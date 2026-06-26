#!/usr/bin/env node
// bulk-sync.js — Sync CardHedge FMV prices for all ~500K cards
// Each unique (cardhedge_id, grade_label) = 1 API call
// Resumes from progress file on restart
// Usage: node scripts/bulk-sync.js
// Env: CONCURRENCY (default 15), DATABASE_URL, CARDHEDGE_API_KEY

const pg   = require('pg');
const fs   = require('fs');
const path = require('path');

const DB   = 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const KEY  = 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';
const CH   = 'https://api.cardhedger.com';
const CONCURRENCY   = parseInt(process.env.CONCURRENCY || '15');
const WRITE_EVERY   = 200;
const MV_EVERY      = 50000;
const PROGRESS_FILE = path.join(__dirname, '.bulk-sync-progress.json');

const pool = new pg.Pool({ connectionString: DB, max: 8 });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function gradeLabel(grader, grade) {
  if (!grader || !grade || grade === '' || grader.toLowerCase() === 'raw' ||
      grader.toLowerCase() === 'ungraded' || grade.toLowerCase() === 'ungraded') return 'Raw';
  const g = grader.charAt(0).toUpperCase() + grader.slice(1).toLowerCase();
  return `${g} ${grade}`;
}

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); }
  catch { return { done: 0, updated: 0, errors: 0, startedAt: Date.now() }; }
}
function saveProgress(p) { try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p)); } catch {} }

async function fetchFMV(card_id, grade, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${CH}/v1/cards/card-fmv`, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id, grade }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
      if (res.status === 502 || res.status === 500) { await sleep(1000 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      const d = await res.json();
      return {
        price:      d?.price ?? null,
        price_low:  d?.price_low ?? null,
        price_high: d?.price_high ?? null,
        confidence: d?.confidence ?? null,
      };
    } catch {
      if (attempt < retries - 1) await sleep(800 * (attempt + 1));
    }
  }
  return null;
}

function makeSemaphore(n) {
  let active = 0;
  const queue = [];
  const acquire = () => new Promise(res => {
    if (active < n) { active++; res(); }
    else queue.push(res);
  });
  const release = () => {
    active--;
    if (queue.length > 0) { active++; queue.shift()(); }
  };
  return { acquire, release };
}

async function main() {
  const prog = loadProgress();
  console.log(`[bulk-sync] Starting — concurrency: ${CONCURRENCY}`);
  console.log(`[bulk-sync] Resume: ${prog.done} done, ${prog.updated} updated\n`);

  const client = await pool.connect();
  console.log('[bulk-sync] Loading card list from DB...');

  // Load unique (cardhedge_id, grader, grade) combos needing refresh, skip already done
  const { rows: cards } = await client.query(`
    SELECT DISTINCT cardhedge_id,
      grader,
      grade
    FROM cards
    WHERE cardhedge_id IS NOT NULL
      AND (ch_updated_at IS NULL OR ch_updated_at < NOW() - INTERVAL '6 days')
    ORDER BY cardhedge_id, grader, grade
  `);
  client.release();

  const total = cards.length;
  console.log(`[bulk-sync] ${total.toLocaleString()} unique (cardhedge_id, grade) combos to sync\n`);

  const sem = makeSemaphore(CONCURRENCY);
  let done = prog.done;
  let updated = prog.updated;
  let errors = 0;
  let sinceLastMV = 0;
  const writeBuf = [];
  const t0 = Date.now();
  let lastSaveAt = Date.now();

  async function flushWrites() {
    if (!writeBuf.length) return;
    const batch = writeBuf.splice(0);
    const wc = await pool.connect();
    try {
      await wc.query('BEGIN');
      for (const w of batch) {
        if (!w.price) continue;
        await wc.query(`
          UPDATE cards SET
            catalog_price = $1,
            ch_price_lo   = COALESCE($2, ch_price_lo),
            ch_price_hi   = COALESCE($3, ch_price_hi),
            ch_confidence = COALESCE($4, ch_confidence),
            ch_updated_at = NOW()
          WHERE cardhedge_id = $5
            AND (
              CASE WHEN LOWER(grader) IN ('raw','ungraded') OR grade = '' OR grade IS NULL THEN 'Raw'
                   ELSE INITCAP(grader) || ' ' || grade END
            ) = $6
        `, [w.price, w.price_low, w.price_high, w.confidence, w.card_id, w.grade_label]);
      }
      await wc.query('COMMIT');
      updated += batch.filter(w => w.price).length;
      sinceLastMV += batch.filter(w => w.price).length;
    } catch (e) {
      await wc.query('ROLLBACK').catch(() => {});
      process.stderr.write(`  [DB error] ${e.message}\n`);
    } finally { wc.release(); }
  }

  async function refreshMV() {
    const mc = await pool.connect();
    try {
      process.stdout.write('\n[bulk-sync] Refreshing mv_card_feed...');
      await mc.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed');
      process.stdout.write(' done\n');
      sinceLastMV = 0;
    } catch (e) {
      process.stderr.write(`  [MV error] ${e.message}\n`);
    } finally { mc.release(); }
  }

  // Skip already-done cards (progress resume)
  const toProcess = cards.slice(prog.done);

  await Promise.all(toProcess.map(card => async () => {
    await sem.acquire();
    try {
      const gl = gradeLabel(card.grader, card.grade);
      const data = await fetchFMV(card.cardhedge_id, gl);
      if (data?.price > 0) {
        writeBuf.push({ card_id: card.cardhedge_id, grade_label: gl, ...data });
      } else {
        errors++;
      }
      done++;
      if (writeBuf.length >= WRITE_EVERY) await flushWrites();
      if (sinceLastMV >= MV_EVERY) await refreshMV();

      if (done % 250 === 0 || Date.now() - lastSaveAt > 30000) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / elapsed;
        const rem = (total - done) / Math.max(rate, 0.1);
        const pct = ((done / total) * 100).toFixed(1);
        const eta = new Date(Date.now() + rem * 1000).toISOString().slice(11, 16);
        process.stdout.write(
          `\r  ${done.toLocaleString()}/${total.toLocaleString()} (${pct}%) | ` +
          `${rate.toFixed(0)}/s | ETA ${eta}Z | ok:${updated} err:${errors}   `
        );
        saveProgress({ done, updated, errors, startedAt: prog.startedAt });
        lastSaveAt = Date.now();
      }
    } finally { sem.release(); }
  }).map(fn => fn()));

  await flushWrites();
  await refreshMV();

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n\n[bulk-sync] DONE — ${updated.toLocaleString()} updated, ${errors.toLocaleString()} no-data, ${mins} min`);

  // Reset progress file
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ done: 0, updated: 0, errors: 0, startedAt: Date.now() }));
  await pool.end();
}

main().catch(e => { console.error('\n[bulk-sync] Fatal:', e.message); process.exit(1); });
