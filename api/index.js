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
    const CH = process.env.CARDHEDGE_API_KEY || 'inNtDlct1UCWnsJutpdTnJkKdt22xuJ222RTsLHs';
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
    const CH = process.env.CARDHEDGE_API_KEY || 'inNtDlct1UCWnsJutpdTnJkKdt22xuJ222RTsLHs';
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const grade = req.query.grade || 'PSA 10';

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

    res.json({ ...fmv, comps: comps ? { price: comps.comp_price, lo: comps.low, hi: comps.high, count: comps.count_used } : null });
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
    const r = await fetch(url, { headers: { 'X-API-Key': process.env.CARDHEDGE_API_KEY || 'inNtDlct1UCWnsJutpdTnJkKdt22xuJ222RTsLHs' } });
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
    
    // Top 50 gainers + top 50 losers for a balanced heatmap
    const gainersQ = `SELECT ${cols} FROM cards WHERE gain_7d > 0 AND catalog_price > 0${sportClause}
      ORDER BY gain_7d DESC, COALESCE(sales_7d,0) DESC LIMIT 50`;
    const losersQ = `SELECT ${cols} FROM cards WHERE gain_7d < 0 AND catalog_price > 0${sportClause}
      ORDER BY gain_7d ASC, COALESCE(sales_7d,0) DESC LIMIT 50`;
    
    const [{ rows: gainers }, { rows: losers }] = await Promise.all([
      pool.query(gainersQ, params),
      pool.query(losersQ, params),
    ]);
    const rows = [...gainers, ...losers];
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
    const isTrending = !['price_asc','price_desc','player','gain','sales','newest'].includes(sort);
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
    const mvWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Sort against mv columns (no aggregates needed)
    let orderBy;
    switch (sort) {
      case 'price_asc': orderBy = 'catalog_price ASC NULLS LAST'; break;
      case 'price_desc': orderBy = 'catalog_price DESC NULLS LAST'; break;
      case 'player': orderBy = 'player ASC'; break;
      case 'gain': orderBy = 'gain_7d DESC NULLS LAST'; break;
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
      const { rows: sc } = await pool.query('SELECT sport, COUNT(*) as cnt FROM mv_card_feed GROUP BY sport ORDER BY cnt DESC');
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

app.post('/api/catalog/search', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    const q = (req.body?.q || req.query.q || '').trim();
    if (!pool || !q) return res.json({ results: [], canCreate: true });
    // Trigram similarity search — uses GIN index, fast on 500K rows
    const { rows } = await pool.query(
      `SELECT id, player, grader, grade, card_set, variant, sport, catalog_price, ebay_thumb, image_url,
              similarity(player, $1) AS sim
       FROM cards
       WHERE player % $1 OR card_set ILIKE $2 OR variant ILIKE $2
       ORDER BY sim DESC, catalog_price DESC NULLS LAST
       LIMIT 20`,
      [q, `%${q}%`]
    );
    res.json({ results: rows, canCreate: true, total: rows.length });
  } catch(e) { res.json({ results: [], canCreate: true }); }
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

    // Undervalued: high volume + negative gain = buy-the-dip candidates (min 3 sales/wk)
    const { rows: undervalued } = await pool.query(`
      SELECT id, player, sport, card_set, grader, grade, year, variant,
             catalog_price, ch_price_lo, ch_price_hi, gain_7d, sales_7d, sales_30d,
             ebay_thumb, cardhedge_id, rookie
      FROM cards
      WHERE catalog_price > 5 AND catalog_price <= 5000
        AND sales_7d >= 3
        AND COALESCE(gain_7d, 0) < 0
      ORDER BY (COALESCE(sales_7d,0) * ABS(COALESCE(gain_7d,0))) DESC
      LIMIT 50
    `);

    // 7-day gainers (min 3 sales to validate the move)
    const { rows: gainers } = await pool.query(`
      SELECT id, player, sport, card_set, grader, grade, year, variant,
             catalog_price, ch_price_lo, ch_price_hi, gain_7d, sales_7d, sales_30d,
             ebay_thumb, cardhedge_id, rookie
      FROM cards WHERE gain_7d > 5 AND sales_7d >= 3 AND catalog_price > 5 AND catalog_price <= 5000
      ORDER BY gain_7d DESC LIMIT 25
    `);

    // 7-day losers (min 3 sales to validate the drop)
    const { rows: losers } = await pool.query(`
      SELECT id, player, sport, card_set, grader, grade, year, variant,
             catalog_price, ch_price_lo, ch_price_hi, gain_7d, sales_7d, sales_30d,
             ebay_thumb, cardhedge_id, rookie
      FROM cards WHERE gain_7d < -5 AND sales_7d >= 3 AND catalog_price > 5 AND catalog_price <= 5000
      ORDER BY gain_7d ASC LIMIT 25
    `);

    // Most traded (real volume, not one-offs)
    const { rows: mostTraded } = await pool.query(`
      SELECT id, player, sport, card_set, grader, grade, year, variant,
             catalog_price, ch_price_lo, ch_price_hi, gain_7d, sales_7d, sales_30d,
             ebay_thumb, cardhedge_id, rookie
      FROM cards WHERE sales_7d >= 5 AND catalog_price > 5 AND catalog_price <= 5000
      ORDER BY sales_7d DESC, sales_30d DESC LIMIT 25
    `);

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

// ── Wants/Bids — public listing (no auth for browsing) ────────────────────────
app.get('/api/wants', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ wants: [] });

    const { cardId, userId, search, sort = 'newest' } = req.query;
    await pool.query("UPDATE wants SET status = 'expired' WHERE status = 'active' AND expires_at < NOW()");

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
    await pool.query("UPDATE wants SET status = 'expired' WHERE status = 'active' AND expires_at < NOW()");
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
      const commons = await pull(1, 50, 2);
      const mids = await pull(25, 200, 3);
      const hits = await pull(200, 10000, 2);
      const chase = roll < 10 ? await pull(2000, 10000, 2)
                  : roll < 30 ? await pull(500, 2000, 2)
                  : await pull(200, 500, 2);
      cards = [...commons, ...mids, ...hits, ...chase].slice(0, cardCount);
    } else if (packType === 'premium') {
      const commons = await pull(1, 50, 2);
      const mids = await pull(25, 100, 2);
      const hit = await pull(100, 10000, 1);
      const chase = roll < 10 ? await pull(1000, 10000, 1)
                  : roll < 40 ? await pull(200, 1000, 1)
                  : await pull(50, 200, 1);
      cards = [...commons, ...mids, ...hit, ...chase].slice(0, cardCount);
    } else {
      // Standard
      const commons = await pull(1, 25, 3);
      const mids = await pull(25, 100, 2);
      const chase = roll < 1 ? await pull(1500, 10000, 1)
                  : roll < 5 ? await pull(500, 1500, 1)
                  : roll < 30 ? await pull(100, 500, 1)
                  : await pull(25, 100, 1);
      cards = [...commons, ...mids, ...chase].slice(0, cardCount);
    }

    // Fallback: fill remaining slots if any tier was empty
    if (cards.length < cardCount) {
      const fill = await pull(1, 5000, cardCount - cards.length);
      cards = [...cards, ...fill];
    }

    // Shuffle so the chase card isn't always last
    cards.sort(() => Math.random() - 0.5);

    // Save pulls to pack_pulls
    for (const card of cards) {
      await pool.query(
        'INSERT INTO pack_pulls (user_id, card_id, pack_type) VALUES ($1, $2, $3)',
        [req.userId, card.id, packType]
      );
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
    const { rows } = await pool.query(`
      SELECT u.id, u.handle, 
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count,
        (SELECT COUNT(*) FROM portfolios WHERE user_id = u.id) as card_count
      FROM users u
      WHERE u.handle ILIKE $1 OR u.email ILIKE $2
      LIMIT 20
    `, [`%${q}%`, `${q}%`]);
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
app.post('/api/credits/checkout', requireAuth, async (req, res) => {
  try {
    const { amount, credits } = req.body;
    if (!amount || !credits) return res.status(400).json({ error: 'amount and credits required' });
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
      success_url: 'https://gemlinecards.com/market?credits=success',
      cancel_url: 'https://gemlinecards.com/market?credits=cancelled',
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
      success_url: 'https://gemlinecards.com/arbitrage?sub=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://gemlinecards.com/arbitrage?sub=cancelled',
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

    // Stats
    const { rows: [pullCount] } = await pool.query(
      'SELECT COUNT(DISTINCT card_id) as digital, COUNT(DISTINCT DATE_TRUNC(\'second\', pulled_at)) as packs FROM pack_pulls WHERE user_id = $1', [user.id]
    );
    const { rows: [portfolioCount] } = await pool.query(
      'SELECT COUNT(*) as physical FROM portfolios WHERE user_id = $1', [user.id]
    ).catch(() => ({ rows: [{ physical: 0 }] }));
    const { rows: [tradeCount] } = await pool.query(
      `SELECT COUNT(*) as trades FROM trades WHERE (proposer_id = $1 OR counterparty_id = $1) AND status = 'completed'`, [user.id]
    ).catch(() => ({ rows: [{ trades: 0 }] }));
    const { rows: [digitalVal] } = await pool.query(
      `SELECT COALESCE(SUM(c.catalog_price), 0) as total FROM pack_pulls pp JOIN cards c ON pp.card_id = c.id WHERE pp.user_id = $1`, [user.id]
    );
    const { rows: [physicalVal] } = await pool.query(
      `SELECT COALESCE(SUM(c.catalog_price), 0) as total FROM portfolios p JOIN cards c ON p.card_id = c.id WHERE p.user_id = $1`, [user.id]
    );

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
    const userId = req.user.id;

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
  switch (event.type) {
    case 'payment_intent.amount_capturable_updated': {
      // PI authorized — escrow is locked in
      const pi = event.data.object;
      console.log('[webhook] PI authorized:', pi.id, '$' + (pi.amount/100));
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      console.log('[webhook] PI failed:', pi.id);
      // TODO: update order status to failed
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
