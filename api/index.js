// Vercel serverless entry point — wraps the Express app.
import express from 'express';
import cors from 'cors';
import { makeRepo, stripeStub } from '../src/store/repo.js';
import { settlementRouter } from '../src/routes/settlement.js';

const app = express();
app.use(cors());
app.use(express.json());

// Lazy-init repo (shared across warm invocations)
let repo;
async function getRepo() {
  if (!repo) repo = await makeRepo();
  return repo;
}

app.get('/health', async (_req, res) => {
  const r = await getRepo();
  res.json({
    ok: true,
    store: r.kind,
    env: {
      cardhedge: !!process.env.CARDHEDGE_API_KEY,
      ebay: !!process.env.EBAY_CLIENT_ID,
      apify: !!process.env.APIFY_TOKEN,
      stripe: !!process.env.STRIPE_SECRET_KEY,
      db: !!process.env.DATABASE_URL,
    },
  });
});

app.use('/api', async (req, res, next) => {
  const r = await getRepo();
  settlementRouter(r, stripeStub)(req, res, next);
});

app.get('/feed', (_req, res) => {
  res.json({ live: false, cards: [], message: 'Demo mode — add API keys to enable live data' });
});

export default app;
