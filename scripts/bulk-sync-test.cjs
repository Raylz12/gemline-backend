#!/usr/bin/env node
// bulk-sync.cjs — Batch-update CardHedge FMV prices
// Pages through DB, dedupes in memory, writes in bulk
// Resumes via progress file | Usage: node scripts/bulk-sync.cjs

const pg   = require('pg');
const fs   = require('fs');
const path = require('path');

const DB   = 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const KEY  = 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';
const CH   = 'https://api.cardhedger.com';

const CONCURRENCY = 20;
const PAGE_SIZE   = 500;  // Reduced to avoid overwhelming pMap
const MV_EVERY    = 50000;
const PROG_FILE   = path.join(__dirname, '.bulk-sync-progress.json');

const pool = new pg.Pool({ connectionString: DB, max: 6 });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function gradeLabel(grader, grade) {
  if (!grader || !grade || ['raw','ungraded',''].includes((grader||'').toLowerCase()) || (grade||'').toLowerCase()==='ungraded') return 'Raw';
  return grader.charAt(0).toUpperCase() + grader.slice(1).toLowerCase() + ' ' + grade;
}

function loadProg() {
  try { return JSON.parse(fs.readFileSync(PROG_FILE,'utf8')); }
  catch { return { offset: 0, written: 0, errors: 0, t0: Date.now() }; }
}
function saveProg(p) { fs.writeFileSync(PROG_FILE, JSON.stringify(p)); }

async function fetchFMV(card_id, grade) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${CH}/v1/cards/card-fmv`, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id, grade }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.status===429) { await sleep(3000*(i+1)); continue; }
      if (r.status>=500) { await sleep(1000*(i+1)); continue; }
      if (!r.ok) return null;
      const d = await r.json();
      return d?.price ? { price: d.price, lo: d.price_low, hi: d.price_high, conf: d.confidence } : null;
    } catch { await sleep(500*(i+1)); }
  }
  return null;
}

async function pMap(items, fn, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function bulkUpdate(rows) {
  if (!rows.length) return 0;
  const c = await pool.connect();
  let wrote = 0;
  try {
    await c.query('BEGIN');
    for (const w of rows) {
      const r = await c.query(`
        UPDATE cards SET catalog_price=$1, ch_price_lo=$2, ch_price_hi=$3, ch_confidence=$4, ch_updated_at=NOW()
        WHERE cardhedge_id=$5 AND LOWER(COALESCE(grader,'raw'))=LOWER($6) AND COALESCE(grade,'')=$7
      `, [w.price, w.lo, w.hi, w.conf, w.card_id, w.grader, w.grade]);
      wrote += r.rowCount;
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(()=>{});
    console.error('  [DB]', e.message);
  } finally { c.release(); }
  return wrote;
}

async function refreshMV() {
  const c = await pool.connect();
  try {
    process.stdout.write('\n[MV refresh]...');
    await c.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed');
    process.stdout.write(' done\n');
  } catch (e) { console.error('  [MV]', e.message); }
  finally { c.release(); }
}

async function main() {
  const prog = loadProg();
  console.log(`\n[bulk-sync] START | offset=${prog.offset} written=${prog.written}\n`);

  const countC = await pool.connect();
  const { rows: [{count: totalStr}] } = await countC.query(`
    SELECT COUNT(*) FROM cards
    WHERE cardhedge_id IS NOT NULL AND (ch_updated_at IS NULL OR ch_updated_at < NOW() - INTERVAL '6 days')
  `);
  countC.release();
  const total = parseInt(totalStr);
  console.log(`[bulk-sync] ${total.toLocaleString()} cards to sync\n`);

  let written = prog.written;
  let errors = 0;
  let sinceLastMV = 0;
  const t0 = Date.now();

  for (let offset = prog.offset; offset < total; offset += PAGE_SIZE) { console.log("
DEBUG: Loop iteration offset=", offset);
    // Fetch page
    const pc = await pool.connect();
    const { rows } = await pc.query(`
      SELECT cardhedge_id, grader, COALESCE(grade,'') as grade
      FROM cards
      WHERE cardhedge_id IS NOT NULL AND (ch_updated_at IS NULL OR ch_updated_at < NOW() - INTERVAL '6 days')
      ORDER BY id
      LIMIT $1 OFFSET $2
    `, [PAGE_SIZE, offset]);
    pc.release();

    if (!rows.length) break;

    // Dedupe in memory
    const uniq = new Map();
    for (const c of rows) {
      const key = `${c.cardhedge_id}|${c.grader}|${c.grade}`;
      if (!uniq.has(key)) uniq.set(key, c);
    }
    const cards = Array.from(uniq.values());

    // Fetch FMV
    let results = [];
    try {
      results = await pMap(cards, async (c) => {
        const gl = gradeLabel(c.grader, c.grade);
        const data = await fetchFMV(c.cardhedge_id, gl);
        return data ? { card_id: c.cardhedge_id, grader: c.grader, grade: c.grade, ...data } : null;
      }, CONCURRENCY);
    } catch (e) {
      console.error('  [pMap error]', e.message);
      results = [];
    }

    const hits = results.filter(Boolean);
    errors += results.length - hits.length;

    // Write
    let w = 0;
    try {
      w = await bulkUpdate(hits);
      written += w;
      sinceLastMV += w;
    } catch (e) {
      console.error('  [bulkUpdate error]', e.message);
    }

    saveProg({ offset: offset + PAGE_SIZE, written, errors, t0: prog.t0 || t0 });

    if (sinceLastMV >= MV_EVERY) {
      await refreshMV();
      sinceLastMV = 0;
    }

    const done = Math.min(offset + PAGE_SIZE, total);
    const elapsed = (Date.now() - t0) / 1000;
    const rate = (done - prog.offset) / elapsed;
    const rem = (total - done) / Math.max(rate, 0.1);
    const eta = new Date(Date.now() + rem * 1000).toISOString().slice(11, 16);
    const pct = ((done / total) * 100).toFixed(1);
    console.log("DEBUG: Finished page, continuing..."); console.log(`  ${done.toLocaleString()}/${total.toLocaleString()} (${pct}%) | ${rate.toFixed(0)}/s | ETA ${eta}Z | wr:${written} err:${errors}`);
  }

  await refreshMV();
  console.log(`\n[bulk-sync] DONE — ${written.toLocaleString()} written, ${errors.toLocaleString()} no-data, ${((Date.now()-t0)/60000).toFixed(1)}min`);
  saveProg({ offset: 0, written: 0, errors: 0, t0: Date.now() });
  await pool.end();
}

main().catch(e => { console.error('\n[FATAL]', e); process.exit(1); });
