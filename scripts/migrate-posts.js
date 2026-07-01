import pg from 'pg';
const DB = 'postgresql://neondb_owner:npg_EC6NcOHey4QA@ep-soft-firefly-ateyekqi-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const pool = new pg.Pool({ connectionString: DB });

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'general',
      body TEXT NOT NULL,
      card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
      likes INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('posts table created');

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);`);
  console.log('indexes created');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, post_id)
    );
  `);
  console.log('post_likes table created');

  await pool.end();
  console.log('Migration complete!');
}

main().catch(e => { console.error(e); process.exit(1); });
