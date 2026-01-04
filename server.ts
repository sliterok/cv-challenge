import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import Motion3DCaptcha, { type Hitbox } from './index.js';

type CaptchaToken = {
  hitbox: Hitbox;
  jti?: string;
  exp?: number;
};

const TOKEN_TTL_SEC = 20;
const app = express();
app.use(express.json({ limit: '1mb' }));

const captchaEngine = new Motion3DCaptcha(432, 180, 3, 20);

const secret = process.env.CAPTCHA_JWT_SECRET ?? 'dev-only-change-me';
const jwtKey = createHash('sha256').update(secret).digest();

const blacklist = new Map<string, number>();
const pruneBlacklist = (): void => {
  const now = Date.now();
  for (const [jti, expiresAt] of blacklist.entries()) {
    if (expiresAt <= now) {
      blacklist.delete(jti);
    }
  }
};

const encryptPayload = async (payload: CaptchaToken): Promise<{ token: string; expiresAt: number }> => {
  const jti = randomUUID();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = Date.now() + TOKEN_TTL_SEC * 1000;
  const token = await new EncryptJWT({ ...payload, jti })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + TOKEN_TTL_SEC)
    .setJti(jti)
    .encrypt(jwtKey);
  return { token, expiresAt };
};

const decryptPayload = async (token: string): Promise<CaptchaToken> => {
  const { payload } = await jwtDecrypt(token, jwtKey);
  return payload as CaptchaToken;
};

app.get('/captcha', async (_req, res) => {
  try {
    pruneBlacklist();
    const { videoBuffer, hitbox, debug } = await captchaEngine.generate();
    const { token, expiresAt } = await encryptPayload({ hitbox });
    res.set('Content-Type', 'video/webm');
    res.set('Cache-Control', 'no-store');
    res.set('X-Captcha-Token', token);
    res.set('X-Captcha-Expires-At', String(expiresAt));
    res.set('X-Captcha-Expires-In', String(TOKEN_TTL_SEC * 1000));
    res.send(videoBuffer);
    console.log('[captcha] generated', {
      token: token.slice(0, 12),
      ...debug
    });
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
    if (!payload.hitbox) {
      res.status(401).json({ error: 'invalid-token', reload: true });
      return;
    }
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now();
    const jti = payload.jti ?? 'unknown';
    pruneBlacklist();

    if (blacklist.has(jti)) {
      res.status(401).json({ error: 'token-blacklisted', reload: true });
      return;
    }

    const success = captchaEngine.validate({ x, y }, payload.hitbox);
    if (!success && jti !== 'unknown') {
      blacklist.set(jti, expiresAt);
    }

    console.log('[verify]', { x, y, success, token: jti });
    res.json({ success, reload: !success });
  } catch (error) {
    console.error('[verify] token decrypt failed', error);
    res.status(401).json({ error: 'invalid-token', reload: true });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Captcha server running at http://localhost:${port}`);
});
