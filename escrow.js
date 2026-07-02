// Escrow: money is held by the platform, never the seller, until the asset is
// confirmed. Each function maps to a Stripe Connect call (noted inline). The
// `stripe` arg is a pluggable client; in the demo it's a no-op stub.
import { transition } from './machine.js';
import { ESCROW as S } from './states.js';

export async function hold(repo, stripe, { orderId = null, tradeId = null, payerId, payeeId = null, amount, fee = 0, currency = 'USD', metadata = {} }) {
  // Stripe: PaymentIntent with capture_method:'manual' (authorize, hold funds).
  const pi = await stripe.authorize({ amount, currency, payerId, metadata: { gemline_order_id: orderId || '', ...metadata } });
  const rec = await repo.escrow.insert({
    order_id: orderId, trade_id: tradeId, payer_id: payerId, payee_id: payeeId,
    amount, platform_fee: fee, currency, status: S.HELD,
    stripe_payment_intent_id: pi.id, created_at: new Date().toISOString(),
  });
  await repo.events.insert({ entity_type: 'escrow', entity_id: rec.id, from_state: null, to_state: S.HELD, payload: { amount } });
  // Non-persisted: handed to the buyer's Payment Element to confirm the PI.
  rec.client_secret = pi.client_secret || null;
  return rec;
}

// Checkout abandoned/expired before the buyer confirmed — cancel the PI and
// void the hold. No money ever moved (the PI was never confirmed).
export async function voidHold(repo, stripe, escrow) {
  let pi = { id: escrow.stripe_payment_intent_id, status: 'canceled' };
  if (stripe.cancel) pi = await stripe.cancel(escrow.stripe_payment_intent_id);
  await transition(repo, 'escrow', escrow, S.VOID, { payload: { pi_status: pi?.status || null } });
  return pi;
}

export async function release(repo, stripe, escrow, { payeeId } = {}) {
  // Stripe: capture the PI, then Transfer (amount - fee) to seller's connected acct.
  // Payout-on-delivery hardening:
  //   • destination is the seller's Stripe *account id*, never their user uuid
  //   • transfer only fires if the buyer's payment actually captured — never pay
  //     sellers out of platform balance for uncollected payments
  //   • transfer is idempotent per escrow row, so retries can't double-pay
  const payeeUserId = payeeId || escrow.payee_id;
  let destination = null;
  try { destination = (await repo.users.get(payeeUserId))?.stripe_account_id || null; } catch {}

  const cap = await stripe.capture(escrow.stripe_payment_intent_id);
  const captured = cap?.status === 'succeeded';
  const net = Number(escrow.amount) - Number(escrow.platform_fee || 0);

  let tr = { id: null };
  if (captured && destination) {
    tr = await stripe.transfer({ amount: net, destination, idempotencyKey: `escrow_release_${escrow.id}` });
  }
  escrow.stripe_transfer_id = tr.id;
  return transition(repo, 'escrow', escrow, S.RELEASED, { payload: { net, captured, hasConnectedAccount: !!destination } });
}

export async function refund(repo, stripe, escrow) {
  // Stripe: cancel the PI if uncaptured, or Refund if already captured.
  await stripe.refund(escrow.stripe_payment_intent_id);
  return transition(repo, 'escrow', escrow, S.REFUNDED, {});
}
