// Entry point — Express server + settlement engine + /feed route.
import express from 'express';
import cors from 'cors';
import { makeRepo, stripeStub } from './src/store/repo.js';
import { settlementRouter } from './src/routes/settlement.js';

const app = express();
app.use(cors());
app.use(express.json());

const repo = await makeRepo();
const stripe = stripeStub; // swap for real Stripe client when ready

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    store: repo.kind,
    env: {
      cardhedge: !!process.env.CARDHEDGE_API_KEY,
      ebay: !!process.env.EBAY_CLIENT_ID,
      apify: !!process.env.APIFY_TOKEN,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      db: !!process.env.DATABASE_URL,
    },
  });
});

// Settlement engine routes
app.use('/api', settlementRouter(repo, stripe));

// /feed — arbitrage spread feed (returns empty in demo mode, populate via adapters)
app.get('/feed', (_req, res) => {
  res.json({ live: false, cards: [], message: 'Demo mode — add API keys to enable live data' });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`GEMLINE backend running on http://localhost:${PORT}`));

export default app;
