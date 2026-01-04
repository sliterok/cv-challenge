import React, { useCallback, useEffect, useRef, useState } from 'react';

type VerifyResult = {
  success: boolean;
  reload?: boolean;
};

export type AltchaCaptchaProps = {
  apiBaseUrl?: string;
  className?: string;
  style?: React.CSSProperties;
  width?: number;
  height?: number;
  onVerify?: (result: VerifyResult) => void;
  onError?: (message: string) => void;
  onDebug?: (data: unknown) => void;
};

type Status = 'loading' | 'ready' | 'expired' | 'verified';

const joinUrl = (baseUrl: string, path: string): string => {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
};

export const AltchaCaptcha: React.FC<AltchaCaptchaProps> = ({
  apiBaseUrl = '',
  className,
  style,
  width = 432,
  height = 180,
  onVerify,
  onError,
  onDebug
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const expiryTimerRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [token, setToken] = useState<string | null>(null);

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

  const loadCaptcha = useCallback(async () => {
    setStatus('loading');
    setToken(null);
    clearExpiryTimer();
    try {
      const response = await fetch(joinUrl(apiBaseUrl, '/captcha'), { cache: 'no-store' });
      if (!response.ok) {
        setStatus('expired');
        onError?.('captcha-fetch-failed');
        return;
      }
      const tokenHeader = response.headers.get('x-captcha-token');
      if (!tokenHeader) {
        setStatus('expired');
        onError?.('captcha-token-missing');
        return;
      }
      const expiresAtHeader = response.headers.get('x-captcha-expires-at');
      const expiresInHeader = response.headers.get('x-captcha-expires-in');
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
      setToken(tokenHeader);
      scheduleExpiry(expiresAtMs);
      onDebug?.({ token: tokenHeader.slice(0, 12), expiresAt: expiresAtMs });
    } catch (error) {
      setStatus('expired');
      onError?.('captcha-request-failed');
      onDebug?.(error);
    }
  }, [apiBaseUrl, onDebug, onError]);

  useEffect(() => {
    loadCaptcha();
    return () => {
      clearExpiryTimer();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [loadCaptcha]);

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
      const response = await fetch(joinUrl(apiBaseUrl, '/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, x: coords.x, y: coords.y })
      });
      const data = (await response.json()) as VerifyResult;
      const success = response.ok && data.success;
      onVerify?.({ success, reload: data.reload });
      onDebug?.(data);
      if (!success || data.reload) {
        await loadCaptcha();
        return;
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
      await loadCaptcha();
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
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill', cursor: 'crosshair' }}
      />
      {status === 'loading' && <div style={overlayStyle}>Loading...</div>}
      {status === 'expired' && (
        <div style={overlayStyle}>
          <span>Expired</span>
          <button type="button" style={buttonStyle} onClick={loadCaptcha}>
            Reload
          </button>
        </div>
      )}
      {status === 'verified' && (
        <div style={overlayStyle}>
          <span>Verified</span>
          <button type="button" style={buttonStyle} onClick={loadCaptcha}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
};

export default AltchaCaptcha;
