// In-memory repository. Implements the same interface the Postgres adapter does,
// so the whole settlement engine runs and is testable with zero infrastructure.
import { randomUUID } from 'crypto';

function collection() {
  const m = new Map();
  return {
    async insert(row) { const id = row.id || randomUUID(); const r = { ...row, id }; m.set(id, r); return r; },
    async get(id) { return m.get(id) || null; },
    async update(row) { m.set(row.id, row); return row; },
    async list(filter = {}) {
      return [...m.values()].filter(r => Object.entries(filter).every(([k, v]) => r[k] === v));
    },
    _all: m,
  };
}

export function memoryRepo() {
  const names = ['users', 'cards', 'listings', 'bids', 'orders', 'trades', 'tradeItems',
    'vault', 'shipments', 'auth', 'ledger', 'boosts', 'disputes', 'escrow', 'events', 'portfolios'];
  const repo = {};
  for (const n of names) repo[n] = collection();
  repo.tx = async (fn) => fn(repo);   // memory store has no real transaction
  repo.kind = 'memory';
  return repo;
}
