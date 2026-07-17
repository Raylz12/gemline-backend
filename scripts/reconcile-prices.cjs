#!/usr/bin/env node
// reconcile-prices.cjs — fix bogus CardHedge stored prices using real sales history.
//
// Problem: CH's stored latest-price (all-prices-by-card / card-fmv-batch) is sometimes
// garbage (e.g. Tyler Shough Prizm Blue Ice RAW: stored $18.99 vs 9 real sales at
// $899–$1,275). batch-price-sync.cjs faithfully syncs the bad number into
// cards.catalog_price. Truth = the sales feed (POST /v1/cards/prices-by-card).
//
// Suspect sets (RAW rows joined to same-cardhedge_id PSA 10 price):
//   A) catalog_price < 1.5% of PSA-10 price AND sales_30d > 0   (too-low)
//   B) catalog_price > PSA-10 price AND sales_30d > 0           (inverted)
// For each suspect: fetch 365d RAW sales. If >=3 sales AND median diverges >4x from
// stored catalog_price (either direction) -> set catalog_price=median, lo=min, hi=max,
// insert price_reconciliations row. Otherwise leave untouched (cheap base cards
// legitimately have raw $0.50 vs PSA10 $80).
//
// Resumable via .reconcile-prices-progress.json (keyset by card uuid per phase).
// Rate: ~CONCURRENCY calls in flight, paced to ~5-8 req/s.
//
// Usage: node scripts/reconcile-prices.cjs
//   env: DATABASE_URL, CARDHEDGE_API_KEY, RECON_CONCURRENCY, RECON_LIMIT (test cap)

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DB  = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const KEY = process.env.CARDHEDGE_API_KEY || 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK';
const CH  = 'https://api.cardhedger.com';

const CONCURRENCY = parseInt(process.env.RECON_CONCURRENCY || '6', 10);
const LIMIT       = parseInt(process.env.RECON_LIMIT || '0', 10); // 0 = no cap
const MIN_SALES   = 3;
const DIVERGE_X   = 4;
const PRICE_CAP   = 15000000; // same junk cap as batch-price-sync
const PROG_FILE   = path.join(__dirname, '.reconcile-prices-progress.json');
const ZERO_UUID   = '00000000-0000-0000-0000-000000000000';

const pool = new pg.Pool({ connectionString: DB, max: 4 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadProg() {
  try { return JSON.parse(fs.readFileSync(PROG_FILE, 'utf8')); }
  catch { return { phase: 'A', lastId: ZERO_UUID, examined: 0, fixed: 0, skippedFewSales: 0, skippedLegit: 0, errors: 0, apiCalls: 0 }; }
}
function saveProg(p) { try { fs.writeFileSync(PROG_FILE, JSON.stringify(p)); } catch {} }

function median(sorted) {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

async function fetchSales(cardhedgeId, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${CH}/v1/cards/prices-by-card`, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardhedgeId, grade: 'RAW', days: 365 }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) {
        const ra = parseInt(res.headers.get('retry-after') || '0', 10);
        await sleep(ra > 0 ? (ra + 1) * 1000 : Math.min(5000 * 2 ** attempt, 60000));
        continue;
      }
      if (res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) return { error: `http ${res.status}` };
      const d = await res.json();
      const prices = (d.prices || [])
        .map((p) => Number(p.price))
        .filter((p) => p > 0 && p < PRICE_CAP)
        .sort((a, b) => a - b);
      return { prices };
    } catch (e) {
      if (attempt < retries - 1) await sleep(2000 * (attempt + 1));
      else return { error: e.message };
    }
  }
  return { error: 'retries exhausted' };
}

const PHASE_SQL = {
  // A: RAW price absurdly low vs same-family PSA 10, but has recent sales
  A: `
    WITH psa10 AS (
      SELECT cardhedge_id, MAX(catalog_price) AS p10
      FROM cards WHERE grader='PSA' AND grade='10' AND cardhedge_id IS NOT NULL AND catalog_price > 0
      GROUP BY cardhedge_id
    )
    SELECT r.id, r.cardhedge_id, r.catalog_price
    FROM cards r JOIN psa10 p ON p.cardhedge_id = r.cardhedge_id
    WHERE r.grader='RAW' AND r.catalog_price > 0
      AND r.catalog_price < 0.015 * p.p10
      AND r.sales_30d > 0
      AND r.id > $1::uuid
    ORDER BY r.id LIMIT $2`,
  // B: RAW price above PSA 10 (inverted ladder), with recent sales
  B: `
    WITH psa10 AS (
      SELECT cardhedge_id, MAX(catalog_price) AS p10
      FROM cards WHERE grader='PSA' AND grade='10' AND cardhedge_id IS NOT NULL AND catalog_price > 0
      GROUP BY cardhedge_id
    )
    SELECT r.id, r.cardhedge_id, r.catalog_price
    FROM cards r JOIN psa10 p ON p.cardhedge_id = r.cardhedge_id
    WHERE r.grader='RAW' AND r.catalog_price > p.p10
      AND r.sales_30d > 0
      AND r.id > $1::uuid
    ORDER BY r.id LIMIT $2`,
};

async function reconcileOne(row, prog) {
  prog.examined++;
  const old = Number(row.catalog_price);
  const { prices, error } = await fetchSales(row.cardhedge_id);
  prog.apiCalls++;
  if (error) { prog.errors++; console.log(`  [err] ${row.cardhedge_id}: ${error}`); return; }
  if (!prices || prices.length < MIN_SALES) { prog.skippedFewSales++; return; }
  const med = median(prices);
  const ratio = med > old ? med / Math.max(old, 0.01) : old / Math.max(med, 0.01);
  if (ratio <= DIVERGE_X) { prog.skippedLegit++; return; }

  const lo = prices[0], hi = prices[prices.length - 1];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(
      `UPDATE cards SET catalog_price=$1, ch_price_lo=$2, ch_price_hi=$3, ch_updated_at=NOW()
       WHERE id=$4::uuid AND grader='RAW'`,
      [med, lo, hi, row.id]);
    if (u.rowCount === 1) {
      await client.query(
        `INSERT INTO price_reconciliations (card_id, cardhedge_id, grader, grade, old_price, sales_median, sales_count, new_price, source)
         VALUES ($1::uuid, $2, 'RAW', '', $3, $4, $5, $6, 'reconcile-script')`,
        [row.id, row.cardhedge_id, old, med, prices.length, med]);
      prog.fixed++;
      console.log(`  [fix] ${row.cardhedge_id} $${old} -> $${med} (${prices.length} sales, $${lo}-$${hi})`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    prog.errors++;
    console.log(`  [db-err] ${row.id}: ${e.message}`);
  } finally { client.release(); }
}

async function refreshMV() {
  const client = await pool.connect();
  try {
    console.log('[recon] Refreshing mv_card_feed (concurrently)...');
    const t0 = Date.now();
    await client.query("SET temp_buffers = '512MB'");
    await client.query('SET statement_timeout = 0');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed');
    console.log(`[recon] MV refreshed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) {
    console.error(`[recon] MV refresh failed: ${e.message}`);
  } finally { client.release(); }
}

async function main() {
  const prog = loadProg();
  console.log(`[recon] START phase=${prog.phase} lastId=${prog.lastId} examined=${prog.examined} fixed=${prog.fixed}`);
  const t0 = Date.now();
  const phases = prog.phase === 'B' ? ['B'] : ['A', 'B'];

  for (const phase of phases) {
    if (prog.phase !== phase) { prog.phase = phase; prog.lastId = ZERO_UUID; }
    console.log(`[recon] --- phase ${phase} ---`);
    for (;;) {
      if (LIMIT && prog.examined >= LIMIT) { console.log('[recon] RECON_LIMIT hit, stopping'); saveProg(prog); await pool.end(); return; }
      const { rows } = await pool.query(PHASE_SQL[phase], [prog.lastId, CONCURRENCY * 5]);
      if (!rows.length) break;
      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY);
        const t = Date.now();
        await Promise.all(chunk.map((r) => reconcileOne(r, prog)));
        const dt = Date.now() - t;
        if (dt < 1000) await sleep(1000 - dt); // pace: <= CONCURRENCY req/s
      }
      prog.lastId = rows[rows.length - 1].id;
      saveProg(prog);
      if (prog.examined % 300 < CONCURRENCY * 5) {
        const mins = ((Date.now() - t0) / 60000).toFixed(1);
        console.log(`[recon] examined=${prog.examined} fixed=${prog.fixed} skip-few=${prog.skippedFewSales} skip-legit=${prog.skippedLegit} err=${prog.errors} calls=${prog.apiCalls} (${mins}min)`);
      }
    }
  }

  console.log(`\n[recon] COMPLETE — examined=${prog.examined} fixed=${prog.fixed} skipped-few-sales=${prog.skippedFewSales} skipped-legit=${prog.skippedLegit} errors=${prog.errors} apiCalls=${prog.apiCalls} in ${((Date.now() - t0) / 60000).toFixed(1)}min`);
  if (prog.fixed > 0) await refreshMV();
  prog.done = true; saveProg(prog);
  await pool.end();
}

main().catch((e) => { console.error('[recon] Fatal:', e.message, e.stack); process.exit(1); });
