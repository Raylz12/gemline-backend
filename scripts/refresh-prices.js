#!/usr/bin/env node
// refresh-prices.js — Batch CardHedge FMV sync (100 cards per API call)
// Rate limit: 100 req/min → 10,000 cards/min → 447K cards in ~45 min
// Resumable via .refresh-progress.json

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB   = process.env.DATABASE_URL   || 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const KEY  = process.env.CARDHEDGE_API_KEY || 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';
const CH   = 'https://api.cardhedger.com';

const BATCH_SIZE  = 100;   // cards per API call (CH max)
const PACE_MS     = 650;   // ms between calls (100/min = 600ms min, 650ms safe)
const MV_EVERY    = 50000; // refresh mv_card_feed every N written
const PROG_FILE   = path.join(__dirname, '.refresh-progress.json');

const pool = new pg.Pool({ connectionString: DB, max: 6 });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function gradeLabel(grader, grade) {
  if (!grader || !grade || grade === '' ||
      ['raw', 'ungraded'].includes((grader || '').toLowerCase()) ||
      (grade || '').toLowerCase() === 'ungraded') return 'Raw';
  return grader.charAt(0).toUpperCase() + grader.slice(1).toLowerCase() + ' ' + grade;
}

function loadProg() {
  try { return JSON.parse(fs.readFileSync(PROG_FILE, 'utf8')); }
  catch { return { offset: 0, written: 0, errors: 0, t0: Date.now() }; }
}
function saveProg(p) { try { fs.writeFileSync(PROG_FILE, JSON.stringify(p)); } catch {} }

async function batchFMV(items, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${CH}/v1/cards/card-fmv-batch`, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '60');
        const waitMs = (retryAfter + 2) * 1000;
        process.stdout.write(`\n  [429] rate limit — waiting ${retryAfter}s...\n`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      if (!res.ok) {
        const t = await res.text();
        console.error(`\n  [${res.status}]`, t.slice(0, 100));
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
  if (!rows.length) return 0;
  const client = await pool.connect();
  let wrote = 0;
  try {
    await client.query('BEGIN');
    for (const w of rows) {
      const r = await client.query(`
        UPDATE cards
        SET catalog_price  = $1,
            ch_price_lo    = COALESCE($2, ch_price_lo),
            ch_price_hi    = COALESCE($3, ch_price_hi),
            ch_confidence  = COALESCE($4, ch_confidence),
            ch_updated_at  = NOW()
        WHERE id = $5
      `, [w.price, w.lo, w.hi, w.conf, w.db_id]);
      wrote += r.rowCount;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\n  [DB] ${e.message}`);
  } finally { client.release(); }
  return wrote;
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
  console.log(`\n[refresh] Starting batch FMV sync`);
  console.log(`[refresh] BATCH_SIZE=${BATCH_SIZE} | PACE=${PACE_MS}ms | resume offset=${prog.offset} | prev written=${prog.written}\n`);

  // Count total stale cards
  const countClient = await pool.connect();
  const { rows: [{ count: totalStr }] } = await countClient.query(`
    SELECT COUNT(*) FROM cards
    WHERE cardhedge_id IS NOT NULL
      AND (ch_updated_at IS NULL OR ch_updated_at < NOW() - INTERVAL '6 days')
  `);
  countClient.release();

  const total = parseInt(totalStr);
  const totalBatches = Math.ceil(total / BATCH_SIZE);
  const estMinutes = ((totalBatches * PACE_MS) / 60000).toFixed(0);
  console.log(`[refresh] ${total.toLocaleString()} cards | ${totalBatches.toLocaleString()} batches | ~${estMinutes} min estimated\n`);

  let written      = prog.written;
  let errors       = 0;
  let sinceLastMV  = 0;
  const t0 = Date.now();

  for (let offset = prog.offset; offset < total; offset += BATCH_SIZE) {
    // Load batch from DB
    const pc = await pool.connect();
    const { rows } = await pc.query(`
      SELECT id, cardhedge_id, grader, COALESCE(grade, '') AS grade
      FROM cards
      WHERE cardhedge_id IS NOT NULL
        AND (ch_updated_at IS NULL OR ch_updated_at < NOW() - INTERVAL '6 days')
      ORDER BY id
      LIMIT $1 OFFSET $2
    `, [BATCH_SIZE, offset]);
    pc.release();

    if (!rows.length) break;

    // Build CH request items, keep DB id mapping
    const idMap = new Map(); // card_id|grade → db_id
    const items = rows.map(c => {
      const gl = gradeLabel(c.grader, c.grade);
      idMap.set(`${c.cardhedge_id}|${gl}`, c.id);
      return { card_id: c.cardhedge_id, grade: gl };
    });

    // Fetch FMV from CH
    const results = await batchFMV(items);

    // Map results back to DB rows
    const toWrite = [];
    for (const r of results) {
      if (!r.price || r.price <= 0) { errors++; continue; }
      const dbId = idMap.get(`${r.card_id}|${r.grade}`);
      if (!dbId) continue;
      toWrite.push({ db_id: dbId, price: r.price, lo: r.price_low, hi: r.price_high, conf: r.confidence });
    }

    errors += rows.length - results.length; // items with no response at all

    // Write to DB
    const wrote = await writeBatch(toWrite);
    written += wrote;
    sinceLastMV += wrote;
    saveProg({ offset: offset + BATCH_SIZE, written, errors, t0: prog.t0 || t0 });

    // Refresh MV every 50K writes
    if (sinceLastMV >= MV_EVERY) {
      await refreshMV();
      sinceLastMV = 0;
    }

    // Progress log every 10 batches
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    if (batchNum % 10 === 0 || offset === 0) {
      const done = Math.min(offset + BATCH_SIZE, total);
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (done - prog.offset) / Math.max(elapsed, 1);
      const rem = (total - done) / Math.max(rate, 0.1);
      const eta = new Date(Date.now() + rem * 1000).toISOString().slice(11, 16);
      const pct = ((done / total) * 100).toFixed(1);
      console.log(`  [batch ${batchNum}/${totalBatches}] ${done.toLocaleString()}/${total.toLocaleString()} (${pct}%) | ${rate.toFixed(0)}/s | ETA ${eta}Z | written:${written.toLocaleString()} err:${errors.toLocaleString()}`);
    }

    // Pace requests to stay under rate limit
    await sleep(PACE_MS);
  }

  // Final MV refresh
  await refreshMV();

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n[refresh] COMPLETE — ${written.toLocaleString()} prices written, ${errors.toLocaleString()} no-data, ${mins}min elapsed`);
  saveProg({ offset: 0, written: 0, errors: 0, t0: Date.now() });
  await pool.end();
}

main().catch(e => { console.error('[refresh] Fatal:', e.message, e.stack); process.exit(1); });
