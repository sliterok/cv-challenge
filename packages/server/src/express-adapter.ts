import express, { type Request, type Response, type Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { EncryptJWT, UnsecuredJWT, jwtDecrypt } from 'jose';
import type { Hitbox } from './types.js';

export type ChallengeTokenPayload = {
  hitbox: Hitbox;
  jti: string;
  exp: number;
};

export type SuccessTokenPayload<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  jti: string;
  exp: number;
  kind: 'success';
  payload?: TPayload;
};

export type SuccessTokenIssueOptions<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  expiresInSec?: number;
  payload?: TPayload;
};

export type ChallengeTokenManagerOptions = {
  secret: string;
  tokenTtlSec?: number;
  successTokenTtlSec?: number;
};

export type ChallengeTokenManager<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  issueToken: (hitbox: Hitbox) => Promise<{
    token: string;
    jti: string;
    expiresAt: number;
    expiresInMs: number;
  }>;
  decryptToken: (token: string) => Promise<ChallengeTokenPayload>;
  issueSuccessToken: (options?: SuccessTokenIssueOptions<TPayload>) => Promise<{
    token: string;
    expiresAt: number;
    expiresInMs: number;
  }>;
  decodeSuccessToken: (token: string) => SuccessTokenPayload<TPayload>;
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

export type ChallengeGenerateOptions = {
  failureCount?: number;
};

export type ChallengeEngine = {
  generate: (options?: ChallengeGenerateOptions) => Promise<{
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

export type ChallengeRequestContext = {
  req: Request;
  res: Response;
};

export type ChallengeBackoffOptions = {
  enabled?: boolean;
  windowMs?: number;
  scheduleMs?: number[];
  maxMs?: number;
};

export type ChallengeExpressAdapterOptions<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  challenge: ChallengeEngine;
  tokenManager: ChallengeTokenManager<TPayload>;
  onChallenge?: (
    context: ChallengeRequestContext
  ) => Promise<string | null | undefined> | string | null | undefined;
  backoff?: ChallengeBackoffOptions;
  onVerified?: (
    context: ChallengeVerifyContext
  ) =>
    | Promise<SuccessTokenIssueOptions<TPayload> | null | undefined>
    | SuccessTokenIssueOptions<TPayload>
    | null
    | undefined;
  validateSuccessToken?: (
    payload: SuccessTokenPayload<TPayload>,
    context: SuccessTokenValidationContext
  ) => Promise<boolean> | boolean;
  debug?: ChallengeDebugLevel;
};

export const createChallengeTokenManager = <TPayload extends Record<string, unknown> = Record<string, unknown>>({
  secret,
  tokenTtlSec = 20,
  successTokenTtlSec = 60
}: ChallengeTokenManagerOptions): ChallengeTokenManager<TPayload> => {
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

  const issueToken = async (
    hitbox: Hitbox
  ): Promise<{ token: string; jti: string; expiresAt: number; expiresInMs: number }> => {
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
    return { token, jti, expiresAt, expiresInMs: tokenTtlSec * 1000 };
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
    options: SuccessTokenIssueOptions<TPayload> = {}
  ): Promise<{ token: string; expiresAt: number; expiresInMs: number }> => {
    const jti = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresInSec =
      typeof options.expiresInSec === 'number' && Number.isFinite(options.expiresInSec)
        ? Math.max(1, Math.floor(options.expiresInSec))
        : successTokenTtlSec;
    const exp = issuedAt + expiresInSec;
    const expiresAt = exp * 1000;
    const payload: SuccessTokenPayload<TPayload> = {
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

  const decodeSuccessToken = (token: string): SuccessTokenPayload<TPayload> => {
    const { payload } = UnsecuredJWT.decode<SuccessTokenPayload<TPayload>>(token);
    if (!payload || typeof payload !== 'object') {
      throw new Error('invalid-success-token');
    }
    const kind = payload.kind as string | undefined;
    const jti = payload.jti as string | undefined;
    const exp = payload.exp as number | undefined;
    const payloadData =
      payload.payload && typeof payload.payload === 'object' ? (payload.payload as TPayload) : undefined;
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

const defaultBackoffWindowMs = 10 * 60 * 1000;
const defaultBackoffScheduleMs = [0, 0, 2000, 5000, 10000, 20000, 35000, 55000, 75000];
const defaultBackoffMaxMs = 75 * 1000;

export const createChallengeExpressRouter = <TPayload extends Record<string, unknown> = Record<string, unknown>>({
  challenge,
  tokenManager,
  onChallenge,
  backoff,
  onVerified,
  validateSuccessToken,
  debug = 'none'
}: ChallengeExpressAdapterOptions<TPayload>): Router => {
  const router = express.Router();
  const minGenerationMs = 5000;
  const maxSuccessFailures = 3;
  const backoffEnabled = Boolean(onChallenge) && (backoff?.enabled ?? true);
  const backoffWindowMs =
    typeof backoff?.windowMs === 'number' && Number.isFinite(backoff.windowMs) && backoff.windowMs > 0
      ? Math.floor(backoff.windowMs)
      : defaultBackoffWindowMs;
  const backoffScheduleMs =
    Array.isArray(backoff?.scheduleMs) && backoff.scheduleMs.length > 0
      ? backoff.scheduleMs
      : defaultBackoffScheduleMs;
  const backoffMaxMs =
    typeof backoff?.maxMs === 'number' && Number.isFinite(backoff.maxMs) && backoff.maxMs > 0
      ? Math.floor(backoff.maxMs)
      : defaultBackoffMaxMs;
  const successTokenState = new Map<
    string,
    { expiresAt: number; consecutiveFailures: number; invalidated: boolean }
  >();
  const challengeSuccessLinks = new Map<
    string,
    { successJti: string; successExpiresAt: number; challengeExpiresAt: number }
  >();
  const activeChallenges = new Map<string, { jti: string; expiresAt: number }>();
  const activeChallengeKeysByJti = new Map<string, string>();
  const backoffStateByKey = new Map<string, { failures: number; lastFailureAt: number; blockedUntil: number }>();

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

  const pruneSuccessState = () => {
    const now = Date.now();
    for (const [jti, state] of successTokenState.entries()) {
      if (state.expiresAt <= now) {
        successTokenState.delete(jti);
      }
    }
    for (const [challengeJti, link] of challengeSuccessLinks.entries()) {
      if (link.challengeExpiresAt <= now || link.successExpiresAt <= now) {
        challengeSuccessLinks.delete(challengeJti);
      }
    }
  };

  const pruneActiveChallenges = () => {
    const now = Date.now();
    for (const [key, entry] of activeChallenges.entries()) {
      if (entry.expiresAt <= now) {
        activeChallenges.delete(key);
        activeChallengeKeysByJti.delete(entry.jti);
        recordBackoffFailure(key);
      }
    }
  };

  const registerActiveChallenge = (key: string, jti: string, expiresAt: number) => {
    const existing = activeChallenges.get(key);
    if (existing) {
      activeChallengeKeysByJti.delete(existing.jti);
    }
    activeChallenges.set(key, { jti, expiresAt });
    activeChallengeKeysByJti.set(jti, key);
  };

  const clearActiveChallenge = (jti: string): string | null => {
    const key = activeChallengeKeysByJti.get(jti);
    if (!key) return null;
    activeChallengeKeysByJti.delete(jti);
    const existing = activeChallenges.get(key);
    if (existing?.jti === jti) {
      activeChallenges.delete(key);
    }
    return key;
  };

  const resolveChallengeKey = async (req: Request, res: Response): Promise<string | null> => {
    if (!onChallenge) return null;
    const key = await onChallenge({ req, res });
    if (typeof key !== 'string') return null;
    const trimmed = key.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const getBackoffDelayMs = (failures: number): number => {
    if (!backoffEnabled || failures <= 0) return 0;
    const index = Math.min(failures - 1, backoffScheduleMs.length - 1);
    const delay = backoffScheduleMs[index] ?? 0;
    return Math.min(Math.max(0, delay), backoffMaxMs);
  };

  const pruneBackoffState = () => {
    if (!backoffEnabled) return;
    const now = Date.now();
    for (const [key, state] of backoffStateByKey.entries()) {
      if (now - state.lastFailureAt > backoffWindowMs) {
        backoffStateByKey.delete(key);
      }
    }
  };

  const getBackoffState = (key: string) => {
    if (!backoffEnabled) return null;
    const state = backoffStateByKey.get(key);
    if (!state) return null;
    if (Date.now() - state.lastFailureAt > backoffWindowMs) {
      backoffStateByKey.delete(key);
      return null;
    }
    return state;
  };

  const resetBackoffState = (key: string) => {
    if (!backoffEnabled) return;
    backoffStateByKey.delete(key);
  };

  const recordBackoffFailure = (key: string) => {
    if (!backoffEnabled) return;
    const now = Date.now();
    const existing = backoffStateByKey.get(key);
    const state =
      existing && now - existing.lastFailureAt <= backoffWindowMs
        ? existing
        : { failures: 0, lastFailureAt: now, blockedUntil: 0 };
    state.failures += 1;
    state.lastFailureAt = now;
    const delayMs = getBackoffDelayMs(state.failures);
    state.blockedUntil = Math.max(state.blockedUntil, now + delayMs);
    backoffStateByKey.set(key, state);
  };

  const registerSuccessToken = (jti: string, expiresAt: number) => {
    const existing = successTokenState.get(jti);
    if (existing) {
      existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
      successTokenState.set(jti, existing);
      return;
    }
    successTokenState.set(jti, {
      expiresAt,
      consecutiveFailures: 0,
      invalidated: false
    });
  };

  const isSuccessTokenInvalidated = (jti: string): boolean => {
    return successTokenState.get(jti)?.invalidated ?? false;
  };

  const recordSuccessTokenResult = (jti: string, expiresAt: number, success: boolean) => {
    const state = successTokenState.get(jti) ?? {
      expiresAt,
      consecutiveFailures: 0,
      invalidated: false
    };
    state.expiresAt = Math.max(state.expiresAt, expiresAt);
    if (success) {
      state.consecutiveFailures = 0;
    } else if (!state.invalidated) {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= maxSuccessFailures) {
        state.invalidated = true;
      }
    }
    successTokenState.set(jti, state);
    if (!success && state.invalidated) {
      logInfo('[success-token] invalidated', { jti, failures: state.consecutiveFailures });
    }
  };

  router.get('/challenge', async (req, res) => {
    try {
      const requestStart = Date.now();
      tokenManager.prune();
      pruneSuccessState();
      pruneActiveChallenges();
      pruneBackoffState();
      const challengeKey = await resolveChallengeKey(req, res);
      let failureCount = 0;
      if (challengeKey) {
        const now = Date.now();
        const backoffState = getBackoffState(challengeKey);
        if (backoffState) {
          failureCount = backoffState.failures;
          if (backoffState.blockedUntil > now) {
            const backoffMs = Math.max(0, backoffState.blockedUntil - now);
            res.set('Retry-After', String(Math.ceil(backoffMs / 1000)));
            res.status(429).json({
              error: 'challenge-backoff',
              backoffExpiresAt: backoffState.blockedUntil,
              backoffExpiresIn: backoffMs
            });
            return;
          }
        }
        const active = activeChallenges.get(challengeKey);
        if (active && active.expiresAt > now) {
          const expiresInMs = Math.max(0, active.expiresAt - now);
          res.set('Retry-After', String(Math.ceil(expiresInMs / 1000)));
          res.status(429).json({
            error: 'challenge-already-issued',
            challengeExpiresAt: active.expiresAt,
            challengeExpiresIn: expiresInMs
          });
          return;
        }
      }
      let hasValidSuccessToken = false;
      let successTokenContext: { jti: string; expMs: number } | null = null;
      const successTokenHeader = req.header('x-challenge-success-token');
      if (successTokenHeader) {
        try {
          const successPayload = tokenManager.decodeSuccessToken(successTokenHeader);
          const successExpMs = successPayload.exp * 1000;
          if (successExpMs > Date.now()) {
            registerSuccessToken(successPayload.jti, successExpMs);
            if (!isSuccessTokenInvalidated(successPayload.jti)) {
              const validation = validateSuccessToken
                ? await validateSuccessToken(successPayload, { req, res })
                : true;
              if (validation) {
                hasValidSuccessToken = true;
                successTokenContext = { jti: successPayload.jti, expMs: successExpMs };
              }
            }
          }
        } catch {
          hasValidSuccessToken = false;
        }
      }
      const { videoBuffer, hitbox, debug: renderDebug } = await challenge.generate({ failureCount });
      const { token, jti, expiresAt, expiresInMs } = await tokenManager.issueToken(hitbox);
      if (challengeKey) {
        registerActiveChallenge(challengeKey, jti, expiresAt);
      }
      if (hasValidSuccessToken && successTokenContext) {
        challengeSuccessLinks.set(jti, {
          successJti: successTokenContext.jti,
          successExpiresAt: successTokenContext.expMs,
          challengeExpiresAt: expiresAt
        });
      }
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
      pruneSuccessState();
      pruneActiveChallenges();
      pruneBackoffState();
      const expiresAt = payload.exp * 1000;
      const challengeKey = clearActiveChallenge(payload.jti);
      if (tokenManager.isBlacklisted(payload.jti)) {
        res.status(401).json({ error: 'token-blacklisted', reload: true });
        return;
      }

      const success = challenge.validate({ x, y }, payload.hitbox);
      if (challengeKey) {
        if (success) {
          resetBackoffState(challengeKey);
        } else {
          recordBackoffFailure(challengeKey);
        }
      }
      const successLink = challengeSuccessLinks.get(payload.jti);
      if (successLink) {
        recordSuccessTokenResult(successLink.successJti, successLink.successExpiresAt, success);
        challengeSuccessLinks.delete(payload.jti);
      }
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
