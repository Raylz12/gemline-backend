// Spread engine: merges multi-source offers into a single GEMLINE card shape.
// lo = lowest active ask found, hi = highest recent sold, fmv = midpoint.
// edge % = ((hi - lo) / lo) * 100.

let _seq = 0;
export function resetIds() { _seq = 0; }

/**
 * Removes outliers from a price array using IQR-based filtering.
 * Prevents bad scraped prices from skewing spread calculations.
 */
function removeOutliers(prices) {
  if (prices.length < 4) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const filtered = sorted.filter(p => p >= lower && p <= upper);
  // Fall back to original if too many filtered out
  return filtered.length >= Math.ceil(prices.length * 0.5) ? filtered : sorted;
}

/**
 * Weighted median — more robust than simple median for pricing.
 */
function weightedMedian(prices) {
  if (!prices.length) return 0;
  const s = [...prices].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function buildCard({
  player,
  sport,
  set,
  variant,
  num,
  grader,
  grade,
  fmv,
  offers = [],
  comps = [],
  history = [],
  imageUrl = null,
  year = null,
}) {
  if (!player) return null;
  if (!offers.length && !fmv) return null;

  const rawPrices = offers.map(o => Number(o.price)).filter(p => p > 0 && isFinite(p));
  const prices = removeOutliers(rawPrices);
  if (!prices.length && !fmv) return null;

  const lo  = prices.length ? prices[0] : fmv;
  const hi  = prices.length ? prices[prices.length - 1] : fmv;
  const mid = prices.length ? weightedMedian(prices) : fmv;
  const edge = (hi > lo && lo > 0) ? Math.round(((hi - lo) / lo) * 1000) / 10 : 0;
  const derivedFmv = fmv ?? mid ?? lo ?? 0;

  // Confidence level based on offer count and spread tightness
  let confidence = 'low';
  if (prices.length >= 5 && edge < 30) confidence = 'high';
  else if (prices.length >= 2 && edge < 60) confidence = 'medium';

  // Price range object for the frontend range bar
  const range = { lo, mid: derivedFmv, hi };

  return {
    id: ++_seq,
    player, sport, set, variant, num, grader, grade, year,
    fmv: derivedFmv,
    lo, hi, edge, range,
    confidence,
    imageUrl,
    offerCount: prices.length,
    offers: offers.map(o => ({
      source: o.source,
      price: Number(o.price),
      url: o.url || null,
      kind: o.kind || 'ask',
    })),
    comps: comps.slice(0, 10).map(c => ({
      date: c.sale_date || c.date,
      price: Number(c.sale_price || c.price) || 0,
      source: c.source || 'eBay',
      url: c.listing_url || null,
    })).filter(c => c.price > 0),
    history: history.slice(0, 30),
  };
}

/**
 * Merge multiple spread results for the same card (e.g., same player, different grade combos).
 * Returns the one with the most offers and tightest spread.
 */
export function mergeSpread(cards) {
  if (!cards || cards.length === 0) return null;
  if (cards.length === 1) return cards[0];
  return cards.reduce((best, cur) => {
    if (!best) return cur;
    const score = (c) => (c.offerCount || 0) * 2 + (100 - Math.min(c.edge, 100));
    return score(cur) > score(best) ? cur : best;
  }, null);
}
