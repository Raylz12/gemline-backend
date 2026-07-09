#!/usr/bin/env node
// enum-sets.cjs — enumerate all Basketball/Football sets via additions-summary
const fs = require('fs');
const KEY = 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK';
const B = 'https://api.cardhedger.com/v1/cards/additions-summary';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function enumerate(category) {
  const sets = new Map(); // set_name -> card_count total
  let page = 1, calls = 0, earliest = null, latest = null;
  for (;;) {
    let d = null;
    for (let a = 0; a < 5; a++) {
      try {
        const r = await fetch(B, {
          method: 'POST',
          headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_date: '2015-01-01', category, page, page_size: 500 }),
          signal: AbortSignal.timeout(30000),
        });
        calls++;
        if (r.status === 429) { await sleep(10000 * (a + 1)); continue; }
        if (!r.ok) { await sleep(2000 * (a + 1)); continue; }
        d = await r.json(); break;
      } catch { await sleep(2000 * (a + 1)); }
    }
    if (!d) { console.error(`[${category}] page ${page} failed permanently`); break; }
    const rows = d.data || [];
    for (const r of rows) {
      sets.set(r.set_name, (sets.get(r.set_name) || 0) + (r.card_count || 0));
      if (!earliest || r.added_date < earliest) earliest = r.added_date;
      if (!latest || r.added_date > latest) latest = r.added_date;
    }
    if (page % 20 === 0) console.log(`[${category}] page ${page}, ${sets.size} sets, earliest ${earliest}`);
    if (rows.length < 500) break;
    page++;
    await sleep(60);
  }
  console.log(`[${category}] DONE: ${sets.size} sets, ${[...sets.values()].reduce((a,b)=>a+b,0)} cards, pages=${page}, calls=${calls}, dates ${earliest}..${latest}`);
  return { sets: Object.fromEntries(sets), calls };
}

(async () => {
  const bb = await enumerate('Basketball');
  const fb = await enumerate('Football');
  fs.writeFileSync('/tmp/ch-sets-bbfb.json', JSON.stringify({
    basketball: bb.sets, football: fb.sets, apiCalls: bb.calls + fb.calls, ts: new Date().toISOString(),
  }, null, 1));
  console.log('total API calls:', bb.calls + fb.calls);
})();
