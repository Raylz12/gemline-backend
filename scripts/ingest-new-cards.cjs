#!/usr/bin/env node
// ingest-new-cards.cjs — Fill card catalog gaps by iterating every known set
// Parallel set processing + reduced delays for fast ingest
// Usage: node scripts/ingest-new-cards.cjs [--target=500000]

const pg = require('pg');
const fs = require('fs');
const path = require('path');

const DB   = 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const KEY  = 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK';
const BASE = 'https://api.cardhedger.com';

const TARGET      = parseInt((process.argv.find(a => a.startsWith('--target=')) || '--target=500000').split('=')[1]);
const PAGE_SIZE   = 50;
const MAX_PAGES   = 200;
const SET_CONCURR = 4;   // process 4 sets in parallel
const PAGE_DELAY  = 60;  // ms between page requests per worker
const MV_EVERY    = 40000;
const PROG_FILE   = path.join(__dirname, '.ingest-new-progress.json');

const pool = new pg.Pool({ connectionString: DB, max: 12 });
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadProg() {
  try { return JSON.parse(fs.readFileSync(PROG_FILE, 'utf8')); }
  catch { return { inserted: 0, setsDone: [] }; }
}
function saveProg(p) { fs.writeFileSync(PROG_FILE, JSON.stringify(p, null, 2)); }

function parseGrade(g) {
  if (!g) return { grader: 'RAW', grade: '' };
  const s = g.trim();
  if (/^(raw|ungraded)$/i.test(s)) return { grader: 'RAW', grade: '' };
  const m = s.match(/^([A-Za-z]+)\s+(.+)$/);
  if (m) return { grader: m[1].toUpperCase(), grade: m[2] };
  return { grader: s.toUpperCase(), grade: '' };
}

async function searchSetPage(setName, page) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/v1/cards/card-search`, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ set: setName, page, page_size: PAGE_SIZE, sort_by: 'description', sort_order: 'asc' }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 429) { await sleep(8000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(1000 * (i + 1)); }
  }
  return null;
}

// Shared state for existingIds (accessed by parallel workers)
let existingIds;
let totalInserted = 0;
let sinceLastMV = 0;
const mvLock = { busy: false };

async function insertBatch(cards) {
  const rows = [];
  for (const card of cards) {
    const id = card.card_id;
    if (!id || existingIds.has(id)) continue;
    existingIds.add(id);
    const prices = card.prices?.length ? card.prices : [{ grade: 'Raw', price: null }];
    for (const p of prices) {
      const { grader, grade } = parseGrade(p.grade);
      rows.push([
        card.player || 'Unknown', card.year || '', card.set || '',
        card.variant || '', card.number || '', card.category || 'Other',
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

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const res = await client.query(`
        INSERT INTO cards (id,player,year,card_set,variant,number,sport,grader,grade,cardhedge_id,catalog_price,ebay_thumb,sales_7d,sales_30d,gain_7d,rookie,created_at)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
        ON CONFLICT DO NOTHING
      `, r);
      inserted += res.rowCount;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
  } finally { client.release(); }
  return inserted;
}

async function maybeRefreshMV() {
  if (sinceLastMV < MV_EVERY || mvLock.busy) return;
  mvLock.busy = true;
  const c = await pool.connect();
  try {
    process.stdout.write(' [MV]...');
    await c.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed');
    process.stdout.write('✓ ');
    sinceLastMV = 0;
  } catch (e) { process.stdout.write('[MV err] '); }
  finally { c.release(); mvLock.busy = false; }
}

async function processSet(setName) {
  let newThisSet = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (existingIds.size >= TARGET) break;
    const data = await searchSetPage(setName, page);
    if (!data?.cards?.length) break;
    const inserted = await insertBatch(data.cards);
    newThisSet += inserted;
    totalInserted += inserted;
    sinceLastMV += inserted;
    if (data.pages && page >= data.pages) break;
    await sleep(PAGE_DELAY);
  }
  await maybeRefreshMV();
  return newThisSet;
}

async function getUniqueCount() {
  const { rows } = await pool.query('SELECT COUNT(DISTINCT cardhedge_id) FROM cards WHERE cardhedge_id IS NOT NULL');
  return parseInt(rows[0].count);
}

async function main() {
  const prog = loadProg();
  const setsDone = new Set(prog.setsDone || []);
  totalInserted = prog.inserted || 0;

  console.log(`\n[ingest-new-cards] TARGET: ${TARGET.toLocaleString()} unique card IDs`);
  const startCount = await getUniqueCount();
  console.log(`Current: ${startCount.toLocaleString()} | Need: ${(TARGET - startCount).toLocaleString()} more\n`);

  if (startCount >= TARGET) { console.log('Already at target!'); await pool.end(); return; }

  process.stdout.write('Loading existing IDs...');
  const { rows: idRows } = await pool.query('SELECT DISTINCT cardhedge_id FROM cards WHERE cardhedge_id IS NOT NULL');
  existingIds = new Set(idRows.map(r => r.cardhedge_id));
  console.log(` ${existingIds.size.toLocaleString()} loaded`);

  // Build set list from DB + CardHedge discovery
  process.stdout.write('Building set list...');
  const { rows: dbSets } = await pool.query(
    "SELECT DISTINCT card_set FROM cards WHERE card_set IS NOT NULL AND card_set != '' ORDER BY card_set"
  );
  const discoveredSets = new Set(dbSets.map(r => r.card_set.trim()).filter(Boolean));

  const setKeywords = ['Topps', 'Bowman', 'Panini', 'Upper Deck', 'Fleer', 'Donruss', 'Score',
    'Leaf', 'Select', 'Prizm', 'Optic', 'Mosaic', 'Contenders', 'National Treasures',
    'Immaculate', 'Chrome', 'Stadium Club', 'Heritage', 'Archives', 'Finest', 'Ultra',
    'Exquisite', 'Certified', 'Limited', 'Spectra', 'Revolution', 'Obsidian', 'Noir',
    'Gold Label', 'Crown Royale', 'Pokemon', 'Yu-Gi-Oh', 'Magic', 'SP Authentic',
    'Playoff', 'Pacific', 'Topps Total', 'Sage', 'SAGE Hit', 'Collector\'s Choice',
    'Stadium Club', 'Skybox', 'Hoops', 'Ultra Pro', 'Flair', 'Studio', 'Pinnacle'];
  for (const kw of setKeywords) {
    try {
      const r = await fetch(`${BASE}/v1/cards/set-search`, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: kw, count: 500 }),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      (d.sets || []).forEach(s => s.name && discoveredSets.add(s.name));
    } catch {}
    await sleep(80);
  }
  const allSets = Array.from(discoveredSets).filter(s => !setsDone.has(s));
  console.log(` ${(allSets.length + setsDone.size).toLocaleString()} total sets | ${allSets.length.toLocaleString()} remaining\n`);

  const t0 = Date.now();
  let setsProcessed = setsDone.size;
  const totalSets = allSets.length + setsDone.size;

  // Process sets in parallel batches
  for (let i = 0; i < allSets.length; i += SET_CONCURR) {
    if (existingIds.size >= TARGET) break;

    const batch = allSets.slice(i, i + SET_CONCURR);
    const results = await Promise.all(batch.map(s => processSet(s)));

    batch.forEach((s, idx) => {
      setsDone.add(s);
      const n = results[idx];
      if (n > 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = (totalInserted / elapsed).toFixed(0);
        const pct = ((existingIds.size / TARGET) * 100).toFixed(1);
        console.log(`[${setsProcessed + idx + 1}/${totalSets}] "${s}" → +${n} | total: ${existingIds.size.toLocaleString()} (${pct}%) | ${rate} rows/s`);
      }
    });
    setsProcessed += batch.length;

    if (setsProcessed % 100 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (totalInserted / elapsed).toFixed(0);
      const pct = ((existingIds.size / TARGET) * 100).toFixed(1);
      console.log(`--- Progress: ${setsProcessed}/${totalSets} sets | ${existingIds.size.toLocaleString()} unique (${pct}%) | ${rate} rows/s ---`);
      saveProg({ inserted: totalInserted, setsDone: Array.from(setsDone) });
    }
  }

  saveProg({ inserted: totalInserted, setsDone: Array.from(setsDone) });
  console.log('\n[Final MV refresh]...');
  const c = await pool.connect();
  try { await c.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed'); console.log('done'); }
  catch (e) { console.error('MV error:', e.message); }
  finally { c.release(); }

  const finalCount = await getUniqueCount();
  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n[DONE] ${finalCount.toLocaleString()} unique cards | +${totalInserted.toLocaleString()} rows | ${elapsed}min`);
  if (finalCount < TARGET) console.log(`Still ${(TARGET - finalCount).toLocaleString()} short.`);
  await pool.end();
}

main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
