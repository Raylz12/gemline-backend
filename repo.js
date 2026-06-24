// Picks the store: Postgres when DATABASE_URL is set, otherwise in-memory.
import { memoryRepo } from './memory.js';

export async function makeRepo() {
  if (process.env.DATABASE_URL) {
    const { pgRepo } = await import('./pg.js');
    return pgRepo(process.env.DATABASE_URL);
  }
  return memoryRepo();
}

// Stripe Connect client. The stub returns fake ids so the engine runs end-to-end
// without keys. Swap for a real implementation backed by the `stripe` SDK:
//   authorize → PaymentIntent (capture_method:'manual')
//   capture   → paymentIntents.capture
//   transfer  → transfers.create (to seller's connected account)
//   refund    → refunds.create / paymentIntents.cancel
let _seq = 0;
const fakeId = (p) => `${p}_${Date.now()}_${++_seq}`;
export const stripeStub = {
  async authorize({ amount }) { return { id: fakeId('pi'), amount, status: 'requires_capture' }; },
  async capture(piId) { return { id: piId, status: 'succeeded' }; },
  async transfer({ amount, destination }) { return { id: fakeId('tr'), amount, destination }; },
  async refund(piId) { return { id: fakeId('re'), payment_intent: piId, status: 'refunded' }; },
};
