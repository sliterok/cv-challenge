import express, { type Request, type Response, type Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { EncryptJWT, UnsecuredJWT, jwtDecrypt } from 'jose';
import type { Hitbox } from './types.js';

export type ChallengeTokenPayload = {
  hitbox: Hitbox;
  jti: string;
  exp: number;
};

export type SuccessTokenPayload = {
  jti: string;
  exp: number;
  kind: 'success';
  payload?: Record<string, unknown>;
};

export type SuccessTokenIssueOptions = {
  expiresInSec?: number;
  payload?: Record<string, unknown>;
};

export type ChallengeTokenManagerOptions = {
  secret: string;
  tokenTtlSec?: number;
  successTokenTtlSec?: number;
};

export type ChallengeTokenManager = {
  issueToken: (hitbox: Hitbox) => Promise<{ token: string; expiresAt: number; expiresInMs: number }>;
  decryptToken: (token: string) => Promise<ChallengeTokenPayload>;
  issueSuccessToken: (options?: SuccessTokenIssueOptions) => Promise<{
    token: string;
    expiresAt: number;
    expiresInMs: number;
  }>;
  decodeSuccessToken: (token: string) => SuccessTokenPayload;
  blacklistToken: (jti: string, expiresAt: number) => void;
  isBlacklisted: (jti: string) => boolean;
  prune: () => void;
};

export type ChallengeVerifyContext = {
  req: Request;
  res: Response;
  token: string;
  jti: string;
  hitbox: Hitbox;
  x: number;
  y: number;
};

export type ChallengeEngine = {
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

export type ChallengeDebugLevel = 'none' | 'error' | 'info';

export type SuccessTokenValidationContext = {
  req: Request;
  res: Response;
};

export type ChallengeExpressAdapterOptions = {
  challenge: ChallengeEngine;
  tokenManager: ChallengeTokenManager;
  onVerified?: (
    context: ChallengeVerifyContext
  ) => Promise<SuccessTokenIssueOptions | null | undefined> | SuccessTokenIssueOptions | null | undefined;
  validateSuccessToken?: (
    payload: SuccessTokenPayload,
    context: SuccessTokenValidationContext
  ) => Promise<boolean> | boolean;
  debug?: ChallengeDebugLevel;
};

export const createChallengeTokenManager = ({
  secret,
  tokenTtlSec = 20,
  successTokenTtlSec = 60
}: ChallengeTokenManagerOptions): ChallengeTokenManager => {
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

  const decryptToken = async (token: string): Promise<ChallengeTokenPayload> => {
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

  const issueSuccessToken = async (
    options: SuccessTokenIssueOptions = {}
  ): Promise<{ token: string; expiresAt: number; expiresInMs: number }> => {
    const jti = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresInSec =
      typeof options.expiresInSec === 'number' && Number.isFinite(options.expiresInSec)
        ? Math.max(1, Math.floor(options.expiresInSec))
        : successTokenTtlSec;
    const exp = issuedAt + expiresInSec;
    const expiresAt = exp * 1000;
    const payload: SuccessTokenPayload = {
      jti,
      exp,
      kind: 'success',
      ...(options.payload ? { payload: options.payload } : {})
    };
    const token = new UnsecuredJWT(payload)
      .setIssuedAt(issuedAt)
      .setExpirationTime(exp)
      .setJti(jti)
      .encode();
    return { token, expiresAt, expiresInMs: expiresInSec * 1000 };
  };

  const decodeSuccessToken = (token: string): SuccessTokenPayload => {
    const { payload } = UnsecuredJWT.decode<SuccessTokenPayload>(token);
    if (!payload || typeof payload !== 'object') {
      throw new Error('invalid-success-token');
    }
    const kind = payload.kind as string | undefined;
    const jti = payload.jti as string | undefined;
    const exp = payload.exp as number | undefined;
    const payloadData =
      payload.payload && typeof payload.payload === 'object' ? (payload.payload as Record<string, unknown>) : undefined;
    if (kind !== 'success' || typeof jti !== 'string' || typeof exp !== 'number') {
      throw new Error('invalid-success-token');
    }
    return {
      jti,
      exp,
      kind: 'success',
      ...(payloadData ? { payload: payloadData } : {})
    };
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
    decodeSuccessToken,
    blacklistToken,
    isBlacklisted: (jti: string) => blacklist.has(jti),
    prune
  };
};

const wait = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

export const createChallengeExpressRouter = ({
  challenge,
  tokenManager,
  onVerified,
  validateSuccessToken,
  debug = 'none'
}: ChallengeExpressAdapterOptions): Router => {
  const router = express.Router();
  const minGenerationMs = 5000;

  const logInfo = (...args: unknown[]) => {
    if (debug === 'info') {
      console.log(...args);
    }
  };

  const logError = (...args: unknown[]) => {
    if (debug !== 'none') {
      console.error(...args);
    }
  };

  router.get('/challenge', async (req, res) => {
    try {
      const requestStart = Date.now();
      tokenManager.prune();
      let hasValidSuccessToken = false;
      const successTokenHeader = req.header('x-challenge-success-token');
      if (successTokenHeader) {
        try {
          const successPayload = tokenManager.decodeSuccessToken(successTokenHeader);
          if (successPayload.exp * 1000 > Date.now()) {
            const validation = validateSuccessToken
              ? await validateSuccessToken(successPayload, { req, res })
              : true;
            hasValidSuccessToken = validation;
          }
        } catch {
          hasValidSuccessToken = false;
        }
      }
      const { videoBuffer, hitbox, debug: renderDebug } = await challenge.generate();
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
      res.set('X-Challenge-Token', token);
      res.set('X-Challenge-Expires-At', String(expiresAt));
      res.set('X-Challenge-Expires-In', String(expiresInMs));
      res.send(videoBuffer);
      logInfo('[challenge] generated', { token: token.slice(0, 12), ...renderDebug });
    } catch (error) {
      logError('[challenge] generation failed', error);
      res.status(500).json({ error: 'challenge-generation-failed' });
    }
  });

  router.post('/challenge/verify', async (req, res) => {
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

      const success = challenge.validate({ x, y }, payload.hitbox);
      let successToken: { token: string; expiresAt: number; expiresInMs: number } | null = null;
      if (!success) {
        tokenManager.blacklistToken(payload.jti, expiresAt);
      } else {
        const override = onVerified
          ? await onVerified({ req, res, token, jti: payload.jti, hitbox: payload.hitbox, x, y })
          : undefined;
        if (override !== null) {
          successToken = await tokenManager.issueSuccessToken(override ?? undefined);
        }
      }

      logInfo('[verify]', { x, y, success, token: payload.jti });
      res.json({
        success,
        reload: !success,
        successToken: successToken?.token ?? null,
        successTokenExpiresAt: successToken?.expiresAt ?? null,
        successTokenExpiresIn: successToken?.expiresInMs ?? null
      });
    } catch (error) {
      logError('[verify] token decrypt failed', error);
      res.status(401).json({ error: 'invalid-token', reload: true });
    }
  });

  return router;
};
