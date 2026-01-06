# @cv-challenge/react-plugin

React widget for the CV Challenge verification flow.

## Install

```bash
pnpm add @cv-challenge/react-plugin
```

## Usage

```tsx
import { CvChallenge } from '@cv-challenge/react-plugin';

export const Example = () => (
  <CvChallenge
    apiBaseUrl="http://localhost:3000"
    width={180}
    height={60}
    onVerify={result => console.log(result)}
  />
);
```

## Props

- `apiBaseUrl`: base URL where `/challenge` and `/challenge/verify` live.
- `width`/`height`: widget size in pixels (default 180x60).
- `autoLoad`: when false, shows a "Load challenge" button (default true).
- `className`/`style`: wrapper styling hooks.
- `onVerify`: called after verify requests `{ success, reload }`.
- `onError`: called with error codes (`challenge-fetch-failed`, `challenge-token-missing`, `challenge-request-failed`, `verify-request-failed`).
- `onDebug`: called with debug data from the client or server responses.

## Behavior

- The widget auto-loads a challenge video unless `autoLoad` is disabled.
- On cold start, it shows a 5s countdown and waits for the server padding.
- When `/challenge` responds with `429` and `Retry-After`, the widget shows a retry countdown and auto-retries.
- Success tokens are stored in memory and sent as `X-Challenge-Success-Token`.
- Expired challenges show a reload button; verified challenges show a reset button.

## Endpoint contract

`GET /challenge`

- Response: `video/webm`
- Headers:
  - `X-Challenge-Token`
  - `X-Challenge-Expires-At`
  - `X-Challenge-Expires-In`

`POST /challenge/verify`

- Body: `{ token: string, x: number, y: number }`
- Response: `{ success, reload, successToken, successTokenExpiresAt, successTokenExpiresIn }`
