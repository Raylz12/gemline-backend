/**
 * cardHedge.js — Card Hedge API adapter
 * Base: https://api.cardhedger.com
 * Auth: X-API-Key header
 * 3.5M+ cards, TODAY's prices, confidence grades, real comps
 *
 * Key endpoints:
 *   POST /v1/cards/card-search      → search by query, returns card_id + prices + image
 *   POST /v1/cards/all-prices-by-card → all grade prices for a card_id
 *   POST /v1/cards/card-fmv         → FMV with confidence A/B/C, lo/mid/hi, freshness
 *   POST /v1/cards/comps            → recent sold comps (comp_price, high, low)
 *   GET  /v1/cards/top-movers       → trending cards
 *   POST /v1/cards/price-estimate   → AI estimate for ungraded
 */

const BASE = 'https://api.cardhedger.com';

function getKey() {
  return process.env.CARDHEDGE_API_KEY || null;
}

function headers() {
  return { 'X-API-Key': getKey(), 'Content-Type': 'application/json' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function post(path, body) {
  const key = getKey();
  if (!key) return null;
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json();
    if (d.detail && typeof d.detail === 'string' && d.detail.includes('Missing')) {
      console.error(`[CH] ${path} missing fields:`, d.detail);
      return null;
    }
    return d;
  } catch(e) {
    console.error(`[CH] ${path} error:`, e.message);
    return null;
  }
}

async function get(path) {
  const key = getKey();
  if (!key) return null;
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { 'X-API-Key': key },
      signal: AbortSignal.timeout(12000),
    });
    return await r.json();
  } catch(e) {
    console.error(`[CH] GET ${path} error:`, e.message);
    return null;
  }
}

/** Search for cards by query string. Returns first 20 matches. */
export async function searchCards(q, limit = 5) {
  const d = await post('/v1/cards/card-search', { q, limit });
  return d?.cards || [];
}

/** Get all grade prices for a specific card_id */
export async function getAllPrices(cardId) {
  const d = await post('/v1/cards/all-prices-by-card', { card_id: cardId });
  return d?.prices || [];
}

/** Get Fair Market Value with confidence score for a specific grade */
export async function getFMV(cardId, grade) {
  const d = await post('/v1/cards/card-fmv', { card_id: cardId, grade });
  return d; // { price, price_low, price_high, confidence, confidence_grade, freshness_days, fmv_sample_count }
}

/** Get recent sold comps */
export async function getComps(cardId, grade, count = 10) {
  const d = await post('/v1/cards/comps', { card_id: cardId, grade, count });
  return d; // { comp_price, high, low, count_used }
}

/** Top movers / trending cards */
export async function getTopMovers() {
  return await get('/v1/cards/top-movers');
}

/**
 * Full price lookup for a card: search → FMV → comps
 * Returns comprehensive price data for display
 */
export async function getCardPriceFull(player, grader, grade, set = '') {
  const key = getKey();
  if (!key) return null;

  // Build grade string for Card Hedge format
  const gradeLabel = (grader && grader !== 'RAW') ? `${grader} ${grade}` : 'Raw';

  // Search for the card
  const q = `${player} ${set}`.trim();
  const results = await searchCards(q, 5);
  if (!results.length) return null;

  // Find best match — prefer exact player name match
  const match = results.find(c => c.player?.toLowerCase().includes(player.toLowerCase().split(' ')[0].toLowerCase())) || results[0];
  const cardId = match.card_id;

  await sleep(300); // small delay between calls

  // Get FMV for the specific grade
  const fmv = await getFMV(cardId, gradeLabel);

  await sleep(300);

  // Get all grade prices
  const allPrices = await getAllPrices(cardId);

  await sleep(300);

  // Get comps
  const comps = await getComps(cardId, gradeLabel, 10);

  // Find the specific grade price from allPrices
  const gradePrice = allPrices.find(p => p.grade?.toLowerCase() === gradeLabel.toLowerCase());

  return {
    cardId,
    player: match.player,
    set: match.set,
    variant: match.variant,
    number: match.number,
    image: match.image,
    category: match.category,
    sevenDaySales: match['7 Day Sales'],
    thirtyDaySales: match['30 Day Sales'],
    isRookie: match.rookie,

    // Price for requested grade
    price: fmv?.price || parseFloat(gradePrice?.price || 0) || null,
    priceLow: fmv?.price_low || null,
    priceHigh: fmv?.price_high || null,
    confidence: fmv?.confidence || null,
    confidenceGrade: fmv?.confidence_grade || null,
    freshnessdays: fmv?.freshness_days || null,
    fmvSamples: fmv?.fmv_sample_count || null,
    gradeLabel,

    // All grade prices
    allPrices,

    // Recent comps
    compPrice: comps?.comp_price || null,
    compHigh: comps?.high || null,
    compLow: comps?.low || null,
    compCount: comps?.count_used || 0,

    source: 'cardhedge',
  };
}

/**
 * Bulk ingest Card Hedge data for all catalog cards
 * Stores in price_history + updates cards table (image, cardhedge_id, catalog_price)
 */
export async function bulkIngestCH(pool, cards) {
  const key = getKey();
  if (!key) {
    console.warn('[CardHedge] No CARDHEDGE_API_KEY set');
    return { stored: 0, skipped: cards.length };
  }

  let stored = 0, skipped = 0, imagesUpdated = 0;

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const grader = (c.grader || 'RAW').toUpperCase();
    const grade = c.grade || '';
    const gradeLabel = (grader !== 'RAW' && grade) ? `${grader} ${grade}` : 'Raw';

    process.stdout.write(`[CH ${i+1}/${cards.length}] ${c.player} ${grader} ${grade}... `);

    try {
      const q = `${c.player} ${c.card_set || ''}`.replace(/\s+/g,' ').trim();
      const results = await searchCards(q, 3);

      if (!results.length) {
        console.log('not found');
        skipped++;
        await sleep(500);
        continue;
      }

      // Best match
      const match = results.find(r =>
        r.player?.toLowerCase().includes(c.player.toLowerCase().split(' ')[0].toLowerCase())
      ) || results[0];

      const cardId = match.card_id;
      await sleep(400);

      // Get FMV
      const fmv = await getFMV(cardId, gradeLabel);
      await sleep(400);

      // Get comps
      const comps = await getComps(cardId, gradeLabel, 10);

      const price = fmv?.price || null;
      const priceLow = fmv?.price_low || null;
      const priceHigh = fmv?.price_high || null;
      const confidence = fmv?.confidence_grade || 'N/A';
      const samples = fmv?.fmv_sample_count || 0;
      const freshness = fmv?.freshness_days ?? '?';

      if (!price && !comps?.comp_price) {
        console.log(`found (${match.player}) but no price data`);
        skipped++;
        await sleep(400);
        continue;
      }

      const finalPrice = price || comps?.comp_price;
      console.log(`$${finalPrice?.toLocaleString()} [${confidence}] ${samples} samples, ${freshness}d fresh`);

      // Store in price_history
      await pool.query(`
        INSERT INTO price_history (id,player,grader,grade,card_set,source,sale_price,listing_url,thumbnail,title,sale_date,scraped_at)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,'cardhedge',$5,$6,$7,$8,NOW(),NOW())
      `, [c.player, grader, grade, c.card_set||'',
          finalPrice,
          `https://gemlinecards.com/cards/${cardId}`,
          match.image || null,
          `${match.player} ${match.set} #${match.number} ${match.variant || ''}`]);
      stored++;

      // Update catalog_price with real FMV
      if (finalPrice > 0) {
        await pool.query(`UPDATE cards SET catalog_price=$1 WHERE id=$2`, [finalPrice, c.id]);
      }

      // Update card image if we got one from Card Hedge
      if (match.image && !c.ebay_thumb) {
        await pool.query(`UPDATE cards SET ebay_thumb=$1 WHERE id=$2 AND ebay_thumb IS NULL`, [match.image, c.id]);
        imagesUpdated++;
      }

      // Store comp prices too (each comp is an individual sale)
      if (comps?.comp_price && comps.comp_price !== finalPrice) {
        await pool.query(`
          INSERT INTO price_history (id,player,grader,grade,card_set,source,sale_price,listing_url,thumbnail,title,sale_date,scraped_at)
          VALUES (gen_random_uuid(),$1,$2,$3,$4,'cardhedge_comp',$5,$6,$7,$8,NOW(),NOW())
        `, [c.player, grader, grade, c.card_set||'',
            comps.comp_price, null, match.image || null,
            `Comp: ${match.player} ${gradeLabel} hi=$${comps.high} lo=$${comps.low}`]);
      }

    } catch(e) {
      console.log('ERROR:', e.message);
      skipped++;
    }

    await sleep(600); // ~1.7 req/sec across the 3 sub-calls
  }

  return { stored, skipped, imagesUpdated };
}
