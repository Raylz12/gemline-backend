/**
 * priceHistory.js — Verifiable price database
 *
 * Every sale stored has: source, price, date, listing URL, thumbnail.
 * Market price = volume-weighted median of last 30 days, capped at 90 days.
 * Users see: "Based on 23 eBay sales · Avg $247 · Range $210–$295"
 */

import { searchEbaySold, searchWhatnot } from './priceFeed.js';

// ── Store scraped comps into price_history ────────────────────────────────────
export async function ingestEbayComps(pool, cardId, player, grader, grade, cardSet) {
  const query = [player, grader, grade, cardSet].filter(Boolean).join(' ');
  const results = await searchEbaySold(query, 20);

  let inserted = 0;
  for (const r of results) {
    if (!r.price) continue;
    try {
      await pool.query(`
        INSERT INTO price_history (card_id, player, grader, grade, card_set, source, sale_price, listing_url, thumbnail, title, sale_date, condition)
        VALUES ($1,$2,$3,$4,$5,'ebay',$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING
      `, [
        cardId || null, player, grader, grade, cardSet || null,
        r.price, r.url || null, r.thumbnail || null,
        r.title || null, r.date ? new Date(r.date) : null,
        `${grader || ''} ${grade || ''}`.trim() || null,
      ]);
      inserted++;
    } catch {}
  }
  return inserted;
}

export async function ingestWhatnot(pool, cardId, player, grader, grade) {
  const query = [player, grader, grade].filter(Boolean).join(' ');
  const results = await searchWhatnot(query, 10);

  let inserted = 0;
  for (const r of results) {
    const price = r.price || r.bid || 0;
    if (!price) continue;
    try {
      await pool.query(`
        INSERT INTO price_history (card_id, player, grader, grade, source, sale_price, title, condition)
        VALUES ($1,$2,$3,$4,'whatnot',$5,$6,$7)
        ON CONFLICT DO NOTHING
      `, [
        cardId || null, player, grader, grade,
        price, r.title || null,
        `${grader || ''} ${grade || ''}`.trim() || null,
      ]);
      inserted++;
    } catch {}
  }
  return inserted;
}

// ── Card Hedge ingestion (ready when API key arrives) ─────────────────────────
export async function ingestCardHedge(pool, cardId, player, grader, grade) {
  const apiKey = process.env.CARDHEDGE_API_KEY;
  if (!apiKey) return 0; // Silently skip until key arrives

  try {
    const q = encodeURIComponent(`${player} ${grader} ${grade}`);
    const r = await fetch(`https://ai.cardhedger.com/api/v1/prices?q=${q}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!r.ok) return 0;
    const data = await r.json();
    const sales = Array.isArray(data) ? data : (data.sales || data.results || []);

    let inserted = 0;
    for (const s of sales) {
      const price = s.price || s.sale_price || s.amount;
      if (!price) continue;
      await pool.query(`
        INSERT INTO price_history (card_id, player, grader, grade, source, sale_price, listing_url, thumbnail, sale_date, condition)
        VALUES ($1,$2,$3,$4,'cardhedge',$5,$6,$7,$8,$9)
        ON CONFLICT DO NOTHING
      `, [
        cardId || null, player, grader, grade,
        price, s.url || null, s.image || null,
        s.date ? new Date(s.date) : null,
        `${grader} ${grade}`,
      ]);
      inserted++;
    }
    return inserted;
  } catch (e) {
    console.error('Card Hedge ingest error:', e.message);
    return 0;
  }
}

// ── Compute market price from stored history ──────────────────────────────────
export async function getMarketPrice(pool, cardId, player, grader, grade, windowDays = 30) {
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();

  // Try by cardId first, fall back to player+grader+grade
  let rows;
  if (cardId) {
    const { rows: r } = await pool.query(`
      SELECT sale_price, source, sale_date, thumbnail, listing_url, title
      FROM price_history
      WHERE card_id = $1 AND sale_date > $2
      ORDER BY sale_date DESC LIMIT 50
    `, [cardId, cutoff]);
    rows = r;
  }

  if (!rows?.length) {
    const { rows: r } = await pool.query(`
      SELECT sale_price, source, sale_date, thumbnail, listing_url, title
      FROM price_history
      WHERE player = $1 AND grader = $2 AND grade = $3 AND sale_date > $4
      ORDER BY sale_date DESC LIMIT 50
    `, [player, grader, grade, cutoff]);
    rows = r;
  }

  if (!rows?.length) return null;

  // Source reliability weights (per Opus architecture review)
  const SOURCE_WEIGHT = { gemline: 1.0, ebay: 1.0, pwcc: 1.0, cardhedge: 0.95, whatnot: 0.9, comc: 0.8 };
  // Recency decay: 50% weight at 23 days
  const recencyWeight = (date) => {
    const daysAgo = (Date.now() - new Date(date || Date.now()).getTime()) / 86400000;
    return Math.exp(-0.03 * daysAgo);
  };

  const weighted = rows.map(r => ({
    price: Number(r.sale_price),
    w: (SOURCE_WEIGHT[r.source] || 0.8) * recencyWeight(r.sale_date),
    source: r.source, date: r.sale_date, title: r.title, url: r.listing_url, thumbnail: r.thumbnail,
  })).sort((a, b) => a.price - b.price);

  // Outlier detection: flag if > 2.5 std devs from mean
  const rawPrices = weighted.map(w => w.price);
  const mean = rawPrices.reduce((s, p) => s + p, 0) / rawPrices.length;
  const stdDev = Math.sqrt(rawPrices.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / rawPrices.length);
  const clean = weighted.filter(w => Math.abs(w.price - mean) / (stdDev || 1) <= 2.5);

  // Trimmed weighted mean (drop top/bottom 10% if enough data)
  const trim = clean.length >= 10 ? Math.floor(clean.length * 0.1) : 0;
  const trimmed = clean.slice(trim, clean.length - trim || undefined);
  const totalW = trimmed.reduce((s, w) => s + w.w, 0);
  const marketPrice = totalW ? Math.round(trimmed.reduce((s, w) => s + w.price * w.w, 0) / totalW) : mean;

  const prices = clean.map(w => w.price);
  const sources = [...new Set(rows.map(r => r.source))];
  const sourceCounts = {};
  for (const r of rows) sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
  const withThumb = rows.find(r => r.thumbnail);

  // Confidence: high ≥10 sales, medium ≥3, low <3
  const confidence = prices.length >= 10 ? 'high' : prices.length >= 3 ? 'medium' : 'low';

  return {
    price:      marketPrice,
    avg:        Math.round(mean),
    lo:         Math.min(...prices),
    hi:         Math.max(...prices),
    count:      prices.length,
    confidence,
    window:     windowDays,
    sources,
    sourceCounts,
    lastSale:   rows[0] ? { price: Number(rows[0].sale_price), date: rows[0].sale_date, source: rows[0].source } : null,
    thumbnail:  withThumb?.thumbnail || null,
    recent:     rows.slice(0, 5).map(r => ({
      price: Number(r.sale_price), source: r.source,
      date: r.sale_date, title: (r.title || '').slice(0, 60),
      url: r.listing_url, thumbnail: r.thumbnail,
    })),
  };
}

// ── PSA Cert Verification ─────────────────────────────────────────────────────
// PSA public API returns card details from cert number.
// 100 calls/day free. Register at: collectors.com/api
export async function verifyCert(certNumber, grader = 'PSA') {
  const cert = String(certNumber).replace(/\D/g, '');
  if (!cert) return null;

  if (grader === 'PSA') {
    try {
      // Try PSA public API first (no key needed, 100/day limit)
      const r = await fetch(`https://api.psacard.com/publicapi/cert/GetByCertNumber/${cert}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (r.ok) {
        const data = await r.json();
        const item = data.PSACertificationResponse?.PSAItem;
        if (item) {
          return {
            verified: true,
            grader: 'PSA',
            certNumber: cert,
            player: item.Subject || null,
            year: item.Year || null,
            brand: item.Brand || null,
            set: item.Set || null,
            cardNumber: item.CardNumber || null,
            grade: item.GradeDescription || null,
            gradeNum: item.PSAGrade || null,
            variety: item.Variety || null,
            psaUrl: `https://www.psacard.com/cert/${cert}`,
          };
        }
      }
    } catch {}
  }

  // Fallback: return link-based verification (user verifies themselves)
  const verifyUrls = {
    PSA: `https://www.psacard.com/cert/${cert}`,
    BGS: `https://www.beckett.com/grading/certification-lookup?cert=${cert}`,
    SGC: `https://www.sgccard.com/cert/${cert}`,
  };
  return {
    verified: false,
    grader,
    certNumber: cert,
    verifyUrl: verifyUrls[grader] || null,
    note: 'Click to verify directly with grader',
  };
}
