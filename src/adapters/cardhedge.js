// Card Hedge adapter — spine of the arbitrage feed.
// Set CARDHEDGE_AUTH=free|apikey|x402 and CARDHEDGE_API_KEY=... in .env
const BASE = 'https://api.cardhedger.com';
const AUTH = process.env.CARDHEDGE_AUTH || 'free';
const KEY  = process.env.CARDHEDGE_API_KEY || '';

export function cardHedgeEnabled() { return AUTH !== 'off' && (AUTH === 'free' || !!KEY); }

function headers() {
  if (AUTH === 'apikey') return { 'X-Api-Key': KEY };
  return {};
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`CardHedge ${path}: ${res.status}`);
  return res.json();
}

// Returns top movers as seed objects for the spread engine.
export async function topMovers(limit = 20) {
  try {
    const data = await get(`/v1/agent/cards/top-movers?limit=${limit}`);
    return (data.cards || data.results || data || []).slice(0, limit);
  } catch {
    return [];
  }
}

// Enriches a seed card with FMV, offers, and comps from Card Hedge.
export async function enrich(seed) {
  try {
    if (!seed.cardId && !seed.id) return null;
    const id = seed.cardId || seed.id;
    const data = await get(`/v1/agent/cards/${id}/prices`);
    return {
      fmv: data.fmv || data.fair_market_value || null,
      offers: (data.prices || data.offers || []).map(p => ({ source: 'cardhedge', price: p.price || p.value, url: p.url, kind: 'ask' })),
      comps: data.comps || data.sales || [],
      history: data.history || [],
    };
  } catch {
    return null;
  }
}
