# Motion3DCaptcha POC

Server-side 3D captcha rendering using OpenCV and FFmpeg. The demo renders 20 densely packed cubes in a 2.4:1, 180px-tall clip with noise-driven transforms, Lambertian shading, randomized colors, and WebM alpha output. Verification is simplified by keeping the target object static in screen space and storing a single hitbox in an encrypted JWT.

## What this POC includes

- TypeScript + ESM implementation (`index.ts`).
- Express captcha API server (`server.ts`).
- React plugin (Vite library) in `packages/react-plugin`.
- Vite demo app in `apps/demo`.
- Encrypted JWT (JWE) token containing the target hitbox.
- Static and moving object populations in roughly equal proportions.

## Rendering pipeline

1. **Transform**: Each cube is scaled, rotated, and optionally morphed using simplex noise.
2. **Shading**: Lambertian reflectance is computed per face from a key and fill light.
3. **Projection**: Manual pinhole projection converts 3D vertices to screen space.
4. **Encoding**: BGRA frames are streamed into FFmpeg (`libvpx-vp9`) with alpha.

## Verification model

- The target object is always **static in position** (it still rotates/scales).
- A single screen-space hitbox is computed by sampling the target across the clip.
- The hitbox is encrypted into a JWT token, so no server-side session storage is required.
- Tokens expire after ~20 seconds; failed attempts are blacklisted until expiry.
- Express helpers are available via `createCaptchaExpressRouter` and `createCaptchaTokenManager`.

## Running the demo

```bash
pnpm install
pnpm dev
```

This starts the captcha server on `http://localhost:3000` and the Vite demo on `http://localhost:5173`.
Use `pnpm dev:server` or `pnpm dev:demo` if you want to run them separately.

## React plugin

The React component lives in `packages/react-plugin` and expects `/captcha` + `/verify` endpoints. It renders a 2.4:1 video with a minimal overlay (loading and expired states only).

### Environment variables

- `CAPTCHA_JWT_SECRET` (required for real deployments): used to encrypt the hitbox token. A dev default is used if not provided.
- `PORT` (optional): overrides the default port `3000`.

## Notes

- WebM alpha support depends on the browser and player. Chrome and Chromium-based browsers work well.
- The demo logs verification responses in the console; remove these for production.
