// Escrow: money is held by the platform, never the seller, until the asset is
// confirmed. Each function maps to a Stripe Connect call (noted inline). The
// `stripe` arg is a pluggable client; in the demo it's a no-op stub.
import { transition } from './machine.js';
import { ESCROW as S } from './states.js';

export async function hold(repo, stripe, {
  orderId = null,
  tradeId = null,
  payerId,
  payeeId = null,
  amount,
  fee = 0,
  currency = 'USD',
}) {
  if (!amount || amount <= 0) throw new Error('Invalid escrow amount');
  if (!payerId) throw new Error('payerId required');

  // Stripe: PaymentIntent with capture_method:'manual' (authorize, hold funds).
  const pi = await stripe.authorize({ amount, currency, payerId });
  const rec = await repo.escrow.insert({
    order_id: orderId,
    trade_id: tradeId,
    payer_id: payerId,
    payee_id: payeeId,
    amount,
    platform_fee: fee,
    currency,
    status: S.HELD,
    stripe_payment_intent_id: pi.id,
    created_at: new Date().toISOString(),
  });
  await repo.events.insert({
    entity_type: 'escrow',
    entity_id: rec.id,
    from_state: null,
    to_state: S.HELD,
    payload: { amount },
  });
  return rec;
}

export async function release(repo, stripe, escrow, { payeeId } = {}) {
  if (!escrow) throw new Error('escrow record required');
  if (escrow.status !== S.HELD && escrow.status !== 'partial')
    throw new Error(`Cannot release escrow in state: ${escrow.status}`);

  // Stripe: capture the PI, then Transfer (amount - fee) to seller's connected acct.
  // Hardening: destination must be the seller's Stripe account id (not a user
  // uuid), transfers only fire when the buyer's payment actually captured, and
  // the transfer is idempotent per escrow row so retries can't double-pay.
  const payeeUserId = payeeId || escrow.payee_id;
  let destination = null;
  try { destination = (await repo.users.get(payeeUserId))?.stripe_account_id || null; } catch {}

  const cap = await stripe.capture(escrow.stripe_payment_intent_id);
  const captured = cap?.status === 'succeeded';
  const net = Number(escrow.amount) - Number(escrow.platform_fee || 0);
  if (net < 0) throw new Error('Platform fee exceeds escrow amount');

  let tr = { id: null };
  if (captured && destination) {
    tr = await stripe.transfer({ amount: net, destination, idempotencyKey: `escrow_release_${escrow.id}` });
  }
  escrow.stripe_transfer_id = tr.id;
  return transition(repo, 'escrow', escrow, S.RELEASED, { payload: { net, captured, hasConnectedAccount: !!destination } });
}

export async function refund(repo, stripe, escrow) {
  if (!escrow) throw new Error('escrow record required');
  if (escrow.status === S.RELEASED)
    throw new Error('Cannot refund an already-released escrow');
  if (escrow.status === S.REFUNDED)
    throw new Error('Escrow already refunded');

  // Stripe: cancel the PI if uncaptured, or Refund if already captured.
  await stripe.refund(escrow.stripe_payment_intent_id);
  return transition(repo, 'escrow', escrow, S.REFUNDED, {});
}

export async function partialRelease(repo, stripe, escrow, { buyerRefund, sellerNet, payeeId }) {
  if (!escrow) throw new Error('escrow record required');
  if (escrow.status !== S.HELD) throw new Error(`Cannot partial-release in state: ${escrow.status}`);
  const total = Number(escrow.amount);
  if (buyerRefund + sellerNet > total)
    throw new Error('Partial amounts exceed escrow total');

  // Refund buyer's portion
  if (buyerRefund > 0) {
    await stripe.partialRefund(escrow.stripe_payment_intent_id, buyerRefund);
  }
  // Capture and transfer seller's portion
  if (sellerNet > 0) {
    await stripe.capturePartial(escrow.stripe_payment_intent_id, sellerNet);
    await stripe.transfer({ amount: sellerNet, destination: payeeId || escrow.payee_id });
  }
  escrow.amount = sellerNet;
  return transition(repo, 'escrow', escrow, S.PARTIAL, {
    payload: { buyerRefund, sellerNet },
  });
}

export async function void_(repo, stripe, escrow) {
  if (!escrow) throw new Error('escrow record required');
  if (escrow.status !== S.HELD)
    throw new Error(`Cannot void escrow in state: ${escrow.status}`);

  // Cancel the payment intent entirely
  await stripe.cancel(escrow.stripe_payment_intent_id);
  return transition(repo, 'escrow', escrow, S.VOID, {});
}
