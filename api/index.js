// Vercel serverless entry point — wraps the full GEMLINE Express app.
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { cached } from '../src/cache.js';
import { buildCard, resetIds } from '../src/engine/spread.js';
import * as cardhedge from '../src/adapters/cardhedge.js';
import * as ebay from '../src/adapters/ebay.js';
import * as apify from '../src/adapters/apify.js';
import * as schq from '../src/adapters/sportscardhq.js';
import { makeRepo, stripeStub } from '../src/store/repo.js';
import { settlementRouter } from '../src/routes/settlement.js';
import { appRouter } from '../src/routes/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 12);
const CACHE_TTL = Number(process.env.CACHE_TTL || 300);

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend from public/
app.use(express.static(join(__dirname, '..', 'public')));

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
      const q = [seed.year, seed.player, seed.set, seed.variant, seed.grader, seed.grade].filter(Boolean).join(' ');
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
      return res.json({ cards: [], mode: 'demo', sources: activeSources(), note: 'No sources configured.' });
    }
    res.json({ ...payload, mode: 'live' });
  } catch (e) {
    res.status(200).json({ cards: [], mode: 'demo', error: e.message, sources: activeSources() });
  }
});

// Lazy-init repo (warm across invocations)
let repo;
async function getRepo() {
  if (!repo) repo = await makeRepo();
  return repo;
}

app.use('/api', async (req, res, next) => {
  const r = await getRepo();
  settlementRouter(r, stripeStub)(req, res, next);
});

app.use('/api', async (req, res, next) => {
  const r = await getRepo();
  appRouter(r, stripeStub)(req, res, next);
});

export default app;
