// Vercel serverless entry — full GEMLINE Express app.
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
import * as ebayScraper from '../src/adapters/ebay-scraper.js';
import { resolveImages } from '../src/adapters/images.js';
import { makeRepo, stripeStub } from '../src/store/repo.js';
import { settlementRouter } from '../src/routes/settlement.js';
import { appRouter } from '../src/routes/app.js';
import { CATALOG } from '../src/data/catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || 8);
const CACHE_TTL    = Number(process.env.CACHE_TTL    || 600); // 10 min — real scrapes are expensive

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

function activeSources() {
  return {
    cardHedge:   cardhedge.cardHedgeEnabled(),
    ebay:        ebay.ebayEnabled(),
    apify:       apify.apifyEnabled(),
    ebayScraper: ebayScraper.ebayScraperEnabled(),
    sportsCardHQ: schq.schqEnabled(),
  };
}

// ── Live enrichment: fetch real prices + image for one catalog entry ──────────
async function enrichEntry(entry, imageUrl) {
  const q = entry.ebayQuery;

  // Parallel: sold comps + active ask + whatnot
  const [soldComps, activeAsk, whatnot] = await Promise.all([
    ebayScraper.soldComps(q, 5).catch(() => []),
    ebayScraper.activeLowestAsk(q).catch(() => null),
    apify.whatnotLowest(q).catch(() => null),
  ]);

  const offers = [];

  // Active asks (what you can buy right now)
  if (activeAsk) offers.push(activeAsk);
  if (whatnot)   offers.push(whatnot);

  // Sold comps (what it actually sold for — highest is the ceiling)
  for (const c of soldComps) offers.push({ ...c, kind: 'comp' });

  // Need at least 2 data points to show a spread; skip if empty
  if (offers.length < 2) return null;

  const comps = soldComps.map(s => ({ price: s.price, source: 'ebay_sold', url: s.url }));

  return buildCard({ ...entry, offers, comps, imageUrl });
}

// ── Build full feed ───────────────────────────────────────────────────────────
async function buildFeed() {
  resetIds();

  // 1. Card Hedge (primary — if key configured)
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
            const [eb, wn] = await Promise.all([ebay.lowestAsk(q), apify.whatnotLowest(q)]);
            if (eb) offers.push(eb);
            if (wn) offers.push(wn);
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

  // 2. Live scrape: catalog identity + eBay real prices + card images
  if (ebayScraper.ebayScraperEnabled() || apify.apifyEnabled()) {
    try {
      // Fetch images for all catalog cards in parallel
      const imageUrls = await resolveImages(CATALOG, ENRICH_LIMIT).catch(() => CATALOG.map(() => null));

      // Enrich top N with live eBay data; rest get no data (excluded from feed)
      const enrichPromises = CATALOG.slice(0, ENRICH_LIMIT).map((entry, i) =>
        enrichEntry(entry, imageUrls[i] ?? null).catch(() => null)
      );
      const enriched = await Promise.all(enrichPromises);
      const cards = enriched.filter(Boolean);

      if (cards.length > 0) {
        cards.sort((a, b) => b.edge - a.edge);
        return { cards, sources: activeSources(), mode: 'live_scraped', generatedAt: new Date().toISOString() };
      }
    } catch { /* fall through */ }
  }

  // 3. No data — return empty so frontend uses its built-in demo
  return { cards: [], sources: activeSources(), mode: 'demo', generatedAt: new Date().toISOString() };
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, sources: activeSources(), enrichLimit: ENRICH_LIMIT, cacheTtl: CACHE_TTL });
});

app.get('/feed', async (_req, res) => {
  try {
    const payload = await cached('feed', CACHE_TTL, buildFeed);
    res.json(payload);
  } catch (e) {
    console.error('[feed] error:', e);
    res.json({ cards: [], mode: 'demo', error: e.message, sources: activeSources() });
  }
});

// ── /api/image — lazy card image lookup (cached) ─────────────────────────────
const _imageEndpointCache = new Map();
app.get('/api/image', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json({ url: null });
  if (_imageEndpointCache.has(q)) return res.json({ url: _imageEndpointCache.get(q) });

  try {
    // Pokemon: use TCG API
    if (q.toLowerCase().includes('pokémon') || q.toLowerCase().includes('pokemon') ||
        ['charizard','pikachu','umbreon','mewtwo','rayquaza'].some(p => q.toLowerCase().includes(p))) {
      const name = q.split(' ')[0];
      const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=name:"${encodeURIComponent(name)}"&pageSize=1`);
      if (r.ok) {
        const d = await r.json();
        const url = d.data?.[0]?.images?.large || null;
        _imageEndpointCache.set(q, url);
        return res.json({ url });
      }
    }

    // Sports: eBay thumbnail via Apify
    const { ebayThumbnail } = await import('../src/adapters/images.js');
    // ebayThumbnail is not exported directly — use resolveImage with a fake entry
    const { resolveImage } = await import('../src/adapters/images.js');
    const entry = { sport: 'Sports', player: q, set: '', variant: '', grader: '', grade: '', ebayQuery: q };
    const url = await resolveImage(entry);
    _imageEndpointCache.set(q, url);
    res.json({ url });
  } catch (e) {
    res.json({ url: null });
  }
});

// Settlement + app routes
let repo;
async function getRepo() {
  if (!repo) repo = await makeRepo();
  return repo;
}
app.use('/api', async (req, res, next) => { const r = await getRepo(); settlementRouter(r, stripeStub)(req, res, next); });
app.use('/api', async (req, res, next) => { const r = await getRepo(); appRouter(r, stripeStub)(req, res, next); });

export default app;
