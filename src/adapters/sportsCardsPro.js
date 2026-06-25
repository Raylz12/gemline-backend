/**
 * sportsCardsPro.js — SportsCardsPro API adapter
 * Base URL: https://www.sportscardspro.com
 * Rate limit: 1 req/sec
 *
 * Price key mapping (confusing but documented):
 *   manual-only-price  = PSA 10
 *   box-only-price     = Graded 9.5
 *   graded-price       = Graded 9 (PSA 9)
 *   new-price          = Graded 8 or 8.5
 *   cib-price          = Graded 7 or 7.5
 *   loose-price        = Ungraded / RAW
 *   bgs-10-price       = BGS 10
 *   condition-17-price = CGC 10
 *   condition-18-price = SGC 10
 *
 * Prices are in pennies → divide by 100 for USD
 *
 * Set env var: SPORTSCARDSPRO_TOKEN=<your 40-char subscription token>
 * Get it: sportscardspro.com → Subscriptions → "API/Download"
 * NOTE: Demo token c0b53bce... only returns names, not prices. Paid plan required.
 */

const BASE = 'https://www.sportscardspro.com';
const RATE_MS = 1100;

function getToken() {
  return process.env.SPORTSCARDSPRO_TOKEN || null;
}

// Convert pennies to dollars
const toDollars = (v) => (v && typeof v === 'number' && v > 0) ? Math.round(v / 100) : null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Map grader+grade to the right price key
function priceKey(grader, grade) {
  const g = parseFloat(grade || '0');
  if (grader === 'BGS') {
    if (g >= 10) return 'bgs-10-price';
    if (g >= 9.5) return 'box-only-price';
    return 'graded-price';
  }
  if (grader === 'SGC') return 'condition-18-price';
  if (grader === 'CGC') return 'condition-17-price';
  // PSA / default
  if (g === 10) return 'manual-only-price';
  if (g >= 9.5) return 'box-only-price';
  if (g >= 9) return 'graded-price';
  if (g >= 8) return 'new-price';
  if (g >= 7) return 'cib-price';
  if (g > 0) return 'cib-price';
  return 'loose-price'; // RAW
}

export async function searchProducts(q) {
  const token = getToken();
  if (!token) return [];
  try {
    const r = await fetch(`${BASE}/api/products?t=${token}&q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(10000)
    });
    const d = await r.json();
    return d.status === 'success' ? (d.products || []) : [];
  } catch(e) {
    console.error('[SCP] search error:', e.message);
    return [];
  }
}

export async function getProduct(id) {
  const token = getToken();
  if (!token) return null;
  try {
    const r = await fetch(`${BASE}/api/product?t=${token}&id=${id}`, {
      signal: AbortSignal.timeout(10000)
    });
    const d = await r.json();
    return d.status === 'success' ? d : null;
  } catch(e) {
    console.error('[SCP] getProduct error:', e.message);
    return null;
  }
}

export async function getCardPrice(player, grader, grade) {
  const token = getToken();
  if (!token) return null;

  // Search for the card
  const q = `${player} ${grader !== 'RAW' ? grader : ''} ${grade || ''}`.replace(/\s+/g,' ').trim();
  const products = await searchProducts(q);
  if (!products.length) return null;

  await sleep(RATE_MS);
  const product = products[0];
  const data = await getProduct(product.id);
  if (!data) return null;

  const key = priceKey(grader, grade);
  const mid = toDollars(data[key]) || toDollars(data['graded-price']) || toDollars(data['loose-price']);
  if (!mid) return null;

  const raw = toDollars(data['loose-price']);
  return {
    mid,
    lo: Math.round(mid * 0.85),
    hi: Math.round(mid * 1.2),
    raw,
    psa10: toDollars(data['manual-only-price']),
    psa9:  toDollars(data['graded-price']),
    psa8:  toDollars(data['new-price']),
    psa7:  toDollars(data['cib-price']),
    bgs10: toDollars(data['bgs-10-price']),
    rawPrice: raw,
    salesVolume: data['sales-volume'] || null,
    source: 'sportscardspro',
    productId: product.id,
    productName: data['product-name'],
    consoleName: data['console-name'],
  };
}

/**
 * Bulk ingest — run after setting SPORTSCARDSPRO_TOKEN
 * Fetches prices for all cards and stores in price_history + updates catalog_price
 */
export async function bulkIngestSCP(pool, cards) {
  const token = getToken();
  if (!token) {
    console.warn('[SCP] No SPORTSCARDSPRO_TOKEN set — subscribe at sportscardspro.com');
    return { stored: 0, skipped: cards.length };
  }

  let stored = 0, skipped = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    console.log(`[${i+1}/${cards.length}] ${c.player} ${c.grader||''} ${c.grade||''}`);
    try {
      const price = await getCardPrice(c.player, c.grader, c.grade);
      if (!price) { skipped++; await sleep(RATE_MS); continue; }

      console.log(`  $${price.lo}–$${price.mid}–$${price.hi} | vol:${price.salesVolume}`);

      await pool.query(`
        INSERT INTO price_history (id,player,grader,grade,card_set,source,sale_price,listing_url,thumbnail,title,sale_date,scraped_at)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,'sportscardspro',$5,$6,NULL,$7,NOW(),NOW())
      `, [c.player, c.grader||'RAW', c.grade||'', c.card_set||'',
          price.mid, `https://www.sportscardspro.com/game/sports-cards/${price.productId}`,
          price.productName]);

      // Update catalog_price with real market data
      if (price.mid > 0) {
        await pool.query(`UPDATE cards SET catalog_price=$1 WHERE id=$2`, [price.mid, c.id]);
      }
      stored++;
    } catch(e) { console.error('  error:', e.message); skipped++; }
    await sleep(RATE_MS);
  }
  return { stored, skipped };
}
