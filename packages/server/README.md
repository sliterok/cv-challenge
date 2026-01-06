# @cv-challenge/server

Server-side renderer, token manager, and Express adapter for CV Challenge.

## Install

```bash
pnpm add @cv-challenge/server
```

## Requirements

- ffmpeg available in PATH
- OpenCV for opencv4nodejs

## Engine usage

```ts
import Motion3DChallenge from '@cv-challenge/server';

const engine = new Motion3DChallenge(180, 60, 3, 20);
const { videoBuffer, hitbox, debug } = await engine.generate();
const ok = engine.validate({ x: 42, y: 12 }, hitbox);
```

Constructor defaults:

- width: 180
- height: 60
- durationSec: 3
- objectCount: 20

## Express adapter

```ts
import express from 'express';
import Motion3DChallenge, {
  createChallengeExpressRouter,
  createChallengeTokenManager
} from '@cv-challenge/server';

const app = express();
app.use(express.json({ limit: '1mb' }));

const engine = new Motion3DChallenge();
const tokenManager = createChallengeTokenManager<{ sessionId: string }>({
  secret: process.env.CHALLENGE_JWT_SECRET ?? 'dev-only-change-me',
  tokenTtlSec: 20,
  successTokenTtlSec: 60
});

const router = createChallengeExpressRouter<{ sessionId: string }>({
  challenge: engine,
  tokenManager,
  onChallenge: ({ req }) => String(req.headers['x-session-id'] ?? req.ip ?? ''),
  onVerified: async ({ req }) => {
    const sessionId = String(req.headers['x-session-id'] ?? '');
    if (!sessionId) return null;
    return { expiresInSec: 60, payload: { sessionId } };
  },
  validateSuccessToken: (payload, { req }) => {
    const sessionId = String(req.headers['x-session-id'] ?? '');
    return payload.payload?.sessionId === sessionId;
  },
  debug: 'info'
});

app.use(router);
```

## Routes

`GET /challenge`

- Response: `video/webm`
- Headers:
  - `X-Challenge-Token`
  - `X-Challenge-Expires-At`
  - `X-Challenge-Expires-In`
- Optional request header:
  - `X-Challenge-Success-Token`
- 429 response when `onChallenge` identifies an active challenge:
  - Body: `{ error: "challenge-already-issued", challengeExpiresAt, challengeExpiresIn }`
  - Header: `Retry-After`

`POST /challenge/verify`

- Body: `{ token: string, x: number, y: number }`
- Response: `{ success, reload, successToken, successTokenExpiresAt, successTokenExpiresIn }`

## Token behavior

- Challenge tokens are encrypted with the provided secret.
- Success tokens are encoded only (alg "none"), intended as a short-lived hint to skip cold start.
- Use `validateSuccessToken` to bind success tokens to your own session or user data.
- Success tokens are invalidated after 3 consecutive failed verifications tied to them.
- Failed verification blacklists the challenge token JTI until expiry.

## API options

`createChallengeTokenManager(options)`

- `secret` (required): encryption key for challenge tokens.
- `tokenTtlSec` (default 20): challenge token lifetime.
- `successTokenTtlSec` (default 60): success token lifetime.
- Pass a generic type parameter to type the success token payload.

`createChallengeExpressRouter(options)`

- `challenge` (required): the engine instance.
- `tokenManager` (required): token manager from `createChallengeTokenManager`.
- `onChallenge`: optional callback that returns a unique key for the requester (session id, IP, etc). When provided, only one active challenge per key is allowed; additional `GET /challenge` requests return `429` until the prior challenge is verified or expires.
- `onVerified`: optional callback; return `undefined` for default success token, object to override TTL/payload, or `null` to skip.
- `validateSuccessToken`: optional validator for decoded success token payloads.
- `debug`: `"none"` | `"error"` | `"info"` (default `"none"`).
- Pass a matching generic type parameter to type `SuccessTokenPayload`.
