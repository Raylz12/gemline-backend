// Server-side Postgres pool for Next server components / route handlers.
// Kept tiny — SEO pages only read a couple of rows per request and results
// are cached by ISR, so a small pool is plenty.
import { Pool } from 'pg';

let _pool;
export function db() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    _pool.on('error', (e) => console.error('[serverDb pool]', e.message));
  }
  return _pool;
}
