#!/usr/bin/env node
// batch-price-sync.cjs — CardHedge FMV sync via POST /v1/cards/card-fmv-batch (100 items/call)
// Replaces refresh-prices.js / bulk-sync.cjs.
//   - Keyset pagination by id (fixes the OFFSET-over-shrinking-set skip bug in the old scripts)
//   - CONCURRENCY in-flight batch requests (each 100 items), 429-aware exponential backoff
//   - Bulk UNNEST UPDATE (price fields only; never touches identity fields)
//   - Resumable via .batch-price-sync-progress.json; MV refresh every 50K writes + at end
// Usage: node scripts/batch-price-sync.cjs   (env: DATABASE_URL, CARDHEDGE_API_KEY, STALE_HOURS)

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DB  = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const KEY = process.env.CARDHEDGE_API_KEY || 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK';
const CH  = 'https://api.cardhedger.com';

const BATCH_SIZE  = 100;                                 // items per API call (CH max)
const CONCURRENCY = parseInt(process.env.SYNC_CONCURRENCY || '3', 10); // in-flight batch calls
const PAGE_ROWS   = BATCH_SIZE * CONCURRENCY;            // DB rows fetched per loop
const STALE_HOURS = parseInt(process.env.STALE_HOURS || '20', 10);
const MV_EVERY    = 50000;
const PROG_FILE   = path.join(__dirname, '.batch-price-sync-progress.json');
const ZERO_UUID   = '00000000-0000-0000-0000-000000000000';

const pool = new pg.Pool({ connectionString: DB, max: 4 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gradeLabel(grader, grade) {
  if (!grader || !grade || grade === '' ||
      ['raw', 'ungraded'].includes((grader || '').toLowerCase()) ||
      (grade || '').toLowerCase() === 'ungraded') return 'Raw';
  return grader.charAt(0).toUpperCase() + grader.slice(1).toLowerCase() + ' ' + grade;
}

function loadProg() {
  try { return JSON.parse(fs.readFileSync(PROG_FILE, 'utf8')); }
  catch { return { lastId: ZERO_UUID, written: 0, errors: 0, apiCalls: 0, t0: Date.now() }; }
}
function saveProg(p) { try { fs.writeFileSync(PROG_FILE, JSON.stringify(p)); } catch {} }

let apiCalls = 0;
let rl429 = 0;

async function batchFMV(items, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      apiCalls++;
      const res = await fetch(`${CH}/v1/cards/card-fmv-batch`, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 429) {
        rl429++;
        const ra = parseInt(res.headers.get('retry-after') || '0', 10);
        const waitMs = ra > 0 ? (ra + 1) * 1000 : Math.min(5000 * 2 ** attempt, 120000);
        process.stdout.write(`\n  [429] backing off ${(waitMs / 1000).toFixed(0)}s\n`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      if (!res.ok) {
        console.error(`\n  [${res.status}]`, (await res.text()).slice(0, 150));
        return [];
      }
      const d = await res.json();
      return d.results || [];
    } catch (e) {
      if (attempt < retries - 1) await sleep(2000 * (attempt + 1));
    }
  }
  return [];
}

async function writeBatch(rows) {
  // rows: { db_id, price, lo, hi, conf }
  if (!rows.length) return 0;
  const client = await pool.connect();
  try {
    const r = await client.query(`
      UPDATE cards c SET
        catalog_price = v.price,
        ch_price_lo   = COALESCE(v.lo,   c.ch_price_lo),
        ch_price_hi   = COALESCE(v.hi,   c.ch_price_hi),
        ch_confidence = COALESCE(v.conf, c.ch_confidence),
        ch_updated_at = NOW()
      FROM (
        SELECT * FROM UNNEST($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::text[])
          AS t(id, price, lo, hi, conf)
      ) v
      WHERE c.id = v.id
    `, [
      rows.map((w) => w.db_id),
      rows.map((w) => w.price),
      rows.map((w) => w.lo ?? null),
      rows.map((w) => w.hi ?? null),
      rows.map((w) => (w.conf != null ? String(w.conf) : null)),
    ]);
    return r.rowCount;
  } catch (e) {
    console.error(`\n  [DB] ${e.message}`);
    return 0;
  } finally { client.release(); }
}

async function refreshMV() {
  const client = await pool.connect();
  try {
    process.stdout.write('\n  [MV] Refreshing mv_card_feed...');
    const t0 = Date.now();
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed');
    process.stdout.write(` done (${Date.now() - t0}ms)\n`);
  } catch (e) {
    console.error(`\n  [MV] ${e.message}`);
  } finally { client.release(); }
}

async function main() {
  const prog = loadProg();
  apiCalls = prog.apiCalls || 0;
  console.log(`\n[batch-sync] START | concurrency=${CONCURRENCY} | stale>${STALE_HOURS}h | resume lastId=${prog.lastId} | prev written=${prog.written}`);

  const { rows: [{ count: totalStr }] } = await pool.query(`
    SELECT COUNT(*) FROM cards
    WHERE cardhedge_id IS NOT NULL
      AND (ch_updated_at IS NULL OR ch_updated_at < NOW() - ($1 || ' hours')::interval)
  `, [String(STALE_HOURS)]);
  const total = parseInt(totalStr, 10);
  console.log(`[batch-sync] ${total.toLocaleString()} stale cards | ~${Math.ceil(total / BATCH_SIZE).toLocaleString()} API calls\n`);

  let lastId = prog.lastId || ZERO_UUID;
  let written = prog.written || 0;
  let errors = prog.errors || 0;
  let processed = 0;
  let sinceLastMV = 0;
  let loops = 0;
  const t0 = Date.now();

  for (;;) {
    const { rows } = await pool.query(`
      SELECT id, cardhedge_id, grader, COALESCE(grade, '') AS grade
      FROM cards
      WHERE cardhedge_id IS NOT NULL
        AND (ch_updated_at IS NULL OR ch_updated_at < NOW() - ($1 || ' hours')::interval)
        AND id > $2::uuid
      ORDER BY id
      LIMIT $3
    `, [String(STALE_HOURS), lastId, PAGE_ROWS]);

    if (!rows.length) break;

    // Dedupe API items across the page; fan results back out to every matching DB row
    const byKey = new Map(); // "card_id|gradeLabel" -> [db ids]
    for (const c of rows) {
      const key = `${c.cardhedge_id}|${gradeLabel(c.grader, c.grade)}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(c.id);
    }
    const items = Array.from(byKey.keys()).map((k) => {
      const i = k.lastIndexOf('|');
      return { card_id: k.slice(0, i), grade: k.slice(i + 1) };
    });

    // Fire up to CONCURRENCY batch calls in parallel
    const chunks = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) chunks.push(items.slice(i, i + BATCH_SIZE));
    const resultSets = await Promise.all(chunks.map((c) => batchFMV(c)));

    const toWrite = [];
    let hits = 0;
    for (const results of resultSets) {
      for (const r of results) {
        if (!r || !r.price || r.price <= 0) { errors++; continue; }
        const ids = byKey.get(`${r.card_id}|${r.grade}`);
        if (!ids) continue;
        hits++;
        for (const dbId of ids) {
          toWrite.push({ db_id: dbId, price: r.price, lo: r.price_low, hi: r.price_high, conf: r.confidence });
        }
      }
    }
    errors += items.length - resultSets.reduce((n, s) => n + s.length, 0);

    const wrote = await writeBatch(toWrite);
    written += wrote;
    sinceLastMV += wrote;
    processed += rows.length;
    lastId = rows[rows.length - 1].id;
    saveProg({ lastId, written, errors, apiCalls, t0: prog.t0 || t0 });

    if (sinceLastMV >= MV_EVERY) { await refreshMV(); sinceLastMV = 0; }

    if (++loops % 5 === 0 || processed >= total) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = processed / Math.max(elapsed, 1);
      const rem = Math.max(total - processed, 0) / Math.max(rate, 0.1);
      const eta = new Date(Date.now() + rem * 1000).toISOString().slice(11, 16);
      const pct = ((processed / Math.max(total, 1)) * 100).toFixed(1);
      console.log(`  ${processed.toLocaleString()}/${total.toLocaleString()} (${pct}%) | ${rate.toFixed(0)} cards/s | ETA ${eta}Z | written:${written.toLocaleString()} err:${errors.toLocaleString()} calls:${apiCalls.toLocaleString()} 429s:${rl429}`);
    }
  }

  await refreshMV();
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n[batch-sync] COMPLETE — ${written.toLocaleString()} prices written, ${errors.toLocaleString()} no-data, ${apiCalls.toLocaleString()} API calls, ${rl429} 429s, ${mins}min`);
  saveProg({ lastId: ZERO_UUID, written: 0, errors: 0, apiCalls: 0, t0: Date.now() });
  await pool.end();
}

main().catch((e) => { console.error('[batch-sync] Fatal:', e.message, e.stack); process.exit(1); });
