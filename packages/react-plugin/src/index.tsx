import React, { useCallback, useEffect, useRef, useState } from 'react';

type VerifyResult = {
  success: boolean;
  reload?: boolean;
  successToken?: string | null;
  successTokenExpiresAt?: number | null;
  successTokenExpiresIn?: number | null;
};

export type CvChallengeProps = {
  apiBaseUrl?: string;
  className?: string;
  style?: React.CSSProperties;
  width?: number;
  height?: number;
  autoLoad?: boolean;
  onVerify?: (result: VerifyResult) => void;
  onError?: (message: string) => void;
  onDebug?: (data: unknown) => void;
};

type Status = 'idle' | 'loading' | 'ready' | 'expired' | 'verified';

const joinUrl = (baseUrl: string, path: string): string => {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
};

export const CvChallenge: React.FC<CvChallengeProps> = ({
  apiBaseUrl = '',
  className,
  style,
  width = 180,
  height = 60,
  autoLoad = true,
  onVerify,
  onError,
  onDebug
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const expiryTimerRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const successTokenRef = useRef<string | null>(null);
  const successTokenExpiresAtRef = useRef<number | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>(autoLoad ? 'loading' : 'idle');
  const [token, setToken] = useState<string | null>(null);
  const [loadingCountdown, setLoadingCountdown] = useState<number | null>(null);

  const clearExpiryTimer = () => {
    if (expiryTimerRef.current !== null) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  };

  const scheduleExpiry = (expiresAtMs: number) => {
    clearExpiryTimer();
    const delay = Math.max(expiresAtMs - Date.now(), 0);
    expiryTimerRef.current = window.setTimeout(() => {
      setStatus('expired');
      const video = videoRef.current;
      if (video) {
        video.pause();
      }
    }, delay);
  };

  const clearSuccessTimer = () => {
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  };

  const clearSuccessToken = () => {
    successTokenRef.current = null;
    successTokenExpiresAtRef.current = null;
    clearSuccessTimer();
  };

  const setSuccessToken = (tokenValue: string, expiresAtMs: number) => {
    successTokenRef.current = tokenValue;
    successTokenExpiresAtRef.current = expiresAtMs;
    clearSuccessTimer();
    const delay = Math.max(expiresAtMs - Date.now(), 0);
    successTimerRef.current = window.setTimeout(() => {
      clearSuccessToken();
    }, delay);
  };

  const getSuccessToken = (): string | null => {
    const tokenValue = successTokenRef.current;
    const expiresAtMs = successTokenExpiresAtRef.current;
    if (!tokenValue || !expiresAtMs) return null;
    if (expiresAtMs <= Date.now()) {
      clearSuccessToken();
      return null;
    }
    return tokenValue;
  };

  const clearCountdown = () => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  };

  const startCountdown = (durationMs: number) => {
    clearCountdown();
    const deadline = Date.now() + durationMs;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setLoadingCountdown(Number((remaining / 1000).toFixed(1)));
      if (remaining <= 0) {
        clearCountdown();
      }
    };
    tick();
    countdownTimerRef.current = window.setInterval(tick, 100);
  };

  const loadChallenge = useCallback(async () => {
    setStatus('loading');
    setToken(null);
    clearExpiryTimer();
    const successToken = getSuccessToken();
    if (successToken) {
      setLoadingCountdown(null);
    } else {
      startCountdown(5000);
    }
    try {
      const headers: Record<string, string> = {};
      if (successToken) {
        headers['x-challenge-success-token'] = successToken;
      }
      const response = await fetch(joinUrl(apiBaseUrl, '/challenge'), { cache: 'no-store', headers });
      if (!response.ok) {
        setStatus('expired');
        onError?.('challenge-fetch-failed');
        clearCountdown();
        return;
      }
      const tokenHeader = response.headers.get('x-challenge-token');
      if (!tokenHeader) {
        setStatus('expired');
        onError?.('challenge-token-missing');
        clearCountdown();
        return;
      }
      const expiresAtHeader = response.headers.get('x-challenge-expires-at');
      const expiresInHeader = response.headers.get('x-challenge-expires-in');
      const expiresAtMs = expiresAtHeader
        ? Number(expiresAtHeader)
        : Date.now() + Number(expiresInHeader ?? 20000);

      const blob = await response.blob();
      const video = videoRef.current;
      if (!video) return;
      const url = URL.createObjectURL(blob);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      objectUrlRef.current = url;
      video.src = url;
      video.load();
      video.play().catch(() => {});
      video.addEventListener(
        'loadeddata',
        () => {
          setStatus(current => (current === 'loading' ? 'ready' : current));
        },
        { once: true }
      );
      clearCountdown();
      setToken(tokenHeader);
      scheduleExpiry(expiresAtMs);
      onDebug?.({ token: tokenHeader.slice(0, 12), expiresAt: expiresAtMs });
    } catch (error) {
      setStatus('expired');
      onError?.('challenge-request-failed');
      clearCountdown();
      onDebug?.(error);
    }
  }, [apiBaseUrl, onDebug, onError]);

  useEffect(() => {
    if (autoLoad) {
      loadChallenge();
    } else {
      setStatus('idle');
      setLoadingCountdown(null);
    }
    return () => {
      clearExpiryTimer();
      clearSuccessTimer();
      clearCountdown();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [autoLoad, loadChallenge]);

  const getClickCoords = (event: React.MouseEvent<HTMLVideoElement>): { x: number; y: number } | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const rect = video.getBoundingClientRect();
    const scaleX = video.videoWidth / rect.width;
    const scaleY = video.videoHeight / rect.height;
    return {
      x: Math.round((event.clientX - rect.left) * scaleX),
      y: Math.round((event.clientY - rect.top) * scaleY)
    };
  };

  const handleClick = async (event: React.MouseEvent<HTMLVideoElement>) => {
    if (status !== 'ready' || !token) return;
    const coords = getClickCoords(event);
    if (!coords) return;

    try {
      const response = await fetch(joinUrl(apiBaseUrl, '/challenge/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, x: coords.x, y: coords.y })
      });
      const data = (await response.json()) as VerifyResult;
      const success = response.ok && data.success;
      onVerify?.({ success, reload: data.reload });
      onDebug?.(data);
      if (!success || data.reload) {
        await loadChallenge();
        return;
      }
      if (data.successToken) {
        const expiresAtMs =
          typeof data.successTokenExpiresAt === 'number'
            ? data.successTokenExpiresAt
            : Date.now() + Number(data.successTokenExpiresIn ?? 60000);
        setSuccessToken(data.successToken, expiresAtMs);
      }
      clearExpiryTimer();
      const video = videoRef.current;
      if (video) {
        video.pause();
      }
      setStatus('verified');
    } catch (error) {
      onError?.('verify-request-failed');
      onDebug?.(error);
      await loadChallenge();
    }
  };

  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    width,
    height,
    overflow: 'hidden',
    borderRadius: 3,
    ...style
  };

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: status === 'loading' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.45)',
    color: '#f2f2f2',
    fontSize: '0.85rem',
    fontFamily: 'system-ui, sans-serif',
    gap: '0.6rem'
  };

  const buttonStyle: React.CSSProperties = {
    border: '1px solid rgba(255, 255, 255, 0.6)',
    background: 'transparent',
    color: 'inherit',
    padding: '0.35rem 0.7rem',
    borderRadius: 4,
    fontSize: '0.85rem',
    cursor: 'pointer'
  };

  const cursorStyle = status === 'ready' ? 'crosshair' : 'default';

  return (
    <div className={className} style={wrapperStyle}>
      <video
        ref={videoRef}
        width={width}
        height={height}
        muted
        playsInline
        loop
        autoPlay
        onClick={handleClick}
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill', cursor: cursorStyle }}
      />
      {status === 'idle' && (
        <div style={overlayStyle}>
          <button type="button" style={buttonStyle} onClick={loadChallenge}>
            Load challenge
          </button>
        </div>
      )}
      {status === 'loading' && (
        <div style={overlayStyle}>
          {loadingCountdown !== null ? `Generating ${loadingCountdown.toFixed(1)}s` : 'Loading...'}
        </div>
      )}
      {status === 'expired' && (
        <div style={overlayStyle}>
          <span>Expired</span>
          <button type="button" style={buttonStyle} onClick={loadChallenge}>
            Reload
          </button>
        </div>
      )}
      {status === 'verified' && (
        <div style={overlayStyle}>
          <span>Verified</span>
          <button type="button" style={buttonStyle} onClick={loadChallenge}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
};

export default CvChallenge;
