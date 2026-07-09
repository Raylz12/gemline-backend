#!/usr/bin/env node
// crawl-bbfb.cjs — import missing Basketball/Football cards from CardHedge.
// Set manifest: scripts/.bbfb-sets.json (from additions-summary enumeration).
// Resumable via scripts/.crawl-bbfb-progress.json. Insert-only (ON CONFLICT DO NOTHING).
// Mapping matches scripts/ingest-new-cards.cjs: one row per grade tier per card.

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DB   = 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require';
const KEY  = 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';
const BASE = 'https://api.cardhedger.com';

const PAGE_SIZE   = 100;
const SET_CONCURR = 4;
const PAGE_DELAY  = 50;          // ms between pages per worker
const CAP         = 10000;       // API count cap
const MV_EVERY    = 500000;      // rows inserted between MV refreshes
const CALL_BUDGET = parseInt(process.env.CALL_BUDGET || '130000', 10);
const SETS_FILE   = path.join(__dirname, '.bbfb-sets.json');
const PROG_FILE   = path.join(__dirname, '.crawl-bbfb-progress.json');

const pool = new pg.Pool({ connectionString: DB, max: 8 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- progress ----------
function loadProg() {
  try { return JSON.parse(fs.readFileSync(PROG_FILE, 'utf8')); }
  catch { return { done: {}, apiCalls: 0, insertedRows: 0, newCards: { Basketball: 0, Football: 0, Other: 0 }, failedSlices: [], budgetStop: false }; }
}
const prog = loadProg();
prog.budgetStop = false;
function saveProg() { fs.writeFileSync(PROG_FILE, JSON.stringify(prog)); }

// ---------- api ----------
let stopping = false;
async function chSearch(body) {
  if (prog.apiCalls >= CALL_BUDGET) { stopping = true; prog.budgetStop = true; return null; }
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`${BASE}/v1/cards/card-search`, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_size: PAGE_SIZE, sort_by: 'description', sort_order: 'asc', ...body }),
        signal: AbortSignal.timeout(25000),
      });
      prog.apiCalls++;
      if (r.status === 429) { await sleep(8000 * (a + 1)); continue; }
      if (r.status >= 500) { await sleep(3000 * (a + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(2000 * (a + 1)); }
  }
  return null;
}

// ---------- insert ----------
function parseGrade(g) {
  if (!g) return { grader: 'RAW', grade: '' };
  const s = g.trim();
  if (/^(raw|ungraded)$/i.test(s)) return { grader: 'RAW', grade: '' };
  const m = s.match(/^([A-Za-z]+)\s+(.+)$/);
  if (m) return { grader: m[1].toUpperCase(), grade: m[2] };
  return { grader: s.toUpperCase(), grade: '' };
}

let existingIds;
let sinceLastMV = 0;
let mvBusy = false;

const COLS = 15; // params per row
async function insertCards(cards) {
  const rows = [];
  for (const card of cards) {
    const id = card.card_id;
    if (!id || existingIds.has(id)) continue;
    existingIds.add(id);
    const cat = card.category || 'Other';
    prog.newCards[cat] = (prog.newCards[cat] || 0) + 1;
    const year = card.year || (card.set && (card.set.match(/\b(19|20)\d{2}\b/) || [''])[0]) || '';
    const prices = card.prices?.length ? card.prices : [{ grade: 'Raw', price: null }];
    const seen = new Set();
    for (const p of prices) {
      const { grader, grade } = parseGrade(p.grade);
      const k = grader + '|' + grade;
      if (seen.has(k)) continue; // avoid intra-statement conflict dupes
      seen.add(k);
      rows.push([
        card.player || 'Unknown', year, card.set || '',
        card.variant || '', card.number || '', cat,
        grader, grade, id,
        p.price ? parseFloat(p.price) : null,
        card.image || null,
        card['7 Day Sales'] || 0, card['30 Day Sales'] || 0,
        typeof card.gain === 'number' ? card.gain : 0,
        card.rookie || false,
      ]);
    }
  }
  if (!rows.length) return 0;

  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((r, j) => {
      params.push(...r);
      const b = j * COLS;
      return `(gen_random_uuid(),${Array.from({ length: COLS }, (_, k) => '$' + (b + k + 1)).join(',')},NOW())`;
    });
    const sql = `INSERT INTO cards (id,player,year,card_set,variant,number,sport,grader,grade,cardhedge_id,catalog_price,ebay_thumb,sales_7d,sales_30d,gain_7d,rookie,created_at)
      VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`;
    for (let a = 0; a < 3; a++) {
      try { const res = await pool.query(sql, params); inserted += res.rowCount; break; }
      catch (e) { if (a === 2) console.error('[insert err]', e.message.slice(0, 200)); else await sleep(1500 * (a + 1)); }
    }
  }
  prog.insertedRows += inserted;
  sinceLastMV += inserted;
  return inserted;
}

async function refreshMV(label) {
  if (mvBusy) return;
  mvBusy = true;
  const c = await pool.connect();
  try {
    console.log(`[MV refresh ${label}] start ${new Date().toISOString()}`);
    await c.query("SET statement_timeout = '30min'");
    await c.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed');
    console.log(`[MV refresh ${label}] done ${new Date().toISOString()}`);
    sinceLastMV = 0;
  } catch (e) { console.error('[MV err]', e.message.slice(0, 200)); }
  finally { c.release(); mvBusy = false; }
}

// ---------- crawl ----------
async function crawlSlice(setName, search, expect) {
  // returns cards seen; paginates asc; if capped also desc
  let total = 0;
  const body = search ? { set: setName, search } : { set: setName };
  const first = await chSearch({ ...body, page: 1 });
  if (!first) { if (!stopping) prog.failedSlices.push({ set: setName, search: search || null }); return 0; }
  const capped = !!first.count_capped;
  const count = first.count || 0;
  const maxPage = Math.ceil(Math.min(count, CAP) / PAGE_SIZE);
  await insertCards(first.cards || []);
  total += (first.cards || []).length;
  for (let p = 2; p <= maxPage && !stopping; p++) {
    const d = await chSearch({ ...body, page: p });
    if (!d) { if (!stopping) prog.failedSlices.push({ set: setName, search: search || null, page: p }); break; }
    if (!d.cards?.length) break;
    await insertCards(d.cards);
    total += d.cards.length;
    await sleep(PAGE_DELAY);
  }
  if (capped && !stopping) {
    // desc pass for the tail
    for (let p = 1; p <= maxPage && !stopping; p++) {
      const d = await chSearch({ ...body, page: p, sort_order: 'desc' });
      if (!d || !d.cards?.length) break;
      await insertCards(d.cards);
      total += d.cards.length;
      await sleep(PAGE_DELAY);
    }
    if (count === CAP && expect && expect > 2 * CAP) {
      console.log(`[WARN] slice still capped beyond 2x: "${setName}" search="${search}" expect=${expect}`);
      prog.failedSlices.push({ set: setName, search: search || null, reason: 'capped>2xCAP', expect });
    }
  }
  return total;
}

async function processSet(entry) {
  const { set: setName, count: expect, variants } = entry;
  const before = prog.insertedRows;
  if (expect <= CAP - 100) {
    await crawlSlice(setName, null, expect);
  } else {
    // sliced crawl by variant tokens; plain asc+desc first for bulk coverage
    await crawlSlice(setName, null, expect);
    for (const v of variants) {
      if (stopping) break;
      await crawlSlice(setName, v, null);
    }
  }
  return prog.insertedRows - before;
}

async function main() {
  const allSets = JSON.parse(fs.readFileSync(SETS_FILE, 'utf8'));
  const todo = allSets.filter(s => !(s.set in prog.done));
  console.log(`[crawl-bbfb] sets total=${allSets.length} todo=${todo.length} | apiCalls so far=${prog.apiCalls} budget=${CALL_BUDGET}`);

  process.stdout.write('Loading existing cardhedge ids...');
  const { rows: idRows } = await pool.query('SELECT DISTINCT cardhedge_id FROM cards WHERE cardhedge_id IS NOT NULL');
  existingIds = new Set(idRows.map(r => r.cardhedge_id));
  console.log(` ${existingIds.size.toLocaleString()}`);

  const t0 = Date.now();
  let idx = 0;
  async function worker(wid) {
    for (;;) {
      if (stopping) return;
      const i = idx++;
      if (i >= todo.length) return;
      const entry = todo[i];
      const ins = await processSet(entry);
      if (stopping) return; // don't mark a budget/stop-aborted set as done
      prog.done[entry.set] = ins;
      if ((i + 1) % 5 === 0 || ins > 5000) {
        const el = (Date.now() - t0) / 60000;
        console.log(`[${Object.keys(prog.done).length}/${allSets.length}] "${entry.set}" +${ins} | rows=${prog.insertedRows.toLocaleString()} calls=${prog.apiCalls.toLocaleString()} | ${el.toFixed(1)}min`);
        saveProg();
      }
      if (sinceLastMV >= MV_EVERY) refreshMV('periodic'); // fire and forget
    }
  }
  await Promise.all(Array.from({ length: SET_CONCURR }, (_, w) => worker(w)));
  saveProg();

  console.log(`\n[crawl done] stopping=${stopping} budgetStop=${prog.budgetStop} rows=${prog.insertedRows} calls=${prog.apiCalls}`);
  console.log('newCards:', JSON.stringify(prog.newCards));
  console.log('failedSlices:', prog.failedSlices.length);
  await refreshMV('final');
  const { rows } = await pool.query('SELECT COUNT(DISTINCT cardhedge_id) c FROM cards WHERE cardhedge_id IS NOT NULL');
  console.log('distinct cardhedge_id now:', rows[0].c);
  saveProg();
  await pool.end();
}

process.on('SIGTERM', () => { console.log('[SIGTERM] saving progress'); saveProg(); process.exit(0); });
process.on('SIGINT',  () => { saveProg(); process.exit(0); });

main().catch(e => { console.error('[FATAL]', e); saveProg(); process.exit(1); });
