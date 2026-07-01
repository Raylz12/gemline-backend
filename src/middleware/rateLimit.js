// Simple sliding-window rate limiter — no Redis needed.
// Keyed by IP. For production, swap with redis-backed limiter.
const windows = new Map();

// Periodic GC: prune stale entries every 5 minutes to prevent unbounded growth.
// windowMs is unknown here so we use a generous 10-minute cutoff.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of windows) {
    if (v.every(t => t < cutoff)) windows.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.socket?.remoteAddress || 'unknown';
}

export function rateLimit({ max = 60, windowMs = 60_000, message = 'Too many requests' } = {}) {
  return (req, res, next) => {
    const key = getIp(req);
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
