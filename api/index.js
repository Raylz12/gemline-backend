// Vercel serverless entry — GEMLINE marketplace backend.
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { makeRepo, stripeStub } from '../src/store/repo.js';
import { settlementRouter } from '../src/routes/settlement.js';
import { appRouter } from '../src/routes/app.js';
import { authRouter, requireAuth } from '../src/routes/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// Lazy-init repo
let repo;
async function getRepo() {
  if (!repo) repo = await makeRepo();
  return repo;
}

// ── Auth (no token required) ──────────────────────────────────────────────────
app.use('/api/auth', async (req, res, next) => {
  const r = await getRepo();
  authRouter(r)(req, res, next);
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, store: 'memory' }));

// ── Static marketplace feed (no auth, no scraping) ───────────────────────────
// Returns a snapshot of the demo marketplace so unauthenticated users can
// preview the arbitrage engine. Login to interact.
app.get('/feed', (_req, res) => {
  res.json({
    mode: 'preview',
    message: 'Sign in to access the full live marketplace.',
    cards: [],
  });
});

// ── Protected routes — require valid session token ────────────────────────────
app.use('/api', requireAuth);

app.use('/api', async (req, res, next) => {
  const r = await getRepo();
  settlementRouter(r, stripeStub)(req, res, next);
});

app.use('/api', async (req, res, next) => {
  const r = await getRepo();
  appRouter(r, stripeStub)(req, res, next);
});

export default app;
