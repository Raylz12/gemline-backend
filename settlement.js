// HTTP surface for the settlement engine. Thin handlers — all logic lives in
// the domain services. Mounted at /api by server.js.
import { Router } from 'express';
import * as orders from '../domain/orders.js';
import * as trades from '../domain/trades.js';
import * as vault from '../domain/vault.js';
import * as ledger from '../domain/ledger.js';

export function settlementRouter(repo, stripe) {
  const r = Router();
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.code === 'ILLEGAL_TRANSITION' ? 409 : 400).json({ error: e.message, code: e.code }); }
  };
  const need = async (col, id) => { const x = await repo[col].get(id); if (!x) { const e = new Error(`${col} not found`); e.code = 'NOT_FOUND'; throw e; } return x; };

  // ── orders ──
  r.post('/orders', wrap(req => orders.create(repo, stripe, req.body)));
  r.post('/orders/:id/ship', wrap(async req => orders.ship(repo, await need('orders', req.params.id), req.body)));
  r.post('/orders/:id/authenticate', wrap(async req => orders.authenticateAtHub(repo, stripe, await need('orders', req.params.id), req.body)));
  r.post('/orders/:id/delivered', wrap(async req => orders.markDelivered(repo, await need('orders', req.params.id))));
  r.post('/orders/:id/settle', wrap(async req => orders.settle(repo, stripe, await need('orders', req.params.id))));
  r.post('/orders/:id/dispute', wrap(async req => orders.dispute(repo, await need('orders', req.params.id), req.body)));
  r.post('/orders/:id/resolve', wrap(async req => orders.resolveDispute(repo, stripe, await need('orders', req.params.id), req.body)));

  // ── trades ──
  r.post('/trades', wrap(req => trades.propose(repo, req.body)));
  r.post('/trades/:id/accept', wrap(async req => trades.accept(repo, stripe, await need('trades', req.params.id))));
  r.post('/trades/:id/received', wrap(async req => trades.markItemReceived(repo, stripe, await need('trades', req.params.id), req.body.tradeItemId)));
  r.post('/trades/:id/decline', wrap(async req => trades.decline(repo, await need('trades', req.params.id))));

  // ── vault ──
  r.post('/vault/intake', wrap(req => vault.requestIntake(repo, req.body)));
  r.post('/vault/:id/received', wrap(async req => vault.markReceived(repo, await need('vault', req.params.id))));
  r.post('/vault/:id/authenticate', wrap(async req => vault.authenticate(repo, await need('vault', req.params.id), req.body)));
  r.post('/vault/:id/withdraw', wrap(async req => vault.requestWithdrawal(repo, await need('vault', req.params.id))));

  // ── credits + boosts ──
  r.get('/credits/:userId/balance', wrap(async req => ({ balance: await ledger.balance(repo, req.params.userId) })));
  r.post('/credits/purchase', wrap(req => ledger.purchase(repo, req.body.userId, req.body.credits, req.body.packId)));
  r.post('/boosts', wrap(req => ledger.boost(repo, req.body)));

  // ── audit trail ──
  r.get('/events/:type/:id', wrap(async req => repo.events.list({ entity_type: req.params.type, entity_id: req.params.id })));

  return r;
}
