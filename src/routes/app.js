// Application routes the frontend hydrates from.
// All routes require authentication — req.userId is set by requireAuth middleware.
import { Router } from 'express';
import * as orders from '../domain/orders.js';
import * as portfolio from '../domain/portfolio.js';
import { ensureSeed } from '../domain/seed.js';

function rel(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function appRouter(repo, stripe) {
  const r = Router();
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.code === 'ILLEGAL_TRANSITION' ? 409 : e.status || 400).json({ error: e.message, code: e.code }); }
  };

  async function priceOf(cardId) {
    const ls = await repo.listings.list({ card_id: cardId });
    return ls.length ? Number(ls[0].price) : 100;
  }

  async function resolveItem(it) {
    const c = await repo.cards.get(it.card_id);
    return {
      cardId: it.card_id, vaultItemId: it.vault_item_id,
      player: c.player, sport: c.sport, grader: c.grader, grade: c.grade,
      value: await priceOf(it.card_id), imageUrl: c.image_url || null,
    };
  }

  async function myView(t, myId) {
    const items = await repo.tradeItems.list({ trade_id: t.id });
    const proposerItems = items.filter(i => i.side === 'proposer');
    const counterItems  = items.filter(i => i.side === 'counterparty');
    const iAmProposer   = t.proposer_id === myId;
    const giveItems     = iAmProposer ? proposerItems : counterItems;
    const getItems      = iAmProposer ? counterItems  : proposerItems;
    const giveCash      = iAmProposer ? Number(t.cash_from_proposer)    : Number(t.cash_from_counterparty);
    const getCash       = iAmProposer ? Number(t.cash_from_counterparty): Number(t.cash_from_proposer);
    const otherId       = iAmProposer ? t.counterparty_id : t.proposer_id;
    const other         = await repo.users.get(otherId);
    return {
      id: t.id, withHandle: other ? other.handle : 'Trader', when: rel(t.created_at),
      give: await Promise.all(giveItems.map(resolveItem)), giveCash,
      get:  await Promise.all(getItems.map(resolveItem)),  getCash,
    };
  }

  async function buildState(userId) {
    // Use a single JOIN query when Postgres is available to avoid N+1
    let cards = [];
    if (repo.pool) {
      const { rows: listings } = await repo.pool.query(`
        SELECT l.id AS listing_id, l.card_id, l.vault_item_id, l.seller_id, l.price, l.boost_rank,
               c.player, c.sport, c.card_set, c.variant, c.number, c.grader, c.grade, c.image_url,
               u.handle AS seller_handle
        FROM listings l
        JOIN cards c ON c.id = l.card_id
        JOIN users u ON u.id = l.seller_id
        WHERE l.status = 'active'
        ORDER BY l.boost_rank DESC, l.created_at DESC
        LIMIT 500
      `);
      cards = listings.map(l => ({
        listingId: l.listing_id, cardId: l.card_id, vaultItemId: l.vault_item_id || null,
        sellerId: l.seller_id, sellerHandle: l.seller_handle || 'Seller',
        ownedByMe: l.seller_id === userId,
        player: l.player, sport: l.sport, set: l.card_set,
        variant: l.variant, num: l.number, grader: l.grader, grade: l.grade,
        price: Number(l.price), boost_rank: l.boost_rank || 0,
        imageUrl: l.image_url || null,
      }));
    } else {
      // Fallback: in-memory store (dev/test)
      const listings = await repo.listings.list({ status: 'active' });
      cards = await Promise.all(listings.map(async (l) => {
        const card = await repo.cards.get(l.card_id);
        const seller = await repo.users.get(l.seller_id);
        return {
          listingId: l.id, cardId: l.card_id, vaultItemId: l.vault_item_id || null,
          sellerId: l.seller_id, sellerHandle: seller ? seller.handle : 'Seller',
          ownedByMe: l.seller_id === userId,
          player: card.player, sport: card.sport, set: card.card_set,
          variant: card.variant, num: card.number, grader: card.grader, grade: card.grade,
          price: Number(l.price), boost_rank: l.boost_rank || 0,
          imageUrl: card.image_url || null,
        };
      }));
    }

    const ledgerRows = await repo.ledger.list({ user_id: userId });
    const balance   = ledgerRows.reduce((s, x) => s + x.delta, 0);
    const allTrades = await repo.trades.list({});
    const incoming  = await Promise.all(allTrades.filter(t => t.counterparty_id === userId && t.status === 'proposed').map(t => myView(t, userId)));
    const outgoing  = await Promise.all(allTrades.filter(t => t.proposer_id === userId && ['proposed', 'settling'].includes(t.status)).map(t => myView(t, userId)));
    const me = await repo.users.get(userId);
    return { me: { id: me.id, handle: me.handle }, balance, listings: cards, trades: { incoming, outgoing } };
  }

  r.post('/session', wrap(async (req) => {
    await ensureSeed(repo, stripe, req.userId);
    return buildState(req.userId);
  }));

  r.get('/state', wrap(async (req) => buildState(req.userId)));

  // ── Portfolio ─────────────────────────────────────────────────────────────
  r.get('/portfolio', wrap(async (req) => {
    return portfolio.list(repo, req.userId);
  }));

  r.get('/catalog/search', wrap(async (req) => {
    return portfolio.searchCatalog(repo, req.query.q);
  }));

  r.post('/portfolio/add', wrap(async (req) => {
    const { cardId, customCard, purchasePrice, certNumber, notes } = req.body;
    return portfolio.add(repo, { userId: req.userId, cardId, customCard, purchasePrice, certNumber, notes });
  }));

  r.post('/portfolio/list', wrap(async (req) => {
    const { portfolioItemId, price } = req.body;
    return portfolio.listCard(repo, { userId: req.userId, portfolioItemId, price });
  }));

  r.post('/portfolio/delist', wrap(async (req) => {
    return portfolio.delistCard(repo, { userId: req.userId, portfolioItemId: req.body.portfolioItemId });
  }));

  r.delete('/portfolio/:id', wrap(async (req) => {
    return portfolio.remove(repo, { userId: req.userId, portfolioItemId: req.params.id });
  }));

  // ── Buy ───────────────────────────────────────────────────────────────────
  r.post('/buy', wrap(async (req) => {
    const l = await repo.listings.get(req.body.listingId);
    if (!l) { const e = new Error('listing not found'); e.code = 'NOT_FOUND'; throw e; }
    const method = l.vault_item_id ? 'vault' : 'direct';
    const order = await orders.create(repo, stripe, {
      listingId: l.id, cardId: l.card_id, buyerId: req.userId, sellerId: l.seller_id,
      amount: Number(l.price), fee: Math.round(Number(l.price) * 0.1),
      method, vaultItemId: l.vault_item_id || null,
    });
    return { order, instant: order.status === 'settled' };
  }));

  return r;
}
