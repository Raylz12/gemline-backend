/**
 * priceFeed.js — Real price discovery via Apify (eBay + Whatnot)
 * Returns live sold comps for any card query.
 */

const APIFY_TOKEN = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
const EBAY_ACTOR  = 'kJ7qVveeS5kIVhPGB';  // eBay Sold Listings Scraper
const WN_ACTOR    = 'omgr8VWKxGZrtwQKJ';  // Whatnot Scraper

// In-memory cache: key → { ts, data }
const cache = new Map();
const TTL   = 60 * 60 * 1000; // 1 hour

function cached(key, data) {
  cache.set(key, { ts: Date.now(), data });
  return data;
}
function fromCache(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > TTL) { cache.delete(key); return null; }
  return e.data;
}

async function apifyRun(actorId, input, timeoutSec = 55) {
  if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN not set');
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items` +
              `?token=${APIFY_TOKEN}&timeout=${timeoutSec}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Apify ${actorId} error ${r.status}`);
  return r.json();
}

/**
 * Fetch eBay sold listings for a card.
 * Returns array of { title, price, date, type, source:'ebay' }
 */
export async function searchEbaySold(query, maxItems = 12) {
  const key = `ebay:${query}`;
  const hit = fromCache(key);
  if (hit) return hit;

  try {
    const items = await apifyRun(EBAY_ACTOR, {
      searchQueries: [query],
      maxItems,
    });
    const result = (Array.isArray(items) ? items : []).map(i => ({
      title:     i.title || '',
      price:     parseFloat(i.soldPrice) || 0,
      date:      i.soldDate || null,
      type:      i.listingType || 'Fixed',
      thumbnail: i.thumbnail || null,
      url:       i.url || null,
      source:    'ebay',
    })).filter(i => i.price > 0);
    return cached(key, result);
  } catch (e) {
    console.error('eBay scrape failed:', e.message);
    return [];
  }
}

/**
 * Fetch active Whatnot listings for a card.
 * Returns array of { title, price, type, source:'whatnot' }
 */
export async function searchWhatnot(query, maxItems = 10) {
  const key = `wn:${query}`;
  const hit = fromCache(key);
  if (hit) return hit;

  try {
    const items = await apifyRun(WN_ACTOR, {
      mode: 'search',
      searchQuery: query,
      maxItems,
    }, 45);
    const result = (Array.isArray(items) ? items : []).map(i => ({
      title:  i.title || '',
      price:  i.price ? (i.price.amount / 100) : 0,   // Whatnot stores cents
      bid:    i.currentBid ? (i.currentBid.amount / 100) : null,
      type:   i.transactionType === 'AUCTION' ? 'Auction' : 'BuyNow',
      live:   !!i.isLive,
      source: 'whatnot',
    })).filter(i => i.price > 0 || i.bid > 0);
    return cached(key, result);
  } catch (e) {
    console.error('Whatnot scrape failed:', e.message);
    return [];
  }
}

/**
 * Get combined price comps for a card.
 * Returns { comps: [...], stats: { lo, hi, avg, median, count }, sources }
 */
export async function getComps(player, grader, grade, set = '') {
  const q = [player, grader, grade, set].filter(Boolean).join(' ');
  const key = `comps:${q}`;
  const hit = fromCache(key);
  if (hit) return hit;

  const [ebay, wn] = await Promise.all([
    searchEbaySold(q, 12),
    searchWhatnot(q, 8),
  ]);

  const comps = [...ebay, ...wn];
  const prices = comps.map(c => c.price || c.bid || 0).filter(p => p > 0).sort((a, b) => a - b);

  const stats = prices.length ? {
    lo:     prices[0],
    hi:     prices[prices.length - 1],
    avg:    Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    median: prices[Math.floor(prices.length / 2)],
    count:  prices.length,
  } : null;

  const result = {
    query: q,
    comps,
    stats,
    sources: { ebay: ebay.length, whatnot: wn.length },
    ts: Date.now(),
  };
  return cached(key, result);
}

/**
 * Background prefetch for trending cards (feeds the live tape).
 * Returns array of { player, grader, grade, price, change, source }
 */
const TRENDING_QUERIES = [
  'Victor Wembanyama PSA 10 prizm rookie',
  'Shai Gilgeous-Alexander PSA 10 prizm',
  'Caitlin Clark PSA 10 prizm rookie',
  'Patrick Mahomes PSA 10 prizm rookie',
  'Luka Doncic PSA 10 prizm rookie',
  'Charizard PSA 10 base set',
  'LeBron James PSA 10 topps chrome rookie',
  'Zion Williamson PSA 10 prizm rookie',
  'Jude Bellingham PSA 10 prizm rookie',
  'Trae Young PSA 10 prizm rookie',
];

let trendingCache = [];
let trendingTs = 0;

export async function getTrending() {
  if (trendingCache.length && Date.now() - trendingTs < TTL) return trendingCache;

  // Run in parallel (non-blocking — results arrive as they complete)
  const results = await Promise.allSettled(
    TRENDING_QUERIES.map(q => searchEbaySold(q, 5))
  );

  const ticks = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status !== 'fulfilled') continue;
    const items = results[i].value;
    if (!items.length) continue;
    const prices = items.map(x => x.price).filter(Boolean).sort((a, b) => a - b);
    const mid = prices[Math.floor(prices.length / 2)];
    if (!mid) continue;
    ticks.push({
      query:  TRENDING_QUERIES[i],
      price:  mid,
      lo:     prices[0],
      hi:     prices[prices.length - 1],
      count:  prices.length,
      source: 'ebay',
    });
  }

  trendingCache = ticks;
  trendingTs = Date.now();
  return ticks;
}
