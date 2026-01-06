# CV Challenge

CV Challenge is a lightweight interactive verification flow that feels more like a short user challenge than a traditional CAPTCHA. It is not designed to prevent volumetric attacks; it focuses on confirming a real user action with a short 3D visual task.

## Packages

- [@cv-challenge/server](packages/server/README.md): server-side renderer, token manager, and Express adapter.
- [@cv-challenge/react-plugin](packages/react-plugin/README.md): React widget with a minimal overlay UX.
- `apps/demo`: Vite demo app that consumes the React plugin.
- `apps/server`: Express server example for local development.

## How it works

- The server renders 20 dense 3D objects with Lambertian shading and transparency.
- One static target object has more prominent motion cues (rotation/scale/morph).
- The client clicks the target; verification uses a single screen-space hitbox.
- Challenge tokens are encrypted; success tokens are encoded only and should be validated server-side.

### Tokens and throttling

- Challenge tokens expire after ~20 seconds; failed attempts are blacklisted until expiry.
- Successful verification returns a success token (60s by default).
- `onVerified` can override success token TTL/payload or return null to skip issuing it.
- `validateSuccessToken` can tie success tokens to session or user data.
- Success tokens are invalidated after 3 consecutive failed verifications tied to them.
- When the success token is sent back to `/challenge`, the server skips the 5s cold-start delay.
- Without a valid success token, `/challenge` responses are padded to ~5 seconds total.
- The React plugin handles the success token and shows a countdown during cold start.
- `onChallenge` can enforce one active challenge per requester (session/IP). When set, new `/challenge` requests return `429` with `Retry-After` until the prior challenge is verified or expires.
- Per-key backoff on failed verifications can add cooldowns (default window 10 minutes, cap 75s); use `onChallenge` to identify the requester. Unverified expired challenges count as failures within the window.

## Defaults

- Default video size: 180x60.
- Default duration: ~3 seconds, 20 objects (server defaults).
- The React widget and server defaults are aligned; override both if you customize size.

## Local development

```bash
pnpm install
pnpm dev
```

This starts the server on `http://localhost:3000` and the Vite demo on `http://localhost:5173`.

Other useful commands:

```bash
pnpm dev:server
pnpm dev:demo
pnpm dev:plugin
```

## Environment variables

- `CHALLENGE_JWT_SECRET`: encryption key for challenge tokens (required for production).
- `PORT`: overrides the server port (default: `3000`).

## Notes

- The server depends on ffmpeg and OpenCV (opencv4nodejs).
- WebM alpha support depends on the browser. Chromium-based browsers work best.
- The demo logs verification responses in the console; remove these for production.

## Publishing

This repo uses Changesets for versioning:

```bash
pnpm changeset
pnpm version-packages
pnpm release
```
