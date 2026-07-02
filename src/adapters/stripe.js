/**
 * stripe.js — Stripe Connect v2 adapter for GEMLINE marketplace
 *
 * Flow:
 *   1. Seller onboards via Stripe Connect v2 (account controller model)
 *   2. Buyer hits "Buy Now" → createCheckoutSession with destination charge
 *   3. Platform takes 10% application fee, rest goes to seller's connected account
 *
 * Seller onboarding: Stripe Connect v2 (controller model)
 *   POST /api/connect/onboard → creates v2 account + onboarding link
 *   GET  /api/connect/status  → check if payouts enabled
 */

const PLATFORM_FEE_PCT = 0.10; // 10%

let _stripe = null;
async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (_stripe) return _stripe;
  const { default: Stripe } = await import('stripe');
  _stripe = new Stripe(key); // NO apiVersion parameter
  return _stripe;
}

// ── Stripe Connect v2 — Seller Onboarding ─────────────────────────────────────

export async function createConnectAccount({ email, handle, country = 'US' }) {
  const stripe = await getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const account = await stripe.accounts.create({
    controller: {
      losses: { payments: 'application' },
      fees: { payer: 'application' },
      stripe_dashboard: { type: 'express' },
    },
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    country,
    email,
    business_profile: {
      name: `GEMLINE: ${handle}`,
      product_description: 'Trading card sales via GEMLINE marketplace',
    },
    metadata: { gemline_handle: handle },
  });
  return { accountId: account.id };
}

export async function createOnboardingLink({ accountId, returnUrl, refreshUrl }) {
  const stripe = await getStripe();
  if (!stripe) throw new Error('Stripe not configured');
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return { url: link.url, expiresAt: link.expires_at };
}

export async function getAccountStatus(accountId) {
  const stripe = await getStripe();
  if (!stripe) return { enabled: false };
  const account = await stripe.accounts.retrieve(accountId);
  return {
    enabled: account.payouts_enabled && account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    chargesEnabled: account.charges_enabled,
    requirements: account.requirements?.currently_due || [],
  };
}

// ── Checkout Session (marketplace payment with fee) ───────────────────────────

export async function createCheckoutSession({ lineItems, sellerAccountId, applicationFeeAmount, successUrl, cancelUrl }) {
  const stripe = await getStripe();
  if (!stripe) throw new Error('Stripe not configured');
  const session = await stripe.checkout.sessions.create({
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: lineItems,
    mode: 'payment',
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount,
      transfer_data: { destination: sellerAccountId },
    },
  });
  return { url: session.url, sessionId: session.id };
}

// ── Payment Intents (kept for backward compat / escrow flow) ──────────────────

// NOTE: all `amount` values in this adapter are integer CENTS — listings,
// orders, and escrow rows store cents. Do not multiply by 100 again.
export async function createPaymentIntent({ amount, currency = 'USD', buyerId, listingId, sellerId, metadata = {} }) {
  const stripe = await getStripe();
  if (!stripe) throw new Error('Stripe not configured — set STRIPE_SECRET_KEY');

  const amountCents = Math.round(Number(amount));
  const feeCents = Math.round(amountCents * PLATFORM_FEE_PCT);

  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: currency.toLowerCase(),
    capture_method: 'manual',
    confirm: false,
    metadata: {
      gemline_listing_id: listingId || '',
      gemline_buyer_id: buyerId || '',
      gemline_seller_id: sellerId || '',
      ...metadata,
    },
  });

  return {
    id: pi.id,
    clientSecret: pi.client_secret,
    amount: amountCents,
    fee: feeCents,
    status: pi.status,
  };
}

export async function authorize({ amount, currency = 'usd', payerId }) {
  const stripe = await getStripe();
  if (!stripe) {
    return { id: `pi_stub_${Date.now()}`, status: 'requires_capture' };
  }
  const amountCents = Math.round(Number(amount));
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: currency.toLowerCase(),
    capture_method: 'manual',
    metadata: { payer_id: payerId || '' },
  });
  return { id: pi.id, status: pi.status, amount: pi.amount };
}

// Capture is defensive: it never throws. If the PI was never confirmed by the
// buyer (no payment method attached) it reports that instead of blowing up the
// order settlement — callers must check `status === 'succeeded'` before paying
// the seller out of platform funds.
export async function capture(paymentIntentId) {
  const stripe = await getStripe();
  if (!stripe || !paymentIntentId || paymentIntentId.startsWith('pi_stub')) return { id: paymentIntentId, status: 'succeeded' };
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'succeeded') return { id: pi.id, status: 'succeeded' };
    if (pi.status !== 'requires_capture') {
      console.error('capture skipped — PI', paymentIntentId, 'is', pi.status);
      return { id: pi.id, status: pi.status, error: 'not_capturable' };
    }
    const done = await stripe.paymentIntents.capture(paymentIntentId, undefined, { idempotencyKey: `capture_${paymentIntentId}` });
    return { id: done.id, status: done.status, amount: done.amount };
  } catch (e) {
    console.error('Capture failed:', e.message);
    return { id: paymentIntentId, status: 'failed', error: e.message };
  }
}

export async function transfer({ amount, destination, idempotencyKey = null }) {
  const stripe = await getStripe();
  if (!stripe || !destination) return { id: `tr_stub_${Date.now()}` };
  const amountCents = Math.round(Number(amount));
  if (amountCents <= 0) return { id: `tr_zero_${Date.now()}` };
  try {
    const tr = await stripe.transfers.create(
      { amount: amountCents, currency: 'usd', destination },
      idempotencyKey ? { idempotencyKey } : undefined
    );
    return { id: tr.id };
  } catch (e) {
    console.error('Transfer failed:', e.message);
    return { id: `tr_failed_${Date.now()}`, error: e.message };
  }
}

export async function refund(paymentIntentId) {
  const stripe = await getStripe();
  if (!stripe || paymentIntentId.startsWith('pi_stub')) return { id: `re_stub_${Date.now()}` };
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.cancel(paymentIntentId);
      return { id: `cancelled_${paymentIntentId}` };
    }
    const re = await stripe.refunds.create({ payment_intent: paymentIntentId });
    return { id: re.id };
  } catch (e) {
    console.error('Refund failed:', e.message);
    return { id: `re_failed_${Date.now()}`, error: e.message };
  }
}

// ── Webhook verification ──────────────────────────────────────────────────────
export async function verifyWebhook(rawBody, signature) {
  const stripe = await getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return null;
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

// ── Real Stripe client object (replaces stripeStub in production) ─────────────
export const stripeClient = {
  authorize,
  capture,
  transfer,
  refund,
};
