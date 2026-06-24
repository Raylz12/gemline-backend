// Postgres adapter. Same interface as the memory store. 'pg' is imported
// dynamically so the demo runs without it installed; it's only needed when
// DATABASE_URL is set. Object keys are snake_case and map 1:1 to columns.
const TABLE = {
  users: 'users', cards: 'cards', listings: 'listings', bids: 'bids', orders: 'orders',
  trades: 'trades', tradeItems: 'trade_items', vault: 'vault_items', shipments: 'shipments',
  auth: 'authentications', ledger: 'credit_ledger', boosts: 'boosts', disputes: 'disputes',
  escrow: 'escrow_holds', events: 'events', portfolios: 'portfolios',
};

export async function pgRepo(connectionString) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString });

  function collection(table) {
    return {
      async insert(row) {
        const keys = Object.keys(row);
        const cols = keys.join(',');
        const ph = keys.map((_, i) => `$${i + 1}`).join(',');
        const vals = keys.map(k => row[k]);
        const { rows } = await pool.query(`INSERT INTO ${table} (${cols}) VALUES (${ph}) RETURNING *`, vals);
        return rows[0];
      },
      async get(id) {
        const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
        return rows[0] || null;
      },
      async update(row) {
        const keys = Object.keys(row).filter(k => k !== 'id');
        const set = keys.map((k, i) => `${k} = $${i + 1}`).join(',');
        const vals = keys.map(k => row[k]);
        const { rows } = await pool.query(`UPDATE ${table} SET ${set} WHERE id = $${keys.length + 1} RETURNING *`, [...vals, row.id]);
        return rows[0];
      },
      async list(filter = {}) {
        const keys = Object.keys(filter);
        const where = keys.length ? 'WHERE ' + keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ') : '';
        const { rows } = await pool.query(`SELECT * FROM ${table} ${where}`, keys.map(k => filter[k]));
        return rows;
      },
    };
  }

  const repo = { kind: 'pg', pool };
  for (const [name, table] of Object.entries(TABLE)) repo[name] = collection(table);
  repo.tx = async (fn) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const r = await fn(repo); await client.query('COMMIT'); return r; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  };
  return repo;
}
