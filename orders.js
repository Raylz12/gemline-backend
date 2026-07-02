// Order lifecycle: checkout → escrow held → fulfillment → inspection → settle.
// Three fulfillment methods diverge after escrow:
//   vault         → instant settle (ownership transfer, no shipping)
//   authenticated → seller ships to hub, we verify, then forward to buyer
//   direct        → seller ships straight to buyer
import { transition } from './machine.js';
import { ORDER } from './states.js';
import * as escrowSvc from './escrow.js';
import * as vaultSvc from './vault.js';

const INSPECTION_DAYS = 2;

export async function create(repo, stripe, { listingId = null, cardId, buyerId, sellerId, amount, fee = 0, method, vaultItemId = null }) {
  const order = await repo.orders.insert({
    listing_id: listingId, card_id: cardId, buyer_id: buyerId, seller_id: sellerId,
    amount, platform_fee: fee, currency: 'USD', fulfillment_method: method,
    status: ORDER.CREATED, created_at: new Date().toISOString(),
  });
  await repo.events.insert({ entity_type: 'order', entity_id: order.id, from_state: null, to_state: ORDER.CREATED });

  // Hold buyer funds in escrow immediately. Seller is not paid yet.
  const escrow = await escrowSvc.hold(repo, stripe, {
    orderId: order.id, payerId: buyerId, payeeId: sellerId, amount, fee,
  });
  order.escrow_id = escrow.id;
  await transition(repo, 'order', order, ORDER.ESCROW_HELD, { actor: buyerId });

  if (method === 'vault') {
    // Both parties' cards live in the vault → transfer ownership and settle now.
    if (vaultItemId) {
      const vi = await repo.vault.get(vaultItemId);
      if (vi) await vaultSvc.transferOwnership(repo, vi, buyerId);
    }
    return settle(repo, stripe, order);
  }
  return transition(repo, 'order', order, ORDER.AWAITING_SHIPMENT, { actor: sellerId });
}

// Seller ships. For 'authenticated', the first hop goes to the hub.
export async function ship(repo, order, { carrier, tracking, insuredValue, signature = true }) {
  const toHub = order.fulfillment_method === 'authenticated';
  const shipment = await repo.shipments.insert({
    order_id: order.id, direction: toHub ? 'to_hub' : 'seller_to_buyer',
    carrier, tracking_number: tracking, insured_value: insuredValue,
    signature_required: signature, status: 'in_transit',
    shipped_at: new Date().toISOString(), created_at: new Date().toISOString(),
  });
  if (toHub) await transition(repo, 'order', order, ORDER.AT_AUTH_HUB, { actor: order.seller_id });
  else await transition(repo, 'order', order, ORDER.SHIPPED, { actor: order.seller_id });
  return { order, shipment };
}

// Authentication step for 'authenticated' orders, at the hub.
export async function authenticateAtHub(repo, stripe, order, { result = 'passed', certLookup = null } = {}) {
  await transition(repo, 'order', order, ORDER.AUTHENTICATING, {});
  await repo.auth.insert({ order_id: order.id, result, cert_lookup: certLookup, created_at: new Date().toISOString() });
  if (result !== 'passed') {
    await transition(repo, 'order', order, ORDER.AUTH_FAILED, {});
    const escrow = await repo.escrow.get(order.escrow_id);
    await escrowSvc.refund(repo, stripe, escrow);     // counterfeit/altered → buyer refunded
    return transition(repo, 'order', order, ORDER.REFUNDED, {});
  }
  await transition(repo, 'order', order, ORDER.AUTH_PASSED, {});
  // Forward the verified card to the buyer.
  await repo.shipments.insert({
    order_id: order.id, direction: 'hub_to_buyer', status: 'in_transit',
    shipped_at: new Date().toISOString(), created_at: new Date().toISOString(),
  });
  return transition(repo, 'order', order, ORDER.SHIPPED, {});
}

// Carrier delivered webhook → start the inspection window.
export async function markDelivered(repo, order, shipment = null) {
  if (shipment) {
    shipment.delivered_at = new Date().toISOString();
    await transition(repo, 'shipment', shipment, 'delivered', {});
  }
  await transition(repo, 'order', order, ORDER.DELIVERED, {});
  order.inspection_ends_at = new Date(Date.now() + INSPECTION_DAYS * 86400e3).toISOString();
  await repo.orders.update(order);
  return transition(repo, 'order', order, ORDER.INSPECTION, {});
}

// Buyer accepts (or inspection window lapses) → pay the seller.
export async function settle(repo, stripe, order) {
  const escrow = await repo.escrow.get(order.escrow_id);
  if (escrow && escrow.status === 'held') await escrowSvc.release(repo, stripe, escrow, { payeeId: order.seller_id });
  if (order.listing_id) {
    const l = await repo.listings.get(order.listing_id);
    if (l) { l.status = 'sold'; await repo.listings.update(l); }
  }
  return transition(repo, 'order', order, ORDER.SETTLED, {});
}

// Buyer opens a not-as-described dispute during the inspection window.
export async function dispute(repo, order, { openerId, reason, evidence = null }) {
  await repo.disputes.insert({ order_id: order.id, opener_id: openerId, reason, status: 'open', evidence, created_at: new Date().toISOString() });
  return transition(repo, 'order', order, ORDER.DISPUTED, { actor: openerId });
}

export async function resolveDispute(repo, stripe, order, { outcome }) {
  const escrow = await repo.escrow.get(order.escrow_id);
  if (outcome === 'refund') {
    if (escrow) await escrowSvc.refund(repo, stripe, escrow);
    return transition(repo, 'order', order, ORDER.REFUNDED, {});
  }
  if (escrow) await escrowSvc.release(repo, stripe, escrow, { payeeId: order.seller_id });
  return transition(repo, 'order', order, ORDER.SETTLED, {});
}

export { ORDER };
