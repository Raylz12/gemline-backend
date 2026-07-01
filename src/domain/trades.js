// Peer-to-peer trades. On accept we pick a settlement mode:
//   vault_instant → every item is already vaulted: swap ownership atomically
//                   (+ move any cash boot through escrow) and settle instantly.
//   escrow_ship   → some item must be mailed in: both parties ship to the hub,
//                   nothing releases until BOTH sides arrive and clear.
import { transition } from './machine.js';
import { TRADE } from './states.js';
import * as escrowSvc from './escrow.js';
import * as vaultSvc from './vault.js';

export async function propose(repo, { proposerId, counterpartyId, give = [], get = [], cashFromProposer = 0, cashFromCounterparty = 0, expiresAt = null }) {
  if (!proposerId) throw Object.assign(new Error('proposerId required'), { status: 400 });
  if (!counterpartyId) throw Object.assign(new Error('counterpartyId required'), { status: 400 });
  if (proposerId === counterpartyId) throw Object.assign(new Error('Cannot trade with yourself'), { status: 400 });
  if (!give.length && !get.length) throw Object.assign(new Error('Must include at least one card'), { status: 400 });

  const trade = await repo.trades.insert({
    proposer_id: proposerId, counterparty_id: counterpartyId, status: TRADE.PROPOSED,
    cash_from_proposer: cashFromProposer, cash_from_counterparty: cashFromCounterparty,
    expires_at: expiresAt, created_at: new Date().toISOString(),
  });

  // Batch insert trade items in parallel rather than serial loop
  const allItems = [
    ...give.map(it => ({ trade_id: trade.id, side: 'proposer', card_id: it.cardId, vault_item_id: it.vaultItemId || null })),
    ...get.map(it => ({ trade_id: trade.id, side: 'counterparty', card_id: it.cardId, vault_item_id: it.vaultItemId || null })),
  ];

  if (repo.pool && allItems.length > 0) {
    const placeholders = allItems.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ');
    const values = allItems.flatMap(it => [it.trade_id, it.side, it.card_id, it.vault_item_id]);
    await repo.pool.query(
      `INSERT INTO trade_items (trade_id, side, card_id, vault_item_id) VALUES ${placeholders}`,
      values
    );
  } else {
    await Promise.all(allItems.map(it => repo.tradeItems.insert(it)));
  }

  await repo.events.insert({ entity_type: 'trade', entity_id: trade.id, from_state: null, to_state: TRADE.PROPOSED });
  return trade;
}

export async function decline(repo, trade) { return transition(repo, 'trade', trade, TRADE.DECLINED, {}); }
export async function cancel(repo, trade)  { return transition(repo, 'trade', trade, TRADE.CANCELLED, {}); }

export async function accept(repo, stripe, trade) {
  const items = await repo.tradeItems.list({ trade_id: trade.id });
  const allVaulted = items.every(i => i.vault_item_id);
  trade.settlement_mode = allVaulted ? 'vault_instant' : 'escrow_ship';
  await repo.trades.update(trade);
  await transition(repo, 'trade', trade, TRADE.ACCEPTED, {});

  // Cash boot (if any) is escrowed from whichever side owes it.
  if (Number(trade.cash_from_proposer) > 0)
    await escrowSvc.hold(repo, stripe, { tradeId: trade.id, payerId: trade.proposer_id, payeeId: trade.counterparty_id, amount: trade.cash_from_proposer });
  if (Number(trade.cash_from_counterparty) > 0)
    await escrowSvc.hold(repo, stripe, { tradeId: trade.id, payerId: trade.counterparty_id, payeeId: trade.proposer_id, amount: trade.cash_from_counterparty });

  if (allVaulted) return settleInstant(repo, stripe, trade, items);
  return transition(repo, 'trade', trade, TRADE.SETTLING, {});
}

async function finalizeSwap(repo, trade, items) {
  for (const it of items) {
    const newOwner = it.side === 'proposer' ? trade.counterparty_id : trade.proposer_id;
    if (it.vault_item_id) {
      const vi = await repo.vault.get(it.vault_item_id);
      if (vi) await vaultSvc.transferOwnership(repo, vi, newOwner); // never moves physically
    } else {
      await repo.shipments.insert({                                  // mailed item forwarded to new owner
        trade_id: trade.id, direction: 'hub_to_buyer', status: 'in_transit',
        shipped_at: new Date().toISOString(), created_at: new Date().toISOString(),
      });
    }
  }
}

async function settleInstant(repo, stripe, trade, items) {
  await finalizeSwap(repo, trade, items);
  await releaseTradeEscrow(repo, stripe, trade);
  return transition(repo, 'trade', trade, TRADE.SETTLED, {});
}

// escrow_ship: called as each inbound shipment is received + authenticated.
export async function markItemReceived(repo, stripe, trade, tradeItemId) {
  const items = await repo.tradeItems.list({ trade_id: trade.id });
  const it = items.find(i => i.id === tradeItemId);
  if (it) { it.received = true; await repo.tradeItems.update(it); }
  const physical = items.filter(i => !i.vault_item_id);
  if (physical.length && physical.every(i => i.received)) {
    // Both sides have arrived and cleared → swap ownership/forward, then settle.
    await finalizeSwap(repo, trade, items);
    await releaseTradeEscrow(repo, stripe, trade);
    return transition(repo, 'trade', trade, TRADE.SETTLED, {});
  }
  return trade;
}

async function releaseTradeEscrow(repo, stripe, trade) {
  const holds = await repo.escrow.list({ trade_id: trade.id });
  for (const h of holds) if (h.status === 'held') await escrowSvc.release(repo, stripe, h, { payeeId: h.payee_id });
}

export { TRADE };
