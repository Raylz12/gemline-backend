// Vercel serverless entry — GEMLINE marketplace backend.
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { makeRepo, stripeStub, toCents, fromCents } from '../src/store/repo.js';
import { settlementRouter } from '../src/routes/settlement.js';
import { appRouter } from '../src/routes/app.js';
import { authRouter, requireAuth, optionalAuth } from '../src/routes/auth.js';
import { rateLimit, pgRateLimit, getIp } from '../src/middleware/rateLimit.js';
import { resolveCardId, CARDHEDGE_ID_RE } from '../src/domain/cardResolve.js';
import * as ordersSvc from '../orders.js';
import * as escrowSvc from '../escrow.js';
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
  // Minimal Permissions-Policy: camera stays enabled for the card scanner (self).
  // CSP deliberately skipped for now — Stripe Elements + Next hydration need a
  // carefully tested policy; a broken CSP kills payments. Revisit as report-only.
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), interest-cohort=()');
  next();
});

app.use(cors({
  origin: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Camera scans post a full-resolution photo — needs a bigger body limit (registered
// BEFORE the global 128kb parser; express.json skips already-parsed bodies).
app.use('/api/cards/analyze', express.json({ limit: '6mb' }));
app.use('/api/portfolio/:id/verify-scan', express.json({ limit: '6mb' }));
// Stripe webhook needs the RAW body for signature verification. This MUST run
// before the global express.json() below, otherwise the body is parsed to an
// object and constructEvent() fails ("payload must be a string or Buffer") —
// which silently broke every webhook (orders, subscriptions). raw() sets
// req._body=true so the json parser below skips it.
app.use('/api/webhook/stripe', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));   // prevent large payload attacks
app.use(express.static(join(__dirname, '..', 'public')));

// ── Global per-IP soft cap (in-memory layer; cacheable public GETs exempt) ───
// Cacheable GETs are absorbed by the Vercel CDN (s-maxage below) so they skip
// the app-level cap; everything else gets 120 req/min per IP.
const CACHEABLE_GET = /^\/api\/(market\/(feed|heatmap|arb)|sitemap\/|auctions\/live|stats\/live|prices|cards\/[^/]+(\/history)?$|cards\/[^/]+\/history|listings\/for-card|badges|profile\/|users\/[^/]+\/portfolio|posts\/feed|stores)/;
const globalIpCap = rateLimit({ max: 120, windowMs: 60_000, message: 'Too many requests — slow down' });
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (req.method === 'GET' && CACHEABLE_GET.test(req.path)) return next();
  return globalIpCap(req, res, next);
});

// ── Lazy-init repo (shared across warm invocations) ───────────────────────────
let repo;
async function getRepo() {
  if (!repo) repo = await makeRepo();
  return repo;
}
const getPool = async () => (await getRepo()).pool;

// ── Tiered seller fees ────────────────────────────────────────────────────────────
// Intro pricing: a seller's first 5 settled sales are charged 5%; from sale #6
// on it's 7.5% (the old flat 10% is retired). The rate is decided ONCE, when
// the order is created, and locked onto the row (orders.fee_bps + the absolute
// platform_fee in cents). Settlement always uses the stored amount — never a
// recompute — so a seller crossing the threshold mid-flight keeps the rate each
// order was created under. Refunds are untouched: the buyer gets the full PI
// back and no fee is ever taken on a refunded order.
const INTRO_FEE_BPS = 500;      // 5.00% — a seller's first 5 sales
const STANDARD_FEE_BPS = 750;   // 7.50% — sale #6 onward
const INTRO_SALES = 5;
const feeFromBps = (amountCents, bps) => Math.round(amountCents * bps / 10000);
let _feeBpsColReady = false;
async function ensureFeeBpsColumn(pool) {
  if (_feeBpsColReady || !pool) return;
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS fee_bps INTEGER').catch(() => {});
  _feeBpsColReady = true;
}
// Prior sales = orders that actually reached 'settled' (the only terminal
// success state). Cancelled/refunded orders never count toward the tier.
async function sellerFeeBps(pool, sellerId) {
  if (!pool || !sellerId) return STANDARD_FEE_BPS;
  try {
    await ensureFeeBpsColumn(pool);
    const { rows: [x] } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM orders WHERE seller_id = $1 AND status = 'settled'", [sellerId]);
    return Number(x.n) < INTRO_SALES ? INTRO_FEE_BPS : STANDARD_FEE_BPS;
  } catch (e) { console.error('sellerFeeBps:', e.message); return STANDARD_FEE_BPS; }
}

// ── Shop subscription ────────────────────────────────────────────────────────
// Shop/dealer accounts pay $9.99/mo to list. Status is webhook-driven and
// stored in the subscriptions table (plan='shop_monthly'). past_due gets a
// 7-day grace before listing is gated; active always passes.
const SHOP_PRICE_LOOKUP = 'gemline_shop_monthly';
const SHOP_PRICE_ID = process.env.SHOP_PRICE_ID || 'price_1TrXC2ELKWcqIWsc4DfgibcY';
const SHOP_GRACE_DAYS = 7;
let _subColsReady = false;
async function ensureSubColumns(pool) {
  if (_subColsReady || !pool) return;
  await pool.query('ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT').catch(() => {});
  _subColsReady = true;
}
// Returns { active, status, currentPeriodEnd, inGrace } for a user's shop sub.
async function shopSubStatus(pool, userId) {
  const out = { active: false, status: 'none', currentPeriodEnd: null, inGrace: false };
  if (!pool || !userId) return out;
  try {
    await ensureSubColumns(pool);
    const { rows: [me] } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (me?.role === 'admin') return { active: true, status: 'admin', currentPeriodEnd: null, inGrace: false };
    const { rows } = await pool.query(
      `SELECT status, current_period_end FROM subscriptions
       WHERE user_id = $1 AND plan = 'shop_monthly'
       ORDER BY created_at DESC LIMIT 1`, [userId]);
    if (!rows.length) return out;
    const s = rows[0];
    out.status = s.status;
    out.currentPeriodEnd = s.current_period_end;
    if (s.status === 'active' || s.status === 'trialing') { out.active = true; return out; }
    if (s.status === 'past_due') {
      // Grace: allow for SHOP_GRACE_DAYS past the period end.
      const graceUntil = s.current_period_end ? new Date(new Date(s.current_period_end).getTime() + SHOP_GRACE_DAYS * 86400_000) : null;
      if (graceUntil && graceUntil > new Date()) { out.active = true; out.inGrace = true; return out; }
    }
    return out;
  } catch (e) { console.error('shopSubStatus:', e.message); return out; }
}
// Returns an error string if a shop account may NOT create a new listing, else null.
async function shopListingGate(pool, userId) {
  if (!pool || !userId) return null;
  try {
    const { rows: [u] } = await pool.query('SELECT account_type FROM users WHERE id = $1', [userId]);
    if (u?.account_type !== 'store') return null; // individuals unaffected
    const st = await shopSubStatus(pool, userId);
    if (st.active) return null;
    return 'Your shop needs an active Gemline Shop subscription ($9.99/mo) to list new cards. Your existing listings stay live.';
  } catch (e) { console.error('shopListingGate:', e.message); return null; }
}

// ── DB-backed rate limiters (hold across serverless instances) ───────────────
const byUser = (req) => `u:${req.userId}`;
const limitBids = pgRateLimit(getPool, { limits: [{ bucket: 'bids', max: 10, windowSec: 60 }], keyFn: byUser, message: 'Too many bids — slow down for a minute' });
const limitMoney = pgRateLimit(getPool, { limits: [{ bucket: 'money', max: 6, windowSec: 60 }], keyFn: byUser, message: 'Too many purchase attempts — slow down for a minute' });
const limitWrites = pgRateLimit(getPool, { limits: [{ bucket: 'writes', max: 10, windowSec: 60 }], keyFn: byUser, message: 'Posting too fast — slow down for a minute' });
// AI vision costs real money per call: 5/hour + 20/day per user.
const limitAI = pgRateLimit(getPool, { limits: [
  { bucket: 'ai_hr', max: 5, windowSec: 3600 },
  { bucket: 'ai_day', max: 20, windowSec: 86400 },
], keyFn: byUser, message: 'Scan limit reached — try again later' });

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
// Set pages sitemap — one file (~6.4K URLs, under the 50K limit). Must be
// declared BEFORE /api/sitemap/:c so 'sets' isn't eaten by the hex-chunk route.
app.get('/api/sitemap/sets', async (_req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).send('No database');
    const { rows } = await pool.query(`SELECT slug FROM card_sets WHERE card_count > 0 ORDER BY slug`);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `<url><loc>https://gemlinecards.com/sets</loc></url>\n` +
      rows.map(x => `<url><loc>https://gemlinecards.com/sets/${x.slug}</loc></url>`).join('\n') +
      `\n</urlset>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=43200');
    res.send(xml);
  } catch (e) {
    console.error('sitemap sets error:', e.message);
    res.status(500).send('sitemap error');
  }
});

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
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
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

// ── Seller fee tier (for sell-flow previews; the real rate locks at order
// creation — see sellerFeeBps) ────────────────────────────────────────────
app.get('/api/me/fee-rate', requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) return res.json({ feeBps: INTRO_FEE_BPS, feePct: INTRO_FEE_BPS / 100, settledSales: 0, introRemaining: INTRO_SALES });
    const { rows: [x] } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM orders WHERE seller_id = $1 AND status = 'settled'", [req.userId]);
    const n = Number(x?.n) || 0;
    const bps = n < INTRO_SALES ? INTRO_FEE_BPS : STANDARD_FEE_BPS;
    res.json({ feeBps: bps, feePct: bps / 100, settledSales: n, introRemaining: Math.max(0, INTRO_SALES - n) });
  } catch (e) {
    console.error('me/fee-rate:', e.message);
    res.json({ feeBps: STANDARD_FEE_BPS, feePct: STANDARD_FEE_BPS / 100, settledSales: null, introRemaining: 0 });
  }
});


// ── Admin: refresh mv_card_feed + trigger price refresh ──────────────────────
// Cron/admin auth: Vercel crons send GET with `Authorization: Bearer $CRON_SECRET`
// (when the CRON_SECRET env var is set). Manual/admin calls use x-admin-key.
function cronOrAdminAuthed(req) {
  if (req.headers['x-admin-key'] === (process.env.ADMIN_KEY || 'gemline-admin-2026')) return true;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] === `Bearer ${cronSecret}`) return true;
  return false;
}

async function refreshMvHandler(req, res) {
  if (!cronOrAdminAuthed(req)) return res.status(403).json({ error: 'forbidden' });
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
    // Refresh card_sets summary (set pages) — best-effort, ~20s aggregate.
    // Existing slugs are stable (keyed on name); brand-new sets get a slug,
    // with a short hash suffix if it would collide with an existing one.
    try {
      const t1 = Date.now();
      await pool.query(`
        INSERT INTO card_sets (slug, name, sport, year, card_count, family_count, price_min, price_max, sales_30d, thumbnail, updated_at)
        SELECT CASE WHEN EXISTS (SELECT 1 FROM card_sets cs WHERE cs.slug = a.base AND cs.name <> a.name)
                    THEN a.base || '-' || substr(md5(a.name), 1, 4) ELSE a.base END,
               a.name, a.sport, a.year, a.card_count, a.family_count, a.price_min, a.price_max, a.sales_30d, a.thumbnail, now()
        FROM (
          SELECT card_set AS name,
                 trim(both '-' from lower(regexp_replace(card_set, '[^a-zA-Z0-9]+', '-', 'g'))) AS base,
                 mode() WITHIN GROUP (ORDER BY sport) FILTER (WHERE sport IS NOT NULL AND sport <> '' AND sport !~ '^[0-9]+x[0-9]+$') AS sport,
                 mode() WITHIN GROUP (ORDER BY NULLIF(year,'')) AS year,
                 count(*)::int AS card_count,
                 count(DISTINCT (player, variant, number))::int AS family_count,
                 min(catalog_price) FILTER (WHERE catalog_price > 0) AS price_min,
                 max(catalog_price) FILTER (WHERE catalog_price <= 5000000) AS price_max,
                 sum(COALESCE(sales_30d,0))::bigint AS sales_30d,
                 (array_agg(ebay_thumb ORDER BY sales_30d DESC NULLS LAST) FILTER (WHERE ebay_thumb IS NOT NULL))[1] AS thumbnail
          FROM cards WHERE card_set IS NOT NULL AND card_set <> ''
          GROUP BY card_set
        ) a
        WHERE a.base <> ''
        ON CONFLICT (name) DO UPDATE SET
          card_count = EXCLUDED.card_count, family_count = EXCLUDED.family_count,
          price_min = EXCLUDED.price_min, price_max = EXCLUDED.price_max,
          sales_30d = EXCLUDED.sales_30d, thumbnail = COALESCE(EXCLUDED.thumbnail, card_sets.thumbnail),
          sport = EXCLUDED.sport, year = EXCLUDED.year, updated_at = now()`);
      console.log(`[admin] card_sets refreshed in ${Date.now()-t1}ms`);
    } catch (e) { console.error('[admin] card_sets refresh failed:', e.message); }
    const alerts = await sweepPriceAlerts(pool);
    res.json({ ok: true, refreshedMs: Date.now()-t0, priceAlerts: alerts });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
}
// GET = Vercel cron invocation (crons always send GET); POST = manual/admin.
app.get('/api/admin/refresh-mv', refreshMvHandler);
app.post('/api/admin/refresh-mv', refreshMvHandler);

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


// ── Admin panel API (role-gated — users.role = 'admin') ──────────────────────
// Distinct from the x-admin-key ops endpoints above: these back the /admin UI
// and are gated on the signed-in user's role, never an open header key.
let _adminTablesReady = false;
async function ensureAdminTables(pool) {
  if (_adminTablesReady) return;
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT true,
      note TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  _adminTablesReady = true;
}

async function adminGate(req, res, next) {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const { rows: [u] } = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId]);
    if (u?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    await ensureAdminTables(pool);
    await ensureTsTables(pool);
    req.adminPool = pool;
    next();
  } catch (e) {
    console.error('adminGate error:', e.message);
    res.status(500).json({ error: 'Admin check failed' });
  }
}
const requireAdmin = [requireAuth, adminGate];

// Account suspension: additive users.suspended_at column. Suspended users keep
// read access (and can still message on open orders) but can't create new
// listings/offers/posts/trades/bids — and can't log in again.
async function assertActiveAccount(pool, userId, res) {
  try {
    await ensureAdminTables(pool);
    const { rows: [u] } = await pool.query('SELECT suspended_at FROM users WHERE id = $1', [userId]);
    if (u?.suspended_at) {
      res.status(403).json({ error: 'Your account is suspended. Contact support@gemlinecards.com to appeal.' });
      return false;
    }
  } catch (e) { /* fail open — enforcement is best-effort, login is the hard gate */ }
  return true;
}

// Feature flags: default-on unless a row says otherwise. 60s in-memory cache.
const KNOWN_FLAGS = ['packs', 'mystery_packs', 'community_posts', 'trades', 'auctions', 'ai_scout', 'groups'];
let _flagCache = { at: 0, map: {} };
async function getFlags(pool) {
  if (Date.now() - _flagCache.at < 60_000) return _flagCache.map;
  try {
    await ensureAdminTables(pool);
    const { rows } = await pool.query('SELECT key, enabled FROM feature_flags');
    const map = {};
    for (const k of KNOWN_FLAGS) map[k] = true;
    for (const row of rows) map[row.key] = !!row.enabled;
    _flagCache = { at: Date.now(), map };
  } catch (e) { /* keep last known */ }
  return _flagCache.map;
}
async function flagEnabled(pool, key) {
  const map = await getFlags(pool);
  return map[key] !== false;
}

app.get('/api/flags', async (_req, res) => {
  try {
    const r = await getRepo();
    if (!r.pool) return res.json({ flags: {} });
    res.json({ flags: await getFlags(r.pool) });
  } catch (e) { res.json({ flags: {} }); }
});

app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const [users, listings, orders, reports, flags] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total,
                         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_7d,
                         COUNT(*) FILTER (WHERE suspended_at IS NOT NULL)::int AS suspended
                  FROM users`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                         COUNT(*)::int AS total,
                         COUNT(*) FILTER (WHERE status = 'active' AND kind = 'auction')::int AS live_auctions
                  FROM listings`),
      pool.query(`SELECT status::text, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::bigint AS cents
                  FROM orders GROUP BY status`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open, COUNT(*)::int AS total FROM reports`),
      getFlags(pool),
    ]);
    const byStatus = {};
    let gmvCents = 0;
    for (const row of orders.rows) {
      byStatus[row.status] = row.n;
      if (!['cancelled', 'refunded', 'pending_payment', 'created'].includes(row.status)) gmvCents += Number(row.cents);
    }
    res.json({
      users: users.rows[0],
      listings: listings.rows[0],
      orders: { byStatus, gmv: gmvCents / 100 },
      reports: reports.rows[0],
      flags,
    });
  } catch (e) {
    console.error('admin/overview error:', e.message);
    res.status(500).json({ error: 'Overview failed' });
  }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const q = String(req.query.q || '').trim().slice(0, 60);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const params = q ? [`%${q}%`, limit + 1, (page - 1) * limit] : [limit + 1, (page - 1) * limit];
    const { rows } = await pool.query(`
      SELECT u.id, u.handle, u.email, u.role::text, u.account_type, u.created_at, u.suspended_at,
             (SELECT COUNT(*)::int FROM listings l WHERE l.seller_id = u.id AND l.status = 'active') AS active_listings,
             (SELECT COUNT(*)::int FROM orders o WHERE o.buyer_id = u.id OR o.seller_id = u.id) AS orders,
             (SELECT COUNT(*)::int FROM reports rp WHERE rp.target_type = 'user' AND rp.target_id = u.id::text AND rp.status = 'open') AS open_reports
      FROM users u
      ${q ? 'WHERE u.handle ILIKE $1 OR u.email ILIKE $1' : ''}
      ORDER BY u.created_at DESC
      LIMIT $${q ? 2 : 1} OFFSET $${q ? 3 : 2}`, params);
    res.json({ users: rows.slice(0, limit), hasMore: rows.length > limit, page });
  } catch (e) {
    console.error('admin/users error:', e.message);
    res.status(500).json({ error: 'User list failed' });
  }
});

app.post('/api/admin/users/:id/suspend', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const suspend = req.body?.suspend !== false;
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    const { rows: [target] } = await pool.query('SELECT id, handle, role FROM users WHERE id = $1', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin') return res.status(400).json({ error: 'Admins can\u2019t be suspended' });
    await pool.query('UPDATE users SET suspended_at = $1 WHERE id = $2', [suspend ? new Date() : null, target.id]);
    let pulledListings = 0;
    if (suspend) {
      const { rows } = await pool.query(
        "UPDATE listings SET status = 'cancelled' WHERE seller_id = $1 AND status = 'active' RETURNING id", [target.id]);
      pulledListings = rows.length;
      for (const l of rows) {
        await pool.query('UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1', [l.id]).catch(() => {});
      }
      await notify(pool, target.id, 'account',
        'Your account has been suspended',
        reason || 'A moderator suspended your account for violating marketplace rules. Contact support@gemlinecards.com to appeal.').catch(() => {});
    } else {
      await notify(pool, target.id, 'account',
        'Your account has been reinstated',
        'A moderator lifted the suspension on your account. Welcome back.').catch(() => {});
    }
    console.log(`[admin] ${req.userId} ${suspend ? 'suspended' : 'unsuspended'} @${target.handle}`);
    res.json({ ok: true, suspended: suspend, pulledListings });
  } catch (e) {
    console.error('admin/suspend error:', e.message);
    res.status(500).json({ error: 'Suspend failed' });
  }
});

app.get('/api/admin/listings', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const status = ['active', 'sold', 'cancelled', 'completed'].includes(req.query.status) ? req.query.status : null;
    const q = String(req.query.q || '').trim().slice(0, 60);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const conds = [];
    const params = [];
    if (status) { params.push(status); conds.push(`l.status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); conds.push(`(c.player ILIKE $${params.length} OR u.handle ILIKE $${params.length})`); }
    params.push(limit + 1, (page - 1) * limit);
    const { rows } = await pool.query(`
      SELECT l.id, (l.price / 100.0)::numeric AS price, l.status::text, l.kind::text, l.created_at, l.cert_verified,
             c.player, c.card_set, c.grader, c.grade, c.year,
             u.id AS seller_id, u.handle AS seller_handle,
             (SELECT COUNT(*)::int FROM reports rp WHERE rp.target_type = 'listing' AND rp.target_id = l.id::text AND rp.status = 'open') AS open_reports
      FROM listings l
      JOIN cards c ON c.id = l.card_id
      JOIN users u ON u.id = l.seller_id
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY l.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ listings: rows.slice(0, limit), hasMore: rows.length > limit, page });
  } catch (e) {
    console.error('admin/listings error:', e.message);
    res.status(500).json({ error: 'Listing list failed' });
  }
});

app.post('/api/admin/listings/:id/remove', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    const { rows: [l] } = await pool.query(`
      SELECT l.id, l.seller_id, l.status, c.player FROM listings l JOIN cards c ON c.id = l.card_id WHERE l.id = $1`, [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.status !== 'active') return res.status(400).json({ error: `Listing is ${l.status} — only active listings can be removed` });
    await pool.query("UPDATE listings SET status = 'cancelled' WHERE id = $1", [l.id]);
    await pool.query('UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1', [l.id]).catch(() => {});
    await notify(pool, l.seller_id, 'listing_removed',
      `Listing removed: ${l.player}`,
      reason || 'A moderator removed this listing for violating marketplace rules.').catch(() => {});
    console.log(`[admin] ${req.userId} removed listing ${l.id}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('admin/listing-remove error:', e.message);
    res.status(500).json({ error: 'Remove failed' });
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const status = String(req.query.status || '').trim();
    const params = status ? [status, limit + 1, (page - 1) * limit] : [limit + 1, (page - 1) * limit];
    const { rows } = await pool.query(`
      SELECT o.id, o.amount, o.status::text, o.created_at, o.updated_at, o.fulfillment_method::text,
             c.player, bu.handle AS buyer_handle, se.handle AS seller_handle
      FROM orders o
      JOIN cards c ON c.id = o.card_id
      JOIN users bu ON bu.id = o.buyer_id
      JOIN users se ON se.id = o.seller_id
      ${status ? 'WHERE o.status = $1::order_status' : ''}
      ORDER BY o.created_at DESC
      LIMIT $${status ? 2 : 1} OFFSET $${status ? 3 : 2}`, params);
    res.json({ orders: rows.slice(0, limit), hasMore: rows.length > limit, page });
  } catch (e) {
    console.error('admin/orders error:', e.message);
    res.status(500).json({ error: 'Order list failed' });
  }
});

app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    const { rows } = await pool.query(`
      SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.resolution,
             r.created_at, r.resolved_at, u.handle AS reporter_handle
      FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
      WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 100`, [status]);
    // Enrich targets so moderators see what was reported without leaving the queue.
    const byType = { listing: [], user: [], post: [] };
    for (const r of rows) if (byType[r.target_type]) byType[r.target_type].push(r.target_id);
    const labels = {};
    if (byType.listing.length) {
      const { rows: ls } = await pool.query(`
        SELECT l.id::text, l.status::text, (l.price / 100.0)::numeric AS price, c.player, u.handle AS seller
        FROM listings l JOIN cards c ON c.id = l.card_id JOIN users u ON u.id = l.seller_id
        WHERE l.id::text = ANY($1)`, [byType.listing]).catch(() => ({ rows: [] }));
      for (const l of ls) labels[`listing:${l.id}`] = { label: `${l.player} — $${Number(l.price).toLocaleString()} by @${l.seller}`, status: l.status, sellerHandle: l.seller };
    }
    if (byType.user.length) {
      const { rows: us } = await pool.query(
        'SELECT id::text, handle, suspended_at FROM users WHERE id::text = ANY($1)', [byType.user]).catch(() => ({ rows: [] }));
      for (const u of us) labels[`user:${u.id}`] = { label: `@${u.handle}${u.suspended_at ? ' (suspended)' : ''}`, handle: u.handle, suspended: !!u.suspended_at };
    }
    if (byType.post.length) {
      const { rows: ps } = await pool.query(`
        SELECT p.id::text, LEFT(COALESCE(p.body, ''), 120) AS excerpt, u.handle, u.id AS author_id
        FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id::text = ANY($1)`, [byType.post]).catch(() => ({ rows: [] }));
      for (const p of ps) labels[`post:${p.id}`] = { label: `@${p.handle}: \u201C${p.excerpt}\u201D`, authorId: p.author_id, handle: p.handle };
    }
    res.json({
      reports: rows.map(r => ({ ...r, target: labels[`${r.target_type}:${r.target_id}`] || { label: `${r.target_type} ${r.target_id} (deleted?)` } })),
      status,
    });
  } catch (e) {
    console.error('admin/reports error:', e.message);
    res.status(500).json({ error: 'Report list failed' });
  }
});

app.post('/api/admin/reports/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const status = req.body?.status === 'dismissed' ? 'dismissed' : 'resolved';
    const resolution = String(req.body?.resolution || '').trim().slice(0, 500) || null;
    const { rows: [r] } = await pool.query(`
      UPDATE reports SET status = $1, resolution = $2, resolved_at = NOW()
      WHERE id = $3 AND status = 'open' RETURNING id, target_type, target_id`, [status, resolution, req.params.id]);
    if (!r) return res.status(404).json({ error: 'Open report not found' });
    // Closing one report closes duplicates against the same target.
    const { rowCount } = await pool.query(`
      UPDATE reports SET status = $1, resolution = 'Duplicate — handled under report #' || $4, resolved_at = NOW()
      WHERE status = 'open' AND target_type = $2 AND target_id = $3`, [status, r.target_type, r.target_id, r.id]);
    res.json({ ok: true, status, alsoClosed: rowCount });
  } catch (e) {
    console.error('admin/report-resolve error:', e.message);
    res.status(500).json({ error: 'Resolve failed' });
  }
});

app.get('/api/admin/flags', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const { rows } = await pool.query('SELECT key, enabled, note, updated_at FROM feature_flags');
    const set = new Map(rows.map(r => [r.key, r]));
    const flags = [...new Set([...KNOWN_FLAGS, ...rows.map(r => r.key)])].map(key => ({
      key,
      enabled: set.has(key) ? !!set.get(key).enabled : true,
      note: set.get(key)?.note || null,
      updatedAt: set.get(key)?.updated_at || null,
    }));
    res.json({ flags });
  } catch (e) { res.status(500).json({ error: 'Flags failed' }); }
});

app.post('/api/admin/flags', requireAdmin, async (req, res) => {
  try {
    const pool = req.adminPool;
    const key = String(req.body?.key || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{2,40}$/.test(key)) return res.status(400).json({ error: 'Invalid flag key' });
    const enabled = req.body?.enabled !== false;
    const note = String(req.body?.note || '').trim().slice(0, 200) || null;
    await pool.query(`
      INSERT INTO feature_flags (key, enabled, note, updated_at) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) DO UPDATE SET enabled = $2, note = COALESCE($3, feature_flags.note), updated_at = NOW()`,
      [key, enabled, note]);
    _flagCache = { at: 0, map: {} };
    console.log(`[admin] ${req.userId} set flag ${key}=${enabled}`);
    res.json({ ok: true, key, enabled });
  } catch (e) { res.status(500).json({ error: 'Flag update failed' }); }
});


// ── AI Scout — Claude reasoning over catalog + Card Hedge search ─────────────
app.post('/api/scout/search', async (req, res) => {
  try {
    const { query, category } = req.body || {};
    if (!query) return res.json({ results: [] });
    const CH = process.env.CARDHEDGE_API_KEY || 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK';
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
    const CH = process.env.CARDHEDGE_API_KEY || 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK';
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
    const apiKey = process.env.CARDHEDGE_API_KEY || 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK';

    // Fetch price history + comps in parallel
    const [histRes, compRes] = await Promise.allSettled([
      fetch('https://api.cardhedger.com/v1/cards/prices-by-card', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardhedgeId, grade, days }),
      }),
      // NOTE: /v1/cards/comps REQUIRES count + grade (limit-only 400s on every card).
      // include_raw_prices returns the individual sales (raw_prices[]) w/ sale_url.
      fetch('https://api.cardhedger.com/v1/cards/comps', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardhedgeId, grade, count: 20, include_raw_prices: true }),
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
      comps = (cd.raw_prices || cd.comps || cd.sales || []).slice(0, 20).map(c => ({
        date: c.sale_date || c.date,
        price: Number(c.sale_price ?? c.price),
        source: c.price_source || c.source || 'eBay',
        url: c.sale_url || c.listing_url || null,
        title: c.title || null,
      })).filter(c => c.price > 0)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
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

// ── Card hydration: full feed-shaped card by catalog id ──────────────────────
// CardDetail opens from many entry points (ticker, movers, search, profiles,
// posts) that pass partial card objects — this endpoint lets the modal
// self-hydrate (thumbnail, grades ladder, sales counts, cardhedge_id, lo/hi).
const CARD_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.get('/api/cards/:id', async (req, res) => {
  try {
    let { id } = req.params;
    const isCh = !CARD_UUID_RE.test(id) && CARDHEDGE_ID_RE.test(id);
    if (!CARD_UUID_RE.test(id) && !isCh) return res.status(404).json({ error: 'not found' });
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'db unavailable' });
    if (isCh) {
      // CardHedge id passthrough (Scout results) — resolve to our catalog uuid
      // so the modal self-hydrates with a real cards.id it can act on.
      id = await resolveCardId(pool, id);
      if (!id) return res.status(404).json({ error: 'not found' });
    }
    let { rows: [card] } = await pool.query('SELECT * FROM mv_card_feed WHERE id = $1', [id]);
    if (!card) {
      // Not the family's display-tier row (or unpriced/new) — fall back to cards
      // + sibling grade tiers of the same family (player/set/variant/number).
      const { rows: [raw] } = await pool.query('SELECT * FROM cards WHERE id = $1', [id]);
      if (!raw) return res.status(404).json({ error: 'not found' });
      let grades = [];
      const { rows: sib } = await pool.query(
        `SELECT id, grader, grade, catalog_price AS price, ch_price_lo AS lo, ch_price_hi AS hi,
                sales_7d AS sales7d, sales_30d AS sales30d, gain_7d AS gain7d
         FROM cards
         WHERE player = $1 AND card_set = $2
           AND COALESCE(variant,'') = $3 AND COALESCE(number,'') = $4
           AND catalog_price > 0
         ORDER BY catalog_price DESC NULLS LAST LIMIT 12`,
        [raw.player, raw.card_set, raw.variant || '', raw.number || '']);
      grades = sib;
      if (!grades.length && raw.cardhedge_id) {
        const { rows: chSib } = await pool.query(
          `SELECT id, grader, grade, catalog_price AS price, ch_price_lo AS lo, ch_price_hi AS hi,
                  sales_7d AS sales7d, sales_30d AS sales30d, gain_7d AS gain7d
           FROM cards WHERE cardhedge_id = $1 ORDER BY catalog_price DESC NULLS LAST LIMIT 12`,
          [raw.cardhedge_id]);
        grades = chSib;
      }
      card = { ...raw, grade_count: grades.length || 1, grades };
    }
    const mp = Number(card.catalog_price) || 0;
    const tiers = dedupeTiers(card.grades);
    res.json({ card: {
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
      variant: card.variant || '', num: card.number || '',
      cardhedge_id: card.cardhedge_id || null,
      gradeCount: tiers.length || Number(card.grade_count) || 1,
      priceMin: Number(card.price_min) || mp,
      priceMax: Number(card.price_max) || mp,
      grades: tiers.map(g => ({
        id: g.id || null,
        grader: normGrader(g.grader), grade: normGrade(g.grade),
        price: Number(g.price) || 0, lo: Number(g.lo) || 0, hi: Number(g.hi) || 0,
        sales7d: Number(g.sales7d) || 0, sales30d: Number(g.sales30d) || 0,
        gain7d: Number(g.gain7d) || 0,
      })),
    } });
  } catch (e) { console.error('cards/:id:', e.message); res.status(500).json({ error: 'lookup failed' }); }
});

// ── Card Hedge proxy: top movers ──────────────────────────────────────────────
app.get('/api/market/movers', async (req, res) => {
  try {
    if (app._moversCache && app._moversCache.expires > Date.now())
      return res.json(app._moversCache.data);
    const count = Math.min(Number(req.query.count) || 50, 100);
    const category = req.query.category || '';
    const url = `https://api.cardhedger.com/v1/cards/top-movers?count=${count}${category ? `&category=${category}` : ''}`;
    const r = await fetch(url, { headers: { 'X-API-Key': process.env.CARDHEDGE_API_KEY || 'IVizMeJGO17DThsD4anFVtoceA8mYyBkZdGtqLKK' } });
    const data = await r.json();
    app._moversCache = { expires: Date.now() + 60 * 60 * 1000, data }; // 1hr cache
    res.json(data);
  } catch(e) { res.json({ cards: [] }); }
});

// Heatmap: top 100 cards with real price movement, cached 5min
app.get('/api/market/heatmap', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ cards: [], count: 0 });
    const sport = (req.query.sport && req.query.sport !== 'All') ? String(req.query.sport).slice(0, 40) : null;
    const sort = ['gainers', 'losers', 'volume', 'value', 'movers'].includes(req.query.sort) ? req.query.sort : 'movers';
    const limit = Math.min(300, Math.max(1, parseInt(req.query.limit) || 100));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    // Trusted pool (cached 5min per sport): top cards by 7-day sales volume —
    // real liquidity — then rank within it. Raw gain-sorted queries return a
    // wall of clamped +468–500% thin-sale junk (5 sales at a new price tier ≠
    // a 5x move). Sanity: price >= $5, 5+ validated sales, |gain| <= 150%.
    const poolKey = sport || 'All';
    if (!app._heatmapPools) app._heatmapPools = {};
    let cachedPool = app._heatmapPools[poolKey];
    if (!cachedPool || cachedPool.expires < Date.now()) {
      const cols = `id AS "cardId", player, sport, card_set AS "set", grader, grade, year,
               variant, number AS num, catalog_price AS "marketPrice",
               ch_price_lo AS lo, ch_price_hi AS hi, ch_confidence AS confidence,
               ebay_thumb AS thumbnail, image_url, rookie, cardhedge_id,
               sales_7d, sales_30d, gain_7d`;
      const sportClause = sport ? ` AND sport = $1` : '';
      const params = sport ? [sport] : [];
      const { rows: raw } = await pool.query(
        `SELECT ${cols} FROM cards
         WHERE catalog_price >= 5 AND COALESCE(sales_7d,0) >= 5
           AND gain_7d IS NOT NULL AND gain_7d != 0 AND ABS(gain_7d) <= 150${sportClause}
         ORDER BY COALESCE(sales_7d,0) DESC LIMIT 1500`, params);
      // Dedupe: same card appears once per grade tier — keep one entry per
      // underlying card so the heatmap isn't wallpapered with duplicates.
      // Also normalize legacy grader/grade pollution ('Raw Ungraded' etc).
      const seen = new Set();
      const deduped = raw.filter(c => {
        const key = c.cardhedge_id || `${c.player}|${c.set}|${c.variant}`;
        if (seen.has(key)) return false;
        seen.add(key);
        c.grader = normGrader(c.grader);
        c.grade = normGrade(c.grade);
        return true;
      });
      cachedPool = { rows: deduped, expires: Date.now() + 5 * 60 * 1000 };
      app._heatmapPools[poolKey] = cachedPool;
    }

    // Real sports present in the trusted pool (for filter tabs)
    if (!app._heatmapSports || app._heatmapSports.expires < Date.now()) {
      const { rows: sp } = await pool.query(
        `SELECT sport, COUNT(*) AS cnt FROM cards
         WHERE catalog_price >= 5 AND COALESCE(sales_7d,0) >= 5
           AND gain_7d IS NOT NULL AND gain_7d != 0 AND ABS(gain_7d) <= 150
           AND sport IS NOT NULL AND sport <> '' AND sport !~ '^[0-9]+x[0-9]+$'
         GROUP BY sport ORDER BY cnt DESC LIMIT 12`);
      app._heatmapSports = { data: sp.map(x => x.sport), expires: Date.now() + 30 * 60 * 1000 };
    }

    const g7 = c => Number(c.gain_7d) || 0;
    // 5-min time bucket seeds a tiny deterministic jitter so near-equal movers
    // rotate between refreshes (repeat visitors see fresh cards) without any
    // extra DB work. Magnitude ordering is preserved for clearly bigger moves.
    const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
    const jitter = (c) => {
      const key = String(c.cardId || c.player || '');
      let h = bucket;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      return (h % 1000) / 1000; // 0..1
    };
    let ranked = [...cachedPool.rows];
    if (sort === 'gainers') ranked = ranked.filter(c => g7(c) > 0).sort((a, b) => g7(b) - g7(a));
    else if (sort === 'losers') ranked = ranked.filter(c => g7(c) < 0).sort((a, b) => g7(a) - g7(b));
    else if (sort === 'volume') ranked.sort((a, b) => (Number(b.sales_7d) || 0) - (Number(a.sales_7d) || 0));
    else if (sort === 'value') ranked.sort((a, b) => (Number(b.marketPrice) || 0) - (Number(a.marketPrice) || 0));
    else ranked.sort((a, b) => (Math.abs(g7(b)) + jitter(b) * 6) - (Math.abs(g7(a)) + jitter(a) * 6)); // movers: biggest move + gentle time-seeded rotation

    const cards = ranked.slice(offset, offset + limit);
    res.json({ cards, count: cards.length, total: ranked.length, sort, sport: poolKey, sports: app._heatmapSports.data, updatedAt: new Date().toISOString() });
  } catch(e) { console.error('Heatmap error:', e.message); res.json({ cards: [], count: 0 }); }
});

// Hot Board: trending players by real 7-day sales volume + price direction.
// Landing hero — tiny payload (~2KB) so the hero stack paints instantly instead
// of waiting on the 100KB market feed. Top-selling recognizable cards, one per
// player. In-memory 15 min + CDN s-maxage=900. Prefers r2_thumb (our bucket)
// when the backfill has it, with the ebay/bubble thumb as a client-side
// fallback (r2.dev is rate-limited — the CDN cache keeps this to one DB hit
// per 15 min, and each visitor loads at most ~6 images).
app.get('/api/market/hero', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
    if (app._heroCache?.expires > Date.now()) return res.json(app._heroCache.data);
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ cards: [] });
    // Mix: 5 top-selling SPORTS cards + exactly 1 Pokémon (Rhett 07-10).
    // r2_thumb required — those are the full-res (~705x1200) images in our
    // bucket, so the hero never rotates in a blurry bubble/ebay thumbnail.
    const heroQuery = (sportsFilter, take) => `
      WITH top AS (
        SELECT f.id, f.player, f.sport, f.year, f.grader, f.grade, f.catalog_price,
               f.gain_7d, f.ebay_thumb, f.image_url, f.sales_7d, c.r2_thumb
        FROM mv_card_feed f JOIN cards c ON c.id = f.id
        WHERE c.r2_thumb IS NOT NULL
          AND f.sport IN (${sportsFilter})
          AND f.catalog_price >= 25
          AND f.player IS NOT NULL AND f.player <> '' AND f.player !~ '^[0-9]+x[0-9]+$'
        ORDER BY f.sales_7d DESC NULLS LAST
        LIMIT 80
      ), dedup AS (
        SELECT DISTINCT ON (player) * FROM top ORDER BY player, sales_7d DESC NULLS LAST
      )
      SELECT * FROM dedup ORDER BY sales_7d DESC NULLS LAST LIMIT ${take}`;
    const [sports, poke] = await Promise.all([
      pool.query(heroQuery(`'Basketball','Baseball','Football','Hockey','Soccer'`, 5)),
      pool.query(heroQuery(`'Pokemon','TCG'`, 1)),
    ]);
    const shape = (x, isPoke) => {
      const ebay = x.ebay_thumb || x.image_url || null;
      return {
        cardId: x.id, player: x.player,
        sport: isPoke ? 'Pok\u00e9mon' : (x.sport || ''), year: x.year || '',
        grader: normGrader(x.grader), grade: normGrade(x.grade),
        marketPrice: Number(x.catalog_price) || 0,
        gain7d: Number(x.gain_7d) || 0,
        thumbnail: x.r2_thumb || ebay,
        thumbAlt: (x.r2_thumb && ebay) ? ebay : null,
      };
    };
    const cards = sports.rows.map(x => shape(x, false));
    if (poke.rows[0]) cards.splice(Math.min(2, cards.length), 0, shape(poke.rows[0], true)); // Pokémon rides third in the stack
    const data = { cards, updatedAt: new Date().toISOString() };
    app._heroCache = { data, expires: Date.now() + 15 * 60 * 1000 };
    res.json(data);
  } catch (e) { console.error('market/hero:', e.message); res.json({ cards: [] }); }
});

// Landing-page hot path — aggregate over mv_card_feed, cached 5 min per sport
// (in-memory + CDN s-maxage) so the board visibly refreshes. No external calls.
app.get('/api/market/hot-board', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ players: [], sports: [] });
    const sport = (req.query.sport && req.query.sport !== 'All') ? String(req.query.sport).slice(0, 40) : null;
    const key = sport || 'All';
    if (!app._hotBoard) app._hotBoard = {};
    const hit = app._hotBoard[key];
    if (hit && hit.expires > Date.now()) return res.json(hit.data);

    // Sport tabs: real sports with 7-day sales, cached 1h
    if (!app._hotBoardSports || app._hotBoardSports.expires < Date.now()) {
      const { rows: sp } = await pool.query(
        `SELECT sport, sum(COALESCE(sales_7d,0)) AS s7 FROM mv_card_feed
         WHERE COALESCE(sales_7d,0) > 0 AND sport IS NOT NULL AND sport <> ''
           AND sport !~ '^[0-9]+x[0-9]+$'
         GROUP BY sport ORDER BY s7 DESC LIMIT 6`);
      app._hotBoardSports = { data: sp.map(x => x.sport), expires: Date.now() + 60 * 60 * 1000 };
    }

    const params = [];
    let sportClause = '';
    if (sport) { params.push(sport); sportClause = ` AND sport = $1`; }
    // Weighted 7-day move per player: only sane gains (thin-sale ±10,000% junk
    // excluded from the average, but their volume still counts).
    const { rows } = await pool.query(`
      SELECT player, sport,
             sum(COALESCE(sales_7d,0))::int AS s7,
             sum(COALESCE(sales_30d,0))::int AS s30,
             COALESCE(round((sum(CASE WHEN gain_7d BETWEEN -90 AND 500 THEN gain_7d * COALESCE(sales_7d,0) ELSE 0 END)
               / NULLIF(sum(CASE WHEN gain_7d BETWEEN -90 AND 500 THEN COALESCE(sales_7d,0) ELSE 0 END), 0))::numeric, 1), 0) AS wgain,
             count(*)::int AS families,
             max(catalog_price) AS top_price
      FROM mv_card_feed
      WHERE COALESCE(sales_7d,0) > 0 AND player IS NOT NULL AND player <> ''
        AND player !~ '^[0-9]+x[0-9]+$' AND sport !~ '^[0-9]+x[0-9]+$'${sportClause}
      GROUP BY player, sport
      ORDER BY s7 DESC LIMIT 12`, params);

    // Face for each player row: their most-traded card with an image
    let thumbs = new Map();
    if (rows.length) {
      const { rows: t } = await pool.query(`
        SELECT DISTINCT ON (player, sport) player, sport, id, ebay_thumb, image_url
        FROM mv_card_feed WHERE player = ANY($1)
        ORDER BY player, sport, (ebay_thumb IS NOT NULL OR image_url IS NOT NULL) DESC,
                 sales_7d DESC NULLS LAST`, [rows.map(x => x.player)]);
      thumbs = new Map(t.map(x => [`${x.player}|${x.sport}`, x]));
    }

    const players = rows.map(p => {
      const t = thumbs.get(`${p.player}|${p.sport}`) || {};
      return {
        player: p.player, sport: p.sport,
        sales7d: Number(p.s7) || 0, sales30d: Number(p.s30) || 0,
        gain7d: Number(p.wgain) || 0, families: Number(p.families) || 0,
        topPrice: Number(p.top_price) || 0,
        thumbnail: t.ebay_thumb || t.image_url || null,
        topCardId: t.id || null,
      };
    });
    const data = { players, sports: ['All', ...app._hotBoardSports.data], updatedAt: new Date().toISOString() };
    app._hotBoard[key] = { data, expires: Date.now() + 5 * 60 * 1000 };
    res.json(data);
  } catch (e) { console.error('hot-board:', e.message); res.json({ players: [], sports: [] }); }
});

// Worth Grading? — raw cards where the family also has PSA 10 (and 9) prices.
// Everything computed from OUR catalog: no external calls, no pop faked (we
// don't hold pop data yet — future enhancement). Client does the grading-cost
// math (user-adjustable input); server ships the candidate pool, cached 10min.
app.get('/api/market/worth-grading', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ candidates: [] });
    const sport = (req.query.sport && req.query.sport !== 'All') ? String(req.query.sport).slice(0, 40) : null;
    const key = sport || 'All';
    if (!app._worthGrading) app._worthGrading = {};
    const hit = app._worthGrading[key];
    if (hit && hit.expires > Date.now()) return res.json(hit.data);

    const params = [];
    let sportCond = '';
    if (sport) { params.push(sport); sportCond = ` AND c.sport = $1`; }
    // Family pivot: one row per cardhedge_id with Raw / PSA10 / PSA9 prices.
    // Sanity: raw ≥ $1, PSA10 ≥ $10, some family sales in 30d, ≤150x ratio
    // (beyond that the tier data is junk, not a grading play).
    const { rows } = await pool.query(`
      WITH fam AS (
        SELECT cardhedge_id,
               max(catalog_price) FILTER (WHERE upper(coalesce(grader,'')) = 'RAW') AS raw_price,
               max(catalog_price) FILTER (WHERE upper(coalesce(grader,'')) = 'PSA' AND grade = '10') AS psa10,
               max(catalog_price) FILTER (WHERE upper(coalesce(grader,'')) = 'PSA' AND grade = '9') AS psa9,
               sum(COALESCE(sales_30d,0))::int AS s30,
               sum(COALESCE(sales_7d,0))::int AS s7
        FROM cards WHERE cardhedge_id IS NOT NULL
        GROUP BY cardhedge_id
        HAVING max(catalog_price) FILTER (WHERE upper(coalesce(grader,'')) = 'RAW') >= 1
           AND max(catalog_price) FILTER (WHERE upper(coalesce(grader,'')) = 'PSA' AND grade = '10') >= 10
           AND max(catalog_price) FILTER (WHERE upper(coalesce(grader,'')) = 'PSA' AND grade = '10') <= 5000000
           AND sum(COALESCE(sales_30d,0)) >= 1
      )
      SELECT c.id, c.player, c.card_set, c.year, c.variant, c.number, c.sport, c.rookie,
             COALESCE(c.ebay_thumb, c.image_url) AS thumbnail,
             f.cardhedge_id, f.raw_price, f.psa10, f.psa9, f.s30, f.s7
      FROM fam f
      JOIN cards c ON c.cardhedge_id = f.cardhedge_id AND upper(coalesce(c.grader,'')) = 'RAW'
      WHERE f.psa10 / f.raw_price <= 150${sportCond}
      ORDER BY (f.psa10 - f.raw_price) DESC
      LIMIT 1200`, params);

    // Blend absolute-profit leaders with ROI leaders so cheap "quick win" raws
    // make the pool too, then dedupe.
    const byProfit = rows; // already profit-ordered
    const byRoi = [...rows].sort((a, b) => (Number(b.psa10) / Number(b.raw_price)) - (Number(a.psa10) / Number(a.raw_price)));
    const seen = new Set();
    const merged = [];
    for (const c of [...byProfit.slice(0, 600), ...byRoi.slice(0, 600)]) {
      if (seen.has(c.cardhedge_id)) continue;
      seen.add(c.cardhedge_id);
      merged.push({
        cardId: c.id, cardhedgeId: c.cardhedge_id,
        player: c.player, set: c.card_set, year: c.year || '',
        variant: c.variant || '', number: c.number || '', sport: c.sport,
        rookie: c.rookie || false, thumbnail: c.thumbnail || null,
        raw: Number(c.raw_price), psa10: Number(c.psa10),
        psa9: c.psa9 != null ? Number(c.psa9) : null,
        sales30d: Number(c.s30) || 0, sales7d: Number(c.s7) || 0,
      });
    }
    const data = { candidates: merged.slice(0, 1000), popAvailable: false };
    app._worthGrading[key] = { data, expires: Date.now() + 10 * 60 * 1000 };
    res.json(data);
  } catch (e) { console.error('worth-grading:', e.message); res.json({ candidates: [] }); }
});

// ── PUBLIC routes (no auth) ───────────────────────────────────────────────────
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
// Family rows can carry duplicate tiers (e.g. two PSA 10 source rows from
// polluted imports) — keep the most-traded, then highest-priced per tier.
function dedupeTiers(grades) {
  const seen = new Map();
  for (const g of grades || []) {
    const key = `${normGrader(g.grader)}|${normGrade(g.grade)}`;
    const prev = seen.get(key);
    const s = Number(g.sales30d) || 0, p = Number(g.price) || 0;
    if (!prev || s > prev._s || (s === prev._s && p > prev._p)) {
      seen.set(key, { ...g, _s: s, _p: p });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b._p - a._p)
    .map(({ _s, _p, ...g }) => g);
}

app.get('/api/market/feed', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
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
        // Trending: never lead page 1 with imageless placeholder tiles (~21% of catalog)
        orderBy = `(ebay_thumb IS NOT NULL OR image_url IS NOT NULL) DESC, (COALESCE(sales_7d,0)*2 + COALESCE(sales_30d,0) + ABS(COALESCE(gain_7d,0))*5 + RANDOM()*20) DESC`;
        break;
    }

    let cards, totalCards;
    if (search) {
      // Tokenized AND search over the FULL cards table — same semantics as the
      // header typeahead (POST /api/catalog/search): every word must match
      // player/set/variant/year. mv_card_feed only holds priced families, so
      // newly imported (unpriced) cards were invisible here, and the old
      // whole-phrase ILIKE never matched player+brand queries like
      // "emeka egbuka donruss". Backed by expression index idx_cards_search_trgm.
      const tokens = String(search).split(/\s+/).filter(Boolean).slice(0, 8);
      const SEARCH_EXPR = `(coalesce(player,'') || ' ' || coalesce(card_set,'') || ' ' || coalesce(variant,'') || ' ' || coalesce(year,''))`;
      const sp = [];
      const sconds = tokens.map((t) => { sp.push(`%${t}%`); return `${SEARCH_EXPR} ILIKE $${sp.length}`; });
      if (sport && sport !== 'All') { sp.push(sport); sconds.push(`sport = $${sp.length}`); }
      if (brand) { sp.push(`%${brand}%`); sconds.push(`card_set ILIKE $${sp.length}`); }
      if (sort === 'gain' || sort === 'loss') sconds.push(`catalog_price >= 5`, `COALESCE(sales_7d,0) >= 2`, `gain_7d BETWEEN -90 AND 500`);
      const { rows } = await pool.query(`
        WITH m AS (
          SELECT * FROM cards
          WHERE ${sconds.join(' AND ')}
          ORDER BY (catalog_price IS NOT NULL AND catalog_price > 0) DESC,
                   sales_30d DESC NULLS LAST, catalog_price DESC NULLS LAST
          LIMIT 3000
        ), fam AS (
          SELECT (array_agg(id ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST))[1] AS id,
                 player, card_set, COALESCE(max(NULLIF(year,'')),'') AS year, variant, number, sport,
                 (array_agg(catalog_price ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST))[1] AS catalog_price,
                 (array_agg(ch_price_lo ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST))[1] AS ch_price_lo,
                 (array_agg(ch_price_hi ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST))[1] AS ch_price_hi,
                 (array_agg(ch_confidence ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST))[1] AS ch_confidence,
                 (array_agg(ebay_thumb ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST) FILTER (WHERE ebay_thumb IS NOT NULL))[1] AS ebay_thumb,
                 (array_agg(image_url ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url,
                 (array_agg(cardhedge_id ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST) FILTER (WHERE cardhedge_id IS NOT NULL))[1] AS cardhedge_id,
                 (array_agg(grader ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST))[1] AS grader,
                 (array_agg(grade ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST))[1] AS grade,
                 (array_agg(gain_7d ORDER BY m.sales_7d DESC NULLS LAST, m.catalog_price DESC NULLS LAST))[1] AS gain_7d,
                 sum(COALESCE(sales_7d,0)) AS sales_7d, sum(COALESCE(sales_30d,0)) AS sales_30d,
                 bool_or(rookie) AS rookie, count(*) AS grade_count,
                 min(catalog_price) AS price_min, max(catalog_price) AS price_max,
                 json_agg(json_build_object('id', id, 'grader', grader, 'grade', grade, 'price', catalog_price,
                          'lo', ch_price_lo, 'hi', ch_price_hi, 'sales7d', sales_7d, 'sales30d', sales_30d, 'gain7d', gain_7d)
                          ORDER BY m.catalog_price DESC NULLS LAST) AS grades
          FROM m GROUP BY player, card_set, variant, number, sport
        )
        SELECT *, count(*) OVER () AS _total FROM fam
        ORDER BY (catalog_price IS NOT NULL AND catalog_price > 0) DESC, ${orderBy}
        LIMIT $${sp.length + 1} OFFSET $${sp.length + 2}
      `, [...sp, limit, offset]);
      cards = rows;
      totalCards = rows.length ? Number(rows[0]._total) : 0;
    } else {
      ({ rows: cards } = await pool.query(`
        SELECT * FROM mv_card_feed ${mvWhere}
        ORDER BY (catalog_price IS NOT NULL AND catalog_price > 0) DESC, ${orderBy}
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `, [...params, limit, offset]));

      ({ rows: [{ count: totalCards }] } = await pool.query(
        `SELECT COUNT(*) FROM mv_card_feed ${mvWhere}`,
        params
      ));
    }

    const feed = cards.map(card => {
      const mp = Number(card.catalog_price) || 0;
      const tiers = dedupeTiers(card.grades);
      return {
        cardId: card.id, player: card.player, sport: card.sport, set: card.card_set,
        grader: normGrader(card.grader), grade: normGrade(card.grade), year: card.year || '',
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
        gradeCount: tiers.length || Number(card.grade_count) || 1,
        // Family price range across grade tiers (MV is family-grouped)
        priceMin: Number(card.price_min) || mp,
        priceMax: Number(card.price_max) || mp,
        grades: tiers.map(g => ({
          id: g.id || null,
          grader: normGrader(g.grader),
          grade: normGrade(g.grade),
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

    // Relevance score: exact player name > player prefix > player contains the
    // query, plus trigram similarity and capped liquidity so famous, actively-
    // traded cards float up (was pure trigram, which buried e.g. Michael Jordan
    // under shorter "…Jordan" names on a one-word query).
    const REL = `(
         (CASE WHEN lower(coalesce(player,'')) = lower($1) THEN 5 ELSE 0 END)
       + (CASE WHEN lower(coalesce(player,'')) LIKE lower($1) || '%' THEN 3 ELSE 0 END)
       + (CASE WHEN coalesce(player,'') ILIKE '%' || $1 || '%' THEN 1.5 ELSE 0 END)
       + similarity(coalesce(player,'') || ' ' || coalesce(card_set,'') || ' ' || coalesce(variant,''), $1)
       + LEAST(coalesce(sales_30d,0)::float / 50.0, 2.0)
      )`;
    const { rows: famRows } = await pool.query(
      `WITH m AS (
         SELECT id, player, card_set, year, variant, number, sport, grader, grade,
                catalog_price, ebay_thumb, image_url, sales_30d,
                ${REL} AS rel
         FROM cards
         WHERE ${conds.join(' AND ')}
         ORDER BY rel DESC, sales_30d DESC NULLS LAST, catalog_price DESC NULLS LAST
         LIMIT 500
       )
       SELECT player, card_set, variant, number, sport,
              max(coalesce(year,'')) AS year,
              max(rel) AS rel,
              max(catalog_price) AS top_price,
              sum(coalesce(sales_30d,0)) AS liquidity,
              (array_agg(ebay_thumb) FILTER (WHERE ebay_thumb IS NOT NULL))[1] AS ebay_thumb,
              (array_agg(image_url) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url,
              json_agg(json_build_object('id', id, 'grader', grader, 'grade', grade,
                       'catalog_price', catalog_price, 'sales_30d', sales_30d)
                       ORDER BY catalog_price DESC NULLS LAST) AS tiers
       FROM m
       GROUP BY player, card_set, variant, number, sport
       ORDER BY max(rel) DESC, sum(coalesce(sales_30d,0)) DESC NULLS LAST, max(catalog_price) DESC NULLS LAST
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
// AI vision card identification — shared core for /api/cards/analyze and
// portfolio scan-verification. Throws { status, message } on failure.
async function analyzeCardImage(image) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) throw Object.assign(new Error('Card scanning is not configured'), { status: 503 });
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
  if (!m) throw Object.assign(new Error('Send { image: <dataURL> }'), { status: 400 });
  const [, mediaType, b64] = m;
  if (b64.length > 5_500_000) throw Object.assign(new Error('Image too large — try again'), { status: 413 });

  const prompt = `Identify the trading card in this photo. Respond with ONLY a JSON object, no other text:
{"player":"full player/character name","year":"e.g. 2023","set":"product/set name e.g. Panini Prizm","cardNumber":"card number without # if visible","sport":"Football|Basketball|Baseball|Hockey|Soccer|Pokemon|Other","grader":"PSA|BGS|SGC|CGC or null if raw/ungraded","grade":"numeric grade e.g. 10 or null","certNumber":"grading cert number if visible on the slab label, else null","variant":"parallel/insert name if any, else null","condition":"brief condition note for raw cards, else null","confidence":0.0-1.0}
Use null for anything you cannot read. If the photo does not show a trading card, respond with {"error":"no_card"}.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
  if (!aiRes.ok) {
    const errTxt = await aiRes.text().catch(() => '');
    console.error('analyze AI:', aiRes.status, errTxt.slice(0, 300));
    throw Object.assign(new Error('Card analysis failed — please try again'), { status: 502 });
  }
  const data = await aiRes.json();
  const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonMatch = txt.match(/\{[\s\S]*\}/);
  let info = null;
  try { info = jsonMatch ? JSON.parse(jsonMatch[0]) : null; } catch {}
  if (!info || info.error || !info.player) {
    throw Object.assign(new Error('Could not identify a card — try a clearer, well-lit photo'), { status: 422 });
  }
  const clean = (v) => (v === null || v === undefined || v === 'null' || v === '' ? null : String(v).trim());
  return {
    player: clean(info.player),
    year: clean(info.year),
    set: clean(info.set),
    cardNumber: clean(info.cardNumber),
    sport: clean(info.sport) || 'Other',
    grader: clean(info.grader),
    grade: clean(info.grade),
    certNumber: clean(info.certNumber),
    variant: clean(info.variant),
    condition: clean(info.condition),
    confidence: Math.max(0, Math.min(1, Number(info.confidence) || 0)),
  };
}

// Camera scan → card fields. Auth required (each call costs real money) +
// DB-backed 5/hour + 20/day per user on top of the per-instance 20/min cap.
app.post('/api/cards/analyze', requireAuth, rateLimit({ max: 20, windowMs: 60_000 }), limitAI, async (req, res) => {
  try {
    res.json(await analyzeCardImage(req.body?.image));
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('analyze:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/market/freshness — when card prices last synced (max ch_updated_at).
// Powers the "Prices updated X ago" stamp on the Deal Finder. Cached 10min
// in-memory + 5min CDN so the single seq-scan max() stays cheap.
app.get('/api/market/freshness', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (app._freshnessCache?.expires > Date.now())
      return res.json(app._freshnessCache.data);
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ updatedAt: null });
    const { rows } = await pool.query(`SELECT max(ch_updated_at) AS u FROM cards`);
    const data = { updatedAt: rows[0]?.u || null };
    app._freshnessCache = { data, expires: Date.now() + 10 * 60 * 1000 };
    res.json(data);
  } catch (e) {
    console.error('freshness:', e.message);
    res.json({ updatedAt: null });
  }
});

// GET /api/market/arb — dedicated arbitrage data (cached 5min)
app.get('/api/market/arb', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    const forceRefresh = req.query.refresh === '1';
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (!q && !forceRefresh && app._arbCache && app._arbCache.expires > Date.now())
      return res.json(app._arbCache.data);
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ cards: [] });

    const arbCols = `id, player, sport, card_set, grader, grade, year, variant,
             catalog_price, ch_price_lo, ch_price_hi, gain_7d, sales_7d, sales_30d,
             ebay_thumb, cardhedge_id, rookie`;

    const mapCard = (c) => ({
      id: c.id, player: c.player, sport: c.sport, set: c.card_set,
      grader: normGrader(c.grader), grade: normGrade(c.grade), year: c.year, variant: c.variant,
      market: Number(c.catalog_price) || 0,
      lo: Number(c.ch_price_lo) || 0, hi: Number(c.ch_price_hi) || 0,
      gain7d: Number(c.gain_7d) || 0, sales7d: Number(c.sales_7d) || 0,
      sales30d: Number(c.sales_30d) || 0,
      thumbnail: c.ebay_thumb, cardhedge_id: c.cardhedge_id, rookie: c.rookie,
      edge: (Number(c.ch_price_lo) > 0 && Number(c.ch_price_hi) > 0)
        ? +(((Number(c.ch_price_hi) - Number(c.ch_price_lo)) / Number(c.ch_price_lo)) * 100).toFixed(1) : 0,
      spread: (Number(c.ch_price_hi) || 0) - (Number(c.ch_price_lo) || 0),
    });

    // Tokenized search mode — ?q= covers the FULL card universe (the default
    // arbPlays bucket is capped at 120 rows), so /arbitrage + analytics arb
    // search finds plays that never make the top-120 net-edge cut.
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
      const conds = [];
      const params = [];
      for (const t of tokens) {
        params.push(`%${t}%`);
        const p = `$${params.length}`;
        conds.push(`(player ILIKE ${p} OR card_set ILIKE ${p} OR variant ILIKE ${p} OR year ILIKE ${p} OR grader ILIKE ${p} OR grade ILIKE ${p} OR sport ILIKE ${p})`);
      }
      const { rows } = await pool.query(
        `SELECT ${arbCols} FROM cards
         WHERE ch_price_lo > 0 AND ch_price_hi > 0
           AND catalog_price > 5 AND catalog_price <= 5000
           AND ${conds.join(' AND ')}
         ORDER BY (ch_price_hi * 0.925 - ch_price_lo) * (COALESCE(sales_30d,0) + 1) DESC
         LIMIT 120`, params);
      return res.json({ q, arbPlays: rows.map(mapCard) });
    }

    // Parallelize all queries — cuts latency dramatically
    const [uvRes, gainRes, lossRes, tradedRes, arbRes] = await Promise.all([
      // Undervalued: high volume + negative gain = buy-the-dip candidates
      pool.query(`SELECT ${arbCols} FROM cards
        WHERE catalog_price > 5 AND catalog_price <= 5000 AND sales_7d >= 3
          AND COALESCE(gain_7d, 0) < 0
        ORDER BY (COALESCE(sales_7d,0) * ABS(COALESCE(gain_7d,0))) DESC LIMIT 50`),
      // 7-day gainers — trusted pool (top volume, sane |gain| ≤ 150%): raw
      // gain-sorted rows were a wall of clamped +468–500% thin-sale junk
      pool.query(`WITH vol AS (SELECT ${arbCols} FROM cards
        WHERE sales_7d >= 5 AND catalog_price > 5 AND catalog_price <= 5000
          AND gain_7d IS NOT NULL AND ABS(gain_7d) <= 150
        ORDER BY sales_7d DESC LIMIT 600)
        SELECT * FROM vol WHERE gain_7d > 5 ORDER BY gain_7d DESC LIMIT 25`),
      // 7-day losers — same trusted pool
      pool.query(`WITH vol AS (SELECT ${arbCols} FROM cards
        WHERE sales_7d >= 5 AND catalog_price > 5 AND catalog_price <= 5000
          AND gain_7d IS NOT NULL AND ABS(gain_7d) <= 150
        ORDER BY sales_7d DESC LIMIT 600)
        SELECT * FROM vol WHERE gain_7d < -5 ORDER BY gain_7d ASC LIMIT 25`),
      // Most traded (real volume)
      pool.query(`SELECT ${arbCols} FROM cards
        WHERE sales_7d >= 5 AND catalog_price > 5 AND catalog_price <= 5000
        ORDER BY sales_7d DESC, sales_30d DESC LIMIT 25`),
      // Arb plays: real lo/hi spread, net-positive after the 7.5% standard fee, ranked by net edge × liquidity
      pool.query(`SELECT ${arbCols} FROM cards
        WHERE ch_price_lo > 0 AND ch_price_hi > 0
          AND ch_price_hi * 0.925 - ch_price_lo >= 5
          AND catalog_price > 5 AND catalog_price <= 5000
        ORDER BY (ch_price_hi * 0.925 - ch_price_lo) * (COALESCE(sales_30d,0) + 1) DESC
        LIMIT 120`),
    ]);

    const [undervalued, gainers, losers, mostTraded, arbPlays] = [
      uvRes.rows, gainRes.rows, lossRes.rows, tradedRes.rows, arbRes.rows,
    ];

    const data = {
      undervalued: undervalued.map(mapCard),
      gainers: gainers.map(mapCard),
      losers: losers.map(mapCard),
      mostTraded: mostTraded.map(mapCard),
      arbPlays: arbPlays.map(mapCard),
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

// ── Trust & safety: reports + blocks ───────────────────────────────────
let _tsTablesReady = false;
async function ensureTsTables(pool) {
  if (_tsTablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id BIGSERIAL PRIMARY KEY,
      reporter_id uuid NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC)').catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id uuid NOT NULL,
      blocked_id uuid NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    )`);
  _tsTablesReady = true;
}

const REPORT_TYPES = ['listing', 'user', 'post'];
const REPORT_REASONS = ['counterfeit', 'scam', 'spam', 'harassment', 'inappropriate', 'stolen_photos', 'price_manipulation', 'other'];

app.post('/api/report', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureTsTables(pool);
    const targetType = String(req.body?.targetType || '');
    const targetId = String(req.body?.targetId || '').slice(0, 80);
    const reason = String(req.body?.reason || '');
    const details = String(req.body?.details || '').trim().slice(0, 1000) || null;
    if (!REPORT_TYPES.includes(targetType)) return res.status(400).json({ error: 'Invalid target type' });
    if (!targetId) return res.status(400).json({ error: 'targetId required' });
    if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: 'Invalid reason' });
    const { rows: [dupe] } = await pool.query(
      "SELECT id FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3 AND status = 'open' LIMIT 1",
      [req.userId, targetType, targetId]);
    if (dupe) return res.json({ ok: true, already: true });
    await pool.query(
      'INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, targetType, targetId, reason, details]);
    res.json({ ok: true });
  } catch (e) {
    console.error('report error:', e.message);
    res.status(500).json({ error: 'Report failed' });
  }
});

app.post('/api/users/:userId/block', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureTsTables(pool);
    const target = req.params.userId;
    if (target === req.userId) return res.status(400).json({ error: 'You can\u2019t block yourself' });
    if (req.body?.block === false) {
      await pool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.userId, target]);
      return res.json({ ok: true, blocked: false });
    }
    await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.userId, target]);
    // Blocking also unfollows both directions.
    await pool.query('DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [req.userId, target]).catch(() => {});
    res.json({ ok: true, blocked: true });
  } catch (e) {
    console.error('block error:', e.message);
    res.status(500).json({ error: 'Block failed' });
  }
});

app.get('/api/users/blocked', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ blocked: [] });
    await ensureTsTables(pool);
    const { rows } = await pool.query(`
      SELECT b.blocked_id, u.handle, b.created_at FROM user_blocks b
      LEFT JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`, [req.userId]);
    res.json({ blocked: rows.map(x => ({ userId: x.blocked_id, handle: x.handle, at: x.created_at })) });
  } catch (e) { res.json({ blocked: [] }); }
});

// True when either side has blocked the other (blocks are mutual walls).
async function isBlockedEitherWay(pool, a, b) {
  await ensureTsTables(pool);
  const { rows } = await pool.query(
    'SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1', [a, b]);
  return rows.length > 0;
}

// ── Watchlist + price alerts ───────────────────────────────────────────
// Watch a card (family display tier or any grade tier). Alerts fire on:
//  • new active listing in the watched card's family (immediate, in listing POST)
//  • price move ≥ alert_pct vs last baseline (daily, piggybacks refresh-mv cron)
let _watchTableReady = false;
async function ensureWatchTable(pool) {
  if (_watchTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id BIGSERIAL PRIMARY KEY,
      user_id uuid NOT NULL,
      card_id uuid NOT NULL,
      ref_price NUMERIC,
      last_price NUMERIC,
      alert_pct NUMERIC NOT NULL DEFAULT 5,
      last_alert_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, card_id)
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_watch_card ON watchlist (card_id)').catch(() => {});
  _watchTableReady = true;
}

app.get('/api/watchlist', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ items: [], ids: [] });
    await ensureWatchTable(pool);
    const { rows } = await pool.query(`
      SELECT w.card_id, w.ref_price, w.alert_pct, w.created_at,
             c.player, c.card_set, c.year, c.variant, c.number, c.sport,
             c.grader, c.grade, c.catalog_price, c.gain_7d, c.sales_30d,
             c.ebay_thumb, c.image_url,
             (SELECT COUNT(*) FROM listings l WHERE l.card_id = w.card_id AND l.status = 'active') AS live_listings
      FROM watchlist w JOIN cards c ON c.id = w.card_id
      WHERE w.user_id = $1 ORDER BY w.created_at DESC LIMIT 200`, [req.userId]);
    res.json({
      ids: rows.map(x => x.card_id),
      items: rows.map(x => ({
        cardId: x.card_id, player: x.player, cardSet: x.card_set, year: x.year,
        variant: x.variant, number: x.number, sport: x.sport, grader: x.grader, grade: x.grade,
        thumbnail: x.ebay_thumb || x.image_url || null,
        refPrice: x.ref_price != null ? Number(x.ref_price) : null,
        price: x.catalog_price != null ? Number(x.catalog_price) : null,
        gain7d: x.gain_7d != null ? Number(x.gain_7d) : null,
        sales30d: Number(x.sales_30d) || 0,
        liveListings: Number(x.live_listings) || 0,
        alertPct: Number(x.alert_pct) || 5,
        watchedAt: x.created_at,
      })),
    });
  } catch (e) { res.json({ items: [], ids: [] }); }
});

app.post('/api/watchlist', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureWatchTable(pool);
    let { cardId, watch } = req.body || {};
    if (!cardId) return res.status(400).json({ error: 'cardId required' });
    if (!/^[0-9a-f-]{36}$/i.test(String(cardId))) {
      // CardHedge id passthrough (Scout → CardDetail) — resolve to catalog uuid
      cardId = await resolveCardId(pool, cardId, { grader: req.body?.grader, grade: req.body?.grade });
      if (!cardId) return res.status(404).json({ error: 'Card not found' });
    }
    if (watch === false) {
      await pool.query('DELETE FROM watchlist WHERE user_id = $1 AND card_id = $2', [req.userId, cardId]);
      return res.json({ ok: true, watching: false });
    }
    const { rows: [card] } = await pool.query('SELECT id, catalog_price FROM cards WHERE id = $1', [cardId]);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) AS count FROM watchlist WHERE user_id = $1', [req.userId]);
    if (Number(count) >= 200) return res.status(400).json({ error: 'Watchlist is full (200 max)' });
    const px = Number(card.catalog_price) > 0 ? Number(card.catalog_price) : null;
    await pool.query(`
      INSERT INTO watchlist (user_id, card_id, ref_price, last_price)
      VALUES ($1, $2, $3, $3) ON CONFLICT (user_id, card_id) DO NOTHING`,
      [req.userId, cardId, px]);
    res.json({ ok: true, watching: true });
  } catch (e) {
    console.error('watchlist error:', e.message);
    res.status(500).json({ error: 'Failed to update watchlist' });
  }
});

app.put('/api/watchlist/:cardId', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureWatchTable(pool);
    const pct = Number(req.body?.alertPct);
    if (![2, 5, 10, 20].includes(pct)) return res.status(400).json({ error: 'alertPct must be 2, 5, 10, or 20' });
    await pool.query('UPDATE watchlist SET alert_pct = $1 WHERE user_id = $2 AND card_id = $3', [pct, req.userId, req.params.cardId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to update alert' }); }
});

// ── Saved searches ─────────────────────────────────────────────────────
// Users save a market search (query + filters JSON) and re-run it later.
let _savedSearchReady = false;
async function ensureSavedSearchTable(pool) {
  if (_savedSearchReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id BIGSERIAL PRIMARY KEY,
      user_id uuid NOT NULL,
      name TEXT NOT NULL,
      params JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_saved_search_user ON saved_searches (user_id, created_at DESC)').catch(() => {});
  _savedSearchReady = true;
}

app.get('/api/saved-searches', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ searches: [] });
    await ensureSavedSearchTable(pool);
    const { rows } = await pool.query(
      'SELECT id, name, params, created_at FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.userId]);
    res.json({ searches: rows });
  } catch (e) { res.json({ searches: [] }); }
});

app.post('/api/saved-searches', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureSavedSearchTable(pool);
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Name required' });
    let params = req.body?.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return res.status(400).json({ error: 'params object required' });
    const json = JSON.stringify(params);
    if (json.length > 2000) return res.status(400).json({ error: 'Search too large' });
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) AS count FROM saved_searches WHERE user_id = $1', [req.userId]);
    if (Number(count) >= 25) return res.status(400).json({ error: 'Saved search limit reached (25 max) — delete one first' });
    const { rows: [row] } = await pool.query(
      'INSERT INTO saved_searches (user_id, name, params) VALUES ($1, $2, $3) RETURNING id, name, params, created_at',
      [req.userId, name, json]);
    res.json({ ok: true, search: row });
  } catch (e) {
    console.error('saved-search error:', e.message);
    res.status(500).json({ error: 'Failed to save search' });
  }
});

app.delete('/api/saved-searches/:id', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureSavedSearchTable(pool);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    await pool.query('DELETE FROM saved_searches WHERE id = $1 AND user_id = $2', [id, req.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});

// Notify watchers of a card family when a new listing goes live (skips the seller).
async function notifyWatchersOfListing(pool, listing, sellerId) {
  try {
    await ensureWatchTable(pool);
    const { rows } = await pool.query(`
      SELECT DISTINCT w.user_id, lc.player, lc.grader, lc.grade
      FROM cards lc
      JOIN cards wc ON wc.player = lc.player AND wc.card_set = lc.card_set
        AND COALESCE(wc.variant,'') = COALESCE(lc.variant,'') AND COALESCE(wc.number,'') = COALESCE(lc.number,'')
      JOIN watchlist w ON w.card_id = wc.id
      WHERE lc.id = $1 AND w.user_id != $2 LIMIT 100`, [listing.card_id, sellerId]);
    for (const row of rows) {
      const gradeStr = row.grader && row.grade ? ` ${row.grader} ${row.grade}` : '';
      await notify(pool, row.user_id, 'watch_listing',
        `New listing: ${row.player}${gradeStr} — $${fromCents(listing.price).toLocaleString()}`,
        'A card on your watchlist just hit the market.',
        { listingId: listing.id, cardId: listing.card_id });
    }
  } catch (e) { console.error('watch-notify error:', e.message); }
}

// Daily price-move sweep — called from /api/admin/refresh-mv after the MV rebuild.
async function sweepPriceAlerts(pool) {
  try {
    await ensureWatchTable(pool);
    const { rows } = await pool.query(`
      SELECT w.id, w.user_id, w.card_id, w.last_price, w.alert_pct,
             c.catalog_price, c.player, c.grader, c.grade
      FROM watchlist w JOIN cards c ON c.id = w.card_id
      WHERE c.catalog_price > 0 AND w.last_price > 0
        AND ABS(c.catalog_price - w.last_price) / w.last_price * 100 >= w.alert_pct
        AND (w.last_alert_at IS NULL OR w.last_alert_at < NOW() - INTERVAL '20 hours')
      LIMIT 500`);
    for (const row of rows) {
      const oldPx = Number(row.last_price), newPx = Number(row.catalog_price);
      const pct = ((newPx - oldPx) / oldPx) * 100;
      const dir = pct > 0 ? '▲ up' : '▼ down';
      const gradeStr = row.grader && row.grade ? ` ${row.grader} ${row.grade}` : '';
      await notify(pool, row.user_id, 'price_alert',
        `${row.player}${gradeStr} ${dir} ${Math.abs(pct).toFixed(1)}%`,
        `$${oldPx.toLocaleString()} → $${newPx.toLocaleString()} — a card on your watchlist moved.`,
        { cardId: row.card_id });
      await pool.query('UPDATE watchlist SET last_price = $1, last_alert_at = NOW() WHERE id = $2', [newPx, row.id]);
    }
    return rows.length;
  } catch (e) { console.error('price-alert sweep error:', e.message); return 0; }
}

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

      // Winner — create a pending_payment order. The winner must complete
      // payment (Payment Element) within 24h before anything ships; if they
      // don't, the lazy sweep cancels it and the seller can relist.
      const feeBps = await sellerFeeBps(pool, a.seller_id);
      const { order } = await ordersSvc.beginCheckout(r, stripe, {
        listingId: a.id, cardId: a.card_id, buyerId: a.winner_id, sellerId: a.seller_id,
        amount: winningBid, fee: feeFromBps(winningBid, feeBps), feeBps,
        method: a.vault_item_id ? 'vault' : 'direct',
        paymentDueAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
      await pool.query("UPDATE listings SET status = 'sold' WHERE id = $1", [a.id]);
      await pool.query('UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1', [a.id]).catch(() => {});
      // Snapshot the winner's saved shipping address (if any) — they can
      // confirm/replace it in the Complete Payment flow.
      await snapshotOrderAddress(pool, order.id, a.winner_id).catch(() => {});
      await notify(pool, a.winner_id, 'auction_won', `You won: ${a.player} — ${priceStr}`, 'Complete payment within 24h to secure your card — open Orders to pay now.', { listingId: a.id, cardId: a.card_id, orderId: order.id, action: 'complete_payment' });
      const wonTpl = emailTpl.auctionWon({ player: a.player, price: priceStr });
      await emailUser(pool, a.winner_id, wonTpl.subject, wonTpl.html);
      await notify(pool, a.seller_id, 'auction_sold', `Sold: ${a.player} — ${priceStr}`, 'The winner has 24h to pay. You will be notified to ship once payment clears.', { listingId: a.id, cardId: a.card_id, orderId: order.id });
      // Badge sweep: Gavel Down for the winner, sale badges for the seller
      await checkAndAwardBadges(pool, a.winner_id).catch(() => {});
      await checkAndAwardBadges(pool, a.seller_id).catch(() => {});
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
    // Short CDN cache absorbs poll traffic (10s clients) without staling bids
    res.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=20');
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

    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    if (!(await flagEnabled(pool, 'auctions'))) return res.status(503).json({ error: 'New auctions are temporarily disabled' });
    const { cardId, startingBid, reservePrice, durationHours = 24 } = req.body;
    if (!cardId) return res.status(400).json({ error: 'cardId required' });
    if (!startingBid || Number(startingBid) < 0.01) return res.status(400).json({ error: 'Starting bid must be at least $0.01' });

    // Verify card exists
    const { rows: [card] } = await pool.query('SELECT id, player FROM cards WHERE id = $1', [cardId]);
    if (!card) return res.status(404).json({ error: 'Card not found' });

    // Anti-scam: auctioning requires a verified portfolio item for this card
    const verifyErr = await requireVerifiedItem(pool, req.userId, cardId);
    if (verifyErr) return res.status(403).json({ error: verifyErr, code: 'VERIFY_REQUIRED' });
    const frictionErr = await newAccountListingGuard(pool, req.userId, Math.round(Number(startingBid) * 100));
    if (frictionErr) return res.status(403).json({ error: frictionErr, code: 'NEW_ACCOUNT_LIMIT' });

    const durationMs = Math.max(1, Math.min(168, Number(durationHours) || 24)) * 3600 * 1000;
    const endsAt = new Date(Date.now() + durationMs).toISOString();
    const priceInCents = Math.round(Number(startingBid) * 100);
    const reserveInCents = reservePrice ? Math.round(Number(reservePrice) * 100) : null;

    const { rows: [listing] } = await pool.query(`
      INSERT INTO listings (card_id, seller_id, kind, price, reserve_price, currency, status, ends_at, created_at)
      VALUES ($1, $2, 'auction', $3, $4, 'USD', 'active', $5, NOW())
      RETURNING id
    `, [cardId, req.userId, priceInCents, reserveInCents, endsAt]);

    await notifyWatchersOfListing(pool, { id: listing.id, card_id: cardId, price: priceInCents }, req.userId);
    res.json({ success: true, listingId: listing.id, endsAt, player: card.player });
  } catch (e) {
    console.error('auctions/create error:', e.message);
    res.status(500).json({ error: 'Failed to create auction' });
  }
});

app.post('/api/auctions/:id/bid', requireAuth, limitBids, async (req, res) => {
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

    // First-bid badge sweep (post-commit; awaited — serverless kills fire-and-forget)
    await checkAndAwardBadges(pool, req.userId).catch(() => {});

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
      SELECT l.id, l.price, l.kind, l.created_at, l.seller_id, u.handle AS seller_handle,
             EXISTS (SELECT 1 FROM portfolios p
                     WHERE p.user_id = l.seller_id AND p.card_id = l.card_id
                       AND p.verification_status = 'verified') AS verified
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
        seller_id: l.seller_id,
        seller_handle: l.seller_handle || 'seller',
        open_to_offers: true,
        verified: !!l.verified,
        created_at: l.created_at,
      })),
    });
  } catch (e) {
    console.error('listings/for-card error:', e.message);
    res.json({ listings: [] });
  }
});

// ── Pre-sale Q&A on listings ─────────────────────────────────────
// Buyers ask public questions on a listing; the seller answers. Q&A is
// visible to everyone on the card detail (queried per card across listings).
let _listingQReady = false;
async function ensureListingQTable(pool) {
  if (_listingQReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listing_questions (
      id BIGSERIAL PRIMARY KEY,
      listing_id uuid NOT NULL,
      asker_id uuid NOT NULL,
      question TEXT NOT NULL,
      answer TEXT,
      answered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_listing_q_listing ON listing_questions (listing_id, created_at DESC)').catch(() => {});
  _listingQReady = true;
}

// Public: all Q&A for a card (across its listings), answered first-class.
app.get('/api/cards/:cardId/questions', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ questions: [] });
    await ensureListingQTable(pool);
    const { rows } = await pool.query(`
      SELECT q.id, q.listing_id, q.question, q.answer, q.answered_at, q.created_at,
             ua.handle AS asker_handle, us.handle AS seller_handle, l.seller_id, l.status AS listing_status
      FROM listing_questions q
      JOIN listings l ON l.id = q.listing_id
      LEFT JOIN users ua ON ua.id = q.asker_id
      LEFT JOIN users us ON us.id = l.seller_id
      WHERE l.card_id = $1
      ORDER BY q.created_at DESC LIMIT 50`, [req.params.cardId]);
    res.json({ questions: rows });
  } catch (e) { res.json({ questions: [] }); }
});

// Ask (auth, rate-limited, 500 chars). Notifies + emails the seller.
app.post('/api/listings/:id/questions', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureListingQTable(pool);
    const question = String(req.body?.question || '').trim().slice(0, 500);
    if (question.length < 5) return res.status(400).json({ error: 'Question is too short' });
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    const { rows: [l] } = await pool.query(
      `SELECT l.id, l.seller_id, l.status, c.player FROM listings l JOIN cards c ON c.id = l.card_id WHERE l.id = $1`,
      [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.status !== 'active') return res.status(400).json({ error: 'This listing is no longer active' });
    if (l.seller_id === req.userId) return res.status(400).json({ error: 'You can\u2019t ask a question on your own listing' });
    if (await isBlockedEitherWay(pool, req.userId, l.seller_id)) return res.status(403).json({ error: 'You can\u2019t interact with this seller' });
    const { rows: [row] } = await pool.query(
      'INSERT INTO listing_questions (listing_id, asker_id, question) VALUES ($1, $2, $3) RETURNING id, created_at',
      [l.id, req.userId, question]);
    await notify(pool, l.seller_id, 'listing_question', `New question on ${l.player}`,
      question.slice(0, 140), { listingId: l.id, questionId: row.id });
    const tpl = emailTpl.questionReceived({ player: l.player, question });
    await emailUser(pool, l.seller_id, tpl.subject, tpl.html);
    res.json({ ok: true, id: row.id });
  } catch (e) {
    console.error('listing question error:', e.message);
    res.status(500).json({ error: 'Failed to post question' });
  }
});

// Answer (seller only, 1000 chars). Notifies the asker.
app.post('/api/questions/:id/answer', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureListingQTable(pool);
    const answer = String(req.body?.answer || '').trim().slice(0, 1000);
    if (!answer) return res.status(400).json({ error: 'Answer required' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const { rows: [q] } = await pool.query(`
      SELECT q.id, q.asker_id, q.answer AS existing, l.seller_id, l.card_id, c.player
      FROM listing_questions q JOIN listings l ON l.id = q.listing_id JOIN cards c ON c.id = l.card_id
      WHERE q.id = $1`, [id]);
    if (!q) return res.status(404).json({ error: 'Question not found' });
    if (q.seller_id !== req.userId) return res.status(403).json({ error: 'Only the seller can answer' });
    await pool.query('UPDATE listing_questions SET answer = $1, answered_at = NOW() WHERE id = $2', [answer, id]);
    await notify(pool, q.asker_id, 'question_answered', `The seller answered your question on ${q.player}`,
      answer.slice(0, 140), { cardId: q.card_id, questionId: id });
    res.json({ ok: true });
  } catch (e) {
    console.error('answer question error:', e.message);
    res.status(500).json({ error: 'Failed to post answer' });
  }
});

// ── Seller trust signals ─────────────────────────────────────────
// Public per-seller stats: completed sales, avg ship time, dispute record.
// Only surfaced when the seller has ≥1 completed sale (no zero-shaming).
// Cached in-memory 10 min per seller — cheap and good enough.
const _sellerStatsCache = new Map();
app.get('/api/sellers/:id/stats', async (req, res) => {
  try {
    const sellerId = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(sellerId)) return res.status(400).json({ error: 'Invalid seller id' });
    const hit = _sellerStatsCache.get(sellerId);
    if (hit && hit.expires > Date.now()) return res.json(hit.data);
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ hasStats: false });
    const { rows: [s] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE seller_id = $1 AND status = 'settled') AS completed_sales,
        (SELECT AVG(EXTRACT(EPOCH FROM (sh.shipped_at - o.created_at)) / 3600.0)
           FROM shipments sh JOIN orders o ON o.id = sh.order_id
          WHERE o.seller_id = $1 AND sh.shipped_at IS NOT NULL) AS avg_ship_hours,
        (SELECT COUNT(*) FROM disputes d JOIN orders o ON o.id = d.order_id
          WHERE o.seller_id = $1) AS dispute_count`, [sellerId]);
    const completedSales = Number(s?.completed_sales) || 0;
    let data;
    if (completedSales < 1) {
      data = { hasStats: false };
    } else {
      const disputeCount = Number(s.dispute_count) || 0;
      const avgShipHours = s.avg_ship_hours != null ? Math.round(Number(s.avg_ship_hours) * 10) / 10 : null;
      data = {
        hasStats: true,
        completedSales,
        avgShipHours,
        avgShipLabel: avgShipHours == null ? null
          : avgShipHours <= 24 ? 'Ships within a day'
          : avgShipHours <= 48 ? 'Ships within 2 days'
          : `Ships in ~${Math.round(avgShipHours / 24)} days`,
        disputeCount,
        disputeRate: Math.round((disputeCount / completedSales) * 1000) / 10, // percent, 1dp
        disputeFree: disputeCount === 0,
      };
    }
    _sellerStatsCache.set(sellerId, { data, expires: Date.now() + 10 * 60 * 1000 });
    res.json(data);
  } catch (e) {
    console.error('seller stats error:', e.message);
    res.json({ hasStats: false });
  }
});

// ── Referrals ──────────────────────────────────────────────────────
// Each user gets a short shareable code; /r/[code] stores it client-side and
// signup attributes the referral (recorded in src/routes/auth.js register).
// No monetary rewards yet — just attribution + counts.
let _refTablesReady = false;
async function ensureReferralTables(pool) {
  if (_refTablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      user_id uuid PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      referred_id uuid PRIMARY KEY,
      referrer_id uuid NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_id)').catch(() => {});
  _refTablesReady = true;
}

app.get('/api/referrals/me', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureReferralTables(pool);
    let { rows: [rc] } = await pool.query('SELECT code FROM referral_codes WHERE user_id = $1', [req.userId]);
    if (!rc) {
      const { rows: [u] } = await pool.query('SELECT handle FROM users WHERE id = $1', [req.userId]);
      const base = String(u?.handle || 'collector').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'collector';
      // Retry on the (unlikely) code collision — 4 random base36 chars.
      for (let i = 0; i < 5 && !rc; i++) {
        const code = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        const ins = await pool.query(
          'INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING code',
          [req.userId, code]);
        if (ins.rowCount) rc = ins.rows[0];
      }
      if (!rc) return res.status(500).json({ error: 'Could not generate code' });
    }
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = $1', [req.userId]);
    res.json({ code: rc.code, url: `https://gemlinecards.com/r/${rc.code}`, count: Number(count) });
  } catch (e) {
    console.error('referrals/me error:', e.message);
    res.status(500).json({ error: 'Failed to load referrals' });
  }
});

// ── Store / seller reviews ───────────────────────────────────────
// Buyers with a settled order can leave one 1–5★ review per order.
let _reviewTableReady = false;
async function ensureReviewTable(pool) {
  if (_reviewTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seller_reviews (
      id BIGSERIAL PRIMARY KEY,
      order_id uuid NOT NULL UNIQUE,
      reviewer_id uuid NOT NULL,
      seller_id uuid NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_seller_reviews_seller ON seller_reviews (seller_id, created_at DESC)').catch(() => {});
  _reviewTableReady = true;
}

// Public: avg + count + recent reviews for a seller.
app.get('/api/sellers/:id/reviews', async (req, res) => {
  try {
    const sellerId = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(sellerId)) return res.status(400).json({ error: 'Invalid seller id' });
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ avg: null, count: 0, reviews: [] });
    await ensureReviewTable(pool);
    const [aggRes, listRes] = await Promise.all([
      pool.query('SELECT AVG(rating) AS avg, COUNT(*) AS count FROM seller_reviews WHERE seller_id = $1', [sellerId]),
      pool.query(`
        SELECT sr.id, sr.rating, sr.body, sr.created_at, u.handle AS reviewer_handle, c.player
        FROM seller_reviews sr
        LEFT JOIN users u ON u.id = sr.reviewer_id
        LEFT JOIN orders o ON o.id = sr.order_id
        LEFT JOIN cards c ON c.id = o.card_id
        WHERE sr.seller_id = $1 ORDER BY sr.created_at DESC LIMIT 20`, [sellerId]),
    ]);
    const count = Number(aggRes.rows[0]?.count) || 0;
    res.json({
      avg: count > 0 ? Math.round(Number(aggRes.rows[0].avg) * 10) / 10 : null,
      count,
      reviews: listRes.rows,
    });
  } catch (e) { res.json({ avg: null, count: 0, reviews: [] }); }
});

// Leave a review — buyer of a settled order with this seller, one per order.
app.post('/api/sellers/:id/reviews', requireAuth, limitWrites, async (req, res) => {
  try {
    const sellerId = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(sellerId)) return res.status(400).json({ error: 'Invalid seller id' });
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureReviewTable(pool);
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1–5' });
    const body = String(req.body?.body || '').trim().slice(0, 1000);
    const orderId = String(req.body?.orderId || '');
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return res.status(400).json({ error: 'orderId required' });
    const { rows: [order] } = await pool.query(
      'SELECT id, buyer_id, seller_id, status FROM orders WHERE id = $1', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyer_id !== req.userId) return res.status(403).json({ error: 'Only the buyer can review this order' });
    if (order.seller_id !== sellerId) return res.status(400).json({ error: 'Order is not with this seller' });
    if (order.status !== 'settled') return res.status(400).json({ error: 'You can review once the order completes' });
    const ins = await pool.query(`
      INSERT INTO seller_reviews (order_id, reviewer_id, seller_id, rating, body)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (order_id) DO NOTHING RETURNING id`,
      [orderId, req.userId, sellerId, rating, body]);
    if (ins.rowCount === 0) return res.status(400).json({ error: 'You already reviewed this order' });
    await notify(pool, sellerId, 'review_received', `New ${rating}★ review`,
      body.slice(0, 140) || 'A buyer rated their purchase.', { orderId, rating });
    res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) {
    console.error('seller review error:', e.message);
    res.status(500).json({ error: 'Failed to post review' });
  }
});

// ── Portfolio verification (anti-scam) ───────────────────────────────────
// Tracking a card is frictionless; SELLING requires verification. Two paths:
//  • scan  — photograph the physical card; AI vision must match the claimed card
//  • cert  — graded slabs: store the cert number. Verified instantly only when a
//            PSA_API_TOKEN is configured (publicapi lookup); otherwise 'pending'.
const VERIFY_REQUIRED_MSG = 'Verify this card before listing — scan it or add its cert';

const vTokens = (s) => String(s || '').toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // é → e (Pokémon)
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
// Words that carry no set identity (“Pokémon Trading Card Game” ≈ unreadable set)
const GENERIC_SET_WORDS = new Set(['pokemon', 'trading', 'card', 'cards', 'game', 'tcg', 'the', 'series']);
function tokenOverlap(a, b) {
  const ta = vTokens(a); const tb = new Set(vTokens(b));
  if (!ta.length || !tb.size) return 0;
  return ta.filter(t => tb.has(t)).length;
}
// Scan result vs claimed card: player must match; year/set must not contradict.
function scanMatchesCard(scan, card) {
  const playerHits = tokenOverlap(card.player, scan.player);
  const playerTok = vTokens(card.player).length;
  if (playerHits < Math.min(2, playerTok)) return { ok: false, reason: `Scan shows “${scan.player || 'unknown'}” — doesn’t match ${card.player}` };
  const cardYear = String(card.year || card.card_set || '').match(/(19|20)\d{2}/)?.[0];
  const scanYear = String(scan.year || '').match(/(19|20)\d{2}/)?.[0];
  if (cardYear && scanYear && Math.abs(Number(cardYear) - Number(scanYear)) > 1) {
    return { ok: false, reason: `Scan shows a ${scanYear} card — this item is ${cardYear}` };
  }
  // Card number is a strong identity signal — an exact number match plus the
  // player/year checks above outweighs a fuzzy set-name read.
  const numNorm = (v) => String(v || '').toLowerCase().replace(/[^0-9a-z]/g, '');
  const numberMatches = card.number && scan.cardNumber &&
    (numNorm(scan.cardNumber) === numNorm(card.number) ||
     numNorm(scan.cardNumber).startsWith(numNorm(card.number)) ||
     numNorm(scan.cardNumber).split(/(?=\D)/)[0] === numNorm(card.number));
  const scanSetInformative = vTokens(scan.set).some(t => !GENERIC_SET_WORDS.has(t));
  if (!numberMatches && scanSetInformative &&
      card.card_set && scan.set && tokenOverlap(card.card_set, scan.set) === 0 && tokenOverlap(scan.set, card.card_set) === 0) {
    return { ok: false, reason: `Scan shows “${scan.set}” — doesn’t match ${card.card_set}` };
  }
  // Grade fraud guard: a graded item must be scanned as the SLAB — a raw copy
  // of the same card must not verify a PSA 10 claim (huge price difference).
  const cardGrader = String(card.grader || '').toUpperCase();
  const isSlab = cardGrader && cardGrader !== 'RAW';
  if (isSlab) {
    const scanGrader = String(scan.grader || '').toUpperCase();
    if (!scanGrader) return { ok: false, reason: `This item is a ${cardGrader} ${card.grade || ''} slab — scan the graded slab, not a raw card`.trim() };
    if (scanGrader !== cardGrader) return { ok: false, reason: `Scan shows a ${scanGrader} slab — this item is ${cardGrader} ${card.grade || ''}`.trim() };
    if (card.grade && scan.grade && String(scan.grade).trim() !== String(card.grade).trim()) {
      return { ok: false, reason: `Scan shows ${scanGrader} ${scan.grade} — this item is ${cardGrader} ${card.grade}` };
    }
  }
  return { ok: true };
}

// New-account marketplace friction: accounts <24h old are capped at 3 active
// listings and $500 total list value.
const NEW_ACCOUNT_HOURS = 24;
const NEW_ACCOUNT_MAX_LISTINGS = 3;
const NEW_ACCOUNT_MAX_VALUE_CENTS = 500 * 100;
async function newAccountListingGuard(pool, userId, addCents) {
  const { rows: [u] } = await pool.query('SELECT created_at FROM users WHERE id = $1', [userId]);
  if (!u || Date.now() - new Date(u.created_at).getTime() > NEW_ACCOUNT_HOURS * 3600_000) return null;
  const { rows: [agg] } = await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(price), 0)::bigint AS total
     FROM listings WHERE seller_id = $1 AND status = 'active'`, [userId]);
  if (agg.n >= NEW_ACCOUNT_MAX_LISTINGS)
    return `New accounts can have up to ${NEW_ACCOUNT_MAX_LISTINGS} active listings in their first 24 hours`;
  if (Number(agg.total) + (addCents || 0) > NEW_ACCOUNT_MAX_VALUE_CENTS)
    return 'New accounts can list up to $500 total in their first 24 hours';
  return null;
}

// Requires a VERIFIED portfolio item owned by userId for cardId. Returns an
// error string or null.
async function requireVerifiedItem(pool, userId, cardId) {
  const { rows } = await pool.query(
    `SELECT verification_status FROM portfolios WHERE user_id = $1 AND card_id = $2`,
    [userId, cardId]);
  if (!rows.length) return 'Add this card to your portfolio and verify it before listing — scan it or add its cert';
  if (!rows.some(r => r.verification_status === 'verified')) return VERIFY_REQUIRED_MSG;
  return null;
}

// POST /api/portfolio/:id/verify-scan — photograph the physical card; the AI
// vision read must match the claimed card. Shares the AI budget buckets.
app.post('/api/portfolio/:id/verify-scan', requireAuth, rateLimit({ max: 20, windowMs: 60_000 }), limitAI, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const { rows: [item] } = await pool.query(`
      SELECT p.id, p.user_id, p.verification_status,
             c.player, c.card_set, c.year, c.grader, c.grade, c.variant
      FROM portfolios p JOIN cards c ON c.id = p.card_id
      WHERE p.id = $1`, [req.params.id]);
    if (!item || item.user_id !== req.userId) return res.status(404).json({ error: 'Portfolio item not found' });

    const scan = await analyzeCardImage(req.body?.image);
    const match = scanMatchesCard(scan, item);
    if (!match.ok) return res.status(422).json({ verified: false, error: match.reason, scan });

    await pool.query(
      `UPDATE portfolios SET verification_status = 'verified', verification_method = 'scan', verified_at = NOW() WHERE id = $1`,
      [item.id]);
    res.json({ verified: true, method: 'scan', scan });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('verify-scan:', e.message);
    res.status(e.status || 500).json({ verified: false, error: e.message });
  }
});

// POST /api/portfolio/:id/verify-cert — graded slabs: store the cert number.
// Instant verification only via PSA publicapi lookup (PSA_API_TOKEN); until
// that token exists this stores the cert and marks the item 'pending' review.
app.post('/api/portfolio/:id/verify-cert', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const cert = String(req.body?.certNumber || '').trim();
    if (!/^[A-Za-z0-9-]{5,20}$/.test(cert)) return res.status(400).json({ error: 'Enter a valid cert number (5-20 letters/digits)' });
    const { rows: [item] } = await pool.query(`
      SELECT p.id, p.user_id, c.player, c.grader
      FROM portfolios p JOIN cards c ON c.id = p.card_id
      WHERE p.id = $1`, [req.params.id]);
    if (!item || item.user_id !== req.userId) return res.status(404).json({ error: 'Portfolio item not found' });

    // PSA public API lookup — fully gated on PSA_API_TOKEN (no-op until set)
    if (process.env.PSA_API_TOKEN && String(item.grader || '').toUpperCase() === 'PSA') {
      try {
        const psaRes = await fetch(`https://api.psacard.com/publicapi/cert/GetByCertNumber/${encodeURIComponent(cert)}`, {
          headers: { Authorization: `bearer ${process.env.PSA_API_TOKEN}` },
        });
        if (psaRes.ok) {
          const psa = await psaRes.json();
          const subject = psa?.PSACert?.Subject || psa?.PSACert?.subject || '';
          if (subject && tokenOverlap(item.player, subject) >= 1) {
            await pool.query(
              `UPDATE portfolios SET cert_number = $1, verification_status = 'verified', verification_method = 'cert', verified_at = NOW() WHERE id = $2`,
              [cert, item.id]);
            return res.json({ verified: true, method: 'cert', psaSubject: subject });
          }
          if (subject) return res.status(422).json({ verified: false, error: `PSA cert ${cert} is “${subject}” — doesn’t match ${item.player}` });
        }
      } catch (e) { console.error('PSA lookup failed (falling back to pending):', e.message); }
    }

    await pool.query(
      `UPDATE portfolios SET cert_number = $1, verification_status = 'pending', verification_method = 'cert' WHERE id = $2 AND verification_status <> 'verified'`,
      [cert, item.id]);
    res.json({ verified: false, status: 'pending', message: 'Cert saved — pending review. Scan the card for instant verification.' });
  } catch (e) {
    console.error('verify-cert:', e.message);
    res.status(500).json({ error: 'Failed to save cert' });
  }
});

// ── Collection CSV — "bring your binder" ──────────────────────────────
// Export: one-click CSV of the signed-in user's collection.
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
app.get('/api/collection/export', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'no db' });
    const { rows } = await pool.query(`
      SELECT c.player, c.card_set, c.year, c.number, c.variant, c.grader, c.grade,
             p.purchase_price, c.catalog_price, p.cert_number, p.notes, p.acquired_at,
             (SELECT MIN(l.price) FROM listings l WHERE l.card_id = c.id AND l.status = 'active' AND l.kind = 'buy_now') AS ask_cents
      FROM portfolios p JOIN cards c ON c.id = p.card_id
      WHERE p.user_id = $1
      ORDER BY c.catalog_price DESC NULLS LAST`, [req.userId]);
    const header = 'player,set,year,number,variant,grader,grade,qty,paid_price,current_value,cert_number,notes';
    const lines = rows.map(x => [
      x.player, x.card_set, x.year, x.number, x.variant,
      (x.grader || 'RAW'), x.grade, 1,
      x.purchase_price != null ? Number(x.purchase_price).toFixed(2) : '',
      x.ask_cents != null ? (Number(x.ask_cents) / 100).toFixed(2) : (x.catalog_price != null ? Number(x.catalog_price).toFixed(2) : ''),
      x.cert_number, x.notes,
    ].map(csvCell).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="gemline-collection-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header, ...lines].join('\r\n'));
  } catch (e) {
    console.error('collection/export:', e.message);
    res.status(500).json({ error: 'export failed' });
  }
});

// Import step 1 — match a chunk of parsed CSV rows against the catalog.
// Client sends ≤150 rows per call (wizard chunks + shows progress); nothing
// is written here. Same tokenized-AND semantics as market search + tier pick
// like cardResolve: grader+grade → the right grade-tier row.
const normGraderIn = (g) => {
  const v = String(g || '').trim().toUpperCase();
  if (!v || v === 'RAW' || v === 'UNGRADED' || v === 'NONE') return 'RAW';
  return v;
};
app.post('/api/collection/import/match', requireAuth, rateLimit({ max: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'no db' });
    const rowsIn = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 150) : [];
    const SEARCH_EXPR = `(coalesce(player,'') || ' ' || coalesce(card_set,'') || ' ' || coalesce(variant,'') || ' ' || coalesce(year,''))`;
    const out = [];
    for (const row of rowsIn) {
      const player = String(row.player || '').trim().slice(0, 80);
      const set = String(row.set || '').trim().slice(0, 120);
      const year = String(row.year || '').trim().slice(0, 8);
      const number = String(row.number || '').trim().replace(/^#/, '').slice(0, 20);
      const variant = String(row.variant || '').trim().slice(0, 80);
      const grader = normGraderIn(row.grader);
      const grade = String(row.grade || '').trim().slice(0, 12);
      if (!player) { out.push({ status: 'unmatched', reason: 'no player name' }); continue; }

      // Tokenized AND over the indexed search expression (number handled as a rank boost)
      const tokens = [...player.split(/\s+/), ...set.split(/\s+/), year].map(t => t.trim()).filter(t => t.length > 1).slice(0, 8);
      const params = [];
      const conds = tokens.map(t => { params.push(`%${t}%`); return `${SEARCH_EXPR} ILIKE $${params.length}`; });
      if (!conds.length) { out.push({ status: 'unmatched', reason: 'not enough info' }); continue; }
      params.push(number || null); const numIdx = params.length;
      params.push(variant ? `%${variant}%` : null); const varIdx = params.length;
      let { rows: cands } = await pool.query(`
        SELECT id, player, card_set, year, variant, number, sport, grader, grade,
               catalog_price, cardhedge_id, ebay_thumb, image_url, sales_30d,
               (COALESCE(number,'') = COALESCE($${numIdx}, '\u0001'))::int AS num_hit,
               (CASE WHEN $${varIdx}::text IS NOT NULL AND variant ILIKE $${varIdx} THEN 1 ELSE 0 END) AS var_hit
        FROM cards WHERE ${conds.join(' AND ')}
        ORDER BY num_hit DESC, var_hit DESC, (catalog_price IS NOT NULL AND catalog_price > 0) DESC,
                 sales_30d DESC NULLS LAST
        LIMIT 30`, params);
      // Player-only fallback — set names in binder CSVs rarely match ours exactly
      if (!cands.length) {
        const pParams = player.split(/\s+/).filter(Boolean).slice(0, 4).map(t => `%${t}%`);
        const pConds = pParams.map((_, i) => `player ILIKE $${i + 1}`);
        pParams.push(number || null);
        ({ rows: cands } = await pool.query(`
          SELECT id, player, card_set, year, variant, number, sport, grader, grade,
                 catalog_price, cardhedge_id, ebay_thumb, image_url, sales_30d,
                 (COALESCE(number,'') = COALESCE($${pParams.length}, '\u0001'))::int AS num_hit, 0 AS var_hit
          FROM cards WHERE ${pConds.join(' AND ')}
          ORDER BY num_hit DESC, (catalog_price IS NOT NULL AND catalog_price > 0) DESC, sales_30d DESC NULLS LAST
          LIMIT 30`, pParams));
      }
      if (!cands.length) { out.push({ status: 'unmatched' }); continue; }

      // Group tier rows into families, score each family
      const fams = new Map();
      for (const c of cands) {
        const key = c.cardhedge_id || `${c.player}|${c.card_set}|${c.variant}|${c.number}`;
        if (!fams.has(key)) fams.set(key, []);
        fams.get(key).push(c);
      }
      const scored = [...fams.values()].map(tiers => {
        const f = tiers[0];
        let score = 0;
        if (number && Number(f.num_hit)) score += 3;
        if (variant && Number(f.var_hit)) score += 2;
        if (year && String(f.year || '').includes(year)) score += 1;
        if (f.player.toLowerCase() === player.toLowerCase()) score += 2;
        if (set && f.card_set && f.card_set.toLowerCase().includes(set.toLowerCase())) score += 2;
        return { tiers, f, score };
      }).sort((a, b) => b.score - a.score || (Number(b.f.catalog_price) || 0) - (Number(a.f.catalog_price) || 0));

      // Pick the right grade-tier row inside a family
      const pickTier = (tiers) => {
        if (grader !== 'RAW' || grade) {
          const exact = tiers.find(t =>
            String(t.grader || '').toUpperCase() === grader &&
            (!grade || String(t.grade || '').trim() === grade));
          if (exact) return { row: exact, gradeMatched: true };
        }
        const raw = tiers.find(t => /^(raw)?$/i.test(String(t.grader || '').trim()));
        return { row: raw || tiers[0], gradeMatched: grader === 'RAW' && !!raw };
      };
      const asCandidate = (fam) => {
        const { row, gradeMatched } = pickTier(fam.tiers);
        return {
          cardId: row.id, player: row.player, set: row.card_set, year: row.year,
          variant: row.variant, number: row.number, sport: row.sport,
          grader: row.grader || 'RAW', grade: row.grade || '',
          price: row.catalog_price != null ? Number(row.catalog_price) : null,
          thumbnail: row.ebay_thumb || row.image_url || null,
          gradeMatched,
        };
      };

      const best = scored[0];
      const second = scored[1];
      const maxScore = 3 * (number ? 1 : 0) + 2 * (variant ? 1 : 0) + (year ? 1 : 0) + 4;
      const strong = best.score >= Math.max(4, Math.round(maxScore * 0.6));
      const clearWinner = !second || best.score - second.score >= 2;
      if (strong && clearWinner) {
        out.push({ status: 'matched', confidence: second ? 'high' : 'exact', best: asCandidate(best), candidates: [] });
      } else {
        out.push({
          status: 'ambiguous',
          confidence: 'low',
          best: asCandidate(best),
          candidates: scored.slice(0, 5).map(asCandidate),
        });
      }
    }
    res.json({ results: out });
  } catch (e) {
    console.error('collection/import/match:', e.message);
    res.status(500).json({ error: 'match failed' });
  }
});

// Import step 2 — commit only what the user confirmed on the review screen.
app.post('/api/collection/import/commit', requireAuth, rateLimit({ max: 10, windowMs: 60_000 }), async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'no db' });
    const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 5000) : [];
    if (!items.length) return res.status(400).json({ error: 'nothing to import' });
    const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = [], paids = [], certs = [], notes = [];
    let total = 0;
    for (const it of items) {
      if (!it || !UUIDRE.test(String(it.cardId || ''))) continue;
      const qty = Math.min(25, Math.max(1, parseInt(it.qty) || 1));
      const paid = it.paid != null && it.paid !== '' && isFinite(Number(it.paid)) && Number(it.paid) >= 0 ? Number(it.paid) : null;
      for (let q = 0; q < qty && total < 5000; q++, total++) {
        ids.push(it.cardId);
        paids.push(paid);
        certs.push(it.certNumber ? String(it.certNumber).slice(0, 40) : null);
        notes.push(it.notes ? String(it.notes).slice(0, 300) : 'CSV import');
      }
    }
    if (!ids.length) return res.status(400).json({ error: 'no valid rows' });
    // Only import cards that actually exist — never invent catalog rows here
    const { rows: ins } = await pool.query(`
      INSERT INTO portfolios (id, user_id, card_id, purchase_price, cert_number, notes, is_listed, acquired_at, created_at)
      SELECT gen_random_uuid(), $1, v.card_id::uuid, v.paid::numeric, v.cert, v.note, false, NOW(), NOW()
      FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS v(card_id, paid, cert, note)
      WHERE EXISTS (SELECT 1 FROM cards c WHERE c.id = v.card_id::uuid)
      RETURNING id`, [req.userId, ids, paids.map(p => p == null ? null : String(p)), certs, notes]);
    res.json({ ok: true, imported: ins.length });
  } catch (e) {
    console.error('collection/import/commit:', e.message);
    res.status(500).json({ error: 'import failed' });
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
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    // Shop accounts must carry an active subscription to create NEW listings
    // (existing listings stay live). Individual/collector sellers unaffected.
    const shopGate = await shopListingGate(pool, req.userId);
    if (shopGate) return res.status(402).json({ error: shopGate, code: 'SHOP_SUBSCRIPTION_REQUIRED' });
    let { cardId, price, listingType, openToOffers, description, photos } = req.body || {};
    if (!cardId) return res.status(400).json({ error: 'cardId required' });
    const dollars = Number(price);
    if (!isFinite(dollars) || dollars <= 0) return res.status(400).json({ error: 'Price must be greater than 0' });
    // Accept CardHedge ids from passthrough surfaces — resolve to catalog uuid
    cardId = await resolveCardId(pool, cardId, { grader: req.body?.grader, grade: req.body?.grade });
    if (!cardId) return res.status(404).json({ error: 'Card not found' });
    const { rows: [card] } = await pool.query('SELECT id FROM cards WHERE id = $1', [cardId]);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const cents = toCents(dollars);
    // Anti-scam: selling requires a verified portfolio item for this card
    const verifyErr = await requireVerifiedItem(pool, req.userId, cardId);
    if (verifyErr) return res.status(403).json({ error: verifyErr, code: 'VERIFY_REQUIRED' });
    const frictionErr = await newAccountListingGuard(pool, req.userId, cents);
    if (frictionErr) return res.status(403).json({ error: frictionErr, code: 'NEW_ACCOUNT_LIMIT' });
    const photoUrls = Array.isArray(photos) ? photos.slice(0, 8) : [];
    const { rows: [listing] } = await pool.query(`
      INSERT INTO listings (card_id, seller_id, kind, price, currency, status,
                            open_to_offers, listing_type, description, photo_urls, created_at)
      VALUES ($1, $2, 'buy_now', $3, 'USD', 'active', $4, $5, $6, $7, NOW())
      RETURNING id, card_id, price, status, open_to_offers, listing_type, created_at
    `, [cardId, req.userId, cents, !!openToOffers, listingType || 'buy_now',
        description || null, JSON.stringify(photoUrls)]);
    await notifyWatchersOfListing(pool, { ...listing, card_id: cardId }, req.userId);
    res.json({ ...listing, price: fromCents(listing.price) });
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
      params.push(toCents(dollars)); updates.push(`price = $${params.length}`);
    }
    if (req.body?.openToOffers !== undefined) { params.push(!!req.body.openToOffers); updates.push(`open_to_offers = $${params.length}`); }
    if (req.body?.description !== undefined) { params.push(req.body.description || null); updates.push(`description = $${params.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);
    const { rows: [upd] } = await pool.query(
      `UPDATE listings SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, price, status`, params);
    res.json({ ...upd, price: fromCents(upd.price) });
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

// ── Checkout capture plumbing ─────────────────────────────────────────────────
// Payment windows: direct buys get 30 min (buyer is at the keyboard); auction
// wins and accepted offers get 24 h (buyer gets a notification + Orders CTA).
const BUY_PAYMENT_WINDOW_MS = 30 * 60_000;
const NOTIFIED_PAYMENT_WINDOW_MS = 24 * 3600_000;
const paymentDue = (ms) => new Date(Date.now() + ms).toISOString();

// The buyer's PI actually confirmed — move the order into fulfillment,
// finish listing/portfolio bookkeeping, and tell both parties. Idempotent.
async function finalizePaidOrder(r, stripe, order) {
  if (order.status !== 'pending_payment') return order;
  const pool = r.pool;
  await ordersSvc.finalizePayment(r, stripe, order);
  if (pool) {
    if (order.listing_id) {
      await pool.query("UPDATE listings SET status = 'sold' WHERE id = $1 AND status NOT IN ('sold', 'completed')", [order.listing_id]).catch(() => {});
      await pool.query('UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1', [order.listing_id]).catch(() => {});
    }
    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [order.card_id]).catch(() => ({ rows: [{}] }));
    const amt = `$${(Number(order.amount) / 100).toLocaleString()}`;
    await notify(pool, order.seller_id, 'order_paid',
      `Sold: ${card?.player || 'card'} — ${amt}`,
      order.fulfillment_method === 'vault'
        ? 'Payment captured — the vaulted card transferred to the buyer and your payout is on its way.'
        : 'Payment received and held in escrow. Ship the card to release your payout.',
      { orderId: order.id, cardId: order.card_id, listingId: order.listing_id });
    await notify(pool, order.buyer_id, 'payment_confirmed',
      `Payment confirmed: ${card?.player || 'card'} — ${amt}`,
      order.fulfillment_method === 'vault'
        ? 'Vault transfer complete — the card is yours.'
        : 'Your payment is held in escrow. The seller will ship your card.',
      { orderId: order.id, cardId: order.card_id });
    const soldTpl = emailTpl.orderPaid?.({ player: card?.player || 'your card', amount: amt });
    if (soldTpl) await emailUser(pool, order.seller_id, soldTpl.subject, soldTpl.html);
  }
  return order;
}

// Checkout abandoned, failed, or expired — cancel PI + order and unlock the
// listing so inventory is never stuck behind an unpaid order.
async function cancelCheckout(r, stripe, order, reason) {
  const pool = r.pool;
  const { pi } = await ordersSvc.cancelPendingPayment(r, stripe, order, { reason });
  const listing = order.listing_id ? await r.listings.get(order.listing_id).catch(() => null) : null;
  if (pool && listing) {
    if (listing.kind === 'auction') {
      // The auction already ended — close it out so the seller can relist.
      if (listing.status === 'sold') await pool.query("UPDATE listings SET status = 'completed' WHERE id = $1", [listing.id]).catch(() => {});
      await notify(pool, order.seller_id, 'auction_payment_lapsed',
        'Auction winner did not pay',
        'The winning bidder never completed payment, so the sale was cancelled. You can relist the card anytime.',
        { listingId: listing.id, cardId: order.card_id, orderId: order.id });
    } else if (listing.status === 'sold') {
      // Fixed-price listing — put it back on the market.
      await pool.query("UPDATE listings SET status = 'active' WHERE id = $1", [listing.id]).catch(() => {});
      await pool.query('UPDATE portfolios SET is_listed = true, listing_id = $1 WHERE user_id = $2 AND card_id = $3 AND listing_id IS NULL', [listing.id, order.seller_id, order.card_id]).catch(() => {});
      await pool.query("UPDATE listing_offers SET status = 'expired' WHERE listing_id = $1 AND status = 'accepted'", [listing.id]).catch(() => {});
    }
  }
  if (pool && reason !== 'buyer_cancelled') {
    await notify(pool, order.buyer_id, 'order_cancelled',
      'Order cancelled — payment not completed',
      'Your payment was not completed in time, so the order was cancelled. No charge was made.',
      { orderId: order.id, cardId: order.card_id });
  }
  return pi;
}

// Lazy sweep: pending_payment orders past their window get cancelled and their
// listings unlocked. Throttled to 1/min; runs from order reads + buy attempts.
// (A cron would be strictly better for abandoned carts nobody re-reads — noted
//  in report: add a Vercel cron hitting POST /api/checkout/sweep every ~10min.)
let _lastPendingSweep = 0;
async function expirePendingPayments(r, { force = false } = {}) {
  const pool = r.pool;
  if (!pool) return { expired: 0 };
  const now = Date.now();
  if (!force && now - _lastPendingSweep < 60_000) return { skipped: true };
  _lastPendingSweep = now;
  const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
  const { rows } = await pool.query(
    "SELECT id FROM orders WHERE status = 'pending_payment' AND payment_due_at IS NOT NULL AND payment_due_at < NOW() LIMIT 20");
  let expired = 0;
  for (const row of rows) {
    try {
      const order = await r.orders.get(row.id);
      if (!order || order.status !== 'pending_payment') continue;
      await cancelCheckout(r, stripe, order, 'payment_window_expired');
      expired++;
    } catch (e) { console.error('pending sweep', row.id, e.message); }
  }
  return { expired };
}

// Auto-settle orders whose inspection window lapsed without buyer action —
// this is the "or the inspection window lapses" promise in /fees and the
// legal docs. Runs from the same external sweep cron as payment expiry.
async function settleLapsedInspections(r, stripe) {
  const pool = r.pool;
  if (!pool) return { settled: 0 };
  const { rows } = await pool.query(
    "SELECT id FROM orders WHERE status = 'inspection' AND inspection_ends_at IS NOT NULL AND inspection_ends_at < NOW() LIMIT 10");
  let settled = 0;
  for (const row of rows) {
    try {
      const order = await r.orders.get(row.id);
      if (!order || order.status !== 'inspection') continue;
      await ordersSvc.settle(r, stripe, order);
      const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [order.card_id]).catch(() => ({ rows: [{}] }));
      const amt = `$${(Number(order.amount) / 100).toLocaleString()}`;
      const netStr = `$${((Number(order.amount) - Number(order.platform_fee || 0)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      await notify(pool, order.seller_id, 'order_completed',
        `Sale complete: ${card?.player || 'card'} — ${amt}`,
        'The inspection window closed with no issues reported. Your payout has been released from escrow.',
        { orderId: order.id, cardId: order.card_id });
      await notify(pool, order.buyer_id, 'order_settled',
        `Order complete: ${card?.player || 'card'}`,
        'The inspection window closed — this order is settled. Enjoy the card!',
        { orderId: order.id, cardId: order.card_id });
      const payTpl = emailTpl.payoutReleased({ player: card?.player || 'your card', amount: amt, net: netStr });
      await emailUser(pool, order.seller_id, payTpl.subject, payTpl.html);
      settled++;
    } catch (e) { console.error('inspection sweep', row.id, e.message); }
  }
  return { settled };
}

async function sweepHandler(req, res) {
  try {
    const r = await getRepo();
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const expired = await expirePendingPayments(r, { force: true });
    const inspections = await settleLapsedInspections(r, stripe);
    res.json({ ok: true, ...expired, ...inspections });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
app.post('/api/checkout/sweep', sweepHandler);
app.get('/api/checkout/sweep', sweepHandler); // external cron pinger

// ── Buy a listing directly (CardDetail buy flow) ────────────────────────────
// Creates a pending_payment order + manual-capture PI and returns the PI's
// client_secret — the buyer confirms in the Payment Element before anything
// ships. The listing is locked ('sold') while payment is pending and unlocks
// automatically if the buyer abandons.
app.post('/api/listings/:id/buy', requireAuth, limitMoney, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    let l = await r.listings.get(req.params.id);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.seller_id === req.userId) return res.status(400).json({ error: 'Cannot buy your own listing' });
    if (pool && !(await assertActiveAccount(pool, req.userId, res))) return;

    // If the listing is locked by an expired pending-payment order, free it now.
    if (l.status !== 'active' && pool) {
      const { rows: [stale] } = await pool.query(
        "SELECT id FROM orders WHERE listing_id = $1 AND status = 'pending_payment' AND payment_due_at < NOW() LIMIT 1", [l.id]);
      if (stale) {
        const staleOrder = await r.orders.get(stale.id);
        if (staleOrder) await cancelCheckout(r, stripe, staleOrder, 'payment_window_expired');
        l = await r.listings.get(req.params.id);
      }
    }
    if (l.status !== 'active') return res.status(410).json({ error: 'Listing no longer available' });

    // Atomic lock — loses the race politely if two buyers hit Buy at once.
    if (pool) {
      const { rows } = await pool.query("UPDATE listings SET status = 'sold' WHERE id = $1 AND status = 'active' RETURNING id", [l.id]);
      if (!rows.length) return res.status(410).json({ error: 'Listing no longer available' });
    }

    const method = l.vault_item_id ? 'vault' : 'direct';
    try {
      const feeBps = await sellerFeeBps(pool, l.seller_id);
      const { order, clientSecret, paymentIntentId } = await ordersSvc.beginCheckout(r, stripe, {
        listingId: l.id, cardId: l.card_id, buyerId: req.userId, sellerId: l.seller_id,
        amount: Number(l.price), fee: feeFromBps(Number(l.price), feeBps), feeBps,
        method, paymentDueAt: paymentDue(BUY_PAYMENT_WINDOW_MS),
      });
      // Snapshot the buyer's saved shipping address (if any) onto the order —
      // the payment modal confirms/collects before the card can be paid for.
      if (pool) await snapshotOrderAddress(pool, order.id, req.userId).catch(() => {});
      if (!clientSecret) {
        // No Stripe key (dev/stub) — finalize immediately so local flows still work.
        await finalizePaidOrder(r, stripe, order);
        return res.json({ order, instant: order.status === 'settled' });
      }
      res.json({
        order: { id: order.id, status: order.status, amount: order.amount, platform_fee: order.platform_fee },
        requiresPayment: true,
        payment: {
          orderId: order.id, clientSecret, paymentIntentId,
          amount: Number(order.amount), fee: Number(order.platform_fee),
          expiresAt: order.payment_due_at,
        },
      });
    } catch (e) {
      // Order/PI creation failed after we locked the listing — unlock it.
      if (pool) await pool.query("UPDATE listings SET status = 'active' WHERE id = $1 AND status = 'sold'", [l.id]).catch(() => {});
      throw e;
    }
  } catch (e) {
    console.error('listings/buy error:', e.message);
    res.status(500).json({ error: e.message || 'Purchase failed' });
  }
});

// ── Make an offer on a listing ───────────────────────────────────────────
// -- Checkout: fetch payment info for an existing pending order (resume) --
app.get('/api/orders/:id/payment', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const order = await r.orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyer_id !== req.userId) return res.status(403).json({ error: 'Not your order' });
    if (order.status !== 'pending_payment') {
      return res.json({ status: order.status, requiresPayment: false });
    }
    const escrow = order.escrow_id ? await r.escrow.get(order.escrow_id) : null;
    let clientSecret = null;
    if (escrow?.stripe_payment_intent_id && stripe.retrieve) {
      const pi = await stripe.retrieve(escrow.stripe_payment_intent_id);
      clientSecret = pi.client_secret;
    }
    res.json({
      status: order.status, requiresPayment: true,
      payment: {
        orderId: order.id, clientSecret,
        paymentIntentId: escrow?.stripe_payment_intent_id || null,
        amount: Number(order.amount), fee: Number(order.platform_fee),
        expiresAt: order.payment_due_at,
      },
    });
  } catch (e) {
    console.error('order payment info error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// -- Checkout: buyer-side completion ping (webhook is source of truth, but this
//    finalizes instantly on redirect-back so the UI does not wait on the hook) --
app.post('/api/orders/:id/payment/complete', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const order = await r.orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyer_id !== req.userId) return res.status(403).json({ error: 'Not your order' });
    if (order.status !== 'pending_payment') {
      return res.json({ ok: true, status: order.status });
    }
    // Belt-and-suspenders: if no shipping address was attached during checkout
    // (older client), snapshot the buyer's default saved address now.
    if (!order.shipping_address && r.pool) await snapshotOrderAddress(r.pool, order.id, req.userId).catch(() => {});
    // Trust Stripe, not the client: only finalize if the PI actually succeeded
    // (or is authorized/requires_capture under manual capture).
    const escrow = order.escrow_id ? await r.escrow.get(order.escrow_id) : null;
    if (escrow?.stripe_payment_intent_id && stripe.retrieve) {
      const pi = await stripe.retrieve(escrow.stripe_payment_intent_id);
      if (['succeeded', 'requires_capture', 'processing'].includes(pi.status)) {
        await finalizePaidOrder(r, stripe, order);
        return res.json({ ok: true, status: order.status });
      }
      return res.json({ ok: false, status: order.status, piStatus: pi.status });
    }
    await finalizePaidOrder(r, stripe, order);
    res.json({ ok: true, status: order.status });
  } catch (e) {
    console.error('order payment complete error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// -- Checkout: buyer cancels a pending-payment order (closes the modal) --
app.post('/api/orders/:id/payment/cancel', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const order = await r.orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyer_id !== req.userId) return res.status(403).json({ error: 'Not your order' });
    if (order.status === 'pending_payment') await cancelCheckout(r, stripe, order, 'buyer_cancelled');
    res.json({ ok: true, status: order.status });
  } catch (e) {
    console.error('order payment cancel error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/listings/:id/offer', requireAuth, limitMoney, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const amount = Number(req.body?.amount);
    if (!amount || amount < 0.01) return res.status(400).json({ error: 'Invalid offer amount' });
    const { rows: [l] } = await pool.query("SELECT * FROM listings WHERE id = $1 AND status = 'active'", [req.params.id]);
    if (!l) return res.status(404).json({ error: 'Listing not found' });
    if (l.seller_id === req.userId) return res.status(400).json({ error: 'Cannot offer on your own listing' });
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    if (await isBlockedEitherWay(pool, req.userId, l.seller_id)) return res.status(403).json({ error: 'You can\u2019t make offers on this seller\u2019s listings' });
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
    await ensureCounterCols(pool);
    const base = `
      SELECT o.id, o.listing_id, o.amount, o.status, o.created_at, o.counter_amount, o.countered_at,
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
      counterAmount: o.counter_amount != null ? Number(o.counter_amount) / 100 : null,
      counteredAt: o.countered_at || null,
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

app.post('/api/offers/:id/accept', requireAuth, limitMoney, async (req, res) => {
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

    // Pending-payment order at the offer price (outside tx — order engine
    // manages its own writes). Buyer must complete payment within 24h.
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const offerFeeBps = await sellerFeeBps(pool, offer.seller_id);
    const { order } = await ordersSvc.beginCheckout(r, stripe, {
      listingId: offer.listing_id, cardId: offer.card_id,
      buyerId: offer.buyer_id, sellerId: offer.seller_id,
      amount: Number(offer.amount), fee: feeFromBps(Number(offer.amount), offerFeeBps), feeBps: offerFeeBps,
      method: offer.vault_item_id ? 'vault' : 'direct',
      paymentDueAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
    // Snapshot the buyer's saved shipping address (if any) — confirmed at payment.
    await snapshotOrderAddress(pool, order.id, offer.buyer_id).catch(() => {});

    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [offer.card_id]).catch(() => ({ rows: [{}] }));
    const amt = `$${(Number(offer.amount) / 100).toLocaleString()}`;
    await notify(pool, offer.buyer_id, 'offer_accepted', `Offer accepted: ${card?.player || 'card'} — ${amt}`, 'Complete payment within 24h to secure your card — open Orders to pay now.', { listingId: offer.listing_id, offerId: offer.id, orderId: order.id, action: 'complete_payment' });
    const accTpl = emailTpl.offerAccepted({ player: card?.player || 'card', amount: amt });
    await emailUser(pool, offer.buyer_id, accTpl.subject, accTpl.html);

    // Badge sweep: Deal Maker for the seller (awaited — serverless kills fire-and-forget)
    await checkAndAwardBadges(pool, req.userId).catch(() => {});

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

// ── Counteroffers ──────────────────────────────────────────────────────
let _counterColsReady = false;
async function ensureCounterCols(pool) {
  if (_counterColsReady) return;
  await pool.query('ALTER TABLE listing_offers ADD COLUMN IF NOT EXISTS counter_amount NUMERIC').catch(() => {});
  await pool.query('ALTER TABLE listing_offers ADD COLUMN IF NOT EXISTS countered_at TIMESTAMPTZ').catch(() => {});
  _counterColsReady = true;
}

// Seller counters a pending offer at a new price. One counter per offer —
// the ball moves to the buyer (accept / decline via respond-counter).
app.post('/api/offers/:id/counter', requireAuth, limitMoney, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await ensureCounterCols(pool);
    const amount = Number(req.body?.amount);
    if (!amount || amount < 0.01) return res.status(400).json({ error: 'Invalid counter amount' });
    const { rows: [offer] } = await pool.query(
      `SELECT o.*, l.seller_id, l.card_id, l.price AS listing_price, l.status AS listing_status
       FROM listing_offers o JOIN listings l ON l.id = o.listing_id WHERE o.id = $1`,
      [req.params.id]);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    if (offer.seller_id !== req.userId) return res.status(403).json({ error: 'Not your listing' });
    if (offer.status !== 'pending') return res.status(409).json({ error: 'Offer is no longer pending' });
    if (offer.listing_status !== 'active') return res.status(410).json({ error: 'Listing is no longer active' });
    const cents = Math.round(amount * 100);
    if (cents <= Number(offer.amount)) return res.status(400).json({ error: 'Counter must be higher than the buyer\u2019s offer — accept it instead' });
    await pool.query("UPDATE listing_offers SET status = 'countered', counter_amount = $1, countered_at = NOW() WHERE id = $2", [cents, offer.id]);
    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [offer.card_id]).catch(() => ({ rows: [{}] }));
    await notify(pool, offer.buyer_id, 'offer_countered',
      `Counteroffer: ${card?.player || 'card'} — $${amount.toLocaleString()}`,
      `You offered $${(Number(offer.amount) / 100).toLocaleString()}; the seller countered. Accept or decline in your Offers inbox.`,
      { listingId: offer.listing_id, offerId: offer.id, cardId: offer.card_id });
    res.json({ success: true });
  } catch (e) {
    console.error('offer counter error:', e.message);
    res.status(500).json({ error: 'Counter failed' });
  }
});

// Buyer answers a counteroffer. Accept → pending-payment order at the counter
// price (same manual-capture checkout as a seller accept); decline → closed.
app.post('/api/offers/:id/respond-counter', requireAuth, limitMoney, async (req, res) => {
  const r = await getRepo().catch(() => null);
  const pool = r?.pool;
  if (!pool) return res.status(500).json({ error: 'No database' });
  const accept = req.body?.accept === true;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [offer] } = await client.query(
      `SELECT o.*, l.seller_id, l.card_id, l.status AS listing_status, l.vault_item_id
       FROM listing_offers o JOIN listings l ON l.id = o.listing_id
       WHERE o.id = $1 FOR UPDATE OF o, l`, [req.params.id]);
    if (!offer) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Offer not found' }); }
    if (offer.buyer_id !== req.userId) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your offer' }); }
    if (offer.status !== 'countered') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'No open counteroffer' }); }

    if (!accept) {
      await client.query("UPDATE listing_offers SET status = 'declined' WHERE id = $1", [offer.id]);
      await client.query('COMMIT');
      const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [offer.card_id]).catch(() => ({ rows: [{}] }));
      await notify(pool, offer.seller_id, 'offer_declined',
        `Counter declined: ${card?.player || 'card'}`,
        'The buyer passed on your counteroffer. The listing is still live.',
        { listingId: offer.listing_id, offerId: offer.id });
      return res.json({ success: true });
    }

    if (offer.listing_status !== 'active') { await client.query('ROLLBACK'); return res.status(410).json({ error: 'Listing is no longer active' }); }
    await client.query("UPDATE listing_offers SET status = 'accepted' WHERE id = $1", [offer.id]);
    await client.query("UPDATE listing_offers SET status = 'declined' WHERE listing_id = $1 AND id != $2 AND status IN ('pending','countered')", [offer.listing_id, offer.id]);
    await client.query("UPDATE listings SET status = 'sold' WHERE id = $1", [offer.listing_id]);
    await client.query('UPDATE portfolios SET is_listed = false, listing_id = NULL WHERE listing_id = $1', [offer.listing_id]);
    await client.query('COMMIT');

    const amountCents = Number(offer.counter_amount);
    const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
    const counterFeeBps = await sellerFeeBps(pool, offer.seller_id);
    const { order } = await ordersSvc.beginCheckout(r, stripe, {
      listingId: offer.listing_id, cardId: offer.card_id,
      buyerId: offer.buyer_id, sellerId: offer.seller_id,
      amount: amountCents, fee: feeFromBps(amountCents, counterFeeBps), feeBps: counterFeeBps,
      method: offer.vault_item_id ? 'vault' : 'direct',
      paymentDueAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
    await snapshotOrderAddress(pool, order.id, offer.buyer_id).catch(() => {});

    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [offer.card_id]).catch(() => ({ rows: [{}] }));
    const amt = `$${(amountCents / 100).toLocaleString()}`;
    await notify(pool, offer.seller_id, 'offer_accepted',
      `Counter accepted: ${card?.player || 'card'} — ${amt}`,
      'The buyer took your counteroffer. You\u2019ll be notified to ship once payment clears.',
      { listingId: offer.listing_id, offerId: offer.id, orderId: order.id });
    await notify(pool, offer.buyer_id, 'offer_accepted',
      `Deal agreed: ${card?.player || 'card'} — ${amt}`,
      'Complete payment within 24h to secure your card — open Orders to pay now.',
      { listingId: offer.listing_id, offerId: offer.id, orderId: order.id, action: 'complete_payment' });

    res.json({ success: true, order });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('respond-counter error:', e.message);
    res.status(500).json({ error: e.message || 'Respond failed' });
  } finally {
    client.release();
  }
});

// ── Order messages — buyer↔seller thread per order ───────────────────────
let _msgTableReady = false;
async function ensureMsgTable(pool) {
  if (_msgTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_messages (
      id BIGSERIAL PRIMARY KEY,
      order_id uuid NOT NULL,
      sender_id uuid NOT NULL,
      body TEXT NOT NULL,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_omsg_order ON order_messages (order_id, created_at)').catch(() => {});
  _msgTableReady = true;
}

async function orderParty(pool, orderId, userId) {
  const { rows: [o] } = await pool.query('SELECT id, buyer_id, seller_id, status, card_id, escrow_id, listing_id FROM orders WHERE id = $1', [orderId]);
  if (!o) return { error: 404 };
  if (o.buyer_id !== userId && o.seller_id !== userId) return { error: 403 };
  return { order: o, other: o.buyer_id === userId ? o.seller_id : o.buyer_id };
}

app.get('/api/orders/:id/messages', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ messages: [] });
    await ensureMsgTable(pool);
    const p = await orderParty(pool, req.params.id, req.userId);
    if (p.error) return res.status(p.error).json({ error: p.error === 404 ? 'Order not found' : 'Not your order' });
    const { rows } = await pool.query(`
      SELECT m.id, m.sender_id, m.body, m.read, m.created_at, u.handle AS sender_handle
      FROM order_messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.order_id = $1 ORDER BY m.created_at ASC LIMIT 200`, [req.params.id]);
    // Opening the thread marks the other side's messages as read.
    await pool.query('UPDATE order_messages SET read = TRUE WHERE order_id = $1 AND sender_id != $2 AND read = FALSE', [req.params.id, req.userId]).catch(() => {});
    res.json({
      messages: rows.map(m => ({
        id: m.id, body: m.body, createdAt: m.created_at,
        mine: m.sender_id === req.userId, senderHandle: m.sender_handle || 'user',
      })),
    });
  } catch (e) { res.json({ messages: [] }); }
});

app.post('/api/orders/:id/messages', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureMsgTable(pool);
    const body = String(req.body?.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'Message required' });
    const p = await orderParty(pool, req.params.id, req.userId);
    if (p.error) return res.status(p.error).json({ error: p.error === 404 ? 'Order not found' : 'Not your order' });
    // Open orders still allow messages even between blocked users — but flag nothing; blocks only stop NEW interactions.
    const { rows: [msg] } = await pool.query(
      'INSERT INTO order_messages (order_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, created_at',
      [req.params.id, req.userId, body]);
    // Notify the other party — but don't stack unread pings for the same thread.
    const { rows: [existing] } = await pool.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND type = 'order_message' AND read = FALSE AND data->>'orderId' = $2 LIMIT 1`,
      [p.other, String(req.params.id)]).catch(() => ({ rows: [] }));
    if (!existing) {
      const { rows: [me] } = await pool.query('SELECT handle FROM users WHERE id = $1', [req.userId]).catch(() => ({ rows: [{}] }));
      await notify(pool, p.other, 'order_message',
        `Message from @${me?.handle || 'user'}`,
        body.length > 90 ? body.slice(0, 90) + '…' : body,
        { orderId: req.params.id });
    }
    res.json({ ok: true, id: msg.id, createdAt: msg.created_at });
  } catch (e) {
    console.error('order message error:', e.message);
    res.status(500).json({ error: 'Message failed' });
  }
});

// ── Order cancellation + disputes ─────────────────────────────────────
let _cancelColsReady = false;
async function ensureCancelCols(pool) {
  if (_cancelColsReady) return;
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_requested_by uuid').catch(() => {});
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ').catch(() => {});
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT').catch(() => {});
  _cancelColsReady = true;
}

// Cancel + refund an order whose escrow is still held (PI authorized, never
// captured — the "refund" is an authorization release, no money moved).
async function executeCancel(r, order, { actor, reason }) {
  const pool = r.pool;
  const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
  if (order.escrow_id) {
    const escrow = await r.escrow.get(order.escrow_id);
    if (escrow && escrow.status === 'held') await escrowSvc.refund(r, stripe, escrow);
  }
  const full = await r.orders.get(order.id);
  await transition(r, 'order', full, 'cancelled', { actor, payload: { reason } });
  // Put the listing back on the market (best effort).
  if (order.listing_id) {
    await pool.query("UPDATE listings SET status = 'active' WHERE id = $1 AND status = 'sold'", [order.listing_id]).catch(() => {});
    await pool.query(`UPDATE portfolios SET is_listed = true, listing_id = $1
      WHERE id = (SELECT id FROM portfolios WHERE user_id = $2 AND card_id = $3 AND is_listed = false LIMIT 1)`,
      [order.listing_id, order.seller_id, order.card_id]).catch(() => {});
  }
}

const CANCELLABLE = ['escrow_held', 'awaiting_shipment'];

// Buyer requests cancellation (seller must approve). Seller cancels directly
// (can't fulfill) — immediate, buyer's hold is released.
app.post('/api/orders/:id/cancel-request', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureCancelCols(pool);
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    const p = await orderParty(pool, req.params.id, req.userId);
    if (p.error) return res.status(p.error).json({ error: p.error === 404 ? 'Order not found' : 'Not your order' });
    const order = p.order;
    if (!CANCELLABLE.includes(order.status)) {
      return res.status(409).json({ error: `Order is ${order.status.replace(/_/g, ' ')} — it can\u2019t be cancelled at this stage` });
    }
    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [order.card_id]).catch(() => ({ rows: [{}] }));

    if (req.userId === order.seller_id) {
      // Seller can't fulfill → cancel immediately, release the buyer's hold.
      await executeCancel(r, order, { actor: req.userId, reason: reason || 'seller_cancelled' });
      await notify(pool, order.buyer_id, 'order_cancelled',
        `Order cancelled: ${card?.player || 'card'}`,
        'The seller cancelled this order. Your payment hold has been released — no charge.',
        { orderId: order.id, cardId: order.card_id });
      const ocTpl = emailTpl.orderCancelled({ player: card?.player || 'the card', byWhom: 'seller' });
      await emailUser(pool, order.buyer_id, ocTpl.subject, ocTpl.html);
      return res.json({ success: true, cancelled: true });
    }

    if (order.cancel_requested_by) return res.status(409).json({ error: 'Cancellation already requested' });
    await pool.query('UPDATE orders SET cancel_requested_by = $1, cancel_requested_at = NOW(), cancel_reason = $2 WHERE id = $3',
      [req.userId, reason || null, order.id]);
    await notify(pool, order.seller_id, 'cancel_requested',
      `Cancel request: ${card?.player || 'card'}`,
      `The buyer asked to cancel${reason ? ` — “${reason}”` : ''}. Approve or decline in Portfolio → Orders.`,
      { orderId: order.id, cardId: order.card_id });
    const crTpl = emailTpl.cancelRequested({ player: card?.player || 'the card', reason });
    await emailUser(pool, order.seller_id, crTpl.subject, crTpl.html);
    res.json({ success: true, requested: true });
  } catch (e) {
    console.error('cancel-request error:', e.message);
    res.status(500).json({ error: e.message || 'Cancel request failed' });
  }
});

// Seller answers a buyer's cancel request.
app.post('/api/orders/:id/cancel-respond', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    await ensureCancelCols(pool);
    const approve = req.body?.approve === true;
    const p = await orderParty(pool, req.params.id, req.userId);
    if (p.error) return res.status(p.error).json({ error: p.error === 404 ? 'Order not found' : 'Not your order' });
    const order = p.order;
    if (req.userId !== order.seller_id) return res.status(403).json({ error: 'Only the seller can respond' });
    const { rows: [full] } = await pool.query('SELECT cancel_requested_by FROM orders WHERE id = $1', [order.id]);
    if (!full?.cancel_requested_by) return res.status(409).json({ error: 'No open cancel request' });
    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [order.card_id]).catch(() => ({ rows: [{}] }));

    if (approve) {
      if (!CANCELLABLE.includes(order.status)) return res.status(409).json({ error: `Order is ${order.status} — too late to cancel` });
      await executeCancel(r, order, { actor: req.userId, reason: 'buyer_requested' });
      await notify(pool, order.buyer_id, 'order_cancelled',
        `Cancelled: ${card?.player || 'card'}`,
        'The seller approved your cancellation. Your payment hold has been released — no charge.',
        { orderId: order.id, cardId: order.card_id });
      const oc2Tpl = emailTpl.orderCancelled({ player: card?.player || 'the card', byWhom: 'seller (at your request)' });
      await emailUser(pool, order.buyer_id, oc2Tpl.subject, oc2Tpl.html);
      return res.json({ success: true, cancelled: true });
    }
    await pool.query('UPDATE orders SET cancel_requested_by = NULL, cancel_requested_at = NULL, cancel_reason = NULL WHERE id = $1', [order.id]);
    await notify(pool, order.buyer_id, 'cancel_declined',
      `Cancel declined: ${card?.player || 'card'}`,
      'The seller is proceeding with this order — it will ship as planned.',
      { orderId: order.id, cardId: order.card_id });
    res.json({ success: true, cancelled: false });
  } catch (e) {
    console.error('cancel-respond error:', e.message);
    res.status(500).json({ error: e.message || 'Respond failed' });
  }
});

// Buyer reports a problem after delivery — opens a dispute (admin resolves
// toward refund or seller payout; escrow stays held meanwhile).
app.post('/api/orders/:id/dispute', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'Tell us what\u2019s wrong with the order' });
    const order = await r.orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyer_id !== req.userId) return res.status(403).json({ error: 'Not your purchase' });
    if (!['shipped', 'delivered', 'inspection'].includes(order.status)) {
      return res.status(409).json({ error: `Order is ${order.status} — disputes open after shipment` });
    }
    if (order.status === 'shipped') {
      const shipments = await r.shipments.list({ order_id: order.id });
      const inTransit = shipments.find(s => s.status === 'in_transit') || null;
      await ordersSvc.markDelivered(r, order, inTransit);
    }
    await ordersSvc.dispute(r, order, { openerId: req.userId, reason });
    const { rows: [card] } = await pool.query('SELECT player FROM cards WHERE id = $1', [order.card_id]).catch(() => ({ rows: [{}] }));
    await notify(pool, order.seller_id, 'order_disputed',
      `Dispute opened: ${card?.player || 'card'}`,
      `The buyer reported a problem: “${reason.slice(0, 120)}”. Escrow is on hold while GEMLINE reviews.`,
      { orderId: order.id, cardId: order.card_id });
    await notify(pool, order.buyer_id, 'order_disputed',
      `Dispute opened: ${card?.player || 'card'}`,
      'We\u2019ve paused the seller payout while we review. Watch for updates here.',
      { orderId: order.id, cardId: order.card_id });
    const dsTpl = emailTpl.disputeOpenedSeller({ player: card?.player || 'your card', reason });
    await emailUser(pool, order.seller_id, dsTpl.subject, dsTpl.html);
    const dbTpl = emailTpl.disputeOpenedBuyer({ player: card?.player || 'the card' });
    await emailUser(pool, order.buyer_id, dbTpl.subject, dbTpl.html);
    res.json({ success: true });
  } catch (e) {
    console.error('order dispute error:', e.message);
    res.status(500).json({ error: e.message || 'Dispute failed' });
  }
});

// ── Orders — buyer/seller order book with ship + confirm-receipt lifecycle ────
app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ purchases: [], sales: [] });
    // Lazy sweep: expire stale pending_payment orders on every order read.
    await expirePendingPayments(r).catch(() => {});
    await ensureMsgTable(pool);
    await ensureCancelCols(pool);
    await ensureReviewTable(pool);
    const base = `
      SELECT o.id, o.listing_id, o.card_id, o.buyer_id, o.seller_id, o.amount, o.platform_fee,
             o.fulfillment_method, o.status, o.created_at, o.updated_at, o.inspection_ends_at, o.payment_due_at,
             o.shipping_address, o.cancel_requested_by, o.cancel_requested_at, o.cancel_reason,
             (SELECT COUNT(*) FROM order_messages m WHERE m.order_id = o.id AND m.sender_id != $1 AND m.read = FALSE) AS unread_messages,
             (SELECT COUNT(*) FROM order_messages m2 WHERE m2.order_id = o.id) AS message_count,
             EXISTS (SELECT 1 FROM seller_reviews sr WHERE sr.order_id = o.id) AS reviewed,
             tl.timeline,
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
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('state', e.to_state, 'at', e.created_at) ORDER BY e.created_at) AS timeline
        FROM events e WHERE e.entity_type = 'order' AND e.entity_id = o.id
      ) tl ON true`;
    const [bought, sold] = await Promise.all([
      pool.query(`${base} WHERE o.buyer_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [req.userId]),
      pool.query(`${base} WHERE o.seller_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [req.userId]),
    ]);
    const shape = o => ({
      id: o.id, listingId: o.listing_id, cardId: o.card_id,
      amount: Number(o.amount) / 100, fee: Number(o.platform_fee) / 100,
      status: o.status, method: o.fulfillment_method,
      createdAt: o.created_at, updatedAt: o.updated_at, inspectionEndsAt: o.inspection_ends_at,
      paymentDueAt: o.payment_due_at || null,
      needsPayment: o.status === 'pending_payment',
      player: o.player, set: o.card_set, grader: o.grader, grade: o.grade, year: o.year,
      thumbnail: o.ebay_thumb || o.image_url || null,
      buyerHandle: o.buyer_handle || 'buyer', sellerHandle: o.seller_handle || 'seller',
      sellerId: o.seller_id, reviewed: !!o.reviewed,
      carrier: o.carrier || null, trackingNumber: o.tracking_number || null,
      shippedAt: o.shipped_at || null, deliveredAt: o.ship_delivered_at || null,
      shippingAddress: o.shipping_address || null,
      unreadMessages: Number(o.unread_messages) || 0,
      messageCount: Number(o.message_count) || 0,
      cancelRequestedBy: o.cancel_requested_by || null,
      cancelRequestedAt: o.cancel_requested_at || null,
      cancelReason: o.cancel_reason || null,
      timeline: o.timeline || [],
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
    const netStr = `$${((Number(order.amount) - Number(order.platform_fee || 0)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const payTpl = emailTpl.payoutReleased({ player: card?.player || 'your card', amount: amt, net: netStr });
    await emailUser(pool, order.seller_id, payTpl.subject, payTpl.html);

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

    if (!(await flagEnabled(pool, 'packs'))) return res.status(503).json({ error: 'Pack rips are temporarily disabled' });
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

// ── Seller stats — compact dashboard strip on the sell page ───────────────
app.get('/api/seller/stats', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ activeListings: 0, activeValue: 0, pendingOffers: 0, sold: { count: 0, gross: 0 } });
    const [listings, offers, sold] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(price), 0)::numeric / 100.0 AS v FROM listings WHERE seller_id = $1 AND status = 'active'", [req.userId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM listing_offers o JOIN listings l ON l.id = o.listing_id
                  WHERE l.seller_id = $1 AND o.status IN ('pending', 'countered') AND l.status = 'active'`, [req.userId]).catch(() => ({ rows: [{ n: 0 }] })),
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::bigint AS cents FROM orders
                  WHERE seller_id = $1 AND status NOT IN ('cancelled', 'refunded', 'pending_payment', 'created')`, [req.userId]),
    ]);
    res.json({
      activeListings: listings.rows[0].n,
      activeValue: Number(listings.rows[0].v) || 0,
      pendingOffers: offers.rows[0].n,
      sold: { count: sold.rows[0].n, gross: Number(sold.rows[0].cents) / 100 },
    });
  } catch (e) {
    console.error('seller/stats error:', e.message);
    res.json({ activeListings: 0, activeValue: 0, pendingOffers: 0, sold: { count: 0, gross: 0 } });
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
    // Lazy award sweep — catches milestones reached through flows that don't
    // call checkAndAwardBadges directly (portfolio adds, trades, etc.)
    await checkAndAwardBadges(pool, req.userId);
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
          AND u.handle NOT ILIKE 'queefus%' AND u.handle NOT ILIKE '%test%'
          AND u.suspended_at IS NULL
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
    if (await isBlockedEitherWay(pool, req.userId, req.params.userId)) return res.status(403).json({ error: 'Unavailable' });
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
// Public portfolio by handle
app.get('/api/users/:handle/portfolio', async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ user: null, cards: [] });
    // Find user by handle
    const { rows: [user] } = await pool.query(
      'SELECT id, handle, bio, avatar_url, featured_badges, created_at FROM users WHERE LOWER(handle) = LOWER($1)', [req.params.handle]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Follower counts + portfolio + earned badges + showcase picks — one round-trip batch
    const [fcRes, cardsRes, badgesRes, showcaseRes] = await Promise.all([
      pool.query(
        `SELECT (SELECT COUNT(*) FROM follows WHERE following_id = $1) as follower_count,
                (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following_count,
                (SELECT COUNT(*) FROM orders WHERE seller_id = $1 AND status = 'settled') as sales_count,
                (SELECT COUNT(*) FROM trades WHERE (proposer_id = $1 OR counterparty_id = $1) AND status IN ('accepted','settling','settled')) as trades_count`,
        [user.id]),
      pool.query(`
        SELECT p.id as portfolio_id, p.card_id, p.verification_status, c.player, c.sport, c.card_set, c.grader, c.grade,
               c.catalog_price, c.ebay_thumb, c.image_url, c.variant, c.year
        FROM portfolios p
        JOIN cards c ON c.id = p.card_id
        WHERE p.user_id = $1
        ORDER BY (p.verification_status = 'verified') DESC, c.catalog_price DESC NULLS LAST
      `, [user.id]),
      pool.query(
        `SELECT b.key, b.name, b.emoji, b.tier, b.description, ub.earned_at
         FROM user_badges ub JOIN badges b ON ub.badge_key = b.key
         WHERE ub.user_id = $1 ORDER BY ub.earned_at`, [user.id]),
      pool.query(
        `SELECT card_id FROM user_showcase WHERE user_id = $1 AND type = 'physical' ORDER BY position, added_at LIMIT 5`,
        [user.id]),
    ]);
    const fc = fcRes.rows[0];
    const cards = cardsRes.rows;
    const totalValue = cards.reduce((s, c) => s + (Number(c.catalog_price) || 0), 0);
    const verifiedValue = cards.reduce((s, c) => s + (c.verification_status === 'verified' ? (Number(c.catalog_price) || 0) : 0), 0);
    res.json({
      user: { id: user.id, handle: user.handle, created_at: user.created_at, ...fc, avatar_url: user.avatar_url || null, bio: user.bio || '' },
      cards: cards.map(c => ({
        id: c.card_id, portfolioId: c.portfolio_id, player: c.player, sport: c.sport,
        set: c.card_set, grader: c.grader || 'RAW', grade: c.grade || '',
        price: Number(c.catalog_price) || 0, thumbnail: c.ebay_thumb || c.image_url || null,
        variant: c.variant || '', year: c.year || '',
        verified: c.verification_status === 'verified',
      })),
      // Showcase: the user's picks (≤5). UI falls back to top-5 by
      // verified-first-then-value when empty (cards[] is already sorted so).
      showcaseCardIds: showcaseRes.rows.map(x => x.card_id),
      badges: badgesRes.rows,
      featuredBadges: (user.featured_badges || []).slice(0, 3),
      totalValue,
      verifiedValue,
    });
  } catch (e) { console.error('user portfolio:', e.message); res.json({ user: null, cards: [] }); }
});

// Propose a trade (auth required)
app.post('/api/trades/propose', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { toUserId, offeredCardIds, requestedCardIds, cashOffer, message } = req.body;
    if (!toUserId) return res.status(400).json({ error: 'toUserId required' });
    if (!offeredCardIds?.length && !requestedCardIds?.length) return res.status(400).json({ error: 'Must offer or request at least one card' });
    if (toUserId === req.userId) return res.status(400).json({ error: 'Cannot trade with yourself' });
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    if (!(await flagEnabled(pool, 'trades'))) return res.status(503).json({ error: 'Trades are temporarily disabled' });
    if (await isBlockedEitherWay(pool, req.userId, toUserId)) return res.status(403).json({ error: 'You can\u2019t trade with this user' });
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
      WHERE u.handle NOT ILIKE 'queefus%' AND u.handle NOT ILIKE '%test%'
        AND u.suspended_at IS NULL
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

// Comments live in post_comments (lazy-created). Counts ride along on the feed.
let _communityTablesReady = false;
async function ensureCommunityTables(pool) {
  if (_communityTablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id BIGSERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL,
      user_id uuid NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id, created_at)').catch(() => {});
  _communityTablesReady = true;
}

// GET /api/posts/feed — paginated feed (20/page), JOIN with users for handle/avatar.
// tab=foryou (default: posts + show-floor events) | following (people you follow)
// | latest (pure posts, newest first).
app.get('/api/posts/feed', optionalAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ posts: [], hasMore: false });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const tab = ['foryou', 'following', 'latest'].includes(req.query.tab) ? req.query.tab : 'foryou';
    if (req.userId) await ensureTsTables(pool);
    await ensureCommunityTables(pool);
    if (tab === 'following' && !req.userId) return res.json({ posts: [], hasMore: false, page, needsAuth: true });

    const params = [limit + 1, offset];
    const conds = [];
    if (req.userId) {
      params.push(req.userId); // $3
      conds.push(`NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $3 AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = $3))`);
      if (tab === 'following') conds.push(`p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $3)`);
    }
    const { rows } = await pool.query(`
      SELECT p.id, p.type, p.body, p.likes, p.created_at, p.card_id,
             u.id as user_id, u.handle, u.avatar_url,
             c.player, c.grader, c.grade, c.catalog_price, c.sport, c.ebay_thumb, c.image_url,
             (SELECT COUNT(*)::int FROM post_comments pc WHERE pc.post_id = p.id) AS comment_count,
             ${req.userId ? `EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $3) as user_liked` : `false as user_liked`}
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN cards c ON c.id = p.card_id
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);
    const hasMore = rows.length > limit;
    const posts = rows.slice(0, limit).map(p => ({
      id: p.id,
      type: p.type,
      body: p.body,
      likes: p.likes,
      comments: Number(p.comment_count) || 0,
      userLiked: p.user_liked,
      createdAt: p.created_at,
      user: { id: p.user_id, handle: p.handle, avatarUrl: p.avatar_url },
      card: p.card_id ? {
        id: p.card_id, player: p.player, grader: p.grader, grade: p.grade,
        value: Number(p.catalog_price) || 0, sport: p.sport,
        thumbnail: p.ebay_thumb || p.image_url || null,
      } : null,
    }));

    // ── Show-floor auto-events (For You page 1 only) ──
    // The feed should never look dead: synthesize activity items from real
    // marketplace events (new listings, sales, new members) — read-only, no
    // rows written, test accounts filtered. Rendered read-only client-side.
    if (page === 1 && tab === 'foryou') {
      const notTest = `u.handle NOT ILIKE 'queefus%' AND u.handle NOT ILIKE '%test%'`;
      const [lst, sold, joined] = await Promise.allSettled([
        pool.query(`
          SELECT l.id, l.price, l.created_at, u.handle, c.id AS card_id, c.player,
                 c.grader, c.grade, c.sport, c.catalog_price, c.ebay_thumb, c.image_url
          FROM listings l JOIN users u ON u.id = l.seller_id JOIN cards c ON c.id = l.card_id
          WHERE l.status = 'active' AND l.created_at > now() - interval '30 days' AND ${notTest}
          ORDER BY l.created_at DESC LIMIT 6`),
        pool.query(`
          SELECT o.id, o.amount, o.created_at, u.handle, c.id AS card_id, c.player,
                 c.grader, c.grade, c.sport, c.catalog_price, c.ebay_thumb, c.image_url
          FROM orders o JOIN users u ON u.id = o.seller_id JOIN cards c ON c.id = o.card_id
          WHERE o.status IN ('escrow_held','awaiting_shipment','shipped','delivered','inspection','settled')
            AND o.created_at > now() - interval '30 days' AND ${notTest}
          ORDER BY o.created_at DESC LIMIT 4`),
        pool.query(`
          SELECT u.id, u.handle, u.created_at FROM users u
          WHERE u.created_at > now() - interval '30 days' AND ${notTest} AND u.suspended_at IS NULL
          ORDER BY u.created_at DESC LIMIT 3`),
      ]);
      const cardOf = (r) => ({
        id: r.card_id, player: r.player, grader: r.grader, grade: r.grade,
        value: Number(r.catalog_price) || 0, sport: r.sport,
        thumbnail: r.ebay_thumb || r.image_url || null,
      });
      const usd = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      const events = [];
      if (lst.status === 'fulfilled') for (const r of lst.value.rows) events.push({
        id: `evt-listing-${r.id}`, type: 'listing', activity: true, likes: 0,
        body: `Fresh to the floor — ${r.player} ${`${r.grader || 'RAW'} ${r.grade || ''}`.trim()} listed at ${usd(Number(r.price) / 100)}.`,
        createdAt: r.created_at, user: { handle: r.handle }, card: cardOf(r),
      });
      if (sold.status === 'fulfilled') for (const r of sold.value.rows) events.push({
        id: `evt-sale-${r.id}`, type: 'sale', activity: true, likes: 0,
        body: `SOLD — ${r.player} ${`${r.grader || 'RAW'} ${r.grade || ''}`.trim()} went for ${usd(Number(r.amount) / 100)}.`,
        createdAt: r.created_at, user: { handle: r.handle }, card: cardOf(r),
      });
      if (joined.status === 'fulfilled') for (const r of joined.value.rows) events.push({
        id: `evt-join-${r.id}`, type: 'joined', activity: true, likes: 0,
        body: `@${r.handle} just pulled up a table. Welcome to the show.`,
        createdAt: r.created_at, user: { handle: r.handle }, card: null,
      });
      if (events.length) {
        const merged = [...posts, ...events].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return res.json({ posts: merged, hasMore, page });
      }
    }

    res.json({ posts, hasMore, page });
  } catch (e) { console.error('posts/feed:', e.message); res.json({ posts: [], hasMore: false }); }
});

// POST /api/posts — create a post (auth required)
app.post('/api/posts', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    if (!(await flagEnabled(pool, 'community_posts'))) return res.status(503).json({ error: 'Posting is temporarily disabled' });
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

// GET /api/posts/since?ts=<iso> — count posts newer than ts (drives the
// "N new posts" pill without pulling the whole feed). Cheap COUNT, no cache.
app.get('/api/posts/since', optionalAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ count: 0 });
    const ts = req.query.ts ? new Date(req.query.ts) : null;
    if (!ts || isNaN(ts.getTime())) return res.json({ count: 0 });
    const { rows: [x] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM posts WHERE created_at > $1${req.userId ? ' AND user_id <> $2' : ''}`,
      req.userId ? [ts.toISOString(), req.userId] : [ts.toISOString()]);
    res.json({ count: Number(x.n) || 0 });
  } catch (e) { res.json({ count: 0 }); }
});

// GET /api/posts/:id/comments — newest-last, 100 max
app.get('/api/posts/:id/comments', optionalAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ comments: [] });
    await ensureCommunityTables(pool);
    const postId = parseInt(req.params.id);
    if (!postId) return res.json({ comments: [] });
    const { rows } = await pool.query(`
      SELECT pc.id, pc.body, pc.created_at, u.id AS user_id, u.handle, u.avatar_url
      FROM post_comments pc JOIN users u ON u.id = pc.user_id
      WHERE pc.post_id = $1
      ${req.userId ? 'AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $2 AND b.blocked_id = pc.user_id) OR (b.blocker_id = pc.user_id AND b.blocked_id = $2))' : ''}
      ORDER BY pc.created_at ASC LIMIT 100
    `, req.userId ? [postId, req.userId] : [postId]);
    res.json({ comments: rows.map(c => ({
      id: c.id, body: c.body, createdAt: c.created_at,
      user: { id: c.user_id, handle: c.handle, avatarUrl: c.avatar_url },
    })) });
  } catch (e) { console.error('posts/comments:', e.message); res.json({ comments: [] }); }
});

// POST /api/posts/:id/comments — add a comment (auth required)
app.post('/api/posts/:id/comments', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    if (!(await flagEnabled(pool, 'community_posts'))) return res.status(503).json({ error: 'Commenting is temporarily disabled' });
    await ensureCommunityTables(pool);
    const postId = parseInt(req.params.id);
    if (!postId) return res.status(400).json({ error: 'Invalid post id' });
    const body = (req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Comment body required' });
    if (body.length > 300) return res.status(400).json({ error: 'Comment too long (max 300 chars)' });
    const { rows: [exists] } = await pool.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
    if (!exists) return res.status(404).json({ error: 'Post not found' });
    const { rows: [c] } = await pool.query(
      'INSERT INTO post_comments (post_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, created_at',
      [postId, req.userId, body]);
    const { rows: [user] } = await pool.query('SELECT handle, avatar_url FROM users WHERE id = $1', [req.userId]);
    const { rows: [cnt] } = await pool.query('SELECT COUNT(*)::int AS n FROM post_comments WHERE post_id = $1', [postId]);
    res.json({
      comment: { id: c.id, body, createdAt: c.created_at, user: { id: req.userId, handle: user?.handle, avatarUrl: user?.avatar_url } },
      commentCount: Number(cnt.n) || 0,
    });
  } catch (e) { console.error('posts/comment-create:', e.message); res.status(500).json({ error: 'Failed to comment' }); }
});

// ── Community Groups ──────────────────────────────────────────────────────────
// Collector clubs inside /community. Public groups join instantly, private
// groups take a join request approved by the owner or an admin. Roles: owner
// (exactly one), admin, member. Avatars are emoji + color badges, no uploads.
// Tables live in schema.sql; lazy-create keeps fresh environments working.
let _groupTablesReady = false;
async function ensureGroupTables(pool) {
  if (_groupTablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text UNIQUE NOT NULL,
      slug        text UNIQUE NOT NULL,
      description text NOT NULL DEFAULT '',
      avatar      text NOT NULL DEFAULT '🃏',
      color       text NOT NULL DEFAULT '#16c784',
      privacy     text NOT NULL DEFAULT 'public' CHECK (privacy IN ('public','private')),
      created_by  uuid NOT NULL REFERENCES users(id),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
      joined_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_join_requests (
      id          bigserial PRIMARY KEY,
      group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
      created_at  timestamptz NOT NULL DEFAULT now(),
      resolved_by uuid REFERENCES users(id),
      resolved_at timestamptz
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_posts (
      id         bigserial PRIMARY KEY,
      group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_group_join_pending ON group_join_requests (group_id, user_id) WHERE status = 'pending'`).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_group_posts_group ON group_posts (group_id, created_at DESC)').catch(() => {});
  _groupTablesReady = true;
}

const GROUP_SELECT = `g.id, g.name, g.slug, g.description, g.avatar, g.color, g.privacy, g.created_by, g.created_at,
  (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count`;

function slugifyGroup(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
async function getGroupBySlug(pool, slug) {
  const s = String(slug || '').toLowerCase().slice(0, 80);
  if (!s) return null;
  const { rows: [g] } = await pool.query(`SELECT ${GROUP_SELECT} FROM groups g WHERE g.slug = $1`, [s]);
  return g || null;
}
async function getGroupRole(pool, groupId, userId) {
  if (!userId) return null;
  const { rows: [m] } = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return m?.role || null;
}
const canModerateGroup = (role) => role === 'owner' || role === 'admin';
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
function groupJson(g, extra = {}) {
  return {
    id: g.id, name: g.name, slug: g.slug, description: g.description,
    avatar: g.avatar, color: g.color, privacy: g.privacy,
    memberCount: Number(g.member_count) || 0, createdAt: g.created_at, ...extra,
  };
}
const groupPostJson = (p) => ({
  id: p.id, body: p.body, createdAt: p.created_at,
  user: { id: p.user_id, handle: p.handle, avatarUrl: p.avatar_url },
});

// GET /api/groups — discover directory. ?q= name search, ?sort=members|newest,
// ?tab=mine limits to the caller's groups. Signed-in callers get myRole +
// requested riding along so the UI can render Join / Requested / Joined.
app.get('/api/groups', optionalAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ groups: [] });
    await ensureGroupTables(pool);
    const q = String(req.query.q || '').trim().slice(0, 50);
    const sort = req.query.sort === 'newest' ? 'newest' : 'members';
    const mine = req.query.tab === 'mine';
    if (mine && !req.userId) return res.json({ groups: [], needsAuth: true });
    const params = [];
    const conds = [];
    if (q) { params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`); conds.push(`g.name ILIKE $${params.length}`); }
    if (mine) { params.push(req.userId); conds.push(`EXISTS(SELECT 1 FROM group_members mm WHERE mm.group_id = g.id AND mm.user_id = $${params.length})`); }
    let myCols = '';
    if (req.userId) {
      params.push(req.userId);
      myCols = `, (SELECT role FROM group_members mr WHERE mr.group_id = g.id AND mr.user_id = $${params.length}) AS my_role,
        EXISTS(SELECT 1 FROM group_join_requests jr WHERE jr.group_id = g.id AND jr.user_id = $${params.length} AND jr.status = 'pending') AS my_pending`;
    }
    const { rows } = await pool.query(`
      SELECT ${GROUP_SELECT}${myCols} FROM groups g
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY ${sort === 'newest' ? 'g.created_at DESC' : 'member_count DESC, g.created_at DESC'}
      LIMIT 50`, params);
    res.json({ groups: rows.map(g => groupJson(g, { myRole: g.my_role || null, requested: !!g.my_pending })) });
  } catch (e) { console.error('groups/list:', e.message); res.json({ groups: [] }); }
});

// POST /api/groups — create a group; creator becomes owner.
app.post('/api/groups', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    if (!(await flagEnabled(pool, 'groups'))) return res.status(503).json({ error: 'Groups are temporarily disabled' });
    await ensureGroupTables(pool);
    const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 50) return res.status(400).json({ error: 'Group name must be 3 to 50 characters' });
    const description = String(req.body?.description || '').trim().slice(0, 500);
    const avatar = String(req.body?.avatar || '').trim().slice(0, 8) || '🃏';
    const color = /^#[0-9a-fA-F]{6}$/.test(String(req.body?.color || '')) ? String(req.body.color) : '#16c784';
    const privacy = req.body?.privacy === 'private' ? 'private' : 'public';
    const slug = slugifyGroup(name);
    if (slug.length < 3) return res.status(400).json({ error: 'Group name needs at least 3 letters or numbers' });
    const { rows: [own] } = await pool.query(`SELECT COUNT(*)::int AS n FROM group_members WHERE user_id = $1 AND role = 'owner'`, [req.userId]);
    if (Number(own.n) >= 10) return res.status(400).json({ error: 'You already own 10 groups, that is the limit for now' });
    const { rows: [g] } = await pool.query(`
      INSERT INTO groups (name, slug, description, avatar, color, privacy, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, slug, description, avatar, color, privacy, req.userId]);
    await pool.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [g.id, req.userId]);
    res.json({ group: groupJson({ ...g, member_count: 1 }, { myRole: 'owner', requested: false }) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A group with that name already exists' });
    console.error('groups/create:', e.message);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// GET /api/groups/:slug — detail: info, member count, caller's role, pending
// request state, mod pending count, and recent posts when visible (public
// groups are readable by anyone, private posts are members only).
app.get('/api/groups/:slug', optionalAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(404).json({ error: 'Group not found' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    let requested = false;
    let pendingCount = 0;
    if (req.userId && !myRole) {
      const { rows: [jr] } = await pool.query(`SELECT 1 FROM group_join_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`, [g.id, req.userId]);
      requested = !!jr;
    }
    if (canModerateGroup(myRole)) {
      const { rows: [pc] } = await pool.query(`SELECT COUNT(*)::int AS n FROM group_join_requests WHERE group_id = $1 AND status = 'pending'`, [g.id]);
      pendingCount = Number(pc.n) || 0;
    }
    const canSee = g.privacy === 'public' || !!myRole;
    let posts = [];
    if (canSee) {
      const { rows } = await pool.query(`
        SELECT gp.id, gp.body, gp.created_at, u.id AS user_id, u.handle, u.avatar_url
        FROM group_posts gp JOIN users u ON u.id = gp.user_id
        WHERE gp.group_id = $1 ORDER BY gp.created_at DESC LIMIT 20`, [g.id]);
      posts = rows.map(groupPostJson);
    }
    res.json({ group: groupJson(g, { myRole, requested, pendingCount, canSee }), posts });
  } catch (e) { console.error('groups/detail:', e.message); res.status(500).json({ error: 'Failed to load group' }); }
});

// POST /api/groups/:slug/join — public: instant member. Private: files a join
// request for owner/admin review (idempotent, one pending request per user).
app.post('/api/groups/:slug/join', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    if (!(await flagEnabled(pool, 'groups'))) return res.status(503).json({ error: 'Groups are temporarily disabled' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (myRole) return res.json({ joined: true, myRole });
    if (g.privacy === 'public') {
      await pool.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [g.id, req.userId]);
      return res.json({ joined: true, myRole: 'member' });
    }
    await pool.query(`
      INSERT INTO group_join_requests (group_id, user_id) VALUES ($1, $2)
      ON CONFLICT (group_id, user_id) WHERE status = 'pending' DO NOTHING`, [g.id, req.userId]);
    res.json({ requested: true });
  } catch (e) { console.error('groups/join:', e.message); res.status(500).json({ error: 'Failed to join group' }); }
});

// POST /api/groups/:slug/leave — members and admins can walk away. Owners must
// transfer ownership or delete the group instead.
app.post('/api/groups/:slug/leave', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (!myRole) {
      // Not a member: treat as cancelling a pending join request.
      const { rowCount } = await pool.query(`DELETE FROM group_join_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`, [g.id, req.userId]);
      if (rowCount) return res.json({ left: true, cancelled: true });
      return res.status(400).json({ error: 'You are not a member of this group' });
    }
    if (myRole === 'owner') return res.status(400).json({ error: 'Owners cannot leave. Transfer ownership or delete the group first.' });
    await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [g.id, req.userId]);
    res.json({ left: true });
  } catch (e) { console.error('groups/leave:', e.message); res.status(500).json({ error: 'Failed to leave group' }); }
});

// GET /api/groups/:slug/requests — pending join requests, owner/admin only.
app.get('/api/groups/:slug/requests', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ requests: [] });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (!canModerateGroup(myRole)) return res.status(403).json({ error: 'Only the owner or admins can review requests' });
    const { rows } = await pool.query(`
      SELECT jr.id, jr.created_at, u.id AS user_id, u.handle, u.avatar_url
      FROM group_join_requests jr JOIN users u ON u.id = jr.user_id
      WHERE jr.group_id = $1 AND jr.status = 'pending'
      ORDER BY jr.created_at ASC LIMIT 100`, [g.id]);
    res.json({ requests: rows.map(x => ({ id: x.id, createdAt: x.created_at, user: { id: x.user_id, handle: x.handle, avatarUrl: x.avatar_url } })) });
  } catch (e) { console.error('groups/requests:', e.message); res.json({ requests: [] }); }
});

// POST /api/groups/:slug/requests/:id — approve or deny, owner/admin only.
app.post('/api/groups/:slug/requests/:id', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (!canModerateGroup(myRole)) return res.status(403).json({ error: 'Only the owner or admins can review requests' });
    const reqId = parseInt(req.params.id);
    const action = req.body?.action === 'approve' ? 'approve' : req.body?.action === 'deny' ? 'deny' : null;
    if (!reqId || !action) return res.status(400).json({ error: 'Invalid request' });
    const { rows: [jr] } = await pool.query(`
      UPDATE group_join_requests SET status = $1, resolved_by = $2, resolved_at = NOW()
      WHERE id = $3 AND group_id = $4 AND status = 'pending' RETURNING user_id`,
      [action === 'approve' ? 'approved' : 'denied', req.userId, reqId, g.id]);
    if (!jr) return res.status(404).json({ error: 'Request not found or already handled' });
    if (action === 'approve') {
      await pool.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [g.id, jr.user_id]);
    }
    res.json({ ok: true, action });
  } catch (e) { console.error('groups/requests-resolve:', e.message); res.status(500).json({ error: 'Failed to update request' }); }
});

// PUT /api/groups/:slug — owner/admin edit description, avatar, color.
// Name and privacy changes are owner only. Slug stays stable on rename so
// shared links keep working.
app.put('/api/groups/:slug', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (!canModerateGroup(myRole)) return res.status(403).json({ error: 'Only the owner or admins can edit this group' });
    const sets = [];
    const params = [];
    const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (typeof req.body?.description === 'string') push('description', req.body.description.trim().slice(0, 500));
    if (typeof req.body?.avatar === 'string' && req.body.avatar.trim()) push('avatar', req.body.avatar.trim().slice(0, 8));
    if (typeof req.body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.color)) push('color', req.body.color);
    if (typeof req.body?.name === 'string') {
      if (myRole !== 'owner') return res.status(403).json({ error: 'Only the owner can rename the group' });
      const name = req.body.name.replace(/\s+/g, ' ').trim();
      if (name.length < 3 || name.length > 50) return res.status(400).json({ error: 'Group name must be 3 to 50 characters' });
      push('name', name);
    }
    if (typeof req.body?.privacy === 'string') {
      if (myRole !== 'owner') return res.status(403).json({ error: 'Only the owner can change privacy' });
      push('privacy', req.body.privacy === 'private' ? 'private' : 'public');
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(g.id);
    await pool.query(`UPDATE groups SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);
    const fresh = await getGroupBySlug(pool, g.slug);
    res.json({ group: groupJson(fresh, { myRole }) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A group with that name already exists' });
    console.error('groups/update:', e.message);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE /api/groups/:slug — owner only. Cascades members, requests, posts.
app.delete('/api/groups/:slug', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (myRole !== 'owner') return res.status(403).json({ error: 'Only the owner can delete the group' });
    await pool.query('DELETE FROM groups WHERE id = $1', [g.id]);
    res.json({ deleted: true });
  } catch (e) { console.error('groups/delete:', e.message); res.status(500).json({ error: 'Failed to delete group' }); }
});

// GET /api/groups/:slug/posts — paginated feed (20/page), members only for
// private groups.
app.get('/api/groups/:slug/posts', optionalAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ posts: [], hasMore: false });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (g.privacy === 'private' && !myRole) return res.status(403).json({ error: 'Members only', posts: [], hasMore: false });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const { rows } = await pool.query(`
      SELECT gp.id, gp.body, gp.created_at, u.id AS user_id, u.handle, u.avatar_url
      FROM group_posts gp JOIN users u ON u.id = gp.user_id
      WHERE gp.group_id = $1 ORDER BY gp.created_at DESC LIMIT $2 OFFSET $3`,
      [g.id, limit + 1, (page - 1) * limit]);
    res.json({ posts: rows.slice(0, limit).map(groupPostJson), hasMore: rows.length > limit, page });
  } catch (e) { console.error('groups/posts:', e.message); res.json({ posts: [], hasMore: false }); }
});

// POST /api/groups/:slug/posts — members post to the group wall.
app.post('/api/groups/:slug/posts', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    if (!(await assertActiveAccount(pool, req.userId, res))) return;
    if (!(await flagEnabled(pool, 'groups'))) return res.status(503).json({ error: 'Groups are temporarily disabled' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (!myRole) return res.status(403).json({ error: 'Join this group to post' });
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Post body required' });
    if (body.length > 500) return res.status(400).json({ error: 'Post too long (max 500 chars)' });
    const { rows: [p] } = await pool.query(
      'INSERT INTO group_posts (group_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at',
      [g.id, req.userId, body]);
    const { rows: [u] } = await pool.query('SELECT handle, avatar_url FROM users WHERE id = $1', [req.userId]);
    res.json({ post: groupPostJson({ ...p, user_id: req.userId, handle: u?.handle, avatar_url: u?.avatar_url }) });
  } catch (e) { console.error('groups/post-create:', e.message); res.status(500).json({ error: 'Failed to post' }); }
});

// DELETE /api/groups/:slug/posts/:postId — authors delete their own posts,
// owner/admin can moderate anything in the group.
app.delete('/api/groups/:slug/posts/:postId', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const postId = parseInt(req.params.postId);
    if (!postId) return res.status(400).json({ error: 'Invalid post id' });
    const { rows: [p] } = await pool.query('SELECT user_id FROM group_posts WHERE id = $1 AND group_id = $2', [postId, g.id]);
    if (!p) return res.status(404).json({ error: 'Post not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (p.user_id !== req.userId && !canModerateGroup(myRole)) return res.status(403).json({ error: 'You can only delete your own posts' });
    await pool.query('DELETE FROM group_posts WHERE id = $1', [postId]);
    res.json({ deleted: true });
  } catch (e) { console.error('groups/post-delete:', e.message); res.status(500).json({ error: 'Failed to delete post' }); }
});

// GET /api/groups/:slug/members — roster with roles. Private rosters are
// members only; public rosters are public like the rest of the directory.
app.get('/api/groups/:slug/members', optionalAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.json({ members: [] });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (g.privacy === 'private' && !myRole) return res.status(403).json({ error: 'Members only', members: [] });
    const { rows } = await pool.query(`
      SELECT gm.role, gm.joined_at, u.id AS user_id, u.handle, u.avatar_url
      FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at ASC
      LIMIT 200`, [g.id]);
    res.json({ members: rows.map(m => ({ role: m.role, joinedAt: m.joined_at, user: { id: m.user_id, handle: m.handle, avatarUrl: m.avatar_url } })), myRole });
  } catch (e) { console.error('groups/members:', e.message); res.json({ members: [] }); }
});

// POST /api/groups/:slug/members/:userId/role — owner only. Promote to admin,
// demote to member, or transfer ownership (old owner becomes admin).
app.post('/api/groups/:slug/members/:userId/role', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (myRole !== 'owner') return res.status(403).json({ error: 'Only the owner can change roles' });
    const targetId = req.params.userId;
    if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid user' });
    if (targetId === req.userId) return res.status(400).json({ error: 'You cannot change your own role' });
    const newRole = ['owner', 'admin', 'member'].includes(req.body?.role) ? req.body.role : null;
    if (!newRole) return res.status(400).json({ error: 'Role must be owner, admin, or member' });
    const targetRole = await getGroupRole(pool, g.id, targetId);
    if (!targetRole) return res.status(404).json({ error: 'That user is not a member' });
    if (newRole === 'owner') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2`, [g.id, req.userId]);
        await client.query(`UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2`, [g.id, targetId]);
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
      finally { client.release(); }
      return res.json({ ok: true, transferred: true });
    }
    await pool.query('UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3', [newRole, g.id, targetId]);
    res.json({ ok: true, role: newRole });
  } catch (e) { console.error('groups/role:', e.message); res.status(500).json({ error: 'Failed to change role' }); }
});

// DELETE /api/groups/:slug/members/:userId — remove a member. Owner can remove
// anyone but themselves; admins can remove plain members only.
app.delete('/api/groups/:slug/members/:userId', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    await ensureGroupTables(pool);
    const g = await getGroupBySlug(pool, req.params.slug);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const myRole = await getGroupRole(pool, g.id, req.userId);
    if (!canModerateGroup(myRole)) return res.status(403).json({ error: 'Only the owner or admins can remove members' });
    const targetId = req.params.userId;
    if (!isUuid(targetId)) return res.status(400).json({ error: 'Invalid user' });
    if (targetId === req.userId) return res.status(400).json({ error: 'Use leave instead of removing yourself' });
    const targetRole = await getGroupRole(pool, g.id, targetId);
    if (!targetRole) return res.status(404).json({ error: 'That user is not a member' });
    if (targetRole === 'owner') return res.status(403).json({ error: 'The owner cannot be removed' });
    if (myRole === 'admin' && targetRole === 'admin') return res.status(403).json({ error: 'Admins cannot remove other admins' });
    await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [g.id, targetId]);
    res.json({ removed: true });
  } catch (e) { console.error('groups/member-remove:', e.message); res.status(500).json({ error: 'Failed to remove member' }); }
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
    // Clamp user-supplied pagination (raw values reached SQL LIMIT before)
    params.push(Math.min(100, Math.max(1, parseInt(limit) || 20)), Math.max(0, parseInt(offset) || 0));
    const { rows } = await pool.query(`
      SELECT u.id, u.handle, u.store_name, u.store_description, u.store_location,
             u.store_website, u.store_verified, u.avatar_url, u.rating,
             COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'active') AS listing_count,
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
    // NOTE: columns must match the real schema — listings has status/price
    // (cents), orders has amount/status 'settled'; l.active / o.amount_cents /
    // l.ask_cents never existed and 500'd every store page.
    const { rows } = await pool.query(`
      SELECT u.id, u.handle, u.store_name, u.store_description, u.store_location,
             u.store_website, u.store_verified, u.avatar_url, u.rating, u.bio,
             u.created_at,
             COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'active') AS listing_count,
             COUNT(DISTINCT f.follower_id) AS follower_count,
             COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'settled'), 0) AS total_sales_cents
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
      SELECT l.id, l.price AS ask_cents, l.created_at,
             c.player, c.sport, c.card_set, c.year, c.grader, c.grade, c.ebay_thumb, c.variant
      FROM listings l
      JOIN cards c ON c.id = l.card_id
      WHERE l.seller_id = $1 AND l.status = 'active'
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
    if (!(await flagEnabled(pool, 'mystery_packs'))) return res.status(503).json({ error: 'Mystery packs are temporarily disabled' });
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
// (global per-IP cap now lives at the top of the middleware chain, covering all /api)
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
      success_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/market?tab=deals&sub=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/market?tab=deals&sub=cancelled`,
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
    if (!sessionId) return res.redirect('/market?tab=deals');
    const { default: Stripe } = await import('stripe');
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.redirect('/market?tab=deals');
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
    res.redirect('/market?tab=deals&sub=success');
  } catch (e) {
    res.redirect('/market?tab=deals');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SHOP SUBSCRIPTION — $9.99/mo for shop/dealer accounts to list cards
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/shop/subscription', requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) return res.json({ isShop: false, active: false, status: 'none' });
    const { rows: [u] } = await pool.query('SELECT account_type FROM users WHERE id = $1', [req.userId]);
    const isShop = u?.account_type === 'store';
    const st = await shopSubStatus(pool, req.userId);
    res.json({ isShop, priceMonthly: 9.99, ...st });
  } catch (e) { res.json({ isShop: false, active: false, status: 'none' }); }
});

app.post('/api/shop/subscription/checkout', requireAuth, async (req, res) => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(400).json({ error: 'Stripe not configured' });
    const pool = await getPool();
    await ensureSubColumns(pool);
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(key);
    // Prefer the lookup_key so a rotated price still resolves; fall back to id.
    let priceId = SHOP_PRICE_ID;
    try {
      const found = await stripe.prices.list({ lookup_keys: [SHOP_PRICE_LOOKUP], active: true, limit: 1 });
      if (found.data[0]) priceId = found.data[0].id;
    } catch { /* use fallback id */ }
    // Reuse an existing Stripe customer for this user if we have one.
    let customerId = null;
    try {
      const { rows } = await pool.query(
        `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [req.userId]);
      customerId = rows[0]?.stripe_customer_id || null;
    } catch { /* ignore */ }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      ...(customerId ? { customer: customerId } : {}),
      client_reference_id: req.userId,
      metadata: { userId: req.userId, plan: 'shop_monthly' },
      subscription_data: { metadata: { userId: req.userId, plan: 'shop_monthly' } },
      success_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/api/shop/subscription/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/sell?shop_sub=cancelled`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('shop sub checkout:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// Customer portal — manage/cancel the shop subscription
app.post('/api/shop/subscription/portal', requireAuth, async (req, res) => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(400).json({ error: 'Stripe not configured' });
    const pool = await getPool();
    await ensureSubColumns(pool);
    const { rows } = await pool.query(
      `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [req.userId]);
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No subscription to manage yet' });
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(key);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.APP_URL || 'https://gemlinecards.com'}/sell`,
    });
    res.json({ url: portal.url });
  } catch (e) {
    console.error('shop sub portal:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// Return from Checkout — persist the sub immediately (webhook also confirms)
app.get('/api/shop/subscription/return', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!sessionId || !key) return res.redirect('/sell');
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    const pool = await getPool();
    await ensureSubColumns(pool);
    const userId = session.client_reference_id || session.metadata?.userId;
    if (pool && userId && (session.status === 'complete' || session.payment_status === 'paid')) {
      const sub = session.subscription;
      const subId = typeof sub === 'string' ? sub : sub?.id;
      const status = (typeof sub === 'object' && sub?.status) ? sub.status : 'active';
      const periodEnd = (typeof sub === 'object' && sub?.current_period_end)
        ? new Date(sub.current_period_end * 1000) : new Date(Date.now() + 30 * 86400_000);
      // Upsert-ish: one shop_monthly row per user, keep it current.
      const { rows: existing } = await pool.query(
        `SELECT id FROM subscriptions WHERE user_id = $1 AND plan = 'shop_monthly' ORDER BY created_at DESC LIMIT 1`, [userId]);
      if (existing.length) {
        await pool.query(
          `UPDATE subscriptions SET status = $1, stripe_subscription_id = $2, current_period_end = $3, stripe_customer_id = $4 WHERE id = $5`,
          [status === 'trialing' ? 'active' : status, subId, periodEnd, session.customer || null, existing[0].id]);
      } else {
        await pool.query(
          `INSERT INTO subscriptions (user_id, plan, status, stripe_subscription_id, current_period_end, stripe_customer_id)
           VALUES ($1, 'shop_monthly', $2, $3, $4, $5)`,
          [userId, status === 'trialing' ? 'active' : status, subId, periodEnd, session.customer || null]);
      }
    }
    res.redirect('/sell?shop_sub=active');
  } catch (e) {
    console.error('shop sub return:', e.message);
    res.redirect('/sell');
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
    const { rows: [user] } = await pool.query('SELECT id, handle, email, bio, avatar_url, display_name_changed, created_at FROM users WHERE id = $1', [req.userId]);
    res.json(user || {});
  } catch (e) {
    res.json({});
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SHIPPING ADDRESSES — saved per user; snapshotted onto orders at checkout
// ══════════════════════════════════════════════════════════════════════════════

const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','GU','VI','AS','MP','AA','AE','AP']);
const ZIP_RE = /^\d{5}(-\d{4})?$/;

// Validate + normalize an address payload. Returns { ok, error?, address? }.
function validateAddress(body) {
  const s = (v, max = 120) => String(v ?? '').trim().slice(0, max);
  const a = {
    name: s(body.name, 80),
    street1: s(body.street1),
    street2: s(body.street2) || null,
    city: s(body.city, 80),
    state: s(body.state, 20).toUpperCase(),
    zip: s(body.zip, 12),
    country: (s(body.country, 2).toUpperCase() || 'US'),
    phone: s(body.phone, 24) || null,
  };
  if (!a.name) return { ok: false, error: 'Full name is required' };
  if (!a.street1) return { ok: false, error: 'Street address is required' };
  if (!a.city) return { ok: false, error: 'City is required' };
  if (!a.state) return { ok: false, error: 'State is required' };
  if (!a.zip) return { ok: false, error: 'ZIP code is required' };
  if (a.country === 'US') {
    if (!US_STATES.has(a.state)) return { ok: false, error: 'Enter a valid 2-letter US state (e.g. CA, NY, TX)' };
    if (!ZIP_RE.test(a.zip)) return { ok: false, error: 'Enter a valid ZIP code (12345 or 12345-6789)' };
  }
  return { ok: true, address: a };
}

// Snapshot a user's default (or only) saved address onto an order — called at
// checkout creation so later address edits never mutate historical orders.
async function snapshotOrderAddress(pool, orderId, userId, addressId = null) {
  if (!pool || !orderId || !userId) return null;
  const { rows: [addr] } = addressId
    ? await pool.query('SELECT * FROM user_addresses WHERE id = $1 AND user_id = $2', [addressId, userId])
    : await pool.query('SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1', [userId]);
  if (!addr) return null;
  const snap = {
    name: addr.name, street1: addr.street1, street2: addr.street2 || null,
    city: addr.city, state: addr.state, zip: addr.zip, country: addr.country || 'US',
    phone: addr.phone || null, address_id: addr.id,
  };
  await pool.query('UPDATE orders SET shipping_address = $1 WHERE id = $2', [JSON.stringify(snap), orderId]);
  return snap;
}

app.get('/api/user/addresses', requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) return res.json({ addresses: [] });
    const { rows } = await pool.query(
      'SELECT id, name, street1, street2, city, state, zip, country, phone, is_default, created_at FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [req.userId]);
    res.json({ addresses: rows });
  } catch (e) { console.error('addresses list:', e.message); res.json({ addresses: [] }); }
});

app.post('/api/user/addresses', requireAuth, limitWrites, async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) return res.status(500).json({ error: 'No database' });
    const v = validateAddress(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    const a = v.address;
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) AS count FROM user_addresses WHERE user_id = $1', [req.userId]);
    if (Number(count) >= 10) return res.status(400).json({ error: 'Address book is full (max 10)' });
    const makeDefault = req.body?.is_default === true || Number(count) === 0;
    if (makeDefault) await pool.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.userId]);
    const { rows: [row] } = await pool.query(
      `INSERT INTO user_addresses (user_id, name, street1, street2, city, state, zip, country, phone, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.userId, a.name, a.street1, a.street2, a.city, a.state, a.zip, a.country, a.phone, makeDefault]);
    res.json({ ok: true, address: row });
  } catch (e) { console.error('address create:', e.message); res.status(500).json({ error: 'Could not save address' }); }
});

app.put('/api/user/addresses/:id', requireAuth, limitWrites, async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) return res.status(500).json({ error: 'No database' });
    const v = validateAddress(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    const a = v.address;
    if (req.body?.is_default === true) await pool.query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [req.userId]);
    const { rows: [row] } = await pool.query(
      `UPDATE user_addresses SET name=$1, street1=$2, street2=$3, city=$4, state=$5, zip=$6, country=$7, phone=$8,
              is_default = CASE WHEN $9 THEN true ELSE is_default END
       WHERE id = $10 AND user_id = $11 RETURNING *`,
      [a.name, a.street1, a.street2, a.city, a.state, a.zip, a.country, a.phone, req.body?.is_default === true, req.params.id, req.userId]);
    if (!row) return res.status(404).json({ error: 'Address not found' });
    res.json({ ok: true, address: row });
  } catch (e) { console.error('address update:', e.message); res.status(500).json({ error: 'Could not update address' }); }
});

app.delete('/api/user/addresses/:id', requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { rows: [gone] } = await pool.query('DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 RETURNING is_default', [req.params.id, req.userId]);
    if (!gone) return res.status(404).json({ error: 'Address not found' });
    // Keep exactly one default when possible
    if (gone.is_default) {
      await pool.query(
        `UPDATE user_addresses SET is_default = true
         WHERE id = (SELECT id FROM user_addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`,
        [req.userId]);
    }
    res.json({ ok: true });
  } catch (e) { console.error('address delete:', e.message); res.status(500).json({ error: 'Could not delete address' }); }
});

// Attach/confirm a shipping address on an order (buyer, before/at payment).
// Accepts { addressId } to use a saved address, or full address fields (which
// are also saved to the buyer's address book for next time).
app.post('/api/orders/:id/shipping-address', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const order = await r.orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.buyer_id !== req.userId) return res.status(403).json({ error: 'Not your order' });
    if (['settled', 'cancelled', 'refunded'].includes(order.status)) {
      return res.status(409).json({ error: `Order is ${order.status} — address can no longer be changed` });
    }
    let snap;
    if (req.body?.addressId) {
      snap = await snapshotOrderAddress(pool, order.id, req.userId, req.body.addressId);
      if (!snap) return res.status(404).json({ error: 'Saved address not found' });
    } else {
      const v = validateAddress(req.body || {});
      if (!v.ok) return res.status(400).json({ error: v.error });
      const a = v.address;
      // Save to the address book too (first address becomes default)
      const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) AS count FROM user_addresses WHERE user_id = $1', [req.userId]);
      let addressId = null;
      if (Number(count) < 10) {
        const { rows: [row] } = await pool.query(
          `INSERT INTO user_addresses (user_id, name, street1, street2, city, state, zip, country, phone, is_default)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [req.userId, a.name, a.street1, a.street2, a.city, a.state, a.zip, a.country, a.phone, Number(count) === 0]);
        addressId = row.id;
      }
      snap = { ...a, address_id: addressId };
      await pool.query('UPDATE orders SET shipping_address = $1 WHERE id = $2', [JSON.stringify(snap), order.id]);
    }
    res.json({ ok: true, shippingAddress: snap });
  } catch (e) { console.error('order shipping-address:', e.message); res.status(500).json({ error: 'Could not save shipping address' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE & BADGES (public + auth)
// ══════════════════════════════════════════════════════════════════════════════

// Helper: award badges based on user activity.
// Mystery-pack badges were removed with the packs feature — awards now derive
// from marketplace activity: portfolio, trades, sales, auctions, and offers.
async function checkAndAwardBadges(pool, userId) {
  try {
    const q = (sql, fallback) => pool.query(sql, [userId]).then(r => r.rows[0]).catch(() => fallback);
    const [pf, tradeStats, saleStats, bidStats, winStats, offerStats] = await Promise.all([
      q(`SELECT COUNT(*) AS cnt, COALESCE(SUM(c.catalog_price), 0) AS val
         FROM portfolios p JOIN cards c ON c.id = p.card_id WHERE p.user_id = $1`, { cnt: 0, val: 0 }),
      q(`SELECT COUNT(*) AS trades FROM trades WHERE (proposer_id = $1 OR counterparty_id = $1) AND status = 'completed'`, { trades: 0 }),
      q(`SELECT COUNT(*) AS sales, COALESCE(MAX(price), 0) AS max_price FROM listings WHERE seller_id = $1 AND status = 'sold'`, { sales: 0, max_price: 0 }),
      q(`SELECT COUNT(*) AS bids FROM bids WHERE bidder_id = $1`, { bids: 0 }),
      q(`SELECT COUNT(*) AS wins FROM listings l
         WHERE l.kind = 'auction' AND l.status = 'sold'
           AND (SELECT b.bidder_id FROM bids b WHERE b.listing_id = l.id ORDER BY b.amount DESC, b.created_at ASC LIMIT 1) = $1`, { wins: 0 }),
      q(`SELECT COUNT(*) AS accepted FROM listing_offers o JOIN listings l ON l.id = o.listing_id
         WHERE l.seller_id = $1 AND o.status IN ('accepted', 'expired')`, { accepted: 0 }),
    ]);

    const cardCount = parseInt(pf.cnt) || 0;
    const portfolioValue = parseFloat(pf.val) || 0;
    const trades = parseInt(tradeStats.trades) || 0;
    const sales = parseInt(saleStats.sales) || 0;
    const maxSaleCents = Number(saleStats.max_price) || 0;
    const bids = parseInt(bidStats.bids) || 0;
    const wins = parseInt(winStats.wins) || 0;
    const offersAccepted = parseInt(offerStats.accepted) || 0;

    const badgesToAward = [];

    // Collection size (portfolio cards)
    if (cardCount >= 10) badgesToAward.push('collector_10');
    if (cardCount >= 50) badgesToAward.push('collector_50');
    if (cardCount >= 100) badgesToAward.push('collector_100');
    if (cardCount >= 250) badgesToAward.push('collector_250');
    if (cardCount >= 500) badgesToAward.push('collector_500');
    if (cardCount >= 1000) badgesToAward.push('collector_1000');

    // Portfolio value
    if (portfolioValue >= 1000) badgesToAward.push('portfolio_1k');
    if (portfolioValue >= 10000) badgesToAward.push('portfolio_10k');
    if (portfolioValue >= 50000) badgesToAward.push('portfolio_50k');
    if (portfolioValue >= 100000) badgesToAward.push('portfolio_100k');

    // Trades
    if (trades >= 1) badgesToAward.push('first_trade');
    if (trades >= 5) badgesToAward.push('trader_5');
    if (trades >= 25) badgesToAward.push('trader_25');
    if (trades >= 100) badgesToAward.push('trader_100');
    if (trades >= 500) badgesToAward.push('trader_500');

    // Sales
    if (sales >= 1) badgesToAward.push('first_sale');
    if (sales >= 5) badgesToAward.push('seller_5');
    if (sales >= 25) badgesToAward.push('seller_25');
    if (sales >= 100) badgesToAward.push('seller_100');
    if (maxSaleCents >= 20000) badgesToAward.push('big_sale'); // $200+ sale

    // Auctions + offers
    if (bids >= 1) badgesToAward.push('first_bid');        // In the Game
    if (wins >= 1) badgesToAward.push('auction_winner');   // Gavel Down
    if (offersAccepted >= 1) badgesToAward.push('deal_maker');

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

    // Owner viewing their own profile: run the award sweep first so newly
    // reached milestones show up without a separate visit to /api/user/badges.
    if (isOwner) await checkAndAwardBadges(pool, user.id);

    // Showcase cards (split by type, max 3 each for public)
    const { rows: showcase } = await pool.query(
      `SELECT us.card_id, us.position, us.type, c.id, c.player, c.sport, c.card_set, c.grader, c.grade,
              c.variant, c.catalog_price, c.ebay_thumb as thumbnail, c.image_url, c.cardhedge_id
       FROM user_showcase us JOIN cards c ON us.card_id = c.id
       WHERE us.user_id = $1 ORDER BY us.type, us.position, us.added_at`, [user.id]
    );
    const digitalShowcase = showcase.filter(s => s.type === 'digital').slice(0, 3);
    const physicalShowcase = showcase.filter(s => s.type === 'physical').slice(0, 5);

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
      pool.query(`SELECT COALESCE(SUM(c.catalog_price), 0) as total,
                         COALESCE(SUM(c.catalog_price) FILTER (WHERE p.verification_status = 'verified'), 0) as verified_total
                  FROM portfolios p JOIN cards c ON p.card_id = c.id WHERE p.user_id = $1`, [user.id]),
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
        // Collection value derives from the portfolio — the same source as the
        // CARDS count — so the profile stats row can't contradict itself
        // (legacy digital pulls no longer inflate a 0-card collection).
        totalValue: parseFloat(physicalVal.total) || 0,
        // Verified Value = only scan/cert-verified holdings (anti-scam signal)
        verifiedValue: parseFloat(physicalVal.verified_total) || 0,
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

    // Caps: 5 featured physical cards, 3 digital pulls
    const cap = showcaseType === 'physical' ? 5 : 3;
    const { rows: existing } = await pool.query(
      'SELECT COUNT(*) as cnt FROM user_showcase WHERE user_id = $1 AND type = $2', [req.userId, showcaseType]
    );
    if (parseInt(existing[0].cnt) >= cap) {
      return res.status(400).json({ error: `Showcase is full (max ${cap} ${showcaseType} cards)` });
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

// POST /api/profile/showcase/set — replace the featured-cards showcase (≤5, auth)
// Body: { cardIds: [uuid, ...] } — order = display order. Ownership enforced.
app.post('/api/profile/showcase/set', requireAuth, limitWrites, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const ids = Array.isArray(req.body?.cardIds) ? req.body.cardIds.map(String).slice(0, 5) : null;
    if (!ids) return res.status(400).json({ error: 'cardIds must be an array (max 5)' });
    // Only cards actually in the user's portfolio
    const { rows: owned } = await pool.query(
      'SELECT DISTINCT card_id FROM portfolios WHERE user_id = $1 AND card_id = ANY($2::uuid[])', [req.userId, ids]);
    const ownedSet = new Set(owned.map(o => o.card_id));
    const valid = ids.filter(id => ownedSet.has(id));
    await pool.query("DELETE FROM user_showcase WHERE user_id = $1 AND type = 'physical'", [req.userId]);
    for (let i = 0; i < valid.length; i++) {
      await pool.query(
        `INSERT INTO user_showcase (user_id, card_id, position, type) VALUES ($1, $2, $3, 'physical')
         ON CONFLICT (user_id, card_id) DO UPDATE SET type = 'physical', position = $3`,
        [req.userId, valid[i], i]);
    }
    res.json({ ok: true, cardIds: valid });
  } catch (e) {
    console.error('showcase/set error:', e.message);
    res.status(500).json({ error: e.message });
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

// POST /api/profile/badges — save featured badge keys (up to 3)
app.post('/api/profile/badges', requireAuth, async (req, res) => {
  try {
    const r = await getRepo();
    const pool = r.pool;
    if (!pool) return res.status(500).json({ error: 'No database' });
    const { badges } = req.body;
    if (!Array.isArray(badges)) return res.status(400).json({ error: 'badges must be an array' });
    const keys = badges.slice(0, 3).map(String);

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
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      if (pool && sub.id) {
        // Preserve real Stripe status so shop grace logic works: active |
        // trialing | past_due | canceled | unpaid | incomplete...
        let status = sub.status || 'active';
        if (event.type === 'customer.subscription.deleted') status = 'canceled';
        if (status === 'trialing') status = 'active';
        const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
        const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id || null);
        try {
          const { rowCount } = await pool.query(
            `UPDATE subscriptions SET status = $1, current_period_end = $2,
               stripe_customer_id = COALESCE($4, stripe_customer_id)
             WHERE stripe_subscription_id = $3`,
            [status, periodEnd, sub.id, customerId]);
          // Shop subs may arrive here before the return handler wrote a row.
          if (rowCount === 0) {
            const plan = sub.metadata?.plan || null;
            const userId = sub.metadata?.userId || null;
            if (plan === 'shop_monthly' && userId) {
              await ensureSubColumns(pool);
              await pool.query(
                `INSERT INTO subscriptions (user_id, plan, status, stripe_subscription_id, current_period_end, stripe_customer_id)
                 VALUES ($1, 'shop_monthly', $2, $3, $4, $5)`,
                [userId, status, sub.id, periodEnd, customerId]);
            }
          }
        } catch (e) { console.error('[webhook] sub update:', e.message); }
      }
      break;
    }
    // Manual-capture PIs land here the moment the buyer confirms payment (funds
    // authorized, not yet captured). This is the signal that a pending_payment
    // order should move into fulfillment. 'succeeded' also handled below for
    // any automatic-capture flows.
    case 'payment_intent.amount_capturable_updated':
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      console.log('[webhook] PI paid:', pi.id, event.type, '$' + (pi.amount / 100));
      if (pool) {
        try {
          const { rows: [esc] } = await pool.query(
            'SELECT id, order_id FROM escrow_holds WHERE stripe_payment_intent_id = $1', [pi.id]);
          if (esc?.order_id) {
            const order = await r.orders.get(esc.order_id);
            if (order && order.status === 'pending_payment') {
              const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
              await finalizePaidOrder(r, stripe, order);
              console.log('[webhook] order', order.id, 'finalized ->', order.status);
            }
          }
        } catch (e) { console.error('[webhook] PI paid handling:', e.message); }
      }
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
            const order = await r.orders.get(esc.order_id);
            if (order && ['pending_payment', 'created', 'escrow_held', 'awaiting_shipment'].includes(order.status)) {
              // cancelCheckout voids the hold, cancels the order, and unlocks the
              // listing (returns fixed-price listings to 'active').
              const stripe = process.env.STRIPE_SECRET_KEY ? stripeClient : stripeStub;
              await cancelCheckout(r, stripe, order, event.type);
              console.log('[webhook] order', order.id, 'cancelled + listing unlocked');
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
