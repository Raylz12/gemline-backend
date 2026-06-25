// Card Hedge adapter — spine of the arbitrage feed.
// API Key set via CARDHEDGE_API_KEY env var
const BASE = 'https://api.cardhedger.com';
const KEY  = process.env.CARDHEDGE_API_KEY || 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';

export function cardHedgeEnabled() { return !!KEY; }

function headers() {
  return { 'X-API-Key': KEY, 'Content-Type': 'application/json' };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`CardHedge ${path}: ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CardHedge ${path}: ${res.status}`);
  return res.json();
}

// ── Top Movers ────────────────────────────────────────────────────────────────
// Returns cards with biggest weekly price gains (< 500% filtered out).
export async function topMovers(limit = 20, category = null) {
  try {
    const qs = `?count=${limit}${category ? `&category=${encodeURIComponent(category)}` : ''}`;
    const data = await get(`/v1/cards/top-movers${qs}`);
    return (data.cards || []).slice(0, limit);
  } catch (e) {
    console.error('CardHedge topMovers:', e.message);
    return [];
  }
}

// ── Card Search (with sorting) ────────────────────────────────────────────────
// sort_by: "gain" | "gain_30day" | "sales_7day" | "sales_30day" | "price" | "description"
// sort_order: "asc" | "desc"
export async function searchCards({ search, player, set, category, sort_by = 'gain', sort_order = 'desc', page = 1, page_size = 20, raw_images_only = false } = {}) {
  try {
    const body = { page, page_size, sort_by, sort_order };
    if (search) body.search = search;
    if (player) body.player = player;
    if (set) body.set = set;
    if (category) body.category = category;
    if (raw_images_only) body.raw_images_only = true;
    const data = await post('/v1/cards/search-cards-wsort', body);
    return data;
  } catch (e) {
    console.error('CardHedge searchCards:', e.message);
    return { pages: 0, count: 0, cards: [] };
  }
}

// ── Card Search (basic) ───────────────────────────────────────────────────────
export async function cardSearch({ search, player, set, category, rookie, page = 1, page_size = 20 } = {}) {
  try {
    const body = { page, page_size };
    if (search) body.search = search;
    if (player) body.player = player;
    if (set) body.set = set;
    if (category) body.category = category;
    if (rookie) body.rookie = rookie;
    const data = await post('/v1/cards/card-search', body);
    return data;
  } catch (e) {
    console.error('CardHedge cardSearch:', e.message);
    return { pages: 0, count: 0, cards: [] };
  }
}

// ── Card Match (AI natural language) ─────────────────────────────────────────
export async function matchCard(query, category = null, max_candidates = 10) {
  try {
    const body = { query, max_candidates };
    if (category) body.category = category;
    const data = await post('/v1/cards/card-match', body);
    return data; // { card, confidence, candidates }
  } catch (e) {
    console.error('CardHedge matchCard:', e.message);
    return null;
  }
}

// ── Card Details ──────────────────────────────────────────────────────────────
export async function cardDetails(card_id, raw_images_only = false) {
  try {
    const data = await post('/v1/cards/card-details', { card_id, raw_images_only });
    return data.cards?.[0] || null;
  } catch (e) {
    console.error('CardHedge cardDetails:', e.message);
    return null;
  }
}

// ── All Prices Across All Grades ──────────────────────────────────────────────
// Returns array of { card_id, grade, grader, price, display_order }
export async function allPricesByCard(card_id) {
  try {
    const data = await post('/v1/cards/all-prices-by-card', { card_id });
    return (data.prices || []).sort((a, b) => Number(a.display_order) - Number(b.display_order));
  } catch (e) {
    console.error('CardHedge allPricesByCard:', e.message);
    return [];
  }
}

// ── FMV (Fair Market Value) ───────────────────────────────────────────────────
export async function cardFMV(card_id, grade = 'PSA 10') {
  try {
    return await post('/v1/cards/card-fmv', { card_id, grade });
  } catch (e) {
    console.error('CardHedge cardFMV:', e.message);
    return null;
  }
}

// ── Batch FMV ─────────────────────────────────────────────────────────────────
export async function cardFMVBatch(items) {
  // items: [{ card_id, grade }, ...]
  try {
    const data = await post('/v1/cards/card-fmv-batch', { items });
    return data.results || [];
  } catch (e) {
    console.error('CardHedge cardFMVBatch:', e.message);
    return [];
  }
}

// ── Price Estimate ────────────────────────────────────────────────────────────
export async function priceEstimate(card_id, grade = 'PSA 10') {
  try {
    return await post('/v1/cards/price-estimate', { card_id, grade });
  } catch (e) {
    console.error('CardHedge priceEstimate:', e.message);
    return null;
  }
}

// ── Comparable Sales ──────────────────────────────────────────────────────────
export async function comps(card_id, grade = 'PSA 10', count = 10, time_weighted = true, include_raw_prices = false) {
  try {
    return await post('/v1/cards/comps', { card_id, grade, count, time_weighted, include_raw_prices });
  } catch (e) {
    console.error('CardHedge comps:', e.message);
    return null;
  }
}

// ── Price History ─────────────────────────────────────────────────────────────
export async function priceHistory(card_id, grade = 'PSA 10', days = 90) {
  try {
    const data = await post('/v1/cards/prices-by-card', { card_id, grade, days });
    return data.prices || [];
  } catch (e) {
    console.error('CardHedge priceHistory:', e.message);
    return [];
  }
}

// ── Price Updates (delta polling) ─────────────────────────────────────────────
export async function priceUpdates(since, ignore_grades = []) {
  try {
    const body = { since };
    if (ignore_grades.length) body.ignore_grades = ignore_grades;
    const data = await post('/v1/cards/price-updates', body);
    return data;
  } catch (e) {
    console.error('CardHedge priceUpdates:', e.message);
    return { updates: [], count: 0 };
  }
}

// ── Prices by Cert ────────────────────────────────────────────────────────────
export async function pricesByCert(cert, grader = 'PSA', days = 180) {
  try {
    return await post('/v1/cards/prices-by-cert', { cert, grader, days });
  } catch (e) {
    console.error('CardHedge pricesByCert:', e.message);
    return null;
  }
}

// ── FMV by Cert ───────────────────────────────────────────────────────────────
export async function fmvByCert(cert, grader = 'PSA') {
  try {
    return await post('/v1/cards/fmv-by-cert', { cert, grader });
  } catch (e) {
    console.error('CardHedge fmvByCert:', e.message);
    return null;
  }
}

// ── Image Match (AI card identification from photo) ───────────────────────────
export async function imageMatch(image_url = null, image_base64 = null, k = 10) {
  try {
    const body = { k };
    if (image_url) body.image_url = image_url;
    if (image_base64) body.image_base64 = image_base64;
    return await post('/v1/cards/image-match', body);
  } catch (e) {
    console.error('CardHedge imageMatch:', e.message);
    return null;
  }
}

// ── Image Search (visual similarity) ─────────────────────────────────────────
export async function imageSearch(image_url = null, image_base64 = null, k = 10) {
  try {
    const body = { k };
    if (image_url) body.image_url = image_url;
    if (image_base64) body.image_base64 = image_base64;
    return await post('/v1/cards/image-search', body);
  } catch (e) {
    console.error('CardHedge imageSearch:', e.message);
    return null;
  }
}

// ── Sales Stats by Player (trend data) ───────────────────────────────────────
export async function salesStatsByPlayer(players, interval = 'week', periods = 8) {
  try {
    return await post('/v1/cards/sales-stats-by-player', { players, interval, periods });
  } catch (e) {
    console.error('CardHedge salesStatsByPlayer:', e.message);
    return null;
  }
}

// ── Total Sales by Player ─────────────────────────────────────────────────────
export async function totalSalesByPlayer(players, days = 30) {
  try {
    return await post('/v1/cards/total-sales-by-player', { players, days });
  } catch (e) {
    console.error('CardHedge totalSalesByPlayer:', e.message);
    return null;
  }
}

// ── 90-Day Prices by Grade ────────────────────────────────────────────────────
export async function pricesByGrade({ grade, search, category, page = 1, page_size = 50 } = {}) {
  try {
    const body = { grade, page, page_size };
    if (search) body.search = search;
    if (category) body.category = category;
    return await post('/v1/cards/90day-prices-by-grade', body);
  } catch (e) {
    console.error('CardHedge pricesByGrade:', e.message);
    return { page: 1, pages: 0, cards: [] };
  }
}

// ── Set Search ────────────────────────────────────────────────────────────────
export async function setSearch({ search, category, count = 25 } = {}) {
  try {
    const body = { count };
    if (search) body.search = search;
    if (category) body.category = category;
    return await post('/v1/cards/set-search', body);
  } catch (e) {
    console.error('CardHedge setSearch:', e.message);
    return { count: 0, sets: [] };
  }
}

// ── Enrich a card with all grade prices + FMV ────────────────────────────────
// Used by the spread engine to build a fully hydrated card object.
export async function enrich(card) {
  try {
    const card_id = card.card_id || card.cardId || card.id;
    if (!card_id) return null;
    const [prices, fmvData] = await Promise.all([
      allPricesByCard(card_id),
      cardFMV(card_id, 'PSA 10'),
    ]);
    return {
      fmv: fmvData?.price || null,
      fmvData,
      grades: prices, // all grade/price combos
      offers: prices.map(p => ({
        source: 'cardhedge',
        grade: p.grade,
        grader: p.grader,
        price: Number(p.price),
        kind: 'ask',
      })),
    };
  } catch (e) {
    console.error('CardHedge enrich:', e.message);
    return null;
  }
}
