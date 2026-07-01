// Migration: store/dealer accounts + mystery pulls (additive only — never touches card data)
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require',
});

const stmts = [
  // ── Store / dealer accounts ──
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'collector'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS store_name TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS store_description TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS store_location TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS store_verified BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS store_website TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS store_specialty TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS store_applied_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS idx_users_store_verified ON users (store_verified) WHERE store_verified`,

  // ── Mystery pulls ──
  `CREATE TABLE IF NOT EXISTS mystery_pools (
    id SERIAL PRIMARY KEY,
    store_id UUID REFERENCES users(id),
    name TEXT NOT NULL,
    sport TEXT,
    price_credits INTEGER NOT NULL,
    min_value_cents INTEGER,
    max_value_cents INTEGER,
    cards_available INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mystery_pool_cards (
    id SERIAL PRIMARY KEY,
    pool_id INTEGER REFERENCES mystery_pools(id),
    card_name TEXT,
    grade TEXT,
    estimated_value_cents INTEGER,
    submitted_by UUID REFERENCES users(id),
    claimed BOOLEAN DEFAULT FALSE,
    claimed_by UUID REFERENCES users(id),
    claimed_at TIMESTAMPTZ
  )`,
  `ALTER TABLE mystery_pool_cards ADD COLUMN IF NOT EXISTS card_id UUID REFERENCES cards(id)`,
  `ALTER TABLE mystery_pool_cards ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
  `CREATE INDEX IF NOT EXISTS idx_mystery_pool_cards_open ON mystery_pool_cards (pool_id) WHERE NOT claimed`,
  `CREATE INDEX IF NOT EXISTS idx_mystery_pool_cards_claimed_by ON mystery_pool_cards (claimed_by)`,
];

(async () => {
  for (const s of stmts) {
    await pool.query(s);
    console.log('OK:', s.replace(/\s+/g, ' ').slice(0, 70));
  }
  await pool.end();
  console.log('Migration complete.');
})().catch(e => { console.error('MIGRATION FAILED:', e.message); process.exit(1); });
