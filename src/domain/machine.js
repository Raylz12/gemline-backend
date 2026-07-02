// The one function that changes any entity's state. It refuses illegal moves
// and records every accepted move to the audit log, so the full history of who
// moved what is always reconstructable — the spine of the guarantee.
import { MACHINES } from './states.js';

export class TransitionError extends Error {
  constructor(type, from, to) {
    super(`Illegal ${type} transition: ${from} → ${to}`);
    this.name = 'TransitionError';
    this.code = 'ILLEGAL_TRANSITION';
  }
}

export function can(type, from, to) {
  const map = MACHINES[type];
  if (!map) throw new Error(`Unknown machine: ${type}`);
  return (map[from] || []).includes(to);
}

// record: { id, status }. Mutates status, appends an event via repo, returns record.
const REPO_KEY = { order: 'orders', trade: 'trades', vault: 'vault', shipment: 'shipments', escrow: 'escrow' };

export async function transition(repo, type, record, to, { actor = null, payload = null } = {}) {
  const from = record.status;
  if (!can(type, from, to)) throw new TransitionError(type, from, to);
  const now = new Date().toISOString();
  record.status = to;
  // Only touch updated_at when the row actually has that column (shipments don't).
  if ('updated_at' in record || !('created_at' in record)) record.updated_at = now;
  // Persist the new state — without this, status changes only lived in memory.
  const key = REPO_KEY[type];
  if (key && repo[key]?.update) await repo[key].update(record);
  await repo.events.insert({
    entity_type: type, entity_id: record.id, from_state: from, to_state: to,
    actor_id: actor, payload, created_at: now,
  });
  return record;
}
