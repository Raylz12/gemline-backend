// Picks the store: Postgres when DATABASE_URL is set, otherwise in-memory.
import { memoryRepo } from './memory.js';

// ── Money units ────────────────────────────────────────────────────────────────
// The store keeps all listing/order/escrow amounts as integer CENTS. The API
// speaks dollars. These are the single source of truth for the conversion so
// creation paths can't diverge (previously portfolio/list stored raw dollars
// while POST /api/listings stored cents — a card listed via portfolio read back
// at 1/100th its price). Always toCents() on write, fromCents() on read.
export const toCents = (dollars) => Math.round(Number(dollars) * 100);
export const fromCents = (cents) => Number(cents) / 100;

export async function makeRepo() {
  if (process.env.DATABASE_URL) {
    const { pgRepo } = await import('./pg.js');
    return pgRepo(process.env.DATABASE_URL);
  }
  return memoryRepo();
}

// ── Stripe stub ────────────────────────────────────────────────────────────────
// Real Stripe is wired in api/index.js when STRIPE_SECRET_KEY is set.
// This stub returns fake ids so the engine runs end-to-end without keys.
//
//   authorize → PaymentIntent (capture_method:'manual')
//   capture   → paymentIntents.capture
//   capturePartial → paymentIntents.capture with amount_to_capture
//   transfer  → transfers.create (to seller's connected account)
//   refund    → refunds.create
//   partialRefund → refunds.create with amount
//   cancel    → paymentIntents.cancel

let _seq = 0;
const fakeId = (p) => `${p}_${Date.now()}_${++_seq}`;

export const stripeStub = {
  async authorize({ amount })               { return { id: fakeId('pi'), amount, status: 'requires_capture', client_secret: null }; },
  async retrieve(piId)                      { return { id: piId, status: 'requires_capture', client_secret: null }; },
  async capture(piId)                       { return { id: piId, status: 'succeeded' }; },
  async capturePartial(piId, amount)        { return { id: piId, amount, status: 'succeeded' }; },
  async transfer({ amount, destination })   { return { id: fakeId('tr'), amount, destination }; },
  async refund(piId)                        { return { id: fakeId('re'), payment_intent: piId, status: 'succeeded' }; },
  async partialRefund(piId, amount)         { return { id: fakeId('re'), payment_intent: piId, amount, status: 'succeeded' }; },
  async cancel(piId)                        { return { id: piId, status: 'canceled' }; },
};
