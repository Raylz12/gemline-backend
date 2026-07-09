// Card identifier resolution — accepts either our catalog uuid (cards.id) or a
// CardHedge card_id (Bubble-style "1776476645518x2566…") and returns the
// catalog uuid. Several UI entry points (Scout, CardHedge passthrough surfaces)
// carry the CardHedge id in the `id` slot; passing that straight into a
// cards.id = $1 comparison blows up with `invalid input syntax for type uuid`.
//
// Resolution order:
//   1. uuid → returned as-is (existence is the caller's concern, as before)
//   2. CardHedge id → cards.cardhedge_id lookup (one row per grade tier;
//      prefer exact grader/grade hint, then RAW, then most liquid/priced)
//   3. Truly missing → fetch from CardHedge card-details and insert tier rows
//      with the same identity mapping as scripts/crawl-bbfb.cjs
//      (ON CONFLICT DO NOTHING — never touches existing rows).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CARDHEDGE_ID_RE = /^\d{6,}x[\d.]+$/;

const CH_KEY = () => process.env.CARDHEDGE_API_KEY || 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK';

function parseGrade(g) {
  if (!g) return { grader: 'RAW', grade: '' };
  const s = String(g).trim();
  if (/^(raw|ungraded)$/i.test(s)) return { grader: 'RAW', grade: '' };
  const m = s.match(/^([A-Za-z]+)\s+(.+)$/);
  if (m) return { grader: m[1].toUpperCase(), grade: m[2] };
  return { grader: s.toUpperCase(), grade: '' };
}

// Insert catalog rows for one CardHedge card (identity mapping = crawl-bbfb.cjs:
// one row per grade tier, keyed by unique (cardhedge_id, grader, grade)).
async function importFromCardHedge(pool, chId) {
  let card = null;
  try {
    const r = await fetch('https://api.cardhedger.com/v1/cards/card-details', {
      method: 'POST',
      headers: { 'X-API-Key': CH_KEY(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: chId }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return false;
    const data = await r.json();
    card = (data.cards || [])[0] || (data.card_id ? data : null);
  } catch { return false; }
  if (!card || !card.card_id) return false;

  const year = card.year || (card.set && (card.set.match(/\b(19|20)\d{2}\b/) || [''])[0]) || '';
  const image = card.image ? (String(card.image).startsWith('//') ? 'https:' + card.image : card.image) : null;
  const prices = card.prices?.length ? card.prices : [{ grade: 'Raw', price: null }];
  const seen = new Set();
  for (const p of prices) {
    const { grader, grade } = parseGrade(p.grade);
    const k = grader + '|' + grade;
    if (seen.has(k)) continue;
    seen.add(k);
    await pool.query(
      `INSERT INTO cards (id, player, year, card_set, variant, number, sport, grader, grade,
                          cardhedge_id, catalog_price, ebay_thumb, sales_7d, sales_30d, gain_7d, rookie, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
       ON CONFLICT DO NOTHING`,
      [card.player || 'Unknown', year, card.set || '', card.variant || '', card.number || '',
       card.category || 'Other', grader, grade, card.card_id,
       p.price ? parseFloat(p.price) : null, image,
       card['7 Day Sales'] || 0, card['30 Day Sales'] || 0,
       typeof card.gain === 'number' ? card.gain : 0, card.rookie || false]
    ).catch(() => {});
  }
  return true;
}

// Pick the best tier row for a CardHedge id. Hints (grader/grade) win; then
// RAW (default for "I own this card"), then highest price.
async function pickTier(pool, chId, { grader, grade } = {}) {
  const { rows } = await pool.query(
    `SELECT id, grader, grade FROM cards WHERE cardhedge_id = $1
     ORDER BY (upper(coalesce(grader,'')) = 'RAW') DESC, catalog_price DESC NULLS LAST
     LIMIT 24`, [chId]);
  if (!rows.length) return null;
  if (grader) {
    const g = String(grader).toUpperCase();
    const gr = grade != null ? String(grade).trim() : null;
    const exact = rows.find(r =>
      String(r.grader || '').toUpperCase() === g &&
      (gr === null || String(r.grade || '').trim() === gr));
    if (exact) return exact.id;
  }
  return rows[0].id;
}

// Main entry: returns a cards.id uuid or null (never throws on bad input).
export async function resolveCardId(pool, rawId, hints = {}) {
  const id = String(rawId ?? '').trim();
  if (!id) return null;
  if (UUID_RE.test(id)) return id;
  if (!pool || !CARDHEDGE_ID_RE.test(id)) return null;
  let found = await pickTier(pool, id, hints);
  if (found) return found;
  // Truly missing from the catalog — import it, then retry once.
  const imported = await importFromCardHedge(pool, id);
  if (imported) found = await pickTier(pool, id, hints);
  return found;
}
