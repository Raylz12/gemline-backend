#!/usr/bin/env node
// Probe CardHedge for Football/Basketball sets 2015+ and diff vs our DB
const pg = require('pg');
const DB = 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require';
const KEY = 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';
const BASE = 'https://api.cardhedger.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const BRANDS = ['Prizm','Optic','Select','Mosaic','Donruss','Topps Chrome','Panini','Bowman','National Treasures','Immaculate','Contenders','Absolute','Phoenix','Obsidian','Chronicles','Score','Prestige','Legacy','Zenith','Spectra','Noir','Flawless','Hoops','Court Kings','Revolution','Crown Royale','Origins','Certified','Limited','Illusions','One and One','Impeccable','Playbook','Gold Standard','Totally Certified','Elite','Status','Luminance','Plates and Patches','Encased','Vertex','Honors','Recon','Dominion','Cornerstones','Clearly Donruss','Studio'];
const YEARS = []; for (let y = 2015; y <= 2026; y++) YEARS.push(String(y));

async function search(query) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/v1/cards/set-search`, {
        method: 'POST', headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, page: 1, page_size: 100 }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 429) { await sleep(5000); continue; }
      if (!r.ok) return [];
      const d = await r.json();
      return d.sets || [];
    } catch { await sleep(1000); }
  }
  return [];
}

(async () => {
  const pool = new pg.Pool({ connectionString: DB, max: 3 });
  const { rows } = await pool.query("SELECT DISTINCT card_set FROM cards WHERE card_set IS NOT NULL AND card_set != ''");
  const haveSets = new Set(rows.map(r => r.card_set.trim().toLowerCase()));
  const { rows: sportRows } = await pool.query("SELECT card_set, COUNT(*) n FROM cards WHERE sport IN ('Football','Basketball') GROUP BY card_set");
  const avgPerSet = sportRows.length ? Math.round(sportRows.reduce((a, r) => a + Number(r.n), 0) / sportRows.length) : 0;

  const found = new Map(); // name -> {year, category, sales30}
  const queries = [];
  for (const y of YEARS) { queries.push(`${y} Football`, `${y} Basketball`); }
  for (const b of BRANDS) { queries.push(`${b} Football`, `${b} Basketball`); }

  let done = 0;
  for (const q of queries) {
    const sets = await search(q);
    for (const s of sets) {
      if (!s.name) continue;
      const cat = s.category || '';
      const yr = parseInt(s.year) || 0;
      if ((cat === 'Football' || cat === 'Basketball') && yr >= 2015) {
        found.set(s.name, { year: yr, category: cat, sales30: s['30 Day Sales'] || 0 });
      }
    }
    done++;
    if (done % 20 === 0) console.log(`progress ${done}/${queries.length}, found ${found.size}`);
    await sleep(120);
  }

  const missing = [...found.entries()].filter(([name]) => !haveSets.has(name.trim().toLowerCase()));
  const byCat = { Football: 0, Basketball: 0 };
  missing.forEach(([, v]) => byCat[v.category]++);
  const haveCat = { Football: 0, Basketball: 0 };
  [...found.entries()].filter(([name]) => haveSets.has(name.trim().toLowerCase())).forEach(([, v]) => haveCat[v.category]++);

  console.log('\n=== RESULTS ===');
  console.log('Discovered 2015+ FB/BB sets on CardHedge:', found.size);
  console.log('Already in DB:', found.size - missing.length, JSON.stringify(haveCat));
  console.log('MISSING from DB:', missing.length, JSON.stringify(byCat));
  console.log('Avg rows per FB/BB set in our DB (incl. grade tiers):', avgPerSet);
  console.log('Estimated new card rows if ingested:', (missing.length * avgPerSet).toLocaleString());
  console.log('\nTop 30 missing sets by 30-day sales:');
  missing.sort((a, b) => b[1].sales30 - a[1].sales30).slice(0, 30).forEach(([name, v]) => console.log(`  ${v.sales30.toString().padStart(7)}  ${name}`));
  await pool.end();
})();
