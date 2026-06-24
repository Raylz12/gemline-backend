// Vercel serverless entry — GEMLINE marketplace backend.
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { makeRepo, stripeStub } from '../src/store/repo.js';
import { settlementRouter } from '../src/routes/settlement.js';
import { appRouter } from '../src/routes/app.js';
import { authRouter, requireAuth } from '../src/routes/auth.js';
import { rateLimit } from '../src/middleware/rateLimit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors({
  origin: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '128kb' }));   // prevent large payload attacks
app.use(express.static(join(__dirname, '..', 'public')));

// ── Lazy-init repo (shared across warm invocations) ───────────────────────────
let repo;
async function getRepo() {
  if (!repo) repo = await makeRepo();
  return repo;
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  ok: true,
  store: process.env.DATABASE_URL ? 'postgres' : 'memory',
  note: process.env.DATABASE_URL
    ? 'Persistent database connected'
    : 'Running in-memory — set DATABASE_URL for persistent multi-user data',
}));

// ── Auth routes (rate-limited, no token required) ─────────────────────────────
app.use('/api/auth', rateLimit({ max: 20, windowMs: 60_000, message: 'Too many auth attempts' }));
app.use('/api/auth', async (req, res, next) => {
  const r = await getRepo();
  authRouter(r)(req, res, next);
});

// ── Static feed (no auth) ─────────────────────────────────────────────────────
app.get('/feed', (_req, res) => res.json({ mode: 'preview', cards: [] }));

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api', rateLimit({ max: 120, windowMs: 60_000 }));
app.use('/api', requireAuth);

app.use('/api', async (req, res, next) => {
  const r = await getRepo();
  settlementRouter(r, stripeStub)(req, res, next);
});

app.use('/api', async (req, res, next) => {
  const r = await getRepo();
  appRouter(r, stripeStub)(req, res, next);
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[error]', req.method, req.path, err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    code: err.code || 'SERVER_ERROR',
  });
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `${req.method} ${req.path} not found` });
});

export default app;
