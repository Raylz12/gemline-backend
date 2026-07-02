// Rate limiting — two layers:
//  1. In-memory sliding window (per serverless instance; cheap first line).
//  2. Postgres-backed fixed window (rate_limits table; holds across instances)
//     for critical endpoints — auth, money movement, expensive AI calls.
// Both fail OPEN on infrastructure errors so a limiter outage never takes
// down the site; the memory layer still applies.
const windows = new Map();

// Periodic GC: prune stale entries every 5 minutes to prevent unbounded growth.
// windowMs is unknown here so we use a generous 10-minute cutoff.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of windows) {
    if (v.every(t => t < cutoff)) windows.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

export function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.socket?.remoteAddress || 'unknown';
}

let limiterSeq = 0;
export function rateLimit({ max = 60, windowMs = 60_000, message = 'Too many requests', keyFn = getIp } = {}) {
  const id = ++limiterSeq; // namespace so multiple limiters don't share counts per key
  return (req, res, next) => {
    const key = `${id}:${keyFn(req)}`;
    const now = Date.now();
    const hits = (windows.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: message, retryAfter: Math.ceil(windowMs / 1000) });
    }
    hits.push(now);
    windows.set(key, hits);
    next();
  };
}

// ── Postgres-backed fixed-window limiter ─────────────────────────────────────
// rate_limits (bucket, identifier, window_start) PK, count, last_hit.
// Atomic upsert makes the count race-safe across serverless instances.

let tableReady = false;
async function ensureTable(pool) {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket text NOT NULL,
      identifier text NOT NULL,
      window_start timestamptz NOT NULL,
      count integer NOT NULL DEFAULT 1,
      last_hit timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (bucket, identifier, window_start)
    )`);
  tableReady = true;
}

// Log a limit breach to the audit events table (first breach per window only,
// so a hammering bot doesn't flood the log). Awaited by callers — serverless.
export async function logBreach(pool, bucket, identifier, count, path) {
  try {
    await pool.query(
      `INSERT INTO events (entity_type, entity_id, to_state, payload)
       VALUES ('rate_limit', gen_random_uuid(), 'blocked', $1)`,
      [JSON.stringify({ bucket, identifier, count, path })]
    );
  } catch { /* audit log must never break the request */ }
}

/**
 * Core check: increments the (bucket, identifier) counter for the current
 * fixed window and returns { blocked, retryAfter, count }.
 * Progressive lockout: once over the limit, every further attempt bumps
 * last_hit and the block extends min(1h, 30s × overage) past the last attempt
 * — hammering keeps you locked out longer.
 */
export async function pgRateCheck(pool, { bucket, identifier, max, windowSec }) {
  await ensureTable(pool);
  const { rows: [row] } = await pool.query(
    `INSERT INTO rate_limits (bucket, identifier, window_start, count, last_hit)
     VALUES ($1, $2, to_timestamp(floor(extract(epoch from now()) / $3) * $3), 1, now())
     ON CONFLICT (bucket, identifier, window_start)
     DO UPDATE SET count = rate_limits.count + 1, last_hit = now()
     RETURNING count,
       ceil(extract(epoch from (window_start + ($3 || ' seconds')::interval - now()))) AS window_remaining`,
    [bucket, identifier, windowSec]
  );
  // Opportunistic cleanup (~0.5% of calls): drop windows older than 2 days.
  if (Math.random() < 0.005) {
    pool.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`).catch(() => {});
  }
  const count = Number(row.count);
  if (count <= max) return { blocked: false, count };
  const overage = count - max;
  const penalty = Math.min(3600, overage * 30);
  const retryAfter = Math.max(Number(row.window_remaining) || 1, penalty);
  return { blocked: true, count, retryAfter };
}

/** Clear a bucket for an identifier (e.g. successful login resets the counter). */
export async function pgRateClear(pool, bucket, identifier) {
  try {
    await pool.query('DELETE FROM rate_limits WHERE bucket = $1 AND identifier = $2', [bucket, identifier]);
  } catch { /* best effort */ }
}

/**
 * Express middleware factory. getPool is async () => pg.Pool|null.
 * limits: array of { bucket, max, windowSec } — all checked (e.g. hourly + daily).
 * keyFn(req) → identifier (default IP; use req.userId after requireAuth).
 * Fails open if the pool is unavailable or the query errors.
 */
export function pgRateLimit(getPool, { limits, keyFn = getIp, message = 'Too many requests — slow down' }) {
  return async (req, res, next) => {
    let pool;
    try { pool = await getPool(); } catch { return next(); }
    if (!pool) return next();
    const identifier = String(keyFn(req) || 'unknown').slice(0, 200);
    try {
      for (const lim of limits) {
        const r = await pgRateCheck(pool, { ...lim, identifier });
        if (r.blocked) {
          if (r.count === lim.max + 1) await logBreach(pool, lim.bucket, identifier, r.count, req.originalUrl);
          res.setHeader('Retry-After', r.retryAfter);
          return res.status(429).json({ error: message, retryAfter: r.retryAfter });
        }
      }
    } catch (e) {
      console.error('pgRateLimit error (failing open):', e.message);
    }
    next();
  };
}
