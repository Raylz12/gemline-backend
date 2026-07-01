// In-process TTL cache with stampede protection (single in-flight fetch per key).
// Works across synchronous Vercel Edge / Node processes.
const store = new Map();
const inflight = new Map();

export async function cached(key, ttlSeconds, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now < hit.expiresAt) return hit.value;

  // Stampede protection: deduplicate concurrent fetches for the same key
  if (inflight.has(key)) return inflight.get(key);

  const promise = fn().then(value => {
    store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
    inflight.delete(key);
    return value;
  }).catch(err => {
    inflight.delete(key);
    // Return stale value on error rather than propagating
    const stale = store.get(key);
    if (stale) return stale.value;
    throw err;
  });

  inflight.set(key, promise);
  return promise;
}

export function bust(key) {
  store.delete(key);
  inflight.delete(key);
}

export function bustPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

// GC: drop expired entries every 5 minutes to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now >= entry.expiresAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref?.();
