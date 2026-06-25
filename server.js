import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { cached } from './src/cache.js';
import { buildCard, resetIds } from './src/engine/spread.js';
import * as cardhedge from './src/adapters/cardhedge.js';
import * as ebay from './src/adapters/ebay.js';
import * as apify from './src/adapters/apify.js';
import * as schq from './src/adapters/sportscardhq.js';
import { makeRepo, stripeStub } from './src/store/repo.js';
import { settlementRouter } from './src/routes/settlement.js';
import { appRouter } from './src/routes/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 12);
const CACHE_TTL = Number(process.env.CACHE_TTL || 300);

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()) }));
app.use(express.json());

// Serve the frontend HTML
app.use(express.static(join(__dirname, 'public')));

function activeSources() {
  return {
    cardHedge: cardhedge.cardHedgeEnabled(),
    ebay: ebay.ebayEnabled(),
    apify: apify.apifyEnabled(),
    sportsCardHQ: schq.schqEnabled(),
  };
}

async function buildFeed() {
  resetIds();
  const seeds = await cardhedge.topMovers(40);
  if (seeds.length === 0) return { cards: [], sources: activeSources() };

  const cards = [];
  for (const seed of seeds) {
    const ch = await cardhedge.enrich(seed);
    const offers = ch?.offers ? [...ch.offers] : [];

    if (cards.length < ENRICH_LIMIT) {
      const q = [seed.year, seed.player, seed.set, seed.variant, seed.grader, seed.grade]
        .filter(Boolean).join(' ');
      const [eb, wn] = await Promise.all([ebay.lowestAsk(q), apify.whatnotLowest(q)]);
      if (eb) offers.push(eb);
      if (wn) offers.push(wn);
      const sc = await schq.guidePrice(q, seed.grade);
      if (sc) offers.push(sc);
    }

    const card = buildCard({ ...seed, offers, comps: ch?.comps || [], history: ch?.history || [], fmv: seed.fmv ?? ch?.fmv });
    if (card) cards.push(card);
  }

  cards.sort((a, b) => b.edge - a.edge);
  return { cards, sources: activeSources(), generatedAt: new Date().toISOString() };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, sources: activeSources(), enrichLimit: ENRICH_LIMIT, cacheTtl: CACHE_TTL });
});

app.get('/feed', async (_req, res) => {
  try {
    const payload = await cached('feed', CACHE_TTL, buildFeed);
    if (!payload.cards.length) {
      return res.json({ cards: [], mode: 'demo', sources: activeSources(), note: 'No sources configured — GEMLINE will use built-in demo data.' });
    }
    res.json({ ...payload, mode: 'live' });
  } catch (e) {
    console.error('[feed] error:', e);
    res.status(200).json({ cards: [], mode: 'demo', error: e.message, sources: activeSources() });
  }
});

// ── CardHedge proxy endpoints (public, no auth) ──────────────────────────────
app.get('/api/cardhedge/top-movers', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 60);
    const movers = await cardhedge.topMovers(limit);
    res.json({ cards: movers });
  } catch (e) {
    res.json({ cards: [], error: e.message });
  }
});

app.post('/api/cardhedge/search', async (req, res) => {
  try {
    const { query, sort, limit, offset, sport, variant } = req.body || {};
    const data = await cardhedge.searchCards({
      query: query || '', sort, limit: Math.min(Number(limit) || 40, 100),
      offset: Number(offset) || 0, sport, variant,
    });
    res.json(data);
  } catch (e) {
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
    const data = await cardhedge.comps(req.body.card_id, { limit: req.body.limit || 10 });
    res.json(data || { comps: [] });
  } catch (e) {
    res.json({ comps: [], error: e.message });
  }
});

const repo = await makeRepo();
app.use('/api', settlementRouter(repo, stripeStub));
app.use('/api', appRouter(repo, stripeStub));

app.listen(PORT, () => {
  const s = activeSources();
  console.log(`\nGEMLINE backend on http://localhost:${PORT}`);
  console.log(`  Card Hedge: ${s.cardHedge ? 'on' : 'off'}   eBay: ${s.ebay ? 'on' : 'off'}   Apify: ${s.apify ? 'on' : 'off'}   SportsCardHQ: ${s.sportsCardHQ ? 'on' : 'off'}`);
  console.log(`  Store: ${repo.kind}  |  Frontend: http://localhost:${PORT}/gemline.html\n`);
});

export default app;
