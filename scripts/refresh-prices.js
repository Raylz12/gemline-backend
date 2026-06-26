#!/usr/bin/env node
// Price refresh pipeline — updates stale card prices from CardHedge + refreshes mv_card_feed
// Run: node scripts/refresh-prices.js
// Env: DATABASE_URL, CARDHEDGE_API_KEY
// Cadence: designed to run nightly via cron/Vercel cron

import pg from 'pg';

const DB  = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const KEY = process.env.CARDHEDGE_API_KEY || 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';
const CH  = 'https://api.cardhedger.com';

const BATCH   = 50;   // cards per CH request
const MAX_CARDS = 5000; // max to refresh per run (API rate limit friendly)
const STALE_HOURS = 20; // refresh cards not updated in X hours

const pool = new pg.Pool({ connectionString: DB });

async function chSearch(body) {
  const res = await fetch(`${CH}/v1/cards/search-cards-wsort`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CardHedge search: ${res.status}`);
  return res.json();
}

async function chFMV(card_id) {
  const res = await fetch(`${CH}/v1/cards/card-fmv`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_id }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d?.fmv ?? null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const client = await pool.connect();
  console.log(`[refresh] Starting price refresh — stale threshold: ${STALE_HOURS}h`);

  // 1. Find stale cards (oldest ch_updated_at first, up to MAX_CARDS)
  const { rows: stale } = await client.query(`
    SELECT id, player, grader, grade, card_set, variant, sport, year, cardhedge_id, catalog_price
    FROM cards
    WHERE ch_updated_at IS NULL OR ch_updated_at < NOW() - INTERVAL '${STALE_HOURS} hours'
    ORDER BY catalog_price DESC NULLS LAST, ch_updated_at ASC NULLS FIRST
    LIMIT $1
  `, [MAX_CARDS]);

  console.log(`[refresh] ${stale.length} stale cards to refresh`);

  let updated = 0, errors = 0;

  // 2. Process in batches — prioritize by cardhedge_id (direct FMV call) vs search
  const withId   = stale.filter(c => c.cardhedge_id);
  const withoutId = stale.filter(c => !c.cardhedge_id);

  // Direct FMV for cards we already have CH IDs for
  for (let i = 0; i < withId.length; i++) {
    const card = withId[i];
    try {
      const fmv = await chFMV(card.cardhedge_id);
      if (fmv && fmv > 0) {
        await client.query(`
          UPDATE cards SET catalog_price = $1, ch_updated_at = NOW()
          WHERE id = $2
        `, [fmv, card.id]);
        updated++;
      }
    } catch(e) {
      errors++;
    }
    if (i % 100 === 0) {
      process.stdout.write(`\r[refresh] FMV: ${i}/${withId.length} (${updated} updated, ${errors} errors)`);
      await sleep(50); // gentle rate limiting
    }
  }
  console.log(`\n[refresh] FMV pass done: ${updated} updated`);

  // Search-based refresh for cards without CH IDs
  let searchUpdated = 0;
  for (let i = 0; i < withoutId.length; i += BATCH) {
    const batch = withoutId.slice(i, i + BATCH);
    try {
      // Pick best search term from the batch (search by player name)
      const playerGroups = {};
      for (const c of batch) {
        const key = `${c.player}|${c.card_set}`;
        if (!playerGroups[key]) playerGroups[key] = [];
        playerGroups[key].push(c);
      }

      for (const [key, cards] of Object.entries(playerGroups)) {
        const [player, set] = key.split('|');
        try {
          const data = await chSearch({
            player, set, page: 1, page_size: 20,
            sort_by: 'price', sort_order: 'desc',
          });
          const chCards = data.cards || [];

          for (const card of cards) {
            // Match by grader+grade
            const match = chCards.find(c =>
              c.grader?.toLowerCase() === card.grader?.toLowerCase() &&
              String(c.grade) === String(card.grade)
            ) || chCards[0];

            if (match?.fmv > 0) {
              await client.query(`
                UPDATE cards SET
                  catalog_price = $1,
                  cardhedge_id = COALESCE(cardhedge_id, $2),
                  ch_price_lo = $3,
                  ch_price_hi = $4,
                  ch_confidence = $5,
                  ch_updated_at = NOW()
                WHERE id = $6
              `, [
                match.fmv,
                match.card_id || null,
                match.price_lo || null,
                match.price_hi || null,
                match.confidence || null,
                card.id,
              ]);
              searchUpdated++;
            }
          }
          await sleep(100); // rate limit between player searches
        } catch(e) { /* skip individual player errors */ }
      }
    } catch(e) {
      errors++;
    }
    if (i % 500 === 0) {
      process.stdout.write(`\r[refresh] Search: ${i}/${withoutId.length} (${searchUpdated} updated)`);
    }
  }
  console.log(`\n[refresh] Search pass done: ${searchUpdated} updated`);

  // 3. Refresh the materialized view so feed is up to date
  console.log('[refresh] Refreshing mv_card_feed...');
  const t0 = Date.now();
  await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed');
  console.log(`[refresh] mv_card_feed refreshed in ${Date.now()-t0}ms`);

  const totalUpdated = updated + searchUpdated;
  console.log(`[refresh] Done — ${totalUpdated} prices updated, ${errors} errors`);

  client.release();
  await pool.end();
  return totalUpdated;
}

main().catch(e => { console.error('[refresh] Fatal:', e.message); process.exit(1); });
