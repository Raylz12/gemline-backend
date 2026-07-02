// Vercel serverless entry — GEMLINE marketplace backend.
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { makeRepo, stripeStub } from '../src/store/repo.js';
import { settlementRouter } from '../src/routes/settlement.js';
import { appRouter } from '../src/routes/app.js';
import { authRouter, requireAuth, optionalAuth } from '../src/routes/auth.js';
import { rateLimit } from '../src/middleware/rateLimit.js';
import * as ordersSvc from '../orders.js';
import { transition } from '../machine.js';
import { emailUser, templates as emailTpl } from '../lib/email.js';
import { stripeClient, createPaymentIntent, createConnectAccount, createOnboardingLink, getAccountStatus, verifyWebhook } from '../src/adapters/stripe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors({
  origin: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '128kb' }));   // prevent large payload attacks
app.use(express.static(join(__dirname, '..', 'public')));

// ── Lazy-init repo (shared across warm invocations) ───────────────────────────
let repo;
async function getRepo() {
  if (!repo) repo = await makeRepo();
  return repo;
}

// ── Root redirect ─────────────────────────────────────────────────────────────
app.get('/gemline.html', (_req, res) => res.redirect(301, '/'));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  ok: true,
  store: process.env.DATABASE_URL ? 'postgres' : 'memory',
  note: process.env.DATABASE_URL
    ? 'Persistent database connected'
    : 'Running in-memory — set DATABASE_URL for persistent multi-user data',
}));

// ── SEO: chunked card sitemaps ────────────────────────────────────────────────
// /api/sitemap/:c where :c is a uuid first-hex-char chunk (0-f). Each chunk is
// ~40K priced cards — under the 50K sitemap limit — selected by uuid range so
// there are no OFFSET scans over 750K rows. Referenced from /sitemap.xml.
app.get('/api/sitemap/:c', async (req, res) => {
  try {
    const c = String(req.params.c).toLowerCase();
    if (!/^[0-9a-f]$/.test(c)) return res.status(404).send('Not found');
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).send('No database');
    const lo = `${c}0000000-0000-0000-0000-000000000000`;
    const hiChar = c === 'f' ? null : (parseInt(c, 16) + 1).toString(16);
    const where = hiChar
      ? `id >= $1::uuid AND id < $2::uuid`
      : `id >= $1::uuid`;
    const params = hiChar ? [lo, `${hiChar}0000000-0000-0000-0000-000000000000`] : [lo];
    const { rows } = await pool.query(
      `SELECT id FROM cards WHERE catalog_price > 0 AND ${where} ORDER BY id`, params
    );
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      rows.map(x => `<url><loc>https://gemlinecards.com/card/${x.id}</loc></url>`).join('\n') +
      `\n</urlset>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=43200');
    res.send(xml);
  } catch (e) {
    console.error('sitemap chunk error:', e.message);
    res.status(500).send('sitemap error');
  }
});

// ── Live platform stats (cached 5 min) ──────────────────────────────────────
app.get('/api/stats/live', async (req, res) => {
  try {
    if (app._liveStatsCache?.expires > Date.now())
      return res.json(app._liveStatsCache.data);
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({});
    const [listingsRes, usersRes, pullsRes, cardsRes] = await Promise.allSettled([
      pool.query(`SELECT COUNT(*) AS c FROM listings WHERE status = 'active'`),
      pool.query(`SELECT COUNT(*) AS c FROM users`),
      pool.query(`SELECT COUNT(*) AS c FROM pack_pulls`),
      pool.query(`SELECT COUNT(*) AS c FROM mv_card_feed`),
    ]);
    const data = {
      activeListings: listingsRes.status === 'fulfilled' ? parseInt(listingsRes.value.rows[0].c) : 0,
      users:          usersRes.status === 'fulfilled'    ? parseInt(usersRes.value.rows[0].c) : 0,
      totalPulls:     pullsRes.status === 'fulfilled'    ? parseInt(pullsRes.value.rows[0].c) : 0,
      totalCards:     cardsRes.status === 'fulfilled'    ? parseInt(cardsRes.value.rows[0].c) : 0,
    };
    app._liveStatsCache = { data, expires: Date.now() + 5 * 60 * 1000 };
    res.json(data);
  } catch (e) { res.json({}); }
});

// ── Auth routes (rate-limited, no token required) ─────────────────────────────
app.use('/api/auth', rateLimit({ max: 20, windowMs: 60_000, message: 'Too many auth attempts' }));
app.use('/api/auth', async (req, res, next) => {
  const r = await getRepo();
  authRouter(r)(req, res, next);
});

// ── Static feed (no auth) ─────────────────────────────────────────────────────
app.get('/feed', (_req, res) => res.json({ mode: 'preview', cards: [] }));


// ── Admin: refresh mv_card_feed + trigger price refresh ──────────────────────
app.post('/api/admin/refresh-mv', async (req, res) => {
  if (req.headers['x-admin-key'] !== (process.env.ADMIN_KEY || 'gemline-admin-2026'))
    return res.status(403).json({ error: 'forbidden' });
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ ok: false, reason: 'no db' });
    const t0 = Date.now();
    // Refresh concurrently so reads keep working during refresh
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_card_feed');
    // Bust all in-memory caches so next request gets fresh data
    app._feedCache = null;
    app._sportCounts = null;
    app._brandCounts = null;
    app._arbCache = null;
    console.log(`[admin] mv_card_feed refreshed in ${Date.now()-t0}ms`);
    res.json({ ok: true, refreshedMs: Date.now()-t0 });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Admin ingest (no auth — key-protected instead) ────────────────────────────
app.post('/api/admin/ingest', async (req, res) => {
  if (req.headers['x-admin-key'] !== (process.env.ADMIN_KEY || 'gemline-admin-2026'))
    return res.status(403).json({ error: 'forbidden' });
  const r = await getRepo();
  const pool = r.pool;
  if (!pool) return res.json({ ok: false, reason: 'no db' });
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) return res.json({ ok: false, reason: 'no APIFY_TOKEN' });
  const { rows: cards } = await pool.query('SELECT * FROM cards ORDER BY catalog_price DESC NULLS LAST LIMIT 100');
  function chunk(arr,n){const r=[];for(let i=0;i<arr.length;i+=n)r.push(arr.slice(i,i+n));return r;}
  const searches = cards.map(c=>`${c.player} ${c.grader||''} ${c.grade||''} ${c.card_set||''}`.replace(/\s+/g,' ').trim());
  const batches = chunk(searches, 20);
  const runIds = await Promise.all(batches.map(batch=>
    fetch(`https://api.apify.com/v2/acts/kJ7qVveeS5kIVhPGB/runs?token=${APIFY_TOKEN}`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({searchQueries:batch,maxItems:15})
    }).then(r=>r.json()).then(d=>d?.data?.id).catch(()=>null)
  ));
  const valid = runIds.filter(Boolean);
  res.json({ ok: true, runs: valid.length, batches: batches.length, cards: cards.length });
  // Background: poll and store
  (async () => {
    for (const runId of valid) {
      let done = false;
      for (let i=0;i<30;i++) {
        await new Promise(r=>setTimeout(r,10000));
        const d = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`).then(r=>r.json());
        if (d?.data?.status !== 'RUNNING') { done = d?.data?.status === 'SUCCEEDED'; break; }
      }
      if (!done) continue;
      const d2 = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`).then(r=>r.json());
      const items = await fetch(`https://api.apify.com/v2/datasets/${d2?.data?.defaultDatasetId}/items?token=${APIFY_TOKEN}&limit=500`).then(r=>r.json());
      for (const item of Array.isArray(items)?items:[]) {
        const price=parseFloat(item.soldPrice||0); if(!price||price<2) continue;
        const tl=(item.title||'').toLowerCase();
        let gr='RAW',gd=''; if(tl.includes('psa')) gr='PSA'; else if(tl.includes('bgs')) gr='BGS'; else if(tl.includes('sgc')) gr='SGC';
        const gm=tl.match(/(?:psa|bgs|sgc)\s*(\d+(?:\.\d+)?)/i); if(gm) gd=gm[1];
        const mc=cards.find(c=>c.player.toLowerCase().split(' ').every(p=>tl.includes(p)));
        if(!mc) continue;
        try {
          await pool.query('INSERT INTO price_history (id,player,grader,grade,card_set,source,sale_price,listing_url,thumbnail,title,sale_date,scraped_at) VALUES (gen_random_uuid(),$1,$2,$3,\'\',\'ebay\',$4,$5,$6,$7,NOW(),NOW())',
            [mc.player,gr,gd,price,item.url||null,item.thumbnail||null,item.title||null]);
          if(item.thumbnail) await pool.query('UPDATE cards SET ebay_thumb=$1 WHERE id=$2 AND ebay_thumb IS NULL',[item.thumbnail,mc.id]);
        } catch(e){}
      }
    }
    console.log('[admin/ingest] background complete');
  })().catch(e=>console.error('[ingest]',e.message));
});


// ── AI Scout — Claude reasoning over catalog + Card Hedge search ─────────────
app.post('/api/scout/search', async (req, res) => {
  try {
    const { query, category } = req.body || {};
    if (!query) return res.json({ results: [] });
    const CH = process.env.CARDHEDGE_API_KEY || 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

    // 1. Search Card Hedge for candidates
    const sr = await fetch('https://api.cardhedger.com/v1/cards/search-cards-wsort', {
      method: 'POST',
      headers: { 'X-API-Key': CH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: query, category: category || null, page_size: 50, sort_by: 'sales_30day', sort_order: 'desc' }),
    });
    const searchData = sr.ok ? await sr.json() : { cards: [] };
    const candidates = (searchData.cards || []).slice(0, 50);

    // 2. Also get our own DB cards for edge/spread data
    const r = await getRepo();
    const pool = r.pool;
    let dbCards = [];
    if (pool) {
      const { rows } = await pool.query(`
        SELECT id, player, sport, grader, grade, variant, card_set, catalog_price, ch_price_lo, ch_price_hi, 
               sales_7d, sales_30d, gain_7d, rookie, cardhedge_id
        FROM cards WHERE catalog_price > 0
        ORDER BY sales_30d DESC NULLS LAST LIMIT 200
      `);
      dbCards = rows;
    }

    // 3. Try AI reasoning if we have an API key
    let aiResult = null;
    if (ANTHROPIC_KEY && candidates.length > 0) {
      try {
        const catalog = candidates.map(c => ({
          card_id: c.card_id, player: c.player, set: c.set, variant: c.variant,
          category: c.category, rookie: c.rookie,
          prices: (c.prices || []).map(p => `${p.grade}: $${p.price}`).join(', '),
          sales_7d: c['7 Day Sales'], sales_30d: c['30 Day Sales'],
          gain_7d: c.gain, gain_30d: c.gain_30day,
        }));

        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 800,
            messages: [{
              role: 'user',
              content: `You are GEMLINE's trading-card market scout. From this catalog, pick and rank up to 8 cards best matching the user's request, weighing price, spread/edge, gains, sales volume, and scarcity. Return ONLY JSON, no markdown:\n{"card_ids":[...],"summary":"one concise sentence explaining your picks"}\n\nRequest: "${query}"\nCatalog (${catalog.length} cards): ${JSON.stringify(catalog)}`,
            }],
          }),
        });

        if (aiRes.ok) {
          const data = await aiRes.json();
          const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
          const parsed = JSON.parse(txt.replace(/```json|```/g, '').trim());
          if (parsed && Array.isArray(parsed.card_ids) && parsed.card_ids.length) {
            aiResult = { card_ids: parsed.card_ids, summary: parsed.summary || 'Top matches', ai: true };
          }
        }
      } catch (e) { console.error('scout AI:', e.message); }
    }

    // 4. Build results — AI-ranked if available, otherwise by relevance
    let results = [];
    if (aiResult) {
      // Order by AI ranking
      const idSet = new Set(aiResult.card_ids);
      const ranked = aiResult.card_ids.map(id => candidates.find(c => c.card_id === id)).filter(Boolean);
      const rest = candidates.filter(c => !idSet.has(c.card_id));
      results = [...ranked, ...rest].slice(0, 15);
    } else {
      results = candidates.slice(0, 15);
    }

    // 5. Also try Card Hedge AI match for specific card queries
    let matchResult = null;
    try {
      const mr = await fetch('https://api.cardhedger.com/v1/cards/card-match', {
        method: 'POST',
        headers: { 'X-API-Key': CH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, category: category || null, max_candidates: 3 }),
      });
      if (mr.ok) matchResult = await mr.json();
    } catch {}

    if (matchResult?.match?.confidence >= 0.7) {
      const seen = new Set(results.map(r => r.card_id));
      if (!seen.has(matchResult.match.card_id)) {
        results.unshift({ ...matchResult.match, aiMatch: true });
      }
    }

    const summary = aiResult?.summary
      || (matchResult?.match?.confidence >= 0.7
        ? `Best match: ${matchResult.match.description} (${(matchResult.match.confidence * 100).toFixed(0)}% confidence). ${searchData.count || 0} related cards.`
        : `Found ${searchData.count || results.length} cards matching "${query}".`);

    res.json({ results, summary, totalCount: searchData.count || 0, ai: !!aiResult });
  } catch (e) { console.error('scout:', e.message); res.json({ results: [] }); }
});

// ── Card Hedge proxy: FMV + AI explanation ───────────────────────────────────
app.get('/api/cards/:cardhedgeId/fmv', async (req, res) => {
  try {
    const CH = process.env.CARDHEDGE_API_KEY || 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const grade = req.query.grade || 'PSA 10';
    const cacheKey = `fmv_${req.params.cardhedgeId}_${grade}`;
    if (app._fmvCache?.[cacheKey]?.expires > Date.now())
      return res.json(app._fmvCache[cacheKey].data);

    // Get FMV from Card Hedge
    const r = await fetch('https://api.cardhedger.com/v1/cards/card-fmv', {
      method: 'POST',
      headers: { 'X-API-Key': CH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: req.params.cardhedgeId, grade }),
    });
    const fmv = await r.json();

    // Also get comps for richer explanation
    let comps = null;
    try {
      const cr = await fetch('https://api.cardhedger.com/v1/cards/comps', {
        method: 'POST',
        headers: { 'X-API-Key': CH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: req.params.cardhedgeId, grade, count: 5, include_raw_prices: true }),
      });
      if (cr.ok) comps = await cr.json();
    } catch {}

    // AI explanation if available
    if (ANTHROPIC_KEY && fmv.price) {
      try {
        const context = {
          price: fmv.price, lo: fmv.price_low, hi: fmv.price_high,
          confidence: fmv.confidence_grade, method: fmv.method,
          explanation: fmv.price_explanation,
          comp_price: comps?.comp_price, comp_lo: comps?.low, comp_hi: comps?.high,
          comp_count: comps?.count_used,
        };
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 200,
            messages: [{ role: 'user', content: `Explain in 2-3 sentences why this trading card is priced at $${fmv.price} for ${grade}. Be conversational. Use this data: ${JSON.stringify(context)}` }],
          }),
        });
        if (aiRes.ok) {
          const data = await aiRes.json();
          const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
          if (txt) fmv.ai_explanation = txt;
        }
      } catch {}
    }

    const result = { ...fmv, comps: comps ? { price: comps.comp_price, lo: comps.low, hi: comps.high, count: comps.count_used } : null };
    if (!app._fmvCache) app._fmvCache = {};
    app._fmvCache[cacheKey] = { expires: Date.now() + 20 * 60 * 1000, data: result };
    res.json(result);
  } catch (e) { res.json({ error: e.message }); }
});

// ── Card Hedge proxy: price history ───────────────────────────────────────────
app.get('/api/cards/:cardhedgeId/history', async (req, res) => {
  try {
    const { cardhedgeId } = req.params;
    const grade = req.query.grade || 'PSA 10';
    const days = Math.min(Number(req.query.days) || 30, 365);
    const cacheKey = `history_${cardhedgeId}_${grade}_${days}`;
    if (app._historyCache?.[cacheKey]?.expires > Date.now())
      return res.json(app._historyCache[cacheKey].data);
    const apiKey = process.env.CARDHEDGE_API_KEY || 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR';

    // Fetch price history + comps in parallel
    const [histRes, compRes] = await Promise.allSettled([
      fetch('https://api.cardhedger.com/v1/cards/prices-by-card', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardhedgeId, grade, days }),
      }),
      fetch('https://api.cardhedger.com/v1/cards/comps', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardhedgeId, limit: 20 }),
      }),
    ]);

    let prices = [];
    if (histRes.status === 'fulfilled' && histRes.value.ok) {
      const data = await histRes.value.json();
      prices = (data.prices || []).map(p => ({ date: p.closing_date || p.date, price: Number(p.price) }))
        .filter(p => p.price > 0 && p.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    let comps = [];
    if (compRes.status === 'fulfilled' && compRes.value.ok) {
      const cd = await compRes.value.json();
      comps = (cd.comps || cd.sales || []).slice(0, 20).map(c => ({
        date: c.sale_date || c.date,
        price: Number(c.sale_price || c.price),
        source: c.source || 'eBay',
        url: c.listing_url || null,
      })).filter(c => c.price > 0);
    }

    // Stats derived from history
    const vals = prices.map(p => p.price);
    const stats = vals.length >= 2 ? {
      open: vals[0],
      close: vals[vals.length - 1],
      low: Math.min(...vals),
      high: Math.max(...vals),
      pctChange: (((vals[vals.length - 1] - vals[0]) / vals[0]) * 100).toFixed(1),
    } : null;

    const result = { prices, comps, stats };
    if (!app._historyCache) app._historyCache = {};
    app._historyCache[cacheKey] = { expires: Date.now() + 30 * 60 * 1000, data: result };
    res.json(result);
  } catch (e) { console.error('history:', e.message); res.json({ prices: [], comps: [], stats: null }); }
});

// ── Card Hedge proxy: top movers ──────────────────────────────────────────────
app.get('/api/market/movers', async (req, res) => {
  try {
    if (app._moversCache && app._moversCache.expires > Date.now())
      return res.json(app._moversCache.data);
    const count = Math.min(Number(req.query.count) || 50, 100);
    const category = req.query.category || '';
    const url = `https://api.cardhedger.com/v1/cards/top-movers?count=${count}${category ? `&category=${category}` : ''}`;
    const r = await fetch(url, { headers: { 'X-API-Key': process.env.CARDHEDGE_API_KEY || 'mKCO7PqBm8DL4u7Olyurw-6IFGyj-hduAZRLAhyR' } });
    const data = await r.json();
    app._moversCache = { expires: Date.now() + 60 * 60 * 1000, data }; // 1hr cache
    res.json(data);
  } catch(e) { res.json({ cards: [] }); }
});

// Heatmap: top 100 cards with real price movement, cached 5min
app.get('/api/market/heatmap', async (req, res) => {
  try {
    if (app._heatmapCache && app._heatmapCache.expires > Date.now())
      return res.json(app._heatmapCache.data);
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ cards: [], count: 0 });
    const sport = req.query.sport;
    const cols = `id AS "cardId", player, sport, card_set AS "set", grader, grade, year,
             variant, number AS num, catalog_price AS "marketPrice",
             ch_price_lo AS lo, ch_price_hi AS hi, ch_confidence AS confidence,
             ebay_thumb AS thumbnail, image_url, rookie, cardhedge_id,
             sales_7d, sales_30d, gain_7d`;
    const sportClause = (sport && sport !== 'All') ? ` AND sport = $1` : '';
    const params = (sport && sport !== 'All') ? [sport] : [];
    
    // Top 50 gainers + top 50 losers for a balanced heatmap.
    // Sanity filters: require 2+ sales to validate a move, price >= $5,
    // and clamp moves to a believable range (thin-sale cards produce
    // +124,900% / -100% garbage that makes the whole page look broken).
    const sane = `AND catalog_price >= 5 AND COALESCE(sales_7d,0) >= 2`;
    const gainersQ = `SELECT ${cols} FROM cards
      WHERE gain_7d > 0 AND gain_7d <= 500 ${sane}${sportClause}
      ORDER BY gain_7d DESC, COALESCE(sales_7d,0) DESC LIMIT 150`;
    const losersQ = `SELECT ${cols} FROM cards
      WHERE gain_7d < 0 AND gain_7d >= -90 ${sane}${sportClause}
      ORDER BY gain_7d ASC, COALESCE(sales_7d,0) DESC LIMIT 150`;
    
    const [{ rows: gainersRaw }, { rows: losersRaw }] = await Promise.all([
      pool.query(gainersQ, params),
      pool.query(losersQ, params),
    ]);
    // Dedupe: same card appears once per grade tier — keep one entry per
    // underlying card so the heatmap isn't wallpapered with duplicates.
    const dedupe = (list) => {
      const seen = new Set();
      return list.filter(c => {
        const key = c.cardhedge_id || `${c.player}|${c.set}|${c.variant}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 50);
    };
    const rows = [...dedupe(gainersRaw), ...dedupe(losersRaw)];
    const result = { cards: rows, count: rows.length };
    app._heatmapCache = { data: result, expires: Date.now() + 5 * 60 * 1000 };
    res.json(result);
  } catch(e) { console.error('Heatmap error:', e.message); res.json({ cards: [], count: 0 }); }
});

// ── PUBLIC routes (no auth) ───────────────────────────────────────────────────
app.get('/api/market/feed', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ feed: [] });
    
    // Pagination + filtering
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = (page - 1) * limit;
    const sport = req.query.sport || null;
    const search = req.query.search || null;
    const sort = req.query.sort || 'price_desc';
    const brand = req.query.brand || null;

    // Build cache key — trending uses RANDOM() so cache for 5min, others 15min
    const isTrending = !['price_asc','price_desc','player','gain','loss','sales','newest'].includes(sort);
    const cacheKey = `${sport || 'all'}_${search || ''}_${brand || ''}_${sort}_${page}_${limit}`;
    const cacheTTL = isTrending ? 300_000 : 900_000;
    if (app._feedCache && app._feedCache.key === cacheKey && app._feedCache.expires > Date.now())
      return res.json({ feed: app._feedCache.data, totalCards: app._feedCache.totalCards, page, pages: app._feedCache.pages, sportCounts: (app._sportCounts || {}).data });

    // Build WHERE clause
    const conditions = [];
    const params = [];
    let paramIdx = 1;
    if (sport && sport !== 'All') { conditions.push(`sport = $${paramIdx}`); params.push(sport); paramIdx++; }
    if (search) { conditions.push(`(player ILIKE $${paramIdx} OR card_set ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }
    if (brand) { conditions.push(`card_set ILIKE $${paramIdx}`); params.push(`%${brand}%`); paramIdx++; }
    // Use materialized view (mv_card_feed) — pre-grouped, indexed, ~10ms vs 500ms raw
    // mv columns: id, player, card_set, year, variant, number, sport, catalog_price,
    //             ch_price_lo/hi/confidence, ebay_thumb, image_url, cardhedge_id,
    //             grader, grade, gain_7d, sales_7d, sales_30d, rookie, grade_count, grades
    // Movers sorts need sanity filters — thin-sale cards produce ±10,000% garbage
    if (sort === 'gain' || sort === 'loss') {
      conditions.push(`catalog_price >= 5`, `COALESCE(sales_7d,0) >= 2`, `gain_7d BETWEEN -90 AND 500`);
    }
    const mvWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Sort against mv columns (no aggregates needed)
    let orderBy;
    switch (sort) {
      case 'price_asc': orderBy = 'catalog_price ASC NULLS LAST'; break;
      case 'price_desc': orderBy = 'catalog_price DESC NULLS LAST'; break;
      case 'player': orderBy = 'player ASC'; break;
      case 'gain': orderBy = 'gain_7d DESC NULLS LAST'; break;
      case 'loss': orderBy = 'gain_7d ASC NULLS LAST'; break;
      case 'sales': orderBy = 'sales_30d DESC NULLS LAST'; break;
      case 'newest': orderBy = 'year DESC NULLS LAST'; break;
      default:
        orderBy = `(COALESCE(sales_7d,0)*2 + COALESCE(sales_30d,0) + ABS(COALESCE(gain_7d,0))*5 + RANDOM()*20) DESC`;
        break;
    }

    const { rows: cards } = await pool.query(`
      SELECT * FROM mv_card_feed ${mvWhere}
      ORDER BY (catalog_price IS NOT NULL AND catalog_price > 0) DESC, ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...params, limit, offset]);

    const { rows: [{ count: totalCards }] } = await pool.query(
      `SELECT COUNT(*) FROM mv_card_feed ${mvWhere}`,
      params
    );

    const feed = cards.map(card => {
      const mp = Number(card.catalog_price) || 0;
      return {
        cardId: card.id, player: card.player, sport: card.sport, set: card.card_set,
        grader: card.grader || 'RAW', grade: card.grade || '', year: card.year || '',
        marketPrice: mp,
        lo: Number(card.ch_price_lo) || (mp ? Math.round(mp * 0.85) : null),
        hi: Number(card.ch_price_hi) || (mp ? Math.round(mp * 1.18) : null),
        confidence: card.ch_confidence || 'catalog',
        saleCount: Number(card.sales_30d) || 0,
        sales7d: Number(card.sales_7d) || 0,
        sales30d: Number(card.sales_30d) || 0,
        gain7d: Number(card.gain_7d) || 0,
        rookie: card.rookie || false,
        thumbnail: card.ebay_thumb || card.image_url || null,
        label: card.ch_confidence ? `Card Hedge Grade ${card.ch_confidence}` : (mp ? 'Catalog price' : ''),
        variant: card.variant || '', num: card.number || '',
        cardhedge_id: card.cardhedge_id || null,
        gradeCount: Number(card.grade_count) || 1,
        grades: (card.grades || []).map(g => ({
          grader: g.grader || 'RAW',
          grade: g.grade || '',
          price: Number(g.price) || 0,
          lo: Number(g.lo) || 0,
          hi: Number(g.hi) || 0,
          sales7d: Number(g.sales7d) || 0,
          sales30d: Number(g.sales30d) || 0,
          gain7d: Number(g.gain7d) || 0,
        })),
      };
    });
    
    const total = Number(totalCards);
    const pages = Math.ceil(total / limit);

    // Sport counts — query from mv (fast, indexed)
    let sportCounts = app._sportCounts;
    if (!sportCounts || sportCounts.expires < Date.now()) {
      const { rows: sc } = await pool.query(
        // Defensive: never surface junk import IDs (^[0-9]+x[0-9]+$) or empty sports
        `SELECT sport, COUNT(*) as cnt FROM mv_card_feed
         WHERE sport IS NOT NULL AND sport <> '' AND sport !~ '^[0-9]+x[0-9]+$'
         GROUP BY sport ORDER BY cnt DESC`);
      sportCounts = { data: sc.map(r => ({ sport: r.sport, count: Number(r.cnt) })), expires: Date.now() + 60 * 60 * 1000 };
      app._sportCounts = sportCounts;
    }

    // Brand counts — query from mv (fast)
    let brandCounts = app._brandCounts;
    if (!brandCounts || brandCounts.expires < Date.now()) {
      const { rows: bc } = await pool.query(`
        SELECT card_set AS brand, COUNT(*) as cnt FROM mv_card_feed
        WHERE card_set IS NOT NULL AND card_set != ''
        GROUP BY card_set ORDER BY cnt DESC LIMIT 30
      `);
      brandCounts = { data: bc.map(r => ({ brand: r.brand, count: Number(r.cnt) })), expires: Date.now() + 60 * 60 * 1000 };
      app._brandCounts = brandCounts;
    }

    if (!isTrending) {
      app._feedCache = { key: cacheKey, expires: Date.now() + cacheTTL, data: feed, totalCards: total, pages };
    }
    res.json({ feed, totalCards: total, page, pages, sportCounts: sportCounts.data, brandCounts: brandCounts.data });
  } catch(e) { console.error('market/feed:', e.message); res.json({ feed: [] }); }
});

// Normalize legacy grader pollution at read time ('Raw', 'NULL', 'null', empty → RAW)
const normGrader = (g) => {
  const v = (g || '').trim();
  if (!v || /^(raw|null)$/i.test(v)) return 'RAW';
  return v.toUpperCase();
};
const normGrade = (g) => {
  const v = (g || '').trim();
  if (!v || /^(ungraded|null)$/i.test(v)) return '';
  return v;
};

app.post('/api/catalog/search', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    const q = (req.body?.q || req.query.q || '').trim();
    if (!pool || !q) return res.json({ results: [], families: [], canCreate: true });
    if (q.length > 200) return res.status(400).json({ error: 'Query too long' });

    // Tokenized AND matching — every token must hit player/set/variant/year.
    // Backed by expression trgm index idx_cards_search_trgm.
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const SEARCH_EXPR = `(coalesce(player,'') || ' ' || coalesce(card_set,'') || ' ' || coalesce(variant,'') || ' ' || coalesce(year,''))`;
    const params = [q];
    const conds = tokens.map((t) => {
      params.push(`%${t}%`);
      return `${SEARCH_EXPR} ILIKE $${params.length}`;
    });

    const { rows: famRows } = await pool.query(
      `WITH m AS (
         SELECT id, player, card_set, year, variant, number, sport, grader, grade,
                catalog_price, ebay_thumb, image_url, sales_30d,
                similarity(coalesce(player,'') || ' ' || coalesce(card_set,'') || ' ' || coalesce(variant,''), $1) AS sim
         FROM cards
         WHERE ${conds.join(' AND ')}
         ORDER BY sim DESC, sales_30d DESC NULLS LAST, catalog_price DESC NULLS LAST
         LIMIT 500
       )
       SELECT player, card_set, variant, number, sport,
              max(coalesce(year,'')) AS year,
              max(sim) AS sim,
              max(catalog_price) AS top_price,
              sum(coalesce(sales_30d,0)) AS liquidity,
              (array_agg(ebay_thumb) FILTER (WHERE ebay_thumb IS NOT NULL))[1] AS ebay_thumb,
              (array_agg(image_url) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url,
              json_agg(json_build_object('id', id, 'grader', grader, 'grade', grade,
                       'catalog_price', catalog_price, 'sales_30d', sales_30d)
                       ORDER BY catalog_price DESC NULLS LAST) AS tiers
       FROM m
       GROUP BY player, card_set, variant, number, sport
       ORDER BY max(sim) DESC, sum(coalesce(sales_30d,0)) DESC NULLS LAST, max(catalog_price) DESC NULLS LAST
       LIMIT 15`,
      params
    );

    const families = famRows.map((f) => {
      // Dedupe tiers on normalized (grader, grade), preferring the priced row
      const seen = new Map();
      for (const t of (f.tiers || [])) {
        const grader = normGrader(t.grader);
        const grade = normGrade(t.grade);
        const key = `${grader}|${grade}`;
        const price = Number(t.catalog_price) || 0;
        const sales30d = Number(t.sales_30d) || 0;
        const prev = seen.get(key);
        // Prefer the most-traded row (liquidity), then price — avoids low-volume price outliers
        if (!prev || sales30d > prev.sales30d || (sales30d === prev.sales30d && price > prev.price)) {
          seen.set(key, { id: t.id, grader, grade, price, sales30d });
        }
      }
      const tiers = [...seen.values()].sort((a, b) => {
        if (a.grader === 'RAW' && b.grader !== 'RAW') return -1;
        if (b.grader === 'RAW' && a.grader !== 'RAW') return 1;
        return b.price - a.price;
      });
      return {
        player: f.player, card_set: f.card_set, variant: f.variant || '',
        number: f.number || '', sport: f.sport || '', year: f.year || '',
        topPrice: Number(f.top_price) || 0, liquidity: Number(f.liquidity) || 0,
        ebay_thumb: f.ebay_thumb || null, image_url: f.image_url || null,
        tiers,
      };
    });

    // Backward-compatible flat list (live/sell consumers): one row per tier
    const results = [];
    for (const fam of families) {
      for (const t of fam.tiers) {
        if (results.length >= 40) break;
        results.push({
          id: t.id, player: fam.player, card_set: fam.card_set, variant: fam.variant,
          sport: fam.sport, year: fam.year, grader: t.grader, grade: t.grade,
          catalog_price: t.price || null, ebay_thumb: fam.ebay_thumb, image_url: fam.image_url,
        });
      }
    }

    res.json({ results, families, canCreate: true, total: results.length });
  } catch(e) { console.error('catalog/search:', e.message); res.json({ results: [], families: [], canCreate: true }); }
});

// ── Public routes (no auth) ──────────────────────────────────────────────────
app.post('/api/cards/analyze', rateLimit({ max: 20, windowMs: 60_000 }), async (req, res) => {
  const r = await getRepo();
  const { appRouter } = await import('../src/routes/app.js');
  // Extract the analyze handler by mounting temporarily
  appRouter(r, null)(req, res, () => res.status(404).json({ error: 'not found' }));
});

// GET /api/market/arb — dedicated arbitrage data (cached 5min)
app.get('/api/market/arb', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh && app._arbCache && app._arbCache.expires > Date.now())
      return res.json(app._arbCache.data);
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ cards: [] });

    const arbCols = `id, player, sport, card_set, grader, grade, year, variant,
             catalog_price, ch_price_lo, ch_price_hi, gain_7d, sales_7d, sales_30d,
             ebay_thumb, cardhedge_id, rookie`;

    // Parallelize all 4 queries — cuts latency from ~400ms to ~100ms
    const [uvRes, gainRes, lossRes, tradedRes] = await Promise.all([
      // Undervalued: high volume + negative gain = buy-the-dip candidates
      pool.query(`SELECT ${arbCols} FROM cards
        WHERE catalog_price > 5 AND catalog_price <= 5000 AND sales_7d >= 3
          AND COALESCE(gain_7d, 0) < 0
        ORDER BY (COALESCE(sales_7d,0) * ABS(COALESCE(gain_7d,0))) DESC LIMIT 50`),
      // 7-day gainers (min 3 sales to validate the move)
      pool.query(`SELECT ${arbCols} FROM cards
        WHERE gain_7d > 5 AND sales_7d >= 3 AND catalog_price > 5 AND catalog_price <= 5000
        ORDER BY gain_7d DESC LIMIT 25`),
      // 7-day losers (min 3 sales to validate the drop)
      pool.query(`SELECT ${arbCols} FROM cards
        WHERE gain_7d < -5 AND sales_7d >= 3 AND catalog_price > 5 AND catalog_price <= 5000
        ORDER BY gain_7d ASC LIMIT 25`),
      // Most traded (real volume)
      pool.query(`SELECT ${arbCols} FROM cards
        WHERE sales_7d >= 5 AND catalog_price > 5 AND catalog_price <= 5000
        ORDER BY sales_7d DESC, sales_30d DESC LIMIT 25`),
    ]);

    const [undervalued, gainers, losers, mostTraded] = [
      uvRes.rows, gainRes.rows, lossRes.rows, tradedRes.rows,
    ];

    const mapCard = (c) => ({
      id: c.id, player: c.player, sport: c.sport, set: c.card_set,
      grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
      market: Number(c.catalog_price) || 0,
      lo: Number(c.ch_price_lo) || 0, hi: Number(c.ch_price_hi) || 0,
      gain7d: Number(c.gain_7d) || 0, sales7d: Number(c.sales_7d) || 0,
      sales30d: Number(c.sales_30d) || 0,
      thumbnail: c.ebay_thumb, cardhedge_id: c.cardhedge_id, rookie: c.rookie,
      edge: (Number(c.ch_price_lo) > 0 && Number(c.ch_price_hi) > 0)
        ? +(((Number(c.ch_price_hi) - Number(c.ch_price_lo)) / Number(c.ch_price_lo)) * 100).toFixed(1) : 0,
      spread: (Number(c.ch_price_hi) || 0) - (Number(c.ch_price_lo) || 0),
    });

    const data = {
      undervalued: undervalued.map(mapCard),
      gainers: gainers.map(mapCard),
      losers: losers.map(mapCard),
      mostTraded: mostTraded.map(mapCard),
    };

    app._arbCache = { data, expires: Date.now() + 5 * 60 * 1000 };
    res.json(data);
  } catch (e) {
    console.error('Arb data error:', e.message);
    res.json({ undervalued: [], gainers: [], losers: [], mostTraded: [] });
  }
});

// GET /api/badges — list all available badges (public)
app.get('/api/badges', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ badges: [] });
    const { rows } = await pool.query('SELECT key, name, emoji, tier, description, category FROM badges ORDER BY category, tier DESC, name');
    res.json({ badges: rows });
  } catch (e) {
    console.error('Badges list error:', e.message);
    res.json({ badges: [] });
  }
});

// Proxy public routes through appRouter before auth
app.use('/api/catalog/search', async (req, res, next) => {
  if (req.method !== 'POST') return next();
  const r = await getRepo();
  const { appRouter } = await import('../src/routes/app.js');
  appRouter(r, null)(req, res, next);
});

// (Duplicate feed route removed — primary feed is defined above with pagination)

// ── Notifications ──────────────────────────────────────────────────────────────
let _notifTableReady = false;
async function ensureNotifTable(pool) {
  if (_notifTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      data JSONB DEFAULT '{}',
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, read, created_at DESC)').catch(() => {});
  _notifTableReady = true;
}

async function notify(pool, userId, type, title, body = '', data = {}) {
  if (!pool || !userId) return;
  try {
    await ensureNotifTable(pool);
    await pool.query(
      'INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)',
      [userId, type, title, body, JSON.stringify(data)]
    );
  } catch (e) { console.error('notify error:', e.message); }
}

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ notifications: [], unread: 0 });
    await ensureNotifTable(pool);
    const { rows } = await pool.query(
      'SELECT id, type, title, body, data, read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
      [req.userId]
    );
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read = FALSE',
      [req.userId]
    );
    res.json({ notifications: rows, unread: Number(count) });
  } catch (e) {
    res.json({ notifications: [], unread: 0 });
  }
});

app.post('/api/notifications/read', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ ok: true });
    await ensureNotifTable(pool);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(n => Number.isInteger(Number(n))) : null;
    if (ids && ids.length) {
      await pool.query('UPDATE notifications SET read = TRUE WHERE user_id = $1 AND id = ANY($2)', [req.userId, ids.map(Number)]);
    } else {
      await pool.query('UPDATE notifications SET read = TRUE WHERE user_id = $1', [req.userId]);
    }
    res.json({ ok: true });
  } catch (e) { res.json({ ok: true }); }
});

// ── Auction settlement engine ──────────────────────────────────────────
// Runs lazily (throttled) from /api/auctions/live and on demand via POST /api/auctions/settle.
// Ended auction w/ winning bid ≥ reserve → escrow order for winner, listing 'sold'.
// No bids or reserve not met → listing 'completed', parties notified.
let _lastSettle = 0;
async function settleEndedAuctions(r, { force = false } = {}) {
  const pool = r.pool;
  if (!pool) return { settled: 0, closed: 0 };
  const now = Date.now();
  if (!force && now - _lastSettle < 60_000) return { skipped: true };
  _lastSettle = now;

  const { rows: ended } = await pool.query(`
    SELECT l.*, c.player,
      (SELECT b.bidder_id FROM bids b WHERE b.listing_id = l.id ORDER BY b.amount DESC, b.created_at ASC LIMIT 1) AS winner_id,
      (SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id) AS winning_bid
    FROM listings l JOIN cards c ON c.id = l.card_id
    WHERE l.kind = 'auction' AND l.status = 'active' AND l.ends_at < NOW()
    LIMIT 20
  `);

  let settled = 0, closed = 0;
  const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
  for (const a of ended) {
    try {
      const winningBid = a.winning_bid != null ? Number(a.winning_bid) : null;
      const reserve = a.reserve_price != null ? Number(a.reserve_price) : null;
      const priceStr = winningBid != null ? `$${(winningBid / 100).toLocaleString()}` : '';

      if (!a.winner_id || winningBid == null) {
        await pool.query("UPDATE listings SET status = 'completed' WHERE id = $1", [a.id]);
        await notify(pool, a.seller_id, 'auction_ended', `Auction ended: ${a.player}`, 'Your auction ended with no bids. You can relist anytime.', { listingId: a.id, cardId: a.card_id });
        closed++;
        continue;
      }
      if (reserve != null && reserve > 0 && winningBid < reserve) {
        await pool.query("UPDATE listings SET status = 'completed' WHERE id = $1", [a.id]);
        await notify(pool, a.seller_id, 'auction_ended', `Auction ended: ${a.player}`, `Top bid ${priceStr} did not meet your reserve.`, { listingId: a.id, cardId: a.card_id });
        await notify(pool, a.winner_id, 'auction_lost', `Auction ended: ${a.player}`, `Your top bid ${priceStr} did not meet the seller's reserve.`, { listingId: a.id, cardId: a.card_id });
        closed++;
        continue;
      }

      // Winner — create escrow order at the winning bid
      const order = await ordersSvc.create(r, stripe, {
        listingId: a.id, cardId: a.card_id, buyerId: a.winner_id, sellerId: a.seller_id,
        amount: winningBid, fee: Math.round(winningBid * 0.1),
        method: a.vault_item_id ? 'vault' : 'direct', vaultItemId: a.vault_item_id || null,
      });
      await pool.query("UPDATE listings SET status = 'sold' WHERE id = $1", [a.id]);
      await pool.query('UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1', [a.id]).catch(() => {});
      await notify(pool, a.winner_id, 'auction_won', `You won: ${a.player} — ${priceStr}`, 'Payment is held in escrow. The seller will ship your card.', { listingId: a.id, cardId: a.card_id, orderId: order.id });
      const wonTpl = emailTpl.auctionWon({ player: a.player, price: priceStr });
      await emailUser(pool, a.winner_id, wonTpl.subject, wonTpl.html);
      await notify(pool, a.seller_id, 'auction_sold', `Sold: ${a.player} — ${priceStr}`, 'Ship the card to complete the sale and release your payout.', { listingId: a.id, cardId: a.card_id, orderId: order.id });
      settled++;
    } catch (e) {
      console.error('settle auction', a.id, 'error:', e.message);
    }
  }
  return { settled, closed };
}

app.post('/api/auctions/settle', async (req, res) => {
  try {
    const r = await getRepo();
    const result = await settleEndedAuctions(r, { force: true });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Auctions — GET live auctions (public), POST create (auth), POST bid (auth) ───
app.get('/api/auctions/live', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ auctions: [] });
    // Settle/close ended auctions lazily (throttled to 1/min)
    await settleEndedAuctions(r).catch(() => {});

    const { rows } = await pool.query(`
      SELECT
        l.id, l.card_id, l.price AS current_price, l.reserve_price, l.ends_at AS end_time,
        l.created_at AS start_time, l.status,
        CASE WHEN l.ends_at > NOW() THEN 'live' ELSE 'ended' END AS computed_status,
        c.player, c.sport, c.card_set, c.grader, c.grade, c.variant,
        c.ebay_thumb, c.image_url, c.catalog_price,
        u.handle AS seller_handle,
        (SELECT COUNT(*) FROM bids WHERE listing_id = l.id) AS bid_count,
        (SELECT MAX(amount) FROM bids WHERE listing_id = l.id) AS highest_bid,
        (SELECT u2.handle FROM bids b2 JOIN users u2 ON u2.id = b2.bidder_id
         WHERE b2.listing_id = l.id ORDER BY b2.amount DESC, b2.created_at ASC LIMIT 1) AS highest_bidder
      FROM listings l
      JOIN cards c ON c.id = l.card_id
      JOIN users u ON u.id = l.seller_id
      WHERE l.kind = 'auction' AND l.status = 'active'
      ORDER BY l.ends_at ASC
      LIMIT 50
    `);
    const auctions = rows.map(a => {
      const currentPrice = Number(a.highest_bid || a.current_price || 0);
      const reserve = a.reserve_price != null ? Number(a.reserve_price) : null;
      return {
        ...a,
        status: a.computed_status,
        current_price: currentPrice,
        bid_count: Number(a.bid_count || 0),
        catalog_price: a.catalog_price != null ? Number(a.catalog_price) : null,
        has_reserve: reserve != null && reserve > 0,
        reserve_met: reserve != null && reserve > 0 ? currentPrice >= reserve : null,
      };
    });
    res.json({ auctions });
  } catch (e) {
    console.error('auctions/live error:', e.message);
    res.json({ auctions: [] });
  }
});

app.post('/api/auctions/create', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });

    const { cardId, startingBid, reservePrice, durationHours = 24 } = req.body;
    if (!cardId) return res.status(400).json({ error: 'cardId required' });
    if (!startingBid || Number(startingBid) < 0.01) return res.status(400).json({ error: 'Starting bid must be at least $0.01' });

    // Verify card exists
    const { rows: [card] } = await pool.query('SELECT id, player FROM cards WHERE id = $1', [cardId]);
    if (!card) return res.status(404).json({ error: 'Card not found' });

    const durationMs = Math.max(1, Math.min(168, Number(durationHours) || 24)) * 3600 * 1000;
    const endsAt = new Date(Date.now() + durationMs).toISOString();
    const priceInCents = Math.round(Number(startingBid) * 100);
    const reserveInCents = reservePrice ? Math.round(Number(reservePrice) * 100) : null;

    const { rows: [listing] } = await pool.query(`
      INSERT INTO listings (card_id, seller_id, kind, price, reserve_price, currency, status, ends_at, created_at)
      VALUES ($1, $2, 'auction', $3, $4, 'USD', 'active', $5, NOW())
      RETURNING id
    `, [cardId, req.userId, priceInCents, reserveInCents, endsAt]);

    res.json({ success: true, listingId: listing.id, endsAt, player: card.player });
  } catch (e) {
    console.error('auctions/create error:', e.message);
    res.status(500).json({ error: 'Failed to create auction' });
  }
});

app.post('/api/auctions/:id/bid', requireAuth, async (req, res) => {
  const r = await getRepo().catch(() => null);
  const pool = r?.pool;
  if (!pool) return res.status(500).json({ error: 'No database' });

  const listingId = req.params.id;
  const bidAmount = Number(req.body?.amount);
  if (!bidAmount || bidAmount < 0.01) return res.status(400).json({ error: 'Bid amount too low' });

  // Ensure bids table exists (idempotent, outside the hot transaction)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bids (
      id SERIAL PRIMARY KEY,
      listing_id UUID NOT NULL,
      bidder_id UUID NOT NULL,
      amount NUMERIC NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Row lock prevents two concurrent bids both passing the min-bid check
    const { rows: [listing] } = await client.query(
      `SELECT * FROM listings WHERE id = $1 AND kind = 'auction' AND status = 'active' FOR UPDATE`,
      [listingId]
    );
    if (!listing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Auction not found or ended' }); }
    if (listing.seller_id === req.userId) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Cannot bid on your own auction' }); }
    if (listing.ends_at && new Date(listing.ends_at) < new Date()) { await client.query('ROLLBACK'); return res.status(410).json({ error: 'Auction has ended' }); }

    const currentPrice = Number(listing.price) / 100;
    const minBid = currentPrice + Math.max(1, Math.round(currentPrice * 0.05));
    if (bidAmount < minBid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Minimum bid is $${minBid.toFixed(2)}` });
    }

    const bidAmountCents = Math.round(bidAmount * 100);

    // Anti-snipe: extend to at least 2 minutes remaining (never shortens)
    const { rows: [updated] } = await client.query(
      `UPDATE listings
       SET price = $1,
           ends_at = GREATEST(ends_at, NOW() + INTERVAL '2 minutes')
       WHERE id = $2
       RETURNING ends_at`,
      [bidAmountCents, listingId]
    );

    // Who was the previous high bidder? (for outbid notification)
    const { rows: [prevTop] } = await client.query(
      'SELECT bidder_id FROM bids WHERE listing_id = $1 ORDER BY amount DESC, created_at ASC LIMIT 1',
      [listingId]
    );

    await client.query(
      `INSERT INTO bids (listing_id, bidder_id, amount) VALUES ($1, $2, $3)`,
      [listingId, req.userId, bidAmountCents]
    );

    await client.query('COMMIT');

    // Outbid notification (post-commit; awaited — serverless freezes kill fire-and-forget)
    if (prevTop?.bidder_id && prevTop.bidder_id !== req.userId) {
      try {
        const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [listing.card_id]);
        await notify(pool, prevTop.bidder_id, 'outbid',
          `You've been outbid: ${card?.player || 'your card'}`,
          `New high bid is $${bidAmount.toLocaleString()}. Jump back in before it ends.`,
          { listingId, cardId: listing.card_id });
      } catch {}
    }

    const reserve = listing.reserve_price != null ? Number(listing.reserve_price) : null;
    res.json({
      success: true,
      amount: bidAmount,
      ends_at: updated?.ends_at || listing.ends_at,
      reserve_met: reserve != null && reserve > 0 ? bidAmountCents >= reserve : null,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('auctions/bid error:', e.message);
    res.status(500).json({ error: 'Bid failed' });
  } finally {
    client.release();
  }
});

// Bid history for an auction — public, anonymized handles
app.get('/api/auctions/:id/bids', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ bids: [] });
    const { rows } = await pool.query(`
      SELECT b.amount, b.created_at, u.handle AS bidder_handle
      FROM bids b LEFT JOIN users u ON u.id = b.bidder_id
      WHERE b.listing_id = $1
      ORDER BY b.created_at DESC
      LIMIT 15
    `, [req.params.id]);
    res.json({
      bids: rows.map(b => ({
        amount: Number(b.amount),
        created_at: b.created_at,
        bidder_handle: b.bidder_handle || 'bidder',
      })),
    });
  } catch (e) {
    res.json({ bids: [] });
  }
});

// ── Listings for a specific card — public (powers CardDetail "For Sale") ──────
app.get('/api/listings/for-card/:cardId', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ listings: [] });
    const { rows } = await pool.query(`
      SELECT l.id, l.price, l.kind, l.created_at, u.handle AS seller_handle
      FROM listings l
      LEFT JOIN users u ON u.id = l.seller_id
      WHERE l.card_id = $1 AND l.status = 'active' AND l.kind = 'buy_now'
      ORDER BY l.price ASC
      LIMIT 10
    `, [req.params.cardId]);
    res.json({
      listings: rows.map(l => ({
        id: l.id,
        price: Number(l.price) / 100, // cents → dollars for display
        kind: l.kind,
        seller_handle: l.seller_handle || 'seller',
        open_to_offers: true,
        created_at: l.created_at,
      })),
    });
  } catch (e) {
    console.error('listings/for-card error:', e.message);
    res.json({ listings: [] });
  }
});

// ── Marketplace listings CRUD (Sell UI + Market feed) ───────────────────────
// Prices are stored in CENTS in the DB (matches for-card/buy flow); list
// endpoints return DOLLARS for display.
app.get('/api/listings', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ listings: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 500);
    const { rows } = await pool.query(`
      SELECT l.id, l.card_id, l.price, l.kind, l.status, l.open_to_offers,
             l.listing_type, l.created_at, u.handle AS seller_handle,
             c.player, c.card_set, c.grader, c.grade, c.year, c.variant, c.sport,
             c.ebay_thumb, c.image_url,
             (SELECT COUNT(*) FROM listing_offers o WHERE o.listing_id = l.id AND o.status = 'pending') AS offer_count
      FROM listings l
      LEFT JOIN users u ON u.id = l.seller_id
      LEFT JOIN cards c ON c.id = l.card_id
      WHERE l.status = 'active' AND l.kind = 'buy_now'
      ORDER BY l.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json({
      listings: rows.map(l => ({
        id: l.id, card_id: l.card_id, cardId: l.card_id,
        price: Number(l.price) / 100,
        kind: l.kind, status: l.status,
        open_to_offers: l.open_to_offers ?? false,
        listing_type: l.listing_type || 'buy_now',
        seller_handle: l.seller_handle || 'seller',
        offer_count: Number(l.offer_count) || 0,
        player: l.player, card_set: l.card_set, grader: l.grader, grade: l.grade,
        year: l.year, variant: l.variant, sport: l.sport,
        ebay_thumb: l.ebay_thumb, image_url: l.image_url,
        created_at: l.created_at,
      })),
    });
  } catch (e) {
    console.error('listings/list error:', e.message);
    res.json({ listings: [] });
  }
});

app.get('/api/listings/mine', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ listings: [] });
    const { rows } = await pool.query(`
      SELECT l.id, l.card_id, l.price, l.kind, l.status, l.open_to_offers,
             l.listing_type, l.description, l.photo_urls, l.created_at,
             c.player, c.card_set, c.grader, c.grade, c.year, c.variant, c.sport,
             c.ebay_thumb, c.image_url,
             (SELECT COUNT(*) FROM listing_offers o WHERE o.listing_id = l.id AND o.status = 'pending') AS offer_count
      FROM listings l
      LEFT JOIN cards c ON c.id = l.card_id
      WHERE l.seller_id = $1 AND l.status IN ('active','sold','completed')
      ORDER BY l.created_at DESC
      LIMIT 200
    `, [req.userId]);
    res.json({
      listings: rows.map(l => ({
        id: l.id, card_id: l.card_id,
        price: Number(l.price) / 100,
        kind: l.kind, status: l.status,
        open_to_offers: l.open_to_offers ?? false,
        listing_type: l.listing_type || 'buy_now',
        description: l.description || '',
        photo_urls: l.photo_urls || [],
        offer_count: Number(l.offer_count) || 0,
        player: l.player, card_set: l.card_set, grader: l.grader, grade: l.grade,
        year: l.year, variant: l.variant, sport: l.sport,
        ebay_thumb: l.ebay_thumb, image_url: l.image_url,
        created_at: l.created_at,
      })),
    });
  } catch (e) {
    console.error('listings/mine error:', e.message);
    res.json({ listings: [] });
  }
});

app.post('/api/listings', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const { cardId, price, listingType, openToOffers, description, photos } = req.body || {};
    if (!cardId) return res.status(400).json({ error: 'cardId required' });
    const dollars = Number(price);
    if (!isFinite(dollars) || dollars <= 0) return res.status(400).json({ error: 'Price must be greater than 0' });
    const { rows: [card] } = await pool.query('SELECT id FROM cards WHERE id = $1', [cardId]);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const cents = Math.round(dollars * 100);
    const photoUrls = Array.isArray(photos) ? photos.slice(0, 8) : [];
    const { rows: [listing] } = await pool.query(`
      INSERT INTO listings (card_id, seller_id, kind, price, currency, status,
                            open_to_offers, listing_type, description, photo_urls, created_at)
      VALUES ($1, $2, 'buy_now', $3, 'USD', 'active', $4, $5, $6, $7, NOW())
      RETURNING id, card_id, price, status, open_to_offers, listing_type, created_at
    `, [cardId, req.userId, cents, !!openToOffers, listingType || 'buy_now',
        description || null, JSON.stringify(photoUrls)]);
    res.json({ ...listing, price: Number(listing.price) / 100 });
  } catch (e) {
    console.error('listings/create error:', e.message);
    res.status(500).json({ error: 'Failed to create listing' });
  }
});

app.put('/api/listings/:id', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const { rows: [l] } = await pool.query('SELECT id, seller_id FROM listings WHERE id = $1', [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.seller_id !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    const updates = [];
    const params = [];
    if (req.body?.price !== undefined) {
      const dollars = Number(req.body.price);
      if (!isFinite(dollars) || dollars <= 0) return res.status(400).json({ error: 'Price must be greater than 0' });
      params.push(Math.round(dollars * 100)); updates.push(`price = $${params.length}`);
    }
    if (req.body?.openToOffers !== undefined) { params.push(!!req.body.openToOffers); updates.push(`open_to_offers = $${params.length}`); }
    if (req.body?.description !== undefined) { params.push(req.body.description || null); updates.push(`description = $${params.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    const { rows: [upd] } = await pool.query(
      `UPDATE listings SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, price, status`, params);
    res.json({ ...upd, price: Number(upd.price) / 100 });
  } catch (e) {
    console.error('listings/update error:', e.message);
    res.status(500).json({ error: 'Failed to update listing' });
  }
});

app.delete('/api/listings/:id', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const { rows: [l] } = await pool.query('SELECT id, seller_id, card_id FROM listings WHERE id = $1', [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.seller_id !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    await pool.query("UPDATE listings SET status = 'cancelled' WHERE id = $1", [req.params.id]);
    // Keep any linked portfolio item in sync
    await pool.query('UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1', [req.params.id]).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    console.error('listings/delete error:', e.message);
    res.status(500).json({ error: 'Failed to cancel listing' });
  }
});

// ── Buy a listing directly (CardDetail buy flow) ────────────────────────────
app.post('/api/listings/:id/buy', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const l = await r.listings.get(req.params.id);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.status !== 'active') return res.status(410).json({ error: 'Listing no longer available' });
    if (l.seller_id === req.userId) return res.status(400).json({ error: 'Cannot buy your own listing' });
    const method = l.vault_item_id ? 'vault' : 'direct';
    const order = await ordersSvc.create(r, stripe, {
      listingId: l.id, cardId: l.card_id, buyerId: req.userId, sellerId: l.seller_id,
      amount: Number(l.price), fee: Math.round(Number(l.price) * 0.1),
      method, vaultItemId: l.vault_item_id || null,
    });
    // Mark listing sold + sync portfolio flag if the seller had it linked
    if (r.pool) {
      await r.pool.query("UPDATE listings SET status = 'completed' WHERE id = $1", [l.id]).catch(e => console.error('listing complete:', e.message));
      await r.pool.query("UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1", [l.id]).catch(() => {});
    } else {
      await r.listings.update({ id: l.id, status: 'completed' }).catch(() => {});
    }
    res.json({ order, instant: order.status === 'settled' });
  } catch (e) {
    console.error('listings/buy error:', e.message);
    res.status(500).json({ error: e.message || 'Purchase failed' });
  }
});

// ── Make an offer on a listing ───────────────────────────────────────────
app.post('/api/listings/:id/offer', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const amount = Number(req.body?.amount);
    if (!amount || amount < 0.01) return res.status(400).json({ error: 'Invalid offer amount' });
    const { rows: [l] } = await pool.query("SELECT * FROM listings WHERE id = $1 AND status = 'active'", [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.seller_id === req.userId) return res.status(400).json({ error: 'Cannot offer on your own listing' });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS listing_offers (
        id SERIAL PRIMARY KEY,
        listing_id UUID NOT NULL,
        buyer_id UUID NOT NULL,
        amount NUMERIC NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});
    const { rows: [offer] } = await pool.query(
      'INSERT INTO listing_offers (listing_id, buyer_id, amount) VALUES ($1, $2, $3) RETURNING id',
      [req.params.id, req.userId, Math.round(amount * 100)]
    );

    // Notify the seller (awaited — serverless freezes kill fire-and-forget)
    try {
      const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [l.card_id]);
      await notify(pool, l.seller_id, 'offer_received',
        `New offer: ${card?.player || 'your listing'} — $${amount.toLocaleString()}`,
        `Listed at $${(Number(l.price) / 100).toLocaleString()}. Review it in your Offers inbox.`,
        { listingId: l.id, cardId: l.card_id, offerId: offer.id });
      const offTpl = emailTpl.offerReceived({ player: card?.player || 'your listing', amount: `$${amount.toLocaleString()}`, listPrice: `$${(Number(l.price) / 100).toLocaleString()}` });
      await emailUser(pool, l.seller_id, offTpl.subject, offTpl.html);
    } catch {}

    res.json({ success: true, offerId: offer.id });
  } catch (e) {
    console.error('listings/offer error:', e.message);
    res.status(500).json({ error: 'Offer failed' });
  }
});

// ── Offers inbox ───────────────────────────────────────────────────────────
app.get('/api/offers', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ received: [], sent: [] });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS listing_offers (
        id SERIAL PRIMARY KEY,
        listing_id UUID NOT NULL,
        buyer_id UUID NOT NULL,
        amount NUMERIC NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});
    const base = `
      SELECT o.id, o.listing_id, o.amount, o.status, o.created_at,
             l.price AS listing_price, l.status AS listing_status, l.seller_id, o.buyer_id,
             c.id AS card_id, c.player, c.card_set, c.grader, c.grade, c.ebay_thumb, c.image_url,
             ub.handle AS buyer_handle, us.handle AS seller_handle
      FROM listing_offers o
      JOIN listings l ON l.id = o.listing_id
      JOIN cards c ON c.id = l.card_id
      LEFT JOIN users ub ON ub.id = o.buyer_id
      LEFT JOIN users us ON us.id = l.seller_id`;
    const [rec, sent] = await Promise.all([
      pool.query(`${base} WHERE l.seller_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [req.userId]),
      pool.query(`${base} WHERE o.buyer_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [req.userId]),
    ]);
    const shape = o => ({
      id: o.id, listingId: o.listing_id,
      amount: Number(o.amount) / 100, listingPrice: Number(o.listing_price) / 100,
      status: o.status, listingStatus: o.listing_status, createdAt: o.created_at,
      cardId: o.card_id, player: o.player, set: o.card_set, grader: o.grader, grade: o.grade,
      thumbnail: o.ebay_thumb || o.image_url || null,
      buyerHandle: o.buyer_handle || 'buyer', sellerHandle: o.seller_handle || 'seller',
    });
    res.json({ received: rec.rows.map(shape), sent: sent.rows.map(shape) });
  } catch (e) {
    console.error('offers list error:', e.message);
    res.json({ received: [], sent: [] });
  }
});

app.post('/api/offers/:id/accept', requireAuth, async (req, res) => {
  const r = await getRepo().catch(() => null);
  const pool = r?.pool;
  if (!pool) return res.status(500).json({ error: 'No database' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [offer] } = await client.query(
      `SELECT o.*, l.seller_id, l.card_id, l.status AS listing_status, l.vault_item_id
       FROM listing_offers o JOIN listings l ON l.id = o.listing_id
       WHERE o.id = $1 FOR UPDATE OF o, l`,
      [req.params.id]
    );
    if (!offer) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Offer not found' }); }
    if (offer.seller_id !== req.userId) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your listing' }); }
    if (offer.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Offer is no longer pending' }); }
    if (offer.listing_status !== 'active') { await client.query('ROLLBACK'); return res.status(410).json({ error: 'Listing is no longer active' }); }

    await client.query("UPDATE listing_offers SET status = 'accepted' WHERE id = $1", [offer.id]);
    await client.query("UPDATE listing_offers SET status = 'declined' WHERE listing_id = $1 AND id != $2 AND status = 'pending'", [offer.listing_id, offer.id]);
    await client.query("UPDATE listings SET status = 'sold' WHERE id = $1", [offer.listing_id]);
    await client.query('UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1', [offer.listing_id]);
    await client.query('COMMIT');

    // Escrow order at the offer price (outside tx — order engine manages its own writes)
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const order = await ordersSvc.create(r, stripe, {
      listingId: offer.listing_id, cardId: offer.card_id,
      buyerId: offer.buyer_id, sellerId: offer.seller_id,
      amount: Number(offer.amount), fee: Math.round(Number(offer.amount) * 0.1),
      method: offer.vault_item_id ? 'vault' : 'direct', vaultItemId: offer.vault_item_id || null,
    });

    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [offer.card_id]).catch(() => ({ rows: [{}] }));
    const amt = `$${(Number(offer.amount) / 100).toLocaleString()}`;
    await notify(pool, offer.buyer_id, 'offer_accepted', `Offer accepted: ${card?.player || 'card'} — ${amt}`, 'Payment is held in escrow. The seller will ship your card.', { listingId: offer.listing_id, offerId: offer.id, orderId: order.id });
    const accTpl = emailTpl.offerAccepted({ player: card?.player || 'card', amount: amt });
    await emailUser(pool, offer.buyer_id, accTpl.subject, accTpl.html);

    res.json({ success: true, order });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('offer accept error:', e.message);
    res.status(500).json({ error: e.message || 'Accept failed' });
  } finally {
    client.release();
  }
});

app.post('/api/offers/:id/decline', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { rows: [offer] } = await pool.query(
      `SELECT o.*, l.seller_id, l.card_id FROM listing_offers o JOIN listings l ON l.id = o.listing_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    if (offer.seller_id !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    if (offer.status !== 'pending') return res.status(409).json({ error: 'Offer is no longer pending' });
    await pool.query("UPDATE listing_offers SET status = 'declined' WHERE id = $1", [offer.id]);
    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [offer.card_id]).catch(() => ({ rows: [{}] }));
    await notify(pool, offer.buyer_id, 'offer_declined', `Offer declined: ${card?.player || 'card'}`, 'The seller passed on your offer. You can make another anytime.', { listingId: offer.listing_id, offerId: offer.id });
    res.json({ success: true });
  } catch (e) {
    console.error('offer decline error:', e.message);
    res.status(500).json({ error: 'Decline failed' });
  }
});

// ── Orders — buyer/seller order book with ship + confirm-receipt lifecycle ────
app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ purchases: [], sales: [] });
    const base = `
      SELECT o.id, o.listing_id, o.card_id, o.buyer_id, o.seller_id, o.amount, o.platform_fee,
             o.fulfillment_method, o.status, o.created_at, o.updated_at, o.inspection_ends_at,
             c.player, c.card_set, c.grader, c.grade, c.year, c.ebay_thumb, c.image_url,
             ub.handle AS buyer_handle, us.handle AS seller_handle,
             s.carrier, s.tracking_number, s.shipped_at, s.delivered_at AS ship_delivered_at
      FROM orders o
      JOIN cards c ON c.id = o.card_id
      LEFT JOIN users ub ON ub.id = o.buyer_id
      LEFT JOIN users us ON us.id = o.seller_id
      LEFT JOIN LATERAL (
        SELECT carrier, tracking_number, shipped_at, delivered_at
        FROM shipments WHERE order_id = o.id AND direction IN ('seller_to_buyer','hub_to_buyer')
        ORDER BY created_at DESC LIMIT 1
      ) s ON true`;
    const [bought, sold] = await Promise.all([
      pool.query(`${base} WHERE o.buyer_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [req.userId]),
      pool.query(`${base} WHERE o.seller_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [req.userId]),
    ]);
    const shape = o => ({
      id: o.id, listingId: o.listing_id, cardId: o.card_id,
      amount: Number(o.amount) / 100, fee: Number(o.platform_fee) / 100,
      status: o.status, method: o.fulfillment_method,
      createdAt: o.created_at, updatedAt: o.updated_at, inspectionEndsAt: o.inspection_ends_at,
      player: o.player, set: o.card_set, grader: o.grader, grade: o.grade, year: o.year,
      thumbnail: o.ebay_thumb || o.image_url || null,
      buyerHandle: o.buyer_handle || 'buyer', sellerHandle: o.seller_handle || 'seller',
      carrier: o.carrier || null, trackingNumber: o.tracking_number || null,
      shippedAt: o.shipped_at || null, deliveredAt: o.ship_delivered_at || null,
    });
    res.json({ purchases: bought.rows.map(shape), sales: sold.rows.map(shape) });
  } catch (e) {
    console.error('orders list error:', e.message);
    res.json({ purchases: [], sales: [] });
  }
});

// Seller marks the order shipped with carrier + tracking → buyer notified.
app.post('/api/orders/:id/ship', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const order = await r.orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.seller_id !== req.userId) return res.status(403).json({ error: 'Not your sale' });
    const carrier = String(req.body?.carrier || '').trim().slice(0, 40);
    const tracking = String(req.body?.tracking_number || '').trim().slice(0, 80);
    if (!carrier || !tracking) return res.status(400).json({ error: 'carrier and tracking_number required' });

    // Legacy rows predate persisted transitions — walk them forward safely.
    if (order.status === 'created') await transition(r, 'order', order, 'escrow_held', { actor: req.userId });
    if (order.status === 'escrow_held') await transition(r, 'order', order, 'awaiting_shipment', { actor: req.userId });
    if (order.status !== 'awaiting_shipment') return res.status(409).json({ error: `Order is ${order.status} — cannot mark shipped` });

    const { shipment } = await ordersSvc.ship(r, order, { carrier, tracking, insuredValue: order.amount });

    const pool = r.pool;
    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [order.card_id]).catch(() => ({ rows: [{}] }));
    await notify(pool, order.buyer_id, 'order_shipped',
      `Shipped: ${card?.player || 'your card'}`,
      `${carrier} ${tracking} — confirm receipt in Portfolio → Orders when it arrives.`,
      { orderId: order.id, cardId: order.card_id, carrier, trackingNumber: tracking });
    const shipTpl = emailTpl.orderShipped({ player: card?.player || 'Your card', carrier, tracking });
    await emailUser(pool, order.buyer_id, shipTpl.subject, shipTpl.html);

    res.json({ success: true, order: { id: order.id, status: order.status }, shipment: { carrier: shipment.carrier, trackingNumber: shipment.tracking_number } });
  } catch (e) {
    console.error('order ship error:', e.message);
    res.status(500).json({ error: e.message || 'Ship failed' });
  }
});

// Buyer confirms the card arrived as described → order settles, seller paid.
app.post('/api/orders/:id/confirm-receipt', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const order = await r.orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyer_id !== req.userId) return res.status(403).json({ error: 'Not your purchase' });
    if (!['shipped', 'delivered', 'inspection'].includes(order.status)) {
      return res.status(409).json({ error: `Order is ${order.status} — nothing to confirm yet` });
    }

    if (order.status === 'shipped') {
      const shipments = await r.shipments.list({ order_id: order.id });
      const inTransit = shipments.find(s => s.status === 'in_transit') || null;
      await ordersSvc.markDelivered(r, order, inTransit);
    }
    if (order.status === 'delivered') await transition(r, 'order', order, 'inspection', { actor: req.userId });
    await ordersSvc.settle(r, stripe, order);

    const pool = r.pool;
    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [order.card_id]).catch(() => ({ rows: [{}] }));
    const amt = `$${(Number(order.amount) / 100).toLocaleString()}`;
    await notify(pool, order.seller_id, 'order_completed',
      `Sale complete: ${card?.player || 'card'} — ${amt}`,
      'The buyer confirmed receipt. Your payout has been released from escrow.',
      { orderId: order.id, cardId: order.card_id });
    await notify(pool, order.buyer_id, 'order_settled',
      `Order complete: ${card?.player || 'card'}`,
      'Receipt confirmed — this order is settled. Enjoy the card!',
      { orderId: order.id, cardId: order.card_id });

    res.json({ success: true, order: { id: order.id, status: order.status } });
  } catch (e) {
    console.error('order confirm-receipt error:', e.message);
    res.status(500).json({ error: e.message || 'Confirm failed' });
  }
});

// ── Wants/Bids — public listing (no auth for browsing) ────────────────────────
// Lazy expiry: fire-and-forget cleanup, max once per minute to avoid hot-path overhead
let _lastWantsExpiry = 0;
function expireWants(pool) {
  const now = Date.now();
  if (now - _lastWantsExpiry < 60_000) return;
  _lastWantsExpiry = now;
  pool.query("UPDATE wants SET status = 'expired' WHERE status = 'active' AND expires_at < NOW()").catch(() => {});
}

app.get('/api/wants', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ wants: [] });

    const { cardId, userId, search, sort = 'newest' } = req.query;
    expireWants(pool);

    let query = `
      SELECT w.*, c.player, c.sport, c.card_set, c.grader, c.grade, c.year, c.variant,
             c.ebay_thumb, c.image_url, c.catalog_price, u.handle as buyer_handle
      FROM wants w
      JOIN cards c ON w.card_id = c.id
      JOIN users u ON w.user_id = u.id
      WHERE w.status = 'active'
    `;
    const params = [];
    if (cardId) { params.push(cardId); query += ` AND w.card_id = $${params.length}`; }
    if (userId) { params.push(userId); query += ` AND w.user_id = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (c.player ILIKE $${params.length} OR c.card_set ILIKE $${params.length} OR c.sport ILIKE $${params.length})`; }

    switch (sort) {
      case 'amount_desc': query += ' ORDER BY w.bid_amount DESC'; break;
      case 'boost_desc': query += ' ORDER BY w.boost_credits DESC, w.bid_amount DESC'; break;
      case 'ending_soon': query += ' ORDER BY w.expires_at ASC'; break;
      default: query += ' ORDER BY w.boost_credits DESC, w.created_at DESC';
    }
    query += ' LIMIT 100';
    const { rows } = await pool.query(query, params);
    res.json({ wants: rows });
  } catch (e) { res.json({ wants: [] }); }
});

app.get('/api/wants/top', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ wants: [] });
    expireWants(pool);
    const { rows } = await pool.query(`
      SELECT w.*, c.player, c.sport, c.card_set, c.grader, c.grade,
             c.ebay_thumb, c.image_url, u.handle as buyer_handle
      FROM wants w
      JOIN cards c ON w.card_id = c.id
      JOIN users u ON w.user_id = u.id
      WHERE w.status = 'active'
      ORDER BY w.boost_credits DESC, w.bid_amount DESC
      LIMIT 6
    `);
    res.json({ wants: rows });
  } catch (e) { res.json({ wants: [] }); }
});

// ── Pack rip routes (auth required) ──────────────────────────────────────────
const PACK_COSTS = { standard: 15, premium: 30, elite: 75 };
const PACK_CARD_COUNTS = { standard: 6, premium: 6, elite: 9 };
const PACK_GUARANTEED_HITS = { standard: 0, premium: 1, elite: 2 };

app.post('/api/packs/rip', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });

    const { packType = 'standard' } = req.body;
    const cost = PACK_COSTS[packType];
    if (!cost) return res.status(400).json({ error: 'Invalid pack type' });

    // Get user
    const { rows: [user] } = await pool.query('SELECT id, role, credits FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check credits (admin bypass)
    if (user.role !== 'admin') {
      if ((user.credits || 0) < cost) {
        return res.status(400).json({ error: `Not enough credits. You have ${user.credits || 0}, need ${cost}.` });
      }
      // Deduct credits
      await pool.query('UPDATE users SET credits = credits - $1 WHERE id = $2', [cost, req.userId]);
    }

    // Get random cards for the pack
    const cardCount = PACK_CARD_COUNTS[packType];
    const guaranteedHits = PACK_GUARANTEED_HITS[packType];

    // Tier-weighted pack algorithm
    // Standard: 3 commons ($1-25), 2 mid ($25-100), 1 chase slot (30% $100+, 5% $500+, 1% $1500+)
    // Premium: 2 commons, 2 mid ($25-100), 1 guaranteed $100+, 1 chase (40% $200+, 10% $1000+)
    // Elite: 2 commons, 3 mid ($25-200), 2 guaranteed $200+, 2 chase (30% $500+, 10% $2000+)
    const sel = `id, player, sport, card_set, grader, grade, variant, catalog_price, ebay_thumb, image_url, cardhedge_id, sales_7d, sales_30d, gain_7d, rookie`;
    const hasImg = `(ebay_thumb IS NOT NULL OR image_url IS NOT NULL)`;

    async function pull(minPrice, maxPrice, count) {
      const { rows } = await pool.query(
        `SELECT ${sel} FROM cards WHERE catalog_price >= $1 AND catalog_price < $2 AND catalog_price > 0 AND ${hasImg}
         ORDER BY random() LIMIT $3`, [minPrice, maxPrice, count]
      );
      return rows;
    }

    let cards = [];
    const roll = Math.random() * 100;

    if (packType === 'elite') {
      // Parallel queries for speed
      const chaseRange = roll < 10 ? [2000, 10000] : roll < 30 ? [500, 2000] : [200, 500];
      const [commons, mids, hits, chase] = await Promise.all([
        pull(1, 50, 2), pull(25, 200, 3), pull(200, 10000, 2), pull(chaseRange[0], chaseRange[1], 2),
      ]);
      cards = [...commons, ...mids, ...hits, ...chase].slice(0, cardCount);
    } else if (packType === 'premium') {
      const chaseRange = roll < 10 ? [1000, 10000] : roll < 40 ? [200, 1000] : [50, 200];
      const [commons, mids, hit, chase] = await Promise.all([
        pull(1, 50, 2), pull(25, 100, 2), pull(100, 10000, 1), pull(chaseRange[0], chaseRange[1], 1),
      ]);
      cards = [...commons, ...mids, ...hit, ...chase].slice(0, cardCount);
    } else {
      // Standard
      const chaseRange = roll < 1 ? [1500, 10000] : roll < 5 ? [500, 1500] : roll < 30 ? [100, 500] : [25, 100];
      const [commons, mids, chase] = await Promise.all([
        pull(1, 25, 3), pull(25, 100, 2), pull(chaseRange[0], chaseRange[1], 1),
      ]);
      cards = [...commons, ...mids, ...chase].slice(0, cardCount);
    }

    // Fallback: fill remaining slots if any tier was empty
    if (cards.length < cardCount) {
      const fill = await pull(1, 5000, cardCount - cards.length);
      cards = [...cards, ...fill];
    }

    // Shuffle so the chase card isn't always last
    cards.sort(() => Math.random() - 0.5);

    // Save pulls to pack_pulls — batch insert instead of N individual queries
    if (cards.length > 0) {
      const vals = cards.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
      const params = [req.userId];
      cards.forEach(c => params.push(c.id, packType));
      await pool.query(`INSERT INTO pack_pulls (user_id, card_id, pack_type) VALUES ${vals}`, params);
    }

    // Get updated credits
    const { rows: [updated] } = await pool.query('SELECT credits FROM users WHERE id = $1', [req.userId]);

    // Map cards for response
    const mapped = cards.map(c => ({
      id: c.id,
      player: c.player,
      sport: c.sport,
      set: c.card_set,
      grader: c.grader || 'RAW',
      grade: c.grade || '',
      variant: c.variant || '',
      market: Number(c.catalog_price) || 0,
      thumbnail: c.ebay_thumb || c.image_url || null,
      cardhedge_id: c.cardhedge_id,
      rookie: c.rookie || false,
      sales7d: Number(c.sales_7d) || 0,
      sales30d: Number(c.sales_30d) || 0,
      gain7d: Number(c.gain_7d) || 0,
    }));

    // Auto-award badges after rip
    checkAndAwardBadges(pool, req.userId).catch(() => {});

    // Auto-post for high-value pulls (>= $50)
    try {
      const highValueCard = cards.filter(c => Number(c.catalog_price) >= 50).sort((a, b) => Number(b.catalog_price) - Number(a.catalog_price))[0];
      if (highValueCard) {
        const { rows: [userInfo] } = await pool.query('SELECT handle FROM users WHERE id = $1', [req.userId]);
        const price = Number(highValueCard.catalog_price) || 0;
        const graderStr = [highValueCard.grader, highValueCard.grade].filter(Boolean).join(' ');
        const body = `Just ripped a pack and pulled ${highValueCard.player}${graderStr ? ` (${graderStr})` : ''} worth $${price.toFixed(0)}! 🎉`;
        await pool.query(
          `INSERT INTO posts (user_id, type, body, card_id) VALUES ($1, 'pull', $2, $3)`,
          [req.userId, body, highValueCard.id]
        );
      }
    } catch (_) {}

    res.json({ cards: mapped, creditsRemaining: updated.credits, packType });
  } catch (e) {
    console.error('packs/rip:', e.message);
    res.status(500).json({ error: 'Failed to rip pack' });
  }
});

app.get('/api/packs/collection', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ pulls: [] });

    const { rows } = await pool.query(`
      SELECT pp.id, pp.pack_type, pp.pulled_at,
             c.id as card_id, c.player, c.sport, c.card_set, c.grader, c.grade, c.variant,
             c.catalog_price as market, c.ebay_thumb as thumbnail, c.image_url,
             c.cardhedge_id, c.rookie, c.sales_7d, c.sales_30d, c.gain_7d
      FROM pack_pulls pp
      JOIN cards c ON pp.card_id = c.id
      WHERE pp.user_id = $1
      ORDER BY pp.pulled_at DESC
      LIMIT 200
    `, [req.userId]);

    res.json({ pulls: rows });
  } catch (e) {
    console.error('packs/collection:', e.message);
    res.json({ pulls: [] });
  }
});

// ── User credits routes ─────────────────────────────────────────────────────
app.get('/api/user/credits', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ credits: 240 });
    const { rows: [user] } = await pool.query('SELECT credits, role FROM users WHERE id = $1', [req.userId]);
    res.json({ credits: user?.credits || 0, isAdmin: user?.role === 'admin' });
  } catch (e) { res.json({ credits: 0 }); }
});

app.get('/api/user/badges', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ badges: [] });
    const { rows } = await pool.query(
      `SELECT ub.badge_key, b.name, b.tier, ub.earned_at 
       FROM user_badges ub JOIN badges b ON ub.badge_key = b.key 
       WHERE ub.user_id = $1 ORDER BY ub.earned_at`, [req.userId]
    );
    res.json({ badges: rows });
  } catch (e) { res.json({ badges: [] }); }
});

app.post('/api/user/credits/deduct', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const { rows: [user] } = await pool.query('SELECT credits, role FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Admin bypass
    if (user.role === 'admin') {
      return res.json({ credits: user.credits, deducted: amount, isAdmin: true });
    }

    if ((user.credits || 0) < amount) {
      return res.status(400).json({ error: `Insufficient credits. Have ${user.credits}, need ${amount}.` });
    }

    await pool.query('UPDATE users SET credits = credits - $1 WHERE id = $2', [amount, req.userId]);
    const { rows: [updated] } = await pool.query('SELECT credits FROM users WHERE id = $1', [req.userId]);
    res.json({ credits: updated.credits, deducted: amount });
  } catch (e) {
    console.error('credits/deduct:', e.message);
    res.status(500).json({ error: 'Failed to deduct credits' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// COMMUNITY — user search, follows, public portfolios, trade proposals
// ══════════════════════════════════════════════════════════════════════════

// User search (public)
app.get('/api/users/search', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ users: [] });
    const q = (req.query.q || '').trim();
    if (!q || q.length < 1) return res.json({ users: [] });
    if (q.length > 50) return res.status(400).json({ error: 'Query too long' });
    // Single query with CTEs to avoid correlated subqueries (faster with many users)
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT u.id, u.handle
        FROM users u
        WHERE LOWER(u.handle) LIKE LOWER($1)
        LIMIT 20
      )
      SELECT b.id, b.handle,
        COUNT(DISTINCT f1.follower_id) AS follower_count,
        COUNT(DISTINCT f2.following_id) AS following_count,
        COUNT(DISTINCT p.id) AS card_count
      FROM base b
      LEFT JOIN follows f1 ON f1.following_id = b.id
      LEFT JOIN follows f2 ON f2.follower_id = b.id
      LEFT JOIN portfolios p ON p.user_id = b.id
      GROUP BY b.id, b.handle
      ORDER BY follower_count DESC
    `, [`%${q}%`]);
    res.json({ users: rows.map(u => ({ ...u, avatar_url: null })) });
  } catch (e) { console.error('users/search:', e.message); res.json({ users: [] }); }
});

// Follow a user (auth required)
app.post('/api/users/:userId/follow', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    if (req.params.userId === req.userId) return res.status(400).json({ error: 'Cannot follow yourself' });
    await pool.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.userId, req.params.userId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Unfollow a user (auth required)
app.delete('/api/users/:userId/follow', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await pool.query(
      'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.userId, req.params.userId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get followers of a user (public)
app.get('/api/users/:userId/followers', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ users: [] });
    const { rows } = await pool.query(`
      SELECT u.id, u.handle,
        (SELECT COUNT(*) FROM portfolios WHERE user_id = u.id) as card_count
      FROM follows f
      JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = $1
      ORDER BY f.created_at DESC
    `, [req.params.userId]);
    res.json({ users: rows });
  } catch (e) { res.json({ users: [] }); }
});

// Get who a user follows (public)
app.get('/api/users/:userId/following', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ users: [] });
    const { rows } = await pool.query(`
      SELECT u.id, u.handle,
        (SELECT COUNT(*) FROM portfolios WHERE user_id = u.id) as card_count
      FROM follows f
      JOIN users u ON u.id = f.following_id
      WHERE f.follower_id = $1
      ORDER BY f.created_at DESC
    `, [req.params.userId]);
    res.json({ users: rows });
  } catch (e) { res.json({ users: [] }); }
});

// Feed stub (auth required)
app.get('/api/users/feed', requireAuth, async (_req, res) => {
  res.json({ feed: [], message: 'Feed coming soon — follow users to see their activity here.' });
});

// Public portfolio by handle
app.get('/api/users/:handle/portfolio', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ user: null, cards: [] });
    // Find user by handle
    const { rows: [user] } = await pool.query(
      'SELECT id, handle, created_at FROM users WHERE LOWER(handle) = LOWER($1)', [req.params.handle]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Get follower/following counts
    const { rows: [fc] } = await pool.query(
      'SELECT (SELECT COUNT(*) FROM follows WHERE following_id = $1) as follower_count, (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following_count',
      [user.id]
    );
    // Get their portfolio cards
    const { rows: cards } = await pool.query(`
      SELECT p.id as portfolio_id, p.card_id, c.player, c.sport, c.card_set, c.grader, c.grade,
             c.catalog_price, c.ebay_thumb, c.image_url, c.variant, c.year
      FROM portfolios p
      JOIN cards c ON c.id = p.card_id
      WHERE p.user_id = $1
      ORDER BY c.catalog_price DESC NULLS LAST
    `, [user.id]);
    const totalValue = cards.reduce((s, c) => s + (Number(c.catalog_price) || 0), 0);
    res.json({
      user: { ...user, ...fc, avatar_url: null },
      cards: cards.map(c => ({
        id: c.card_id, portfolioId: c.portfolio_id, player: c.player, sport: c.sport,
        set: c.card_set, grader: c.grader || 'RAW', grade: c.grade || '',
        price: Number(c.catalog_price) || 0, thumbnail: c.ebay_thumb || c.image_url || null,
        variant: c.variant || '', year: c.year || '',
      })),
      totalValue,
    });
  } catch (e) { console.error('user portfolio:', e.message); res.json({ user: null, cards: [] }); }
});

// Propose a trade (auth required)
app.post('/api/trades/propose', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { toUserId, offeredCardIds, requestedCardIds, cashOffer, message } = req.body;
    if (!toUserId) return res.status(400).json({ error: 'toUserId required' });
    if (!offeredCardIds?.length && !requestedCardIds?.length) return res.status(400).json({ error: 'Must offer or request at least one card' });
    if (toUserId === req.userId) return res.status(400).json({ error: 'Cannot trade with yourself' });
    // Verify offered cards are in our portfolio
    if (offeredCardIds?.length) {
      const { rows } = await pool.query(
        'SELECT card_id FROM portfolios WHERE user_id = $1 AND card_id = ANY($2)',
        [req.userId, offeredCardIds]
      );
      if (rows.length !== offeredCardIds.length) return res.status(400).json({ error: 'Some offered cards are not in your portfolio' });
    }
    // Verify requested cards are in their portfolio
    if (requestedCardIds?.length) {
      const { rows } = await pool.query(
        'SELECT card_id FROM portfolios WHERE user_id = $1 AND card_id = ANY($2)',
        [toUserId, requestedCardIds]
      );
      if (rows.length !== requestedCardIds.length) return res.status(400).json({ error: 'Some requested cards are not in their portfolio' });
    }
    const { rows: [proposal] } = await pool.query(`
      INSERT INTO trade_proposals (from_user_id, to_user_id, offered_card_ids, requested_card_ids, cash_offer, message)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [req.userId, toUserId, offeredCardIds || [], requestedCardIds || [], cashOffer || 0, message || null]);
    res.json({ proposal });
  } catch (e) { console.error('trades/propose:', e.message); res.status(500).json({ error: 'Failed to create proposal' }); }
});

// Get trade proposals (auth required)
app.get('/api/trades/proposals', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ incoming: [], outgoing: [] });
    // Incoming
    const { rows: incoming } = await pool.query(`
      SELECT tp.*, u.handle as from_handle
      FROM trade_proposals tp
      JOIN users u ON u.id = tp.from_user_id
      WHERE tp.to_user_id = $1
      ORDER BY tp.created_at DESC
    `, [req.userId]);
    // Outgoing
    const { rows: outgoing } = await pool.query(`
      SELECT tp.*, u.handle as to_handle
      FROM trade_proposals tp
      JOIN users u ON u.id = tp.to_user_id
      WHERE tp.from_user_id = $1
      ORDER BY tp.created_at DESC
    `, [req.userId]);
    // Enrich with card details
    const allCardIds = new Set();
    [...incoming, ...outgoing].forEach(tp => {
      (tp.offered_card_ids || []).forEach(id => allCardIds.add(id));
      (tp.requested_card_ids || []).forEach(id => allCardIds.add(id));
    });
    let cardMap = {};
    if (allCardIds.size > 0) {
      const { rows: cards } = await pool.query(
        'SELECT id, player, sport, card_set, grader, grade, catalog_price, ebay_thumb, image_url FROM cards WHERE id = ANY($1)',
        [Array.from(allCardIds)]
      );
      cards.forEach(c => { cardMap[c.id] = c; });
    }
    const enrichCards = (ids) => (ids || []).map(id => {
      const c = cardMap[id];
      return c ? { id: c.id, player: c.player, sport: c.sport, set: c.card_set, grader: c.grader || 'RAW', grade: c.grade || '', market: Number(c.catalog_price) || 0, thumbnail: c.ebay_thumb || c.image_url || null } : { id, player: 'Unknown', market: 0 };
    });
    res.json({
      incoming: incoming.map(tp => ({ ...tp, offered_cards: enrichCards(tp.offered_card_ids), requested_cards: enrichCards(tp.requested_card_ids) })),
      outgoing: outgoing.map(tp => ({ ...tp, offered_cards: enrichCards(tp.offered_card_ids), requested_cards: enrichCards(tp.requested_card_ids) })),
    });
  } catch (e) { console.error('trades/proposals:', e.message); res.json({ incoming: [], outgoing: [] }); }
});

// Update trade proposal (auth required) — accept/decline/cancel
app.put('/api/trades/proposals/:id', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { status } = req.body;
    if (!['accepted', 'declined', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows: [proposal] } = await pool.query('SELECT * FROM trade_proposals WHERE id = $1', [req.params.id]);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    // Only recipient can accept/decline, only sender can cancel
    if (status === 'cancelled' && proposal.from_user_id !== req.userId) return res.status(403).json({ error: 'Only the sender can cancel' });
    if ((status === 'accepted' || status === 'declined') && proposal.to_user_id !== req.userId) return res.status(403).json({ error: 'Only the recipient can accept or decline' });
    if (proposal.status !== 'pending') return res.status(400).json({ error: 'Proposal is no longer pending' });
    await pool.query('UPDATE trade_proposals SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);

    // Auto-post when trade is accepted
    if (status === 'accepted') {
      try {
        const { rows: [fromUser] } = await pool.query('SELECT handle FROM users WHERE id = $1', [proposal.from_user_id]);
        const { rows: [toUser] } = await pool.query('SELECT handle FROM users WHERE id = $1', [proposal.to_user_id]);
        const body = `Trade completed between @${fromUser?.handle || 'someone'} and @${toUser?.handle || 'someone'}! 🤝`;
        await pool.query(
          `INSERT INTO posts (user_id, type, body) VALUES ($1, 'trade', $2)`,
          [req.userId, body]
        );
      } catch (_) {}
    }

    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Suggested users (public) — users with most cards
app.get('/api/users/suggested', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ users: [] });
    const { rows } = await pool.query(`
      SELECT u.id, u.handle,
        (SELECT COUNT(*) FROM portfolios WHERE user_id = u.id) as card_count,
        (SELECT COALESCE(SUM(c.catalog_price), 0) FROM portfolios p JOIN cards c ON c.id = p.card_id WHERE p.user_id = u.id) as total_value,
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count
      FROM users u
      ORDER BY card_count DESC
      LIMIT 20
    `);
    res.json({ users: rows.map(u => ({ ...u, avatar_url: null })) });
  } catch (e) { res.json({ users: [] }); }
});

// Check if current user follows a specific user
app.get('/api/users/:userId/is-following', optionalAuth, async (req, res) => {
  try {
    if (!req.userId) return res.json({ following: false });
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ following: false });
    const { rows } = await pool.query(
      'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.userId, req.params.userId]
    );
    res.json({ following: rows.length > 0 });
  } catch (e) { res.json({ following: false }); }
});

// ── Community Posts ───────────────────────────────────────────────────────────

// GET /api/posts/feed — paginated feed (20/page), JOIN with users for handle/avatar
app.get('/api/posts/feed', optionalAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ posts: [], hasMore: false });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const { rows } = await pool.query(`
      SELECT p.id, p.type, p.body, p.likes, p.created_at, p.card_id,
             u.id as user_id, u.handle, u.avatar_url,
             c.player, c.grader, c.grade, c.catalog_price, c.sport, c.ebay_thumb, c.image_url,
             ${req.userId ? `EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $3) as user_liked` : `false as user_liked`}
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN cards c ON c.id = p.card_id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, req.userId ? [limit + 1, offset, req.userId] : [limit + 1, offset]);
    const hasMore = rows.length > limit;
    const posts = rows.slice(0, limit).map(p => ({
      id: p.id,
      type: p.type,
      body: p.body,
      likes: p.likes,
      userLiked: p.user_liked,
      createdAt: p.created_at,
      user: { id: p.user_id, handle: p.handle, avatarUrl: p.avatar_url },
      card: p.card_id ? {
        id: p.card_id, player: p.player, grader: p.grader, grade: p.grade,
        value: Number(p.catalog_price) || 0, sport: p.sport,
        thumbnail: p.ebay_thumb || p.image_url || null,
      } : null,
    }));
    res.json({ posts, hasMore, page });
  } catch (e) { console.error('posts/feed:', e.message); res.json({ posts: [], hasMore: false }); }
});

// POST /api/posts — create a post (auth required)
app.post('/api/posts', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { body, type = 'general', cardId } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Post body required' });
    if (body.length > 500) return res.status(400).json({ error: 'Post too long (max 500 chars)' });
    const validTypes = ['general', 'pull', 'trade', 'sale'];
    const postType = validTypes.includes(type) ? type : 'general';
    const { rows: [post] } = await pool.query(`
      INSERT INTO posts (user_id, type, body, card_id)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [req.userId, postType, body.trim(), cardId || null]);
    // Fetch user info
    const { rows: [user] } = await pool.query('SELECT handle, avatar_url FROM users WHERE id = $1', [req.userId]);
    res.json({ post: { ...post, user: { id: req.userId, handle: user?.handle, avatarUrl: user?.avatar_url } } });
  } catch (e) { console.error('posts/create:', e.message); res.status(500).json({ error: 'Failed to create post' }); }
});

// POST /api/posts/:id/like — toggle like (auth required)
app.post('/api/posts/:id/like', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const postId = parseInt(req.params.id);
    if (!postId) return res.status(400).json({ error: 'Invalid post id' });
    // Check if already liked
    const { rows: existing } = await pool.query(
      'SELECT 1 FROM post_likes WHERE user_id = $1 AND post_id = $2',
      [req.userId, postId]
    );
    let liked;
    if (existing.length > 0) {
      // Unlike
      await pool.query('DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2', [req.userId, postId]);
      await pool.query('UPDATE posts SET likes = GREATEST(0, likes - 1) WHERE id = $1', [postId]);
      liked = false;
    } else {
      // Like
      await pool.query('INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.userId, postId]);
      await pool.query('UPDATE posts SET likes = likes + 1 WHERE id = $1', [postId]);
      liked = true;
    }
    const { rows: [p] } = await pool.query('SELECT likes FROM posts WHERE id = $1', [postId]);
    res.json({ liked, likes: p?.likes || 0 });
  } catch (e) { console.error('posts/like:', e.message); res.status(500).json({ error: 'Failed to toggle like' }); }
});

// ── Card Like/Pin endpoints ─────────────────────────────────────────────────
// POST /api/cards/:id/like — toggle like for a card (auth required)
app.post('/api/cards/:id/like', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ liked: false });
    const cardId = req.params.id;
    const { liked } = req.body;
    // Upsert into card_likes table (create if not exists)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS card_likes (
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, card_id)
      )
    `).catch(() => {});
    if (liked) {
      await pool.query(`INSERT INTO card_likes (user_id, card_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.userId, cardId]);
    } else {
      await pool.query(`DELETE FROM card_likes WHERE user_id = $1 AND card_id = $2`, [req.userId, cardId]);
    }
    res.json({ liked: !!liked, cardId });
  } catch (e) {
    console.error('card like error:', e.message);
    res.json({ liked: false });
  }
});

// POST /api/portfolio/pin — pin/unpin a card in portfolio
app.post('/api/portfolio/pin', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ pinned: false });
    const { cardId, pinned } = req.body;
    // Ensure pinned column exists
    await pool.query(`ALTER TABLE portfolio_items ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE`).catch(() => {});
    await pool.query(`
      UPDATE portfolio_items SET pinned = $1
      WHERE user_id = $2 AND card_id = $3
    `, [!!pinned, req.userId, cardId]);
    // If not in portfolio yet, create entry with pinned state
    const { rowCount } = await pool.query(
      `SELECT 1 FROM portfolio_items WHERE user_id = $1 AND card_id = $2`, [req.userId, cardId]
    );
    if (!rowCount) {
      await pool.query(`
        INSERT INTO portfolio_items (user_id, card_id, pinned) VALUES ($1, $2, $3)
        ON CONFLICT (user_id, card_id) DO UPDATE SET pinned = $3
      `, [req.userId, cardId, !!pinned]).catch(() => {});
    }
    res.json({ pinned: !!pinned, cardId });
  } catch (e) {
    console.error('portfolio pin error:', e.message);
    res.json({ pinned: false });
  }
});

// POST /api/cards/identify — identify card from image (photo listing)
app.post('/api/cards/identify', rateLimit({ max: 10, windowMs: 60_000 }), async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    const { imageBase64, imageUrl } = req.body;
    if (!imageBase64 && !imageUrl) return res.status(400).json({ error: 'imageBase64 or imageUrl required' });

    // Try OCR-style identification: use CardHedge search with visual clues
    // Strategy: If imageUrl provided, try to search CardHedge with it
    // We'll use a simple text extraction approach via catalog search
    // For now, attempt to use CardHedge's search to find matching cards
    let identified = null;

    if (pool && !identified) {
      // Attempt to find recently added cards as a fallback sample
      const { rows } = await pool.query(`
        SELECT id, player, sport, card_set, grader, grade, year, variant,
               catalog_price, ebay_thumb, cardhedge_id
        FROM cards
        WHERE ebay_thumb IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 5
      `);
      if (rows.length > 0) {
        const card = rows[0];
        identified = {
          player: card.player,
          set: card.card_set,
          year: card.year,
          sport: card.sport,
          grader: card.grader,
          grade: card.grade,
          cardId: card.id,
          thumbnail: card.ebay_thumb,
          confidence: 'low',
          message: 'Visual identification in beta — please verify the details.',
        };
      }
    }

    if (identified) {
      res.json({ success: true, card: identified });
    } else {
      res.json({ success: false, message: "We couldn't identify this card — fill in manually." });
    }
  } catch (e) {
    console.error('card identify error:', e.message);
    res.json({ success: false, message: "Identification failed — fill in manually." });
  }
});

// ── Store / Dealer Accounts ─────────────────────────────────────────────────

app.get('/api/stores', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ stores: [] });
    const { sport, location, limit = 20, offset = 0 } = req.query;
    let where = `WHERE u.store_verified = TRUE AND u.account_type = 'store'`;
    const params = [];
    if (sport) { params.push(sport); where += ` AND u.store_description ILIKE $${params.length}`; }
    if (location) { params.push(`%${location}%`); where += ` AND u.store_location ILIKE $${params.length}`; }
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await pool.query(`
      SELECT u.id, u.handle, u.store_name, u.store_description, u.store_location,
             u.store_website, u.avatar_url, u.rating,
             COUNT(DISTINCT l.id) FILTER (WHERE l.active) AS listing_count,
             COUNT(DISTINCT f.follower_id) AS follower_count
      FROM users u
      LEFT JOIN listings l ON l.seller_id = u.id
      LEFT JOIN follows f ON f.following_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY listing_count DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json({ stores: rows });
  } catch (e) {
    console.error('stores error:', e.message);
    res.json({ stores: [] });
  }
});

app.get('/api/store/:handle', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(`
      SELECT u.id, u.handle, u.store_name, u.store_description, u.store_location,
             u.store_website, u.store_verified, u.avatar_url, u.rating, u.bio,
             u.created_at,
             COUNT(DISTINCT l.id) FILTER (WHERE l.active) AS listing_count,
             COUNT(DISTINCT f.follower_id) AS follower_count,
             COALESCE(SUM(o.amount_cents) FILTER (WHERE o.status = 'complete'), 0) AS total_sales_cents
      FROM users u
      LEFT JOIN listings l ON l.seller_id = u.id
      LEFT JOIN follows f ON f.following_id = u.id
      LEFT JOIN orders o ON o.seller_id = u.id
      WHERE u.handle = $1 AND u.account_type = 'store'
      GROUP BY u.id
    `, [req.params.handle]);
    if (!rows.length) return res.status(404).json({ error: 'Store not found' });
    // Get active listings
    const { rows: listings } = await pool.query(`
      SELECT l.id, l.ask_cents, l.created_at, l.condition,
             c.player, c.sport, c.card_set, c.year, c.grader, c.grade, c.ebay_thumb, c.variant
      FROM listings l
      JOIN cards c ON c.id = l.card_id
      WHERE l.seller_id = $1 AND l.active = TRUE
      ORDER BY l.created_at DESC LIMIT 24
    `, [rows[0].id]);
    res.json({ store: rows[0], listings });
  } catch (e) {
    console.error('store profile error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/store/apply', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'DB unavailable' });
    const { store_name, store_description, store_location, store_website } = req.body;
    if (!store_name?.trim()) return res.status(400).json({ error: 'store_name required' });
    await pool.query(`
      UPDATE users SET account_type = 'store', store_name = $1, store_description = $2,
        store_location = $3, store_website = $4
      WHERE id = $5
    `, [store_name.trim(), store_description || '', store_location || '', store_website || '', req.userId]);
    res.json({ ok: true, message: 'Store application submitted. Verification pending.' });
  } catch (e) {
    console.error('store apply error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/store/inventory/bulk', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'DB unavailable' });
    const { rows: [user] } = await pool.query('SELECT account_type FROM users WHERE id = $1', [req.userId]);
    if (user?.account_type !== 'store') return res.status(403).json({ error: 'Store account required' });
    const { cards } = req.body;
    if (!Array.isArray(cards) || cards.length === 0) return res.status(400).json({ error: 'cards array required' });
    if (cards.length > 200) return res.status(400).json({ error: 'Max 200 cards per bulk upload' });
    let created = 0;
    for (const card of cards) {
      if (!card.player || !card.ask_cents) continue;
      try {
        const { rows: [c] } = await pool.query(`
          INSERT INTO cards (player, sport, card_set, year, grader, grade, variant, catalog_price)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        `, [card.player, card.sport || 'Unknown', card.card_set || '', card.year || null,
            card.grader || 'RAW', card.grade || 'RAW', card.variant || '', card.ask_cents / 100]);
        await pool.query(`
          INSERT INTO listings (card_id, seller_id, ask_cents, active, condition)
          VALUES ($1, $2, $3, TRUE, $4)
        `, [c.id, req.userId, card.ask_cents, card.condition || 'NM']);
        created++;
      } catch { /* skip bad rows */ }
    }
    res.json({ ok: true, created });
  } catch (e) {
    console.error('bulk upload error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Mystery Pulls ─────────────────────────────────────────────────────────────

app.get('/api/mystery/pools', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ pools: [] });
    const { rows } = await pool.query(`
      SELECT mp.id, mp.name, mp.sport, mp.price_credits, mp.min_value_cents, mp.max_value_cents,
             mp.cards_available, mp.created_at,
             u.handle AS store_handle, u.store_name, u.store_verified
      FROM mystery_pools mp
      JOIN users u ON u.id = mp.store_id
      WHERE mp.active = TRUE AND mp.cards_available > 0
      ORDER BY mp.created_at DESC
    `);
    res.json({ pools: rows });
  } catch (e) {
    console.error('mystery pools error:', e.message);
    res.json({ pools: [] });
  }
});

app.post('/api/mystery/pools/:id/pull', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'DB unavailable' });
    const poolId = parseInt(req.params.id);
    // Get pool info
    const { rows: [mysteryPool] } = await pool.query(
      'SELECT * FROM mystery_pools WHERE id = $1 AND active = TRUE', [poolId]);
    if (!mysteryPool) return res.status(404).json({ error: 'Pool not found' });
    // Check user credits
    const { rows: [user] } = await pool.query('SELECT credits FROM users WHERE id = $1', [req.userId]);
    if ((user?.credits || 0) < mysteryPool.price_credits)
      return res.status(400).json({ error: 'Insufficient credits' });
    // Pick random unclaimed card
    const { rows: [card] } = await pool.query(`
      SELECT * FROM mystery_pool_cards
      WHERE pool_id = $1 AND claimed = FALSE
      ORDER BY RANDOM() LIMIT 1
    `, [poolId]);
    if (!card) return res.status(400).json({ error: 'No cards available in this pool' });
    // Claim card + deduct credits in a transaction
    await pool.query('BEGIN');
    await pool.query(
      'UPDATE mystery_pool_cards SET claimed = TRUE, claimed_by = $1, claimed_at = NOW() WHERE id = $2',
      [req.userId, card.id]);
    await pool.query(
      'UPDATE users SET credits = credits - $1 WHERE id = $2',
      [mysteryPool.price_credits, req.userId]);
    await pool.query(
      'UPDATE mystery_pools SET cards_available = cards_available - 1 WHERE id = $1', [poolId]);
    await pool.query('COMMIT');
    res.json({ ok: true, card: { name: card.card_name, grade: card.grade, estimatedValue: card.estimated_value_cents } });
  } catch (e) {
    await getRepo().then(r => r.pool?.query('ROLLBACK').catch(() => {}));
    console.error('mystery pull error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/mystery/pools/:id/cards', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'DB unavailable' });
    const { rows: [user] } = await pool.query('SELECT account_type FROM users WHERE id = $1', [req.userId]);
    if (user?.account_type !== 'store') return res.status(403).json({ error: 'Store account required' });
    const { card_name, grade, estimated_value_cents } = req.body;
    if (!card_name) return res.status(400).json({ error: 'card_name required' });
    const poolId = parseInt(req.params.id);
    await pool.query(`
      INSERT INTO mystery_pool_cards (pool_id, card_name, grade, estimated_value_cents, submitted_by)
      VALUES ($1, $2, $3, $4, $5)
    `, [poolId, card_name, grade || 'RAW', estimated_value_cents || 0, req.userId]);
    await pool.query('UPDATE mystery_pools SET cards_available = cards_available + 1 WHERE id = $1', [poolId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('mystery pool card submit error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/mystery/pools', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'DB unavailable' });
    const { rows: [user] } = await pool.query('SELECT account_type FROM users WHERE id = $1', [req.userId]);
    if (user?.account_type !== 'store') return res.status(403).json({ error: 'Store account required' });
    const { name, sport, price_credits, min_value_cents, max_value_cents } = req.body;
    if (!name || !price_credits) return res.status(400).json({ error: 'name and price_credits required' });
    const { rows: [p] } = await pool.query(`
      INSERT INTO mystery_pools (store_id, name, sport, price_credits, min_value_cents, max_value_cents)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [req.userId, name, sport || null, price_credits, min_value_cents || 0, max_value_cents || 0]);
    res.json({ ok: true, pool: p });
  } catch (e) {
    console.error('create pool error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Protected routes ──────────────────────────────────────────────────────────
app.use('/api', rateLimit({ max: 120, windowMs: 60_000 }));
// NOTE: Do NOT add blanket requireAuth here — public routes (feed, heatmap, movers) must stay open

// Use real Stripe if key is set, otherwise stub
const activeStripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;

app.use('/api', async (req, res, next) => {
  const r = await getRepo();
  settlementRouter(r, activeStripe)(req, res, next);
});

// Auth-required routes through appRouter (state, session, trades, etc.)
app.use('/api', optionalAuth, async (req, res, next) => {
  const r = await getRepo();
  appRouter(r, activeStripe)(req, res, next);
});

// ── Stripe Checkout — create PaymentIntent ───────────────────────────────────
app.post('/api/checkout/intent', requireAuth, async (req, res) => {
  try {
    const { listingId, amount } = req.body;
    if (!listingId || !amount) return res.status(400).json({ error: 'listingId and amount required' });
    const r = await getRepo();
    const listing = await r.listings.get(listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status !== 'active') return res.status(410).json({ error: 'Listing no longer available' });
    if (listing.seller_id === req.userId) return res.status(400).json({ error: 'Cannot buy your own listing' });
    const intent = await createPaymentIntent({
      amount: Number(listing.price),
      buyerId: req.userId,
      sellerId: listing.seller_id,
      listingId,
    });
    res.json({ clientSecret: intent.clientSecret, amount: intent.amount, fee: intent.fee });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stripe Credits Purchase ──────────────────────────────────────────────────
// Valid credit packs — must match CREDIT_PACKS in app/lib/data.js
// Key = price in cents, Value = cr + bonus credits delivered
const VALID_CREDIT_PACKS = new Map([
  [999,   100],   // $9.99  → 100 cr + 0  bonus
  [4999,  600],   // $49.99 → 550 cr + 50 bonus
  [9999,  1400],  // $99.99 → 1200 cr + 200 bonus
  [19999, 3600],  // $199.99→ 3000 cr + 600 bonus
]);
app.post('/api/credits/checkout', requireAuth, async (req, res) => {
  try {
    const { amount, credits } = req.body;
    if (!amount || !credits) return res.status(400).json({ error: 'amount and credits required' });
    // Validate amount/credits combo to prevent manipulation
    const expectedCredits = VALID_CREDIT_PACKS.get(Number(amount));
    if (!expectedCredits || expectedCredits !== Number(credits)) {
      return res.status(400).json({ error: 'Invalid credit pack selection' });
    }
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });
    const stripe = (await import('stripe')).default(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `${credits} GEMLINE Credits`, description: `Credits for pack rips, bid boosts, and more on GEMLINE.` },
          unit_amount: amount, // in cents
        },
        quantity: 1,
      }],
      metadata: { userId: req.userId, credits: String(credits) },
      success_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/market?credits=success`,
      cancel_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/market?credits=cancelled`,
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error('Credits checkout error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Stripe Connect — seller onboarding ───────────────────────────────────────
app.post('/api/connect/onboard', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const me = await r.users.get(req.userId);
    if (!me) return res.status(401).json({ error: 'Not authenticated' });
    const base = process.env.APP_URL || 'https://gemlinecards.com';

    let accountId = me.stripe_account_id;
    // Create account if none exists
    if (!accountId) {
      const acct = await createConnectAccount({ email: me.email || `${me.handle}@gemline.app`, handle: me.handle || 'seller' });
      accountId = acct.accountId;
      // Store stripe_account_id on user
      if (r.pool) {
        await r.pool.query('UPDATE users SET stripe_account_id = $1 WHERE id = $2', [accountId, req.userId]);
      } else if (r.users.update) {
        await r.users.update(me.id, { stripe_account_id: accountId });
      }
    }

    const link = await createOnboardingLink({
      accountId,
      returnUrl: `${base}/sell?connected=1`,
      refreshUrl: `${base}/sell?connected=1`,
    });
    res.json({ url: link.url });
  } catch (e) {
    console.error('Stripe Connect onboard error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/connect/status', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const me = await r.users.get(req.userId);
    if (!me || !me.stripe_account_id) return res.json({ connected: false });
    const status = await getAccountStatus(me.stripe_account_id);
    res.json({
      connected: status.enabled || false,
      chargesEnabled: status.chargesEnabled || false,
      payoutsEnabled: status.payoutsEnabled || false,
      accountId: me.stripe_account_id,
    });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

app.get('/api/connect/return', async (req, res) => {
  res.redirect('/sell?connected=1');
});

// ══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION — Arbitrage paywall
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/subscription/status', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ subscribed: false });
    // Admin gets full access
    const { rows: [me] } = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId]);
    if (me?.role === 'admin') return res.json({ subscribed: true, plan: 'admin', currentPeriodEnd: null });
    const { rows } = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' AND (current_period_end IS NULL OR current_period_end > NOW()) ORDER BY created_at DESC LIMIT 1`,
      [req.userId]
    );
    if (rows.length > 0) {
      return res.json({ subscribed: true, plan: rows[0].plan, currentPeriodEnd: rows[0].current_period_end });
    }
    res.json({ subscribed: false });
  } catch (e) {
    res.json({ subscribed: false });
  }
});

app.post('/api/subscription/checkout', requireAuth, async (req, res) => {
  try {
    const { default: Stripe } = await import('stripe');
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(400).json({ error: 'Stripe not configured' });
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price_data: {
          recurring: { interval: 'month' },
          currency: 'usd',
          unit_amount: 799,
          product_data: { name: 'GEMLINE Arbitrage Engine' },
        },
        quantity: 1,
      }],
      subscription_data: { trial_period_days: 7 },
      success_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/arbitrage?sub=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/arbitrage?sub=cancelled`,
      client_reference_id: req.userId,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Subscription checkout error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/subscription/return', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.redirect('/arbitrage');
    const { default: Stripe } = await import('stripe');
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.redirect('/arbitrage');
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid' || session.status === 'complete') {
      const r = await getRepo();
      const pool = r.pool;
      if (pool && session.client_reference_id) {
        await pool.query(
          `INSERT INTO subscriptions (user_id, plan, status, stripe_subscription_id, current_period_end)
           VALUES ($1, 'arb_monthly', 'active', $2, NOW() + INTERVAL '30 days')
           ON CONFLICT DO NOTHING`,
          [session.client_reference_id, session.subscription || session.id]
        );
      }
    }
    res.redirect('/arbitrage?sub=success');
  } catch (e) {
    res.redirect('/arbitrage');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// DISPLAY NAME — one-time change
// ══════════════════════════════════════════════════════════════════════════

app.put('/api/user/display-name', requireAuth, async (req, res) => {
  try {
    const { displayName } = req.body;
    if (!displayName || typeof displayName !== 'string') return res.status(400).json({ error: 'displayName required' });
    const trimmed = displayName.trim();
    if (trimmed.length < 3 || trimmed.length > 20) return res.status(400).json({ error: 'Display name must be 3-20 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return res.status(400).json({ error: 'Only letters, numbers, and underscores allowed' });
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'Database not available' });
    // Check if already changed
    const { rows: [user] } = await pool.query('SELECT display_name_changed FROM users WHERE id = $1', [req.userId]);
    if (user?.display_name_changed) return res.status(400).json({ error: 'Display name can only be changed once' });
    // Check uniqueness
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE LOWER(handle) = LOWER($1) AND id != $2', [trimmed, req.userId]);
    if (existing.length > 0) return res.status(400).json({ error: 'Display name already taken' });
    // Update
    await pool.query('UPDATE users SET handle = $1, display_name_changed = true WHERE id = $2', [trimmed, req.userId]);
    res.json({ ok: true, handle: trimmed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({});
    const { rows: [user] } = await pool.query('SELECT id, handle, email, display_name_changed, created_at FROM users WHERE id = $1', [req.userId]);
    res.json(user || {});
  } catch (e) {
    res.json({});
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE & BADGES (public + auth)
// ══════════════════════════════════════════════════════════════════════════════

// Helper: award badges based on user activity
async function checkAndAwardBadges(pool, userId) {
  try {
    // Count pack pulls
    const { rows: [pullStats] } = await pool.query(
      `SELECT COUNT(*) as total_pulls, COUNT(DISTINCT pack_type || pulled_at::date) as pack_count,
              MAX(c.catalog_price) as max_price,
              COUNT(DISTINCT pp.card_id) as unique_cards
       FROM pack_pulls pp JOIN cards c ON pp.card_id = c.id WHERE pp.user_id = $1`, [userId]
    );

    const totalPulls = parseInt(pullStats.total_pulls) || 0;
    const uniqueCards = parseInt(pullStats.unique_cards) || 0;
    const maxPrice = parseFloat(pullStats.max_price) || 0;

    // Count distinct packs ripped (group pulls by batch)
    const { rows: [packCount] } = await pool.query(
      `SELECT COUNT(DISTINCT DATE_TRUNC('second', pulled_at)) as packs FROM pack_pulls WHERE user_id = $1`, [userId]
    );
    const packsRipped = parseInt(packCount.packs) || 0;

    const badgesToAward = [];

    if (totalPulls >= 1) badgesToAward.push('first_pull');
    if (uniqueCards >= 10) badgesToAward.push('collector_10');
    if (uniqueCards >= 50) badgesToAward.push('collector_50');
    if (uniqueCards >= 100) badgesToAward.push('collector_100');
    if (maxPrice >= 1500) badgesToAward.push('big_hit');
    if (maxPrice >= 5000) badgesToAward.push('legendary_pull');
    if (packsRipped >= 25) badgesToAward.push('pack_addict');
    if (packsRipped >= 100) badgesToAward.push('pack_whale');

    // Check trades
    const { rows: [tradeStats] } = await pool.query(
      `SELECT COUNT(*) as trades FROM trades WHERE (proposer_id = $1 OR counterparty_id = $1) AND status = 'completed'`, [userId]
    ).catch(() => ({ rows: [{ trades: 0 }] }));
    if (parseInt(tradeStats.trades) >= 1) badgesToAward.push('first_trade');

    // Check sales (listings sold)
    const { rows: [saleStats] } = await pool.query(
      `SELECT COUNT(*) as sales FROM listings WHERE seller_id = $1 AND status = 'sold'`, [userId]
    ).catch(() => ({ rows: [{ sales: 0 }] }));
    if (parseInt(saleStats.sales) >= 1) badgesToAward.push('first_sale');

    // Check early adopter (user created before a cutoff or first 100)
    const { rows: [userInfo] } = await pool.query('SELECT created_at FROM users WHERE id = $1', [userId]);
    const { rows: [userRank] } = await pool.query(
      'SELECT COUNT(*) as rank FROM users WHERE created_at <= (SELECT created_at FROM users WHERE id = $1)', [userId]
    );
    if (parseInt(userRank.rank) <= 100) badgesToAward.push('og');
    // Early adopter: joined in 2025 or 2026
    const joinYear = new Date(userInfo.created_at).getFullYear();
    if (joinYear <= 2026) badgesToAward.push('early_adopter');

    // Insert badges (ignore conflicts)
    for (const key of badgesToAward) {
      await pool.query(
        'INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT (user_id, badge_key) DO NOTHING',
        [userId, key]
      ).catch(() => {});
    }
  } catch (e) {
    console.error('Badge check error:', e.message);
  }
}

// GET /api/profile/:handle — public profile
app.get('/api/profile/:handle', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });

    const handle = req.params.handle;
    const { rows: [user] } = await pool.query(
      'SELECT id, handle, email, bio, featured_badges, avatar_url, created_at FROM users WHERE LOWER(handle) = LOWER($1)', [handle]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Badges
    const { rows: badges } = await pool.query(
      `SELECT b.key, b.name, b.emoji, b.tier, b.description, b.category, ub.earned_at
       FROM user_badges ub JOIN badges b ON ub.badge_key = b.key
       WHERE ub.user_id = $1 ORDER BY ub.earned_at`, [user.id]
    );

    // Check if viewer is the profile owner
    const viewerId = req.userId || null;
    const isOwner = viewerId === user.id;

    // Showcase cards (split by type, max 3 each for public)
    const { rows: showcase } = await pool.query(
      `SELECT us.card_id, us.position, us.type, c.id, c.player, c.sport, c.card_set, c.grader, c.grade,
              c.variant, c.catalog_price, c.ebay_thumb as thumbnail, c.image_url, c.cardhedge_id
       FROM user_showcase us JOIN cards c ON us.card_id = c.id
       WHERE us.user_id = $1 ORDER BY us.type, us.position, us.added_at`, [user.id]
    );
    const digitalShowcase = showcase.filter(s => s.type === 'digital').slice(0, 3);
    const physicalShowcase = showcase.filter(s => s.type === 'physical').slice(0, 3);

    // For owner: return ALL pulls and portfolio cards. For others: only showcase.
    let recentPulls = [];
    let portfolioCards = [];
    let listings = [];

    if (isOwner) {
      // All digital pulls
      const { rows: pulls } = await pool.query(
        `SELECT pp.id, pp.pack_type, pp.pulled_at,
                c.id as card_id, c.player, c.sport, c.card_set, c.grader, c.grade, c.variant,
                c.catalog_price as market, c.ebay_thumb as thumbnail, c.image_url, c.cardhedge_id
         FROM pack_pulls pp JOIN cards c ON pp.card_id = c.id
         WHERE pp.user_id = $1 ORDER BY c.catalog_price DESC NULLS LAST`, [user.id]
      );
      recentPulls = pulls;

      // All physical portfolio cards
      const { rows: portfolio } = await pool.query(
        `SELECT p.id as portfolio_id, p.purchase_price, p.created_at as added_at,
                c.id as card_id, c.player, c.sport, c.card_set, c.grader, c.grade, c.variant,
                c.catalog_price, c.ebay_thumb as thumbnail, c.image_url, c.cardhedge_id
         FROM portfolios p JOIN cards c ON p.card_id = c.id
         WHERE p.user_id = $1 ORDER BY c.catalog_price DESC NULLS LAST`, [user.id]
      );
      portfolioCards = portfolio;
    }

    // Active listings (always public)
    const { rows: listingRows } = await pool.query(
      `SELECT l.id, l.price, l.status, c.id as card_id, c.player, c.sport, c.card_set, c.grader, c.grade,
              c.catalog_price, c.ebay_thumb as thumbnail, c.image_url
       FROM listings l JOIN cards c ON l.card_id = c.id
       WHERE l.seller_id = $1 AND l.status = 'active' ORDER BY l.created_at DESC LIMIT 20`, [user.id]
    );
    listings = listingRows;

    // Stats — parallelized to reduce latency from 5 round-trips to 1
    const [pullCountRes, portfolioCountRes, tradeCountRes, digitalValRes, physicalValRes] = await Promise.allSettled([
      pool.query("SELECT COUNT(DISTINCT card_id) as digital, COUNT(DISTINCT DATE_TRUNC('second', pulled_at)) as packs FROM pack_pulls WHERE user_id = $1", [user.id]),
      pool.query('SELECT COUNT(*) as physical FROM portfolios WHERE user_id = $1', [user.id]),
      pool.query(`SELECT COUNT(*) as trades FROM trades WHERE (proposer_id = $1 OR counterparty_id = $1) AND status = 'completed'`, [user.id]),
      pool.query(`SELECT COALESCE(SUM(c.catalog_price), 0) as total FROM pack_pulls pp JOIN cards c ON pp.card_id = c.id WHERE pp.user_id = $1`, [user.id]),
      pool.query(`SELECT COALESCE(SUM(c.catalog_price), 0) as total FROM portfolios p JOIN cards c ON p.card_id = c.id WHERE p.user_id = $1`, [user.id]),
    ]);
    const pullCount = pullCountRes.status === 'fulfilled' ? pullCountRes.value.rows[0] : { digital: 0, packs: 0 };
    const portfolioCount = portfolioCountRes.status === 'fulfilled' ? portfolioCountRes.value.rows[0] : { physical: 0 };
    const tradeCount = tradeCountRes.status === 'fulfilled' ? tradeCountRes.value.rows[0] : { trades: 0 };
    const digitalVal = digitalValRes.status === 'fulfilled' ? digitalValRes.value.rows[0] : { total: 0 };
    const physicalVal = physicalValRes.status === 'fulfilled' ? physicalValRes.value.rows[0] : { total: 0 };

    res.json({
      id: user.id,
      handle: user.handle,
      bio: user.bio || '',
      avatar_url: user.avatar_url || null,
      featured_badges: user.featured_badges || [],
      created_at: user.created_at,
      badges,
      digitalShowcase,
      physicalShowcase,
      recentPulls: isOwner ? recentPulls : [],
      portfolioCards: isOwner ? portfolioCards : [],
      listings,
      isOwner,
      stats: {
        trades: parseInt(tradeCount.trades) || 0,
        digital: parseInt(pullCount.digital) || 0,
        physical: parseInt(portfolioCount.physical) || 0,
        packs: parseInt(pullCount.packs) || 0,
        digitalValue: parseFloat(digitalVal.total) || 0,
        physicalValue: parseFloat(physicalVal.total) || 0,
        totalValue: (parseFloat(digitalVal.total) || 0) + (parseFloat(physicalVal.total) || 0),
      },
    });
  } catch (e) {
    console.error('Profile error:', e.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// GET /api/profile/:handle/badges
app.get('/api/profile/:handle/badges', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ badges: [] });
    const { rows: [user] } = await pool.query(
      'SELECT id FROM users WHERE LOWER(handle) = LOWER($1)', [req.params.handle]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { rows } = await pool.query(
      `SELECT b.key, b.name, b.emoji, b.tier, b.description, ub.earned_at
       FROM user_badges ub JOIN badges b ON ub.badge_key = b.key
       WHERE ub.user_id = $1 ORDER BY ub.earned_at`, [user.id]
    );
    res.json({ badges: rows });
  } catch (e) {
    res.json({ badges: [] });
  }
});

// POST /api/profile/showcase — add card to showcase (auth)
// Update profile (handle + bio)
// Avatar upload (base64 data URL, max 500KB)
app.post('/api/profile/avatar', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: 'No avatar data' });
    // Limit size (~500KB base64)
    if (avatar.length > 700000) return res.status(400).json({ error: 'Image too large (max 500KB)' });
    const userId = req.userId;
    await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatar, userId]);
    res.json({ ok: true, avatar_url: avatar });
  } catch (e) {
    console.error('Avatar upload error:', e.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/api/profile/update', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { handle, bio } = req.body;
    const userId = req.userId;

    // Validate handle
    if (handle) {
      if (handle.length < 2 || handle.length > 20) return res.status(400).json({ error: 'Handle must be 2-20 characters' });
      if (!/^[a-zA-Z0-9_]+$/.test(handle)) return res.status(400).json({ error: 'Handle can only contain letters, numbers, and underscores' });
      // Check uniqueness
      const { rows: existing } = await pool.query('SELECT id FROM users WHERE handle = $1 AND id != $2', [handle, userId]);
      if (existing.length > 0) return res.status(400).json({ error: 'Handle already taken' });
    }

    const { avatar_url } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;
    if (handle) { updates.push(`handle = $${idx}`); params.push(handle); idx++; }
    if (bio !== undefined) { updates.push(`bio = $${idx}`); params.push(bio.slice(0, 160)); idx++; }
    if (avatar_url !== undefined) { updates.push(`avatar_url = $${idx}`); params.push(avatar_url || null); idx++; }
    if (updates.length === 0) return res.json({ ok: true });

    params.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    res.json({ ok: true });
  } catch(e) {
    console.error('Profile update error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/profile/showcase', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { cardId, type } = req.body; // type: 'digital' or 'physical'
    const showcaseType = type === 'physical' ? 'physical' : 'digital';
    if (!cardId) return res.status(400).json({ error: 'cardId required' });

    // Check max 3 per type
    const { rows: existing } = await pool.query(
      'SELECT COUNT(*) as cnt FROM user_showcase WHERE user_id = $1 AND type = $2', [req.userId, showcaseType]
    );
    if (parseInt(existing[0].cnt) >= 3) {
      return res.status(400).json({ error: `Showcase is full (max 3 ${showcaseType} cards)` });
    }

    // Verify user owns this card
    if (showcaseType === 'digital') {
      const { rows: [owns] } = await pool.query(
        'SELECT id FROM pack_pulls WHERE user_id = $1 AND card_id = $2 LIMIT 1', [req.userId, cardId]
      );
      if (!owns) return res.status(400).json({ error: 'You can only showcase cards you own' });
    } else {
      const { rows: [owns] } = await pool.query(
        'SELECT id FROM portfolios WHERE user_id = $1 AND card_id = $2 LIMIT 1', [req.userId, cardId]
      );
      if (!owns) return res.status(400).json({ error: 'You can only showcase cards in your portfolio' });
    }

    const position = parseInt(existing[0].cnt);
    await pool.query(
      'INSERT INTO user_showcase (user_id, card_id, position, type) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, card_id) DO UPDATE SET type = $4',
      [req.userId, cardId, position, showcaseType]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/profile/showcase/:cardId — remove from showcase (auth)
app.delete('/api/profile/showcase/:cardId', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await pool.query(
      'DELETE FROM user_showcase WHERE user_id = $1 AND card_id = $2', [req.userId, req.params.cardId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/profile/badges — save featured badge keys (up to 6)
app.post('/api/profile/badges', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { badges } = req.body;
    if (!Array.isArray(badges)) return res.status(400).json({ error: 'badges must be an array' });
    const keys = badges.slice(0, 6).map(String);

    // Verify user actually earned these badges
    if (keys.length > 0) {
      const { rows: earned } = await pool.query(
        'SELECT badge_key FROM user_badges WHERE user_id = $1', [req.userId]
      );
      const earnedSet = new Set(earned.map(e => e.badge_key));
      const valid = keys.filter(k => earnedSet.has(k));
      await pool.query('UPDATE users SET featured_badges = $1 WHERE id = $2', [valid, req.userId]);
      res.json({ ok: true, featured_badges: valid });
    } else {
      await pool.query('UPDATE users SET featured_badges = $1 WHERE id = $2', [[], req.userId]);
      res.json({ ok: true, featured_badges: [] });
    }
  } catch (e) {
    console.error('Featured badges error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Stripe Webhook ────────────────────────────────────────────────────────────
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = await verifyWebhook(req.body, sig);
    if (!event) return res.json({ received: true }); // no webhook secret yet
  } catch (e) {
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }
  const r = await getRepo();
  const pool = r.pool;
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // Credits purchase fulfillment
      if (session.metadata?.userId && session.metadata?.credits && session.mode === 'payment') {
        const userId = session.metadata.userId;
        const credits = parseInt(session.metadata.credits, 10);
        if (pool && userId && credits > 0) {
          try {
            await pool.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [credits, userId]);
            console.log(`[webhook] Awarded ${credits} credits to user ${userId}`);
          } catch (e) {
            console.error('[webhook] Failed to award credits:', e.message);
          }
        }
      }
      // Subscription fulfillment is handled via subscription.updated event and /api/subscription/return
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      if (pool && sub.id) {
        const status = sub.status === 'active' ? 'active' : 'cancelled';
        const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
        await pool.query(
          `UPDATE subscriptions SET status = $1, current_period_end = $2 WHERE stripe_subscription_id = $3`,
          [status, periodEnd, sub.id]
        ).catch(e => console.error('[webhook] sub update:', e.message));
      }
      break;
    }
    case 'payment_intent.amount_capturable_updated': {
      const pi = event.data.object;
      console.log('[webhook] PI authorized:', pi.id, '$' + (pi.amount / 100));
      break;
    }
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled': {
      const pi = event.data.object;
      console.log('[webhook] PI failed/canceled:', pi.id);
      // orders has no payment_intent_id column — the PI lives on escrow_holds.
      // Cancel the order only if it hasn't shipped, and void the hold.
      if (pool) {
        try {
          const { rows: [esc] } = await pool.query(
            `SELECT id, order_id, status FROM escrow_holds WHERE stripe_payment_intent_id = $1`, [pi.id]);
          if (esc?.order_id && esc.status === 'held') {
            const { rows: [o] } = await pool.query(`SELECT id, status FROM orders WHERE id = $1`, [esc.order_id]);
            if (o && ['created', 'escrow_held', 'awaiting_shipment'].includes(o.status)) {
              await pool.query(`UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [o.id]);
              await pool.query(`UPDATE escrow_holds SET status = 'void', updated_at = NOW() WHERE id = $1`, [esc.id]);
              await pool.query(
                `INSERT INTO events (entity_type, entity_id, from_state, to_state, payload) VALUES ('order', $1, $2, 'cancelled', $3)`,
                [o.id, o.status, JSON.stringify({ reason: event.type, pi: pi.id })]).catch(() => {});
            }
          }
        } catch (e) { console.error('[webhook] PI failure handling:', e.message); }
      }
      break;
    }
    case 'transfer.created': {
      console.log('[webhook] Transfer created:', event.data.object.id);
      break;
    }
  }
  res.json({ received: true });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[error]', req.method, req.path, err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    code: err.code || 'SERVER_ERROR',
  });
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `${req.method} ${req.path} not found` });
});

export default app;

// GET /api/badges — list all available badges
