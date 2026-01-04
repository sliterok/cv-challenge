import express, { type Request, type Response, type Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import type { Hitbox } from './index.js';

export type CaptchaTokenPayload = {
  hitbox: Hitbox;
  jti: string;
  exp: number;
};

export type SuccessTokenPayload = {
  jti: string;
  exp: number;
  kind: 'success';
};

export type CaptchaTokenManagerOptions = {
  secret: string;
  tokenTtlSec?: number;
  successTokenTtlSec?: number;
};

export type CaptchaTokenManager = {
  issueToken: (hitbox: Hitbox) => Promise<{ token: string; expiresAt: number; expiresInMs: number }>;
  decryptToken: (token: string) => Promise<CaptchaTokenPayload>;
  issueSuccessToken: () => Promise<{ token: string; expiresAt: number; expiresInMs: number }>;
  decryptSuccessToken: (token: string) => Promise<SuccessTokenPayload>;
  blacklistToken: (jti: string, expiresAt: number) => void;
  isBlacklisted: (jti: string) => boolean;
  prune: () => void;
};

export type CaptchaVerifyContext = {
  req: Request;
  res: Response;
  token: string;
  jti: string;
  hitbox: Hitbox;
  x: number;
  y: number;
};

export type CaptchaEngine = {
  generate: () => Promise<{
    videoBuffer: Buffer;
    hitbox: Hitbox;
    debug: {
      targetId: number;
      staticCount: number;
      movingCount: number;
      objectCount: number;
      hitbox: Hitbox;
      timingMs: { render: number; encode: number; total: number };
    };
  }>;
  validate: (userClick: { x: number; y: number }, hitbox: Hitbox) => boolean;
};

export type CaptchaExpressAdapterOptions = {
  captcha: CaptchaEngine;
  tokenManager: CaptchaTokenManager;
  onVerified?: (context: CaptchaVerifyContext) => void;
};

export const createCaptchaTokenManager = ({
  secret,
  tokenTtlSec = 20,
  successTokenTtlSec = 60
}: CaptchaTokenManagerOptions): CaptchaTokenManager => {
  const jwtKey = createHash('sha256').update(secret).digest();
  const blacklist = new Map<string, number>();

  const prune = (): void => {
    const now = Date.now();
    for (const [jti, expiresAt] of blacklist.entries()) {
      if (expiresAt <= now) {
        blacklist.delete(jti);
      }
    }
  };

  const issueToken = async (hitbox: Hitbox): Promise<{ token: string; expiresAt: number; expiresInMs: number }> => {
    const jti = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);
    const exp = issuedAt + tokenTtlSec;
    const expiresAt = exp * 1000;
    const token = await new EncryptJWT({ hitbox, jti, exp })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt(issuedAt)
      .setExpirationTime(exp)
      .setJti(jti)
      .encrypt(jwtKey);
    return { token, expiresAt, expiresInMs: tokenTtlSec * 1000 };
  };

  const decryptToken = async (token: string): Promise<CaptchaTokenPayload> => {
    const { payload } = await jwtDecrypt(token, jwtKey);
    if (!payload || typeof payload !== 'object') {
      throw new Error('invalid-token');
    }
    const hitbox = payload.hitbox as Hitbox | undefined;
    const jti = payload.jti as string | undefined;
    const exp = payload.exp as number | undefined;
    if (!hitbox || typeof jti !== 'string' || typeof exp !== 'number') {
      throw new Error('invalid-token');
    }
    return { hitbox, jti, exp };
  };

  const issueSuccessToken = async (): Promise<{ token: string; expiresAt: number; expiresInMs: number }> => {
    const jti = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);
    const exp = issuedAt + successTokenTtlSec;
    const expiresAt = exp * 1000;
    const token = await new EncryptJWT({ jti, exp, kind: 'success' as const })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt(issuedAt)
      .setExpirationTime(exp)
      .setJti(jti)
      .encrypt(jwtKey);
    return { token, expiresAt, expiresInMs: successTokenTtlSec * 1000 };
  };

  const decryptSuccessToken = async (token: string): Promise<SuccessTokenPayload> => {
    const { payload } = await jwtDecrypt(token, jwtKey);
    if (!payload || typeof payload !== 'object') {
      throw new Error('invalid-success-token');
    }
    const kind = payload.kind as string | undefined;
    const jti = payload.jti as string | undefined;
    const exp = payload.exp as number | undefined;
    if (kind !== 'success' || typeof jti !== 'string' || typeof exp !== 'number') {
      throw new Error('invalid-success-token');
    }
    return { jti, exp, kind: 'success' };
  };

  const blacklistToken = (jti: string, expiresAt: number): void => {
    if (jti) {
      blacklist.set(jti, expiresAt);
    }
  };

  return {
    issueToken,
    decryptToken,
    issueSuccessToken,
    decryptSuccessToken,
    blacklistToken,
    isBlacklisted: (jti: string) => blacklist.has(jti),
    prune
  };
};

const wait = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

export const createCaptchaExpressRouter = ({
  captcha,
  tokenManager,
  onVerified
}: CaptchaExpressAdapterOptions): Router => {
  const router = express.Router();
  const minGenerationMs = 5000;

  router.get('/captcha', async (_req, res) => {
    try {
      const requestStart = Date.now();
      tokenManager.prune();
      let hasValidSuccessToken = false;
      const successTokenHeader = _req.header('x-captcha-success-token');
      if (successTokenHeader) {
        try {
          const successPayload = await tokenManager.decryptSuccessToken(successTokenHeader);
          if (successPayload.exp * 1000 > Date.now()) {
            hasValidSuccessToken = true;
          }
        } catch {
          hasValidSuccessToken = false;
        }
      }
      const { videoBuffer, hitbox, debug } = await captcha.generate();
      const { token, expiresAt, expiresInMs } = await tokenManager.issueToken(hitbox);
      if (!hasValidSuccessToken) {
        const elapsed = Date.now() - requestStart;
        const remaining = Math.max(0, minGenerationMs - elapsed);
        if (remaining > 0) {
          await wait(remaining);
        }
      }
      res.set('Content-Type', 'video/webm');
      res.set('Cache-Control', 'no-store');
      res.set('X-Captcha-Token', token);
      res.set('X-Captcha-Expires-At', String(expiresAt));
      res.set('X-Captcha-Expires-In', String(expiresInMs));
      res.send(videoBuffer);
      console.log('[captcha] generated', { token: token.slice(0, 12), ...debug });
    } catch (error) {
      console.error('[captcha] generation failed', error);
      res.status(500).json({ error: 'captcha-generation-failed' });
    }
  });

  router.post('/verify', async (req, res) => {
    const { token, x, y } = req.body ?? {};
    if (typeof token !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
      res.status(400).json({ error: 'invalid-request' });
      return;
    }

    try {
      const payload = await tokenManager.decryptToken(token);
      tokenManager.prune();
      const expiresAt = payload.exp * 1000;
      if (tokenManager.isBlacklisted(payload.jti)) {
        res.status(401).json({ error: 'token-blacklisted', reload: true });
        return;
      }

      const success = captcha.validate({ x, y }, payload.hitbox);
      let successToken: { token: string; expiresAt: number; expiresInMs: number } | null = null;
      if (!success) {
        tokenManager.blacklistToken(payload.jti, expiresAt);
      } else {
        successToken = await tokenManager.issueSuccessToken();
        onVerified?.({ req, res, token, jti: payload.jti, hitbox: payload.hitbox, x, y });
      }

      console.log('[verify]', { x, y, success, token: payload.jti });
      res.json({
        success,
        reload: !success,
        successToken: successToken?.token ?? null,
        successTokenExpiresAt: successToken?.expiresAt ?? null,
        successTokenExpiresIn: successToken?.expiresInMs ?? null
      });
    } catch (error) {
      console.error('[verify] token decrypt failed', error);
      res.status(401).json({ error: 'invalid-token', reload: true });
    }
  });

  return router;
};
