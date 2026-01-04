import express from 'express';
import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import Motion3DCaptcha, { type Hitbox } from './index.js';

type CaptchaToken = {
  hitbox: Hitbox;
};

const app = express();
app.use(express.json({ limit: '1mb' }));

const captchaEngine = new Motion3DCaptcha(640, 480, 3, 36);

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
        --bg-1: #0b1224;
        --bg-2: #19233a;
        --panel: rgba(10, 14, 24, 0.82);
        --line: rgba(255, 255, 255, 0.1);
        --ink: #e9eef8;
        --muted: #9fb2d0;
        --accent: #ffb703;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: "Trebuchet MS", "Lucida Sans Unicode", "Lucida Grande", sans-serif;
        color: var(--ink);
        background: radial-gradient(1200px 600px at 20% 10%, #243354 0%, #11192f 45%, #0b1224 100%);
      }
      .card {
        width: min(960px, 92vw);
        padding: 24px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 22px 50px rgba(0, 0, 0, 0.35);
      }
      header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
        letter-spacing: 0.02em;
      }
      .subtitle {
        color: var(--muted);
        font-size: 0.95rem;
      }
      .stage {
        position: relative;
        border-radius: 14px;
        padding: 12px;
        background: linear-gradient(140deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
        border: 1px dashed rgba(255, 255, 255, 0.12);
      }
      video {
        width: 100%;
        height: auto;
        display: block;
        border-radius: 10px;
        background: transparent;
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 16px;
      }
      button {
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.08);
        color: var(--ink);
        padding: 10px 16px;
        border-radius: 10px;
        font-size: 0.95rem;
        cursor: pointer;
        transition: transform 0.15s ease, background 0.15s ease;
      }
      button:hover {
        background: rgba(255, 255, 255, 0.14);
        transform: translateY(-1px);
      }
      .status {
        font-size: 0.95rem;
        color: var(--accent);
      }
      .debug {
        margin-top: 16px;
        padding: 12px;
        border-radius: 12px;
        background: rgba(10, 14, 24, 0.6);
        border: 1px solid var(--line);
        font-family: "Courier New", monospace;
        font-size: 0.85rem;
        color: var(--muted);
        white-space: pre-wrap;
      }
      .hint {
        margin-top: 10px;
        color: var(--muted);
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <header>
        <h1>Motion3D Captcha POC</h1>
        <div class="subtitle">Static vs moving objects with Lambertian shading</div>
      </header>
      <div class="stage">
        <video id="captchaVideo" autoplay muted loop playsinline></video>
      </div>
      <div class="hint">Click the static object that pulses faster.</div>
      <div class="controls">
        <button id="refresh">New captcha</button>
        <div class="status" id="status">Loading captcha...</div>
      </div>
      <div class="debug" id="debug">Debug output will appear here.</div>
    </div>
    <script>
      const video = document.getElementById('captchaVideo');
      const refresh = document.getElementById('refresh');
      const statusEl = document.getElementById('status');
      const debugEl = document.getElementById('debug');
      let currentToken = null;
      let currentUrl = null;

      const loadCaptcha = async () => {
        statusEl.textContent = 'Loading captcha...';
        const response = await fetch('/captcha', { cache: 'no-store' });
        if (!response.ok) {
          statusEl.textContent = 'Failed to fetch captcha.';
          return;
        }
        const token = response.headers.get('x-captcha-token');
        if (!token) {
          statusEl.textContent = 'Missing token header.';
          return;
        }
        currentToken = token;
        const blob = await response.blob();
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = URL.createObjectURL(blob);
        video.src = currentUrl;
        video.load();
        video.play().catch(() => {});
        statusEl.textContent = 'Click the static object that pulses faster.';
        debugEl.textContent = 'Token: ' + token.slice(0, 18) + '...';
        console.log('[captcha] token', token);
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
          statusEl.textContent = 'Video metadata not ready.';
          return;
        }
        const response = await fetch('/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: currentToken, x: coords.x, y: coords.y })
        });
        const data = await response.json();
        statusEl.textContent = data.success ? 'Verified. Great click.' : 'Not quite. Try again.';
        debugEl.textContent = JSON.stringify(data, null, 2);
        console.log('[verify]', data);
      });

      refresh.addEventListener('click', () => {
        loadCaptcha().catch((err) => {
          statusEl.textContent = 'Failed to load captcha.';
          console.error(err);
        });
      });

      loadCaptcha().catch((err) => {
        statusEl.textContent = 'Failed to load captcha.';
        console.error(err);
      });
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
