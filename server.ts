import express from 'express';
import Motion3DCaptcha from './index.js';
import { createCaptchaExpressRouter, createCaptchaTokenManager } from './express-adapter.js';
const app = express();
app.use(express.json({ limit: '1mb' }));

const captchaEngine = new Motion3DCaptcha(432, 180, 3, 20);

const secret = process.env.CAPTCHA_JWT_SECRET ?? 'dev-only-change-me';
const tokenManager = createCaptchaTokenManager({ secret, tokenTtlSec: 20 });
const captchaRouter = createCaptchaExpressRouter({
  captcha: captchaEngine,
  tokenManager,
  onVerified: ({ x, y }) => {
    console.log('[verify] success', { x, y });
  }
});

app.use(captchaRouter);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Captcha server running at http://localhost:${port}`);
});
