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

// ── eBay Marketplace Account Deletion Notifications ──────────────────────────
// Required by eBay Developer Program for all apps using eBay APIs.
// GET: responds to eBay's challenge code for endpoint verification.
// POST: receives and acknowledges deletion/closure notifications.
//
// Set in Vercel env vars:
//   EBAY_VERIFICATION_TOKEN  — 32-80 chars, alphanumeric + _ and -
//   EBAY_ENDPOINT_URL        — full public URL of this endpoint, e.g. https://gemlinecards.com/api/ebay/notifications
{
  const { createHash } = await import('crypto');
  const EBAY_TOKEN    = process.env.EBAY_VERIFICATION_TOKEN || 'gemline_ebay_verify_token_v1_2024';
  const EBAY_ENDPOINT = process.env.EBAY_ENDPOINT_URL       || 'https://gemlinecards.com/api/ebay/notifications';

  // Challenge verification — eBay sends GET ?challenge_code=xxx
  app.get('/api/ebay/notifications', (req, res) => {
    const challengeCode = req.query.challenge_code;
    if (!challengeCode) return res.status(400).json({ error: 'missing challenge_code' });

    // Hash in exact order: challengeCode + verificationToken + endpoint
    const hash = createHash('sha256');
    hash.update(challengeCode);
    hash.update(EBAY_TOKEN);
    hash.update(EBAY_ENDPOINT);
    const challengeResponse = hash.digest('hex');

    // Must use JSON library (not string concat) to avoid BOM issues
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ challengeResponse });
  });

  // Notification receiver — eBay sends POST with deletion payload
  app.post('/api/ebay/notifications', express.json({ type: '*/*' }), (req, res) => {
    const notification = req.body;
    const topic = notification?.metadata?.topic || notification?.notification?.notificationId || 'unknown';
    console.log('[ebay-notification] received:', topic, JSON.stringify(notification).slice(0, 200));

    // If this is a MARKETPLACE_ACCOUNT_DELETION event, handle user data deletion
    if (topic === 'MARKETPLACE_ACCOUNT_DELETION' || topic?.includes('deletion')) {
      const userId = notification?.notification?.data?.userId
        || notification?.notification?.data?.username
        || null;
      if (userId) {
        console.log(`[ebay-notification] deletion request for eBay user: ${userId}`);
        // GEMLINE uses Browse API only (client credentials) — no eBay user PII stored.
        // No action needed, but log for compliance audit trail.
      }
    }

    // eBay requires a 200 OK acknowledgment — no body needed
    res.status(200).send();
  });
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

// ── CardHedge proxy endpoints (no auth required for public data) ──────────────
import * as cardhedge from '../src/adapters/cardhedge.js';

app.get('/api/cardhedge/top-movers', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 60);
    const movers = await cardhedge.topMovers(limit);
    res.json({ cards: movers });
  } catch (e) {
    console.error('[cardhedge proxy] top-movers error:', e.message);
    res.json({ cards: [], error: e.message });
  }
});

app.post('/api/cardhedge/search', async (req, res) => {
  try {
    const { search, player, set, category, sort_by, sort_order, page, page_size, raw_images_only } = req.body || {};
    const data = await cardhedge.searchCards({
      search, player, set, category,
      sort_by: sort_by || 'gain',
      sort_order: sort_order || 'desc',
      page: Number(page) || 1,
      page_size: Math.min(Number(page_size) || 40, 100),
      raw_images_only: !!raw_images_only,
    });
    res.json(data);
  } catch (e) {
    console.error('[cardhedge proxy] search error:', e.message);
    res.json({ cards: [], total: 0, error: e.message });
  }
});

app.post('/api/cardhedge/card-fmv', async (req, res) => {
  try {
    const data = await cardhedge.cardFMV(req.body.card_id);
    res.json(data || { error: 'no data' });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.post('/api/cardhedge/all-prices', async (req, res) => {
  try {
    const data = await cardhedge.allPricesByCard(req.body.card_id);
    res.json(data || { error: 'no data' });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.post('/api/cardhedge/comps', async (req, res) => {
  try {
    const { card_id, grade, count, time_weighted, include_raw_prices } = req.body || {};
    const data = await cardhedge.comps(
      card_id,
      grade || 'PSA 10',
      Number(count) || 10,
      time_weighted !== false,
      !!include_raw_prices
    );
    res.json(data || { comps: [] });
  } catch (e) {
    res.json({ comps: [], error: e.message });
  }
});

// ── CardHedge: image match (card scanning) ────────────────────────────────────
app.post('/api/cardhedge/image-match', async (req, res) => {
  try {
    const { image_url, image_base64 } = req.body || {};
    if (!image_url && !image_base64) return res.status(400).json({ error: 'image_url or image_base64 required' });
    const data = await cardhedge.imageMatch(image_url, image_base64);
    res.json(data || { error: 'no match' });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ── CardHedge: price history ──────────────────────────────────────────────────
app.post('/api/cardhedge/price-history', async (req, res) => {
  try {
    const { card_id, grade, days } = req.body || {};
    const data = await cardhedge.priceHistory(card_id, grade || 'PSA 10', Number(days) || 90);
    res.json({ prices: data });
  } catch (e) {
    res.json({ prices: [], error: e.message });
  }
});

// ── CardHedge: FMV by cert number ─────────────────────────────────────────────
app.post('/api/cardhedge/fmv-by-cert', async (req, res) => {
  try {
    const { cert, grader } = req.body || {};
    const data = await cardhedge.fmvByCert(cert, grader || 'PSA');
    res.json(data || { error: 'not found' });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ── CardHedge: sales stats (for heatmap / community trending) ─────────────────
app.post('/api/cardhedge/sales-stats', async (req, res) => {
  try {
    const { players, interval, periods } = req.body || {};
    const data = await cardhedge.salesStatsByPlayer(players || [], interval || 'week', Number(periods) || 8);
    res.json(data || { results: [] });
  } catch (e) {
    res.json({ results: [], error: e.message });
  }
});

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
