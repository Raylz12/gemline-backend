// Apify / Whatnot adapter — scraped public listing prices.
// Set APIFY_TOKEN in .env; optionally APIFY_WHATNOT_ACTOR.
const TOKEN = process.env.APIFY_TOKEN || '';
const ACTOR = process.env.APIFY_WHATNOT_ACTOR || 'apify/whatnot-scraper';

export function apifyEnabled() { return !!TOKEN; }

// Returns the lowest Whatnot ask for a query string.
export async function whatnotLowest(query) {
  if (!apifyEnabled()) return null;
  try {
    const runRes = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: query, maxItems: 5 }),
    });
    const items = await runRes.json();
    if (!Array.isArray(items) || !items.length) return null;
    const sorted = items.filter(i => i.price).sort((a, b) => Number(a.price) - Number(b.price));
    if (!sorted.length) return null;
    return { source: 'whatnot', price: Number(sorted[0].price), url: sorted[0].url || null, kind: 'ask' };
  } catch {
    return null;
  }
}
