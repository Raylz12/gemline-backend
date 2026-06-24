// Simple in-process TTL cache. One entry per key; refreshed on expiry.
const store = new Map();

export async function cached(key, ttlSeconds, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now < hit.expiresAt) return hit.value;
  const value = await fn();
  store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  return value;
}

export function bust(key) { store.delete(key); }
