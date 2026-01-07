import express from 'express';
import Motion3DChallenge, { createChallengeExpressRouter, createChallengeTokenManager } from '@cv-challenge/server';
const app = express();
app.use(express.json({ limit: '1mb' }));

const challengeEngine = new Motion3DChallenge();

const secret = process.env.CHALLENGE_JWT_SECRET ?? 'dev-only-change-me';
const tokenManager = createChallengeTokenManager({ secret, tokenTtlSec: 20 });
const challengeRouter = createChallengeExpressRouter({
  challenge: challengeEngine,
  tokenManager,
  backoff: { scheduleMs: [0, 200, 500] },
  onChallenge: ({ req }) => req.ip,
  onVerified: async ({ x, y }) => {
    console.log('[verify] success', { x, y });
    return undefined;
  }
});

app.use(challengeRouter);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Challenge server running at http://localhost:${port}`);
});
