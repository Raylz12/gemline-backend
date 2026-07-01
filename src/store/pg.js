// Postgres adapter. Same interface as the memory store. 'pg' is imported
// dynamically so the demo runs without it installed; it's only needed when
// DATABASE_URL is set. Object keys are snake_case and map 1:1 to columns.
const TABLE = {
  users: 'users', cards: 'cards', listings: 'listings', bids: 'bids', orders: 'orders',
  trades: 'trades', tradeItems: 'trade_items', vault: 'vault_items', shipments: 'shipments',
  auth: 'authentications', ledger: 'credit_ledger', boosts: 'boosts', disputes: 'disputes',
  escrow: 'escrow_holds', events: 'events', portfolios: 'portfolios',
};

// Column whitelist per table — prevents SQL injection in orderBy
const SAFE_COLUMNS = {
  users: new Set(['id','handle','email','role','credits','created_at','updated_at']),
  listings: new Set(['id','card_id','seller_id','status','price','boost_rank','created_at','updated_at']),
  trades: new Set(['id','proposer_id','counterparty_id','status','created_at','updated_at']),
  events: new Set(['id','entity_type','entity_id','created_at']),
  portfolios: new Set(['id','user_id','card_id','created_at']),
  credit_ledger: new Set(['id','user_id','delta','created_at']),
};

function isSafeColumn(table, col) {
  return SAFE_COLUMNS[table]?.has(col) ?? /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col);
}

export async function pgRepo(connectionString) {
  const { default: pg } = await import('pg');
  // Tune pool for serverless/edge: short idle timeout, reasonable max
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Log pool errors so they don't go unnoticed
  pool.on('error', (err) => console.error('[pg pool error]', err.message));

  function collection(table) {
    return {
      async insert(row) {
        const keys = Object.keys(row).filter(k => row[k] !== undefined);
        if (!keys.length) throw new Error(`Cannot insert empty row into ${table}`);
        const cols = keys.join(',');
        const ph = keys.map((_, i) => `$${i + 1}`).join(',');
        const vals = keys.map(k => row[k]);
        const { rows } = await pool.query(
          `INSERT INTO ${table} (${cols}) VALUES (${ph}) RETURNING *`,
          vals
        );
        return rows[0];
      },

      async get(id) {
        if (!id) return null;
        const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
        return rows[0] || null;
      },

      async update(row) {
        if (!row.id) throw new Error(`Cannot update ${table} row without id`);
        const keys = Object.keys(row).filter(k => k !== 'id' && row[k] !== undefined);
        if (!keys.length) return row; // nothing to update
        const set = keys.map((k, i) => `${k} = $${i + 1}`).join(',');
        const vals = keys.map(k => row[k]);
        const { rows } = await pool.query(
          `UPDATE ${table} SET ${set} WHERE id = $${keys.length + 1} RETURNING *`,
          [...vals, row.id]
        );
        return rows[0] || null;
      },

      // list supports filter object + optional { limit, orderBy, orderDir }
      async list(filter = {}, opts = {}) {
        const { limit, orderBy, orderDir = 'ASC' } = opts;
        const filterKeys = Object.keys(filter).filter(k => filter[k] !== undefined);
        const where = filterKeys.length
          ? 'WHERE ' + filterKeys.map((k, i) => `${k} = $${i + 1}`).join(' AND ')
          : '';
        const params = filterKeys.map(k => filter[k]);

        let order = '';
        if (orderBy && isSafeColumn(table, orderBy)) {
          const dir = orderDir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
          order = `ORDER BY ${orderBy} ${dir}`;
        }

        const limitClause = limit && Number.isInteger(limit) && limit > 0
          ? `LIMIT ${limit}`
          : '';

        const { rows } = await pool.query(
          `SELECT * FROM ${table} ${where} ${order} ${limitClause}`.trim(),
          params
        );
        return rows;
      },

      async delete(id) {
        if (!id) throw new Error(`Cannot delete from ${table} without id`);
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        return { ok: true };
      },

      // Upsert using ON CONFLICT DO UPDATE
      async upsert(row, conflictCols = ['id']) {
        const keys = Object.keys(row).filter(k => row[k] !== undefined);
        if (!keys.length) throw new Error(`Cannot upsert empty row into ${table}`);
        const cols = keys.join(',');
        const ph = keys.map((_, i) => `$${i + 1}`).join(',');
        const vals = keys.map(k => row[k]);
        const updateCols = keys.filter(k => !conflictCols.includes(k));
        const updateSet = updateCols.map(k => `${k} = EXCLUDED.${k}`).join(', ');
        const conflict = conflictCols.join(', ');
        const sql = updateSet
          ? `INSERT INTO ${table} (${cols}) VALUES (${ph}) ON CONFLICT (${conflict}) DO UPDATE SET ${updateSet} RETURNING *`
          : `INSERT INTO ${table} (${cols}) VALUES (${ph}) ON CONFLICT (${conflict}) DO NOTHING RETURNING *`;
        const { rows } = await pool.query(sql, vals);
        return rows[0] || null;
      },
    };
  }

  const repo = { kind: 'pg', pool };
  for (const [name, table] of Object.entries(TABLE)) repo[name] = collection(table);

  // Transaction helper — wraps fn in BEGIN/COMMIT/ROLLBACK
  repo.tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(repo);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  };

  // Health check
  repo.ping = async () => {
    const { rows } = await pool.query('SELECT 1 AS ok');
    return rows[0].ok === 1;
  };

  return repo;
}
