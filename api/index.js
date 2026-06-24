// Vercel serverless entry point — full GEMLINE Express app.
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { cached } from '../src/cache.js';
import { buildCard, buildCatalogFeed, resetIds } from '../src/engine/spread.js';
import * as cardhedge from '../src/adapters/cardhedge.js';
import * as ebay from '../src/adapters/ebay.js';
import * as apify from '../src/adapters/apify.js';
import * as schq from '../src/adapters/sportscardhq.js';
import * as ebayScraper from '../src/adapters/ebay-scraper.js';
import { makeRepo, stripeStub } from '../src/store/repo.js';
import { settlementRouter } from '../src/routes/settlement.js';
import { appRouter } from '../src/routes/app.js';
import { CATALOG } from '../src/data/catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 8);
const CACHE_TTL = Number(process.env.CACHE_TTL || 300);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

function activeSources() {
  return {
    cardHedge: cardhedge.cardHedgeEnabled(),
    ebay: ebay.ebayEnabled(),
    apify: apify.apifyEnabled(),
    ebayScraper: ebayScraper.ebayScraperEnabled(),
    sportsCardHQ: schq.schqEnabled(),
  };
}

// Enrich a catalog card with live eBay sold comps + active asks via Apify scraper.
async function enrichWithLive(entry) {
  const q = [entry.player, entry.set, entry.variant, entry.grader, entry.grade].filter(Boolean).join(' ');

  const [soldData, activeAsk, whatnot] = await Promise.all([
    ebayScraper.soldComps(q, 3),
    ebayScraper.activeLowestAsk(q),
    apify.whatnotLowest(q),
  ]);

  const offers = [
    { source: 'market_fmv', price: entry.fmv, kind: 'guide' },
    { source: 'market_lo',  price: entry.asks[0], kind: 'ask' },
    { source: 'market_hi',  price: entry.asks[1], kind: 'ask' },
  ];

  if (activeAsk) offers.push(activeAsk);
  if (whatnot) offers.push(whatnot);

  const comps = [
    ...entry.comps.map(p => ({ price: p, source: 'est_comp' })),
    ...soldData.map(s => ({ price: s.price, source: 'ebay_sold', url: s.url })),
  ];

  return buildCard({ ...entry, offers, comps });
}

async function buildFeed() {
  resetIds();

  // Try Card Hedge as primary source first.
  if (cardhedge.cardHedgeEnabled()) {
    try {
      const seeds = await cardhedge.topMovers(40);
      if (seeds.length > 0) {
        const cards = [];
        for (const seed of seeds) {
          const ch = await cardhedge.enrich(seed);
          const offers = ch?.offers ? [...ch.offers] : [];
          if (cards.length < ENRICH_LIMIT) {
            const q = [seed.year, seed.player, seed.set, seed.variant, seed.grader, seed.grade].filter(Boolean).join(' ');
            const [eb, wn, sc] = await Promise.all([
              ebay.lowestAsk(q), apify.whatnotLowest(q), schq.guidePrice(q, seed.grade),
            ]);
            if (eb) offers.push(eb);
            if (wn) offers.push(wn);
            if (sc) offers.push(sc);
          }
          const card = buildCard({ ...seed, offers, comps: ch?.comps || [], history: ch?.history || [], fmv: seed.fmv ?? ch?.fmv });
          if (card) cards.push(card);
        }
        if (cards.length > 0) {
          cards.sort((a, b) => b.edge - a.edge);
          return { cards, sources: activeSources(), mode: 'live', generatedAt: new Date().toISOString() };
        }
      }
    } catch { /* fall through */ }
  }

  // Enrich the static catalog with live eBay data (top N cards to keep Apify cost low).
  if (ebayScraper.ebayScraperEnabled() || apify.apifyEnabled()) {
    try {
      const top = CATALOG.slice(0, ENRICH_LIMIT);
      const rest = CATALOG.slice(ENRICH_LIMIT);

      const enriched = await Promise.all(top.map(e => enrichWithLive(e).catch(() => null)));
      const restCards = rest.map(entry => {
        const offers = [
          { source: 'market_fmv', price: entry.fmv, kind: 'guide' },
          { source: 'market_lo',  price: entry.asks[0], kind: 'ask' },
          { source: 'market_hi',  price: entry.asks[1], kind: 'ask' },
        ];
        return buildCard({ ...entry, offers, comps: entry.comps.map(p => ({ price: p, source: 'est_comp' })) });
      });

      const cards = [...enriched.filter(Boolean), ...restCards.filter(Boolean)];
      cards.sort((a, b) => b.edge - a.edge);
      return { cards, sources: activeSources(), mode: 'enriched', generatedAt: new Date().toISOString() };
    } catch { /* fall through */ }
  }

  // Pure catalog fallback — always works, no API keys needed.
  return buildCatalogFeed();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, sources: activeSources(), enrichLimit: ENRICH_LIMIT, cacheTtl: CACHE_TTL });
});

app.get('/feed', async (_req, res) => {
  try {
    const payload = await cached('feed', CACHE_TTL, buildFeed);
    res.json(payload);
  } catch (e) {
    console.error('[feed] error:', e);
    res.json(buildCatalogFeed());
  }
});

// Lazy-init repo
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
