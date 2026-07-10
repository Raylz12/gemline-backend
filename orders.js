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

export async function create(repo, stripe, { listingId = null, cardId, buyerId, sellerId, amount, fee = 0, feeBps = undefined, method, vaultItemId = null }) {
  const order = await repo.orders.insert({
    listing_id: listingId, card_id: cardId, buyer_id: buyerId, seller_id: sellerId,
    amount, platform_fee: fee, fee_bps: feeBps, currency: 'USD', fulfillment_method: method,
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

// ── Checkout with real payment capture ──────────────────────────────────────
// beginCheckout: order starts in pending_payment with an unconfirmed PI whose
// client_secret goes back to the buyer's Payment Element. Nothing is owed or
// shipped until the buyer actually confirms the payment (finalizePayment).
// feeBps: the seller's tier rate at creation time — stored on the row so the
// rate is locked for the life of the order (settlement uses stored platform_fee).
export async function beginCheckout(repo, stripe, { listingId = null, cardId, buyerId, sellerId, amount, fee = 0, feeBps = undefined, method, paymentDueAt = null }) {
  const order = await repo.orders.insert({
    listing_id: listingId, card_id: cardId, buyer_id: buyerId, seller_id: sellerId,
    amount, platform_fee: fee, fee_bps: feeBps, currency: 'USD', fulfillment_method: method,
    status: ORDER.CREATED, payment_due_at: paymentDueAt, created_at: new Date().toISOString(),
  });
  await repo.events.insert({ entity_type: 'order', entity_id: order.id, from_state: null, to_state: ORDER.CREATED });

  const escrow = await escrowSvc.hold(repo, stripe, {
    orderId: order.id, payerId: buyerId, payeeId: sellerId, amount, fee,
    metadata: { gemline_listing_id: listingId || '', gemline_buyer_id: buyerId || '', gemline_seller_id: sellerId || '' },
  });
  order.escrow_id = escrow.id;
  await transition(repo, 'order', order, ORDER.PENDING_PAYMENT, { actor: buyerId, payload: { amount, fee } });
  return { order, escrow, clientSecret: escrow.client_secret, paymentIntentId: escrow.stripe_payment_intent_id };
}

// Buyer confirmed the PI (webhook or client-side completion ping) — move the
// order into fulfillment. Idempotent: a non-pending order is returned as-is.
export async function finalizePayment(repo, stripe, order, { actor = null } = {}) {
  if (order.status !== ORDER.PENDING_PAYMENT) return order;
  if (order.fulfillment_method === 'vault') {
    // Vault-held card — transfer ownership and settle instantly (capture + payout).
    const listing = order.listing_id ? await repo.listings.get(order.listing_id) : null;
    const vaultItemId = listing?.vault_item_id || null;
    if (vaultItemId) {
      const vi = await repo.vault.get(vaultItemId);
      if (vi) await vaultSvc.transferOwnership(repo, vi, order.buyer_id);
    }
    return settle(repo, stripe, order);
  }
  return transition(repo, 'order', order, ORDER.AWAITING_SHIPMENT, { actor });
}

// Buyer abandoned/expired checkout — cancel PI, void hold, cancel order.
// Safe: the PI was never confirmed, so no funds were ever authorized.
export async function cancelPendingPayment(repo, stripe, order, { reason = 'payment_abandoned' } = {}) {
  if (order.status !== ORDER.PENDING_PAYMENT) return { order, pi: null };
  let pi = null;
  if (order.escrow_id) {
    const escrow = await repo.escrow.get(order.escrow_id);
    if (escrow && escrow.status === 'held') pi = await escrowSvc.voidHold(repo, stripe, escrow);
  }
  await transition(repo, 'order', order, ORDER.CANCELLED, { payload: { reason } });
  return { order, pi };
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
