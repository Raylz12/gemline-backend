import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { cached } from './src/cache.js';
import { buildCard, resetIds } from './src/engine/spread.js';
import * as cardhedge from './src/adapters/cardhedge.js';
import * as ebay from './src/adapters/ebay.js';
import * as apify from './src/adapters/apify.js';
import * as schq from './src/adapters/sportscardhq.js';
import { makeRepo, stripeStub } from './src/store/repo.js';
import { settlementRouter } from './src/routes/settlement.js';
import { appRouter } from './src/routes/app.js';

const PORT = process.env.PORT || 8787;
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 12);
const CACHE_TTL = Number(process.env.CACHE_TTL || 300);

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()) }));
app.use(express.json());

function activeSources() {
  return {
    cardHedge: cardhedge.cardHedgeEnabled(),
    ebay: ebay.ebayEnabled(),
    apify: apify.apifyEnabled(),
    sportsCardHQ: schq.schqEnabled(),
  };
}

// Build the live arbitrage feed: Card Hedge universe → enrich top cards with
// live eBay + Whatnot asks → merge into cross-platform spreads.
async function buildFeed() {
  resetIds();
  const seeds = await cardhedge.topMovers(40);
  if (seeds.length === 0) return { cards: [], sources: activeSources() };

  const cards = [];
  for (const seed of seeds) {
    const ch = await cardhedge.enrich(seed);
    const offers = ch?.offers ? [...ch.offers] : [];

    // Enrich the most volatile cards with live asks from eBay + Whatnot.
    if (cards.length < ENRICH_LIMIT) {
      const q = [seed.year, seed.player, seed.set, seed.variant, seed.grader, seed.grade]
        .filter(Boolean).join(' ');
      const [eb, wn] = await Promise.all([ebay.lowestAsk(q), apify.whatnotLowest(q)]);
      if (eb) offers.push(eb);
      if (wn) offers.push(wn);
      const sc = await schq.guidePrice(q, seed.grade);
      if (sc) offers.push(sc);
    }

    const card = buildCard({
      ...seed,
      offers,
      comps: ch?.comps || [],
      history: ch?.history || [],
      fmv: seed.fmv ?? ch?.fmv,
    });
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
      return res.json({
        cards: [], mode: 'demo', sources: activeSources(),
        note: 'No sources returned data. Add keys in .env (Card Hedge is the spine). GEMLINE will use its built-in demo data.',
      });
    }
    res.json({ ...payload, mode: 'live' });
  } catch (e) {
    console.error('[feed] error:', e);
    res.status(200).json({ cards: [], mode: 'demo', error: e.message, sources: activeSources() });
  }
});

// Settlement engine: orders, trades, escrow, vault, credits. In-memory by
// default; set DATABASE_URL to back it with Postgres (db/schema.sql).
const repo = await makeRepo();
app.use('/api', settlementRouter(repo, stripeStub));
app.use('/api', appRouter(repo, stripeStub));

app.listen(PORT, () => {
  const s = activeSources();
  console.log(`\nGEMLINE backend on http://localhost:${PORT}`);
  console.log(`  Card Hedge: ${s.cardHedge ? 'on' : 'off'}   eBay: ${s.ebay ? 'on' : 'off'}   Apify/Whatnot: ${s.apify ? 'on' : 'off'}   SportsCardHQ: ${s.sportsCardHQ ? 'on' : 'off'}`);
  console.log(`  Settlement store: ${repo.kind}  (orders/trades/escrow/vault at /api/*)`);
  if (!s.cardHedge && !s.ebay && !s.apify) {
    console.log('  No sources configured — /feed will return demo mode. Copy .env.example → .env and add keys.\n');
  } else { console.log(''); }
});
