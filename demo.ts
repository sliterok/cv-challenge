import express from 'express';
import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import Motion3DCaptcha, { type Hitbox } from './index.js';

type CaptchaToken = {
  hitbox: Hitbox;
};

const app = express();
app.use(express.json({ limit: '1mb' }));

const captchaEngine = new Motion3DCaptcha(432, 180, 3, 20);

const secret = process.env.CAPTCHA_JWT_SECRET ?? 'dev-only-change-me';
const jwtKey = createHash('sha256').update(secret).digest();

const encryptPayload = async (payload: CaptchaToken): Promise<string> =>
  new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .encrypt(jwtKey);

const decryptPayload = async (token: string): Promise<CaptchaToken> => {
  const { payload } = await jwtDecrypt(token, jwtKey);
  return payload as CaptchaToken;
};

const renderHtml = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Motion3D Captcha POC</title>
    <style>
      :root {
        --altcha-color-base: transparent;
        --altcha-color-border: #a0a0a0;
        --altcha-color-border-focus: currentColor;
        --altcha-color-text: currentColor;
        --altcha-color-active: #1d1dc9;
        --altcha-color-footer-bg: transparent;
        --altcha-color-error-text: #f23939;
        --altcha-border-width: 1px;
        --altcha-border-radius: 3px;
        --altcha-max-width: 260px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: "Space Grotesk", "Trebuchet MS", sans-serif;
        color: #1a1a1a;
        background: radial-gradient(circle at top, #f8f8fb 0%, #eef1f6 100%);
      }
      .page {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        align-items: flex-start;
      }
      .altcha {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: var(--altcha-max-width);
        border: var(--altcha-border-width) solid var(--altcha-color-border);
        border-radius: var(--altcha-border-radius);
        background: var(--altcha-color-base);
        color: var(--altcha-color-text);
      }
      .altcha:focus-within {
        border-color: var(--altcha-color-border-focus);
      }
      .altcha-main {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
        padding: 0.7rem;
      }
      .altcha-video {
        position: relative;
        width: 100%;
        max-width: calc(var(--altcha-max-width) - 1.4rem);
        aspect-ratio: 2.4 / 1;
        max-height: 180px;
        border-radius: calc(var(--altcha-border-radius) + 2px);
        overflow: hidden;
        background: rgba(0, 0, 0, 0.04);
        border: 1px solid rgba(0, 0, 0, 0.08);
      }
      .altcha-video video {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        cursor: crosshair;
      }
      .altcha-label {
        font-size: 0.9rem;
      }
      .altcha-spinner {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 24px;
        height: 24px;
        border: 2px solid rgba(0, 0, 0, 0.2);
        border-top-color: var(--altcha-color-active);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        animation: spin 0.9s linear infinite;
        display: none;
      }
      .altcha-error {
        display: none;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.85rem;
        color: var(--altcha-color-error-text);
        padding: 0.2rem 0.7rem 0.6rem;
      }
      .altcha-footer {
        display: flex;
        justify-content: end;
        font-size: 0.75rem;
        padding: 0.2rem 0.7rem;
        background: var(--altcha-color-footer-bg);
        opacity: 0.7;
      }
      .altcha-footer:hover {
        opacity: 1;
      }
      .altcha-link {
        border: none;
        background: none;
        color: inherit;
        font: inherit;
        padding: 0;
        cursor: pointer;
        text-decoration: underline;
      }
      .altcha-debug {
        margin: 0;
        padding: 0.5rem 0.7rem;
        font-family: "Courier New", monospace;
        font-size: 0.75rem;
        color: #4a5568;
        background: rgba(0, 0, 0, 0.04);
        border-radius: var(--altcha-border-radius);
        border: 1px solid rgba(0, 0, 0, 0.08);
        max-width: var(--altcha-max-width);
        width: 100%;
        white-space: pre-wrap;
      }
      .altcha[data-state="verifying"] .altcha-spinner {
        display: block;
      }
      .altcha[data-state="verifying"] video {
        filter: saturate(0.9) brightness(0.95);
      }
      .altcha[data-state="verified"] .altcha-label {
        color: var(--altcha-color-active);
      }
      .altcha[data-state="error"] .altcha-error {
        display: flex;
      }
      @keyframes spin {
        to { transform: translate(-50%, -50%) rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="altcha" data-state="verifying" id="captchaWidget">
        <div class="altcha-main">
          <div class="altcha-video altcha-checkbox">
            <video id="captchaVideo" width="432" height="180" autoplay muted loop playsinline></video>
            <div class="altcha-spinner" aria-hidden="true"></div>
          </div>
          <div class="altcha-label" id="status">Loading challenge...</div>
        </div>
        <div class="altcha-error" id="error" hidden>
          <span>!</span>
          <span id="errorText">Something went wrong.</span>
        </div>
        <div class="altcha-footer">
          <button class="altcha-link" id="refresh" type="button">New challenge</button>
        </div>
      </div>
      <pre class="altcha-debug" id="debug">Debug output will appear here.</pre>
    </div>
    <script>
      const widget = document.getElementById('captchaWidget');
      const video = document.getElementById('captchaVideo');
      const refresh = document.getElementById('refresh');
      const statusEl = document.getElementById('status');
      const debugEl = document.getElementById('debug');
      const errorEl = document.getElementById('error');
      const errorText = document.getElementById('errorText');
      let currentToken = null;
      let currentUrl = null;

      const setState = (state, message, errorMessage) => {
        widget.dataset.state = state;
        if (message) {
          statusEl.textContent = message;
        }
        if (errorMessage) {
          errorText.textContent = errorMessage;
          errorEl.hidden = false;
        } else {
          errorEl.hidden = true;
        }
      };

      const loadCaptcha = async () => {
        setState('verifying', 'Loading challenge...');
        currentToken = null;
        try {
          const response = await fetch('/captcha', { cache: 'no-store' });
          if (!response.ok) {
            setState('error', 'Unable to load challenge.', 'Captcha fetch failed.');
            return;
          }
          const token = response.headers.get('x-captcha-token');
          if (!token) {
            setState('error', 'Missing token header.', 'Captcha token missing.');
            return;
          }
          currentToken = token;
          const blob = await response.blob();
          if (currentUrl) URL.revokeObjectURL(currentUrl);
          currentUrl = URL.createObjectURL(blob);
          video.src = currentUrl;
          video.load();
          video.play().catch(() => {});
          setState('unverified', 'Click the static object that pulses faster.');
          debugEl.textContent = 'Token: ' + token.slice(0, 18) + '...';
          console.log('[captcha] token', token);
        } catch (err) {
          setState('error', 'Unable to load challenge.', 'Captcha request failed.');
          console.error(err);
        }
      };

      const getClickCoords = (event) => {
        const rect = video.getBoundingClientRect();
        if (!video.videoWidth || !video.videoHeight) return null;
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
        return {
          x: Math.round((event.clientX - rect.left) * scaleX),
          y: Math.round((event.clientY - rect.top) * scaleY)
        };
      };

      video.addEventListener('click', async (event) => {
        if (!currentToken) return;
        const coords = getClickCoords(event);
        if (!coords) {
          setState('error', 'Video not ready.', 'Video metadata not ready.');
          return;
        }
        setState('verifying', 'Verifying...');
        try {
          const response = await fetch('/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: currentToken, x: coords.x, y: coords.y })
          });
          const data = await response.json();
          if (data.success) {
            setState('verified', 'Verified. Great click.');
          } else {
            setState('error', 'Not quite. Try again.', 'Click missed the target.');
          }
          debugEl.textContent = JSON.stringify(data, null, 2);
          console.log('[verify]', data);
        } catch (err) {
          setState('error', 'Verification failed.', 'Verify request failed.');
          console.error(err);
        }
      });

      refresh.addEventListener('click', () => {
        loadCaptcha();
      });

      loadCaptcha();
    </script>
  </body>
</html>`;

app.get('/', (_req, res) => {
  res.type('html').send(renderHtml());
});

app.get('/captcha', async (_req, res) => {
  try {
    const { videoBuffer, hitbox, debug } = await captchaEngine.generate();
    const token = await encryptPayload({ hitbox });
    res.set('Content-Type', 'video/webm');
    res.set('Cache-Control', 'no-store');
    res.set('X-Captcha-Token', token);
    res.send(videoBuffer);
    console.log('[captcha] generated', { token: token.slice(0, 18), ...debug });
  } catch (error) {
    console.error('[captcha] generation failed', error);
    res.status(500).json({ error: 'captcha-generation-failed' });
  }
});

app.post('/verify', async (req, res) => {
  const { token, x, y } = req.body ?? {};
  if (typeof token !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
    res.status(400).json({ error: 'invalid-request' });
    return;
  }

  try {
    const payload = await decryptPayload(token);
    const success = captchaEngine.validate({ x, y }, payload.hitbox);
    console.log('[verify]', { x, y, success, hitbox: payload.hitbox });
    res.json({ success, hitbox: payload.hitbox, click: { x, y } });
  } catch (error) {
    console.error('[verify] token decrypt failed', error);
    res.status(401).json({ error: 'invalid-token' });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`POC demo running at http://localhost:${port}`);
});
