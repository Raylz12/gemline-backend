// Escrow: money is held by the platform, never the seller, until the asset is
// confirmed. Each function maps to a Stripe Connect call (noted inline). The
// `stripe` arg is a pluggable client; in the demo it's a no-op stub.
import { transition } from './machine.js';
import { ESCROW as S } from './states.js';

export async function hold(repo, stripe, { orderId = null, tradeId = null, payerId, payeeId = null, amount, fee = 0, currency = 'USD' }) {
  // Stripe: PaymentIntent with capture_method:'manual' (authorize, hold funds).
  const pi = await stripe.authorize({ amount, currency, payerId });
  const rec = await repo.escrow.insert({
    order_id: orderId, trade_id: tradeId, payer_id: payerId, payee_id: payeeId,
    amount, platform_fee: fee, currency, status: S.HELD,
    stripe_payment_intent_id: pi.id, created_at: new Date().toISOString(),
  });
  await repo.events.insert({ entity_type: 'escrow', entity_id: rec.id, from_state: null, to_state: S.HELD, payload: { amount } });
  return rec;
}

export async function release(repo, stripe, escrow, { payeeId } = {}) {
  // Stripe: capture the PI, then Transfer (amount - fee) to seller's connected acct.
  await stripe.capture(escrow.stripe_payment_intent_id);
  const net = Number(escrow.amount) - Number(escrow.platform_fee || 0);
  const tr = await stripe.transfer({ amount: net, destination: payeeId || escrow.payee_id });
  escrow.stripe_transfer_id = tr.id;
  return transition(repo, 'escrow', escrow, S.RELEASED, { payload: { net } });
}

export async function refund(repo, stripe, escrow) {
  // Stripe: cancel the PI if uncaptured, or Refund if already captured.
  await stripe.refund(escrow.stripe_payment_intent_id);
  return transition(repo, 'escrow', escrow, S.REFUNDED, {});
}
