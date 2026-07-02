// Portfolio domain — a user's personal card collection.
// Each portfolio item references a card in the shared catalog.
// Users can list portfolio cards on the marketplace or offer them in trades.
import { toCents } from '../store/repo.js';

export async function list(repo, userId) {
  // Fast path: single JOIN query when Postgres is available
  if (repo.pool) {
    const { rows } = await repo.pool.query(`
      SELECT p.id, p.card_id, p.purchase_price, p.cert_number, p.notes,
             p.is_listed, p.listing_id, p.acquired_at,
             p.verification_status, p.verification_method, p.verified_at,
             c.player, c.sport, c.card_set, c.variant, c.number,
             c.grader, c.grade, c.image_url, c.ebay_thumb,
             c.catalog_price,
             (SELECT MIN(l.price) FROM listings l WHERE l.card_id = c.id AND l.status = 'active' AND l.kind = 'buy_now') AS market_value
      FROM portfolios p
      JOIN cards c ON c.id = p.card_id
      WHERE p.user_id = $1
      ORDER BY c.catalog_price DESC NULLS LAST
    `, [userId]);
    return rows.map(item => {
      const costBasis = item.purchase_price ? Number(item.purchase_price) : null;
      // listings.price is stored in cents; catalog_price is dollars
      const marketValue = item.market_value ? Number(item.market_value) / 100 : (item.catalog_price ? Number(item.catalog_price) : null);
      const pnl = (marketValue && costBasis) ? marketValue - costBasis : null;
      const pnlPct = (pnl && costBasis) ? +((pnl / costBasis) * 100).toFixed(1) : null;
      return {
        id: item.id,
        cardId: item.card_id,
        player: item.player,
        sport: item.sport,
        set: item.card_set,
        variant: item.variant,
        num: item.number,
        grader: item.grader,
        grade: item.grade,
        imageUrl: item.ebay_thumb || item.image_url || null,
        certNumber: item.cert_number || null,
        notes: item.notes || null,
        purchasePrice: costBasis,
        marketValue,
        pnl,
        pnlPct,
        isListed: item.is_listed || false,
        listingId: item.listing_id || null,
        verificationStatus: item.verification_status || 'unverified',
        verificationMethod: item.verification_method || null,
        verifiedAt: item.verified_at || null,
        acquiredAt: item.acquired_at,
      };
    });
  }

  // Fallback for in-memory store (dev)
  const items = await repo.portfolios.list({ user_id: userId });
  return Promise.all(items.filter(i => i.user_id !== '__deleted__').map(async (item) => {
    const card = await repo.cards.get(item.card_id);
    const listings = await repo.listings.list({ card_id: item.card_id, status: 'active' });
    const prices = listings.map(l => Number(l.price)).filter(p => p > 0);
    const marketValue = prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null;
    const costBasis = item.purchase_price ? Number(item.purchase_price) : null;
    const pnl = (marketValue && costBasis) ? marketValue - costBasis : null;
    const pnlPct = (pnl && costBasis) ? +((pnl / costBasis) * 100).toFixed(1) : null;
    return {
      id: item.id,
      cardId: item.card_id,
      player: card.player,
      sport: card.sport,
      set: card.card_set,
      variant: card.variant,
      num: card.number,
      grader: card.grader,
      grade: card.grade,
      imageUrl: card.image_url || null,
      certNumber: item.cert_number || null,
      notes: item.notes || null,
      purchasePrice: costBasis,
      marketValue,
      pnl,
      pnlPct,
      isListed: item.is_listed || false,
      listingId: item.listing_id || null,
      acquiredAt: item.acquired_at,
    };
  }));
}

export async function add(repo, { userId, cardId, customCard, purchasePrice, certNumber, notes }) {
  let card;
  if (cardId) {
    card = await repo.cards.get(cardId);
    if (!card) { const e = new Error('Card not found'); e.status = 404; throw e; }
  } else if (customCard) {
    // User is adding a card not in the shared catalog
    card = await repo.cards.insert({
      player:   customCard.player   || 'Unknown',
      sport:    customCard.sport    || 'Other',
      card_set: customCard.set      || '',
      variant:  customCard.variant  || '',
      number:   customCard.number   || '',
      grader:   customCard.grader   || 'RAW',
      grade:    customCard.grade    || '',
      image_url: customCard.imageUrl || null,
      created_at: new Date().toISOString(),
    });
  } else {
    const e = new Error('cardId or customCard required'); e.status = 400; throw e;
  }

  const item = await repo.portfolios.insert({
    user_id: userId,
    card_id: card.id,
    purchase_price: purchasePrice || null,
    cert_number: certNumber || null,
    notes: notes || null,
    is_listed: false,
    listing_id: null,
    acquired_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });

  return { ...item, card };
}

export async function listCard(repo, { userId, portfolioItemId, price }) {
  const item = await repo.portfolios.get(portfolioItemId);
  if (!item || item.user_id !== userId) {
    const e = new Error('Portfolio item not found'); e.status = 404; throw e;
  }
  if (item.is_listed) {
    const e = new Error('Card is already listed'); e.status = 409; throw e;
  }
  if (!price || price <= 0) {
    const e = new Error('Price must be greater than 0'); e.status = 400; throw e;
  }
  // Anti-scam: selling requires verification (scan the card or add its cert).
  // Tracking stays frictionless — only the sell path is gated.
  if (repo.pool && (item.verification_status || 'unverified') !== 'verified') {
    const e = new Error('Verify this card before listing — scan it or add its cert');
    e.status = 403; e.code = 'VERIFY_REQUIRED'; throw e;
  }
  // New-account friction: <24h old → max 3 active listings, $500 total value
  if (repo.pool) {
    const { rows: [u] } = await repo.pool.query('SELECT created_at FROM users WHERE id = $1', [userId]);
    if (u && Date.now() - new Date(u.created_at).getTime() < 24 * 3600_000) {
      const { rows: [agg] } = await repo.pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(price), 0)::bigint AS total
         FROM listings WHERE seller_id = $1 AND status = 'active'`, [userId]);
      if (agg.n >= 3) { const e = new Error('New accounts can have up to 3 active listings in their first 24 hours'); e.status = 403; e.code = 'NEW_ACCOUNT_LIMIT'; throw e; }
      if (Number(agg.total) + toCents(price) > 50000) { const e = new Error('New accounts can list up to $500 total in their first 24 hours'); e.status = 403; e.code = 'NEW_ACCOUNT_LIMIT'; throw e; }
    }
  }

  const listing = await repo.listings.insert({
    card_id: item.card_id,
    seller_id: userId,
    vault_item_id: null,
    kind: 'buy_now',
    price: toCents(price),   // store cents (was raw dollars — unit bug fixed)
    currency: 'USD',
    status: 'active',
    boost_rank: 0,
    created_at: new Date().toISOString(),
  });

  await repo.portfolios.update({ ...item, is_listed: true, listing_id: listing.id });
  return listing;
}

export async function delistCard(repo, { userId, portfolioItemId }) {
  const item = await repo.portfolios.get(portfolioItemId);
  if (!item || item.user_id !== userId) {
    const e = new Error('Portfolio item not found'); e.status = 404; throw e;
  }
  if (item.listing_id) {
    const listing = await repo.listings.get(item.listing_id);
    if (listing) await repo.listings.update({ ...listing, status: 'cancelled' });
  }
  await repo.portfolios.update({ ...item, is_listed: false, listing_id: null });
  return { ok: true };
}

export async function updateItem(repo, { userId, portfolioItemId, purchasePrice, certNumber, notes }) {
  const item = await repo.portfolios.get(portfolioItemId);
  if (!item || item.user_id !== userId) {
    const e = new Error('Portfolio item not found'); e.status = 404; throw e;
  }
  const patch = { ...item };
  if (purchasePrice !== undefined) {
    const p = purchasePrice === null || purchasePrice === '' ? null : Number(purchasePrice);
    if (p !== null && (!isFinite(p) || p < 0)) { const e = new Error('Invalid purchase price'); e.status = 400; throw e; }
    patch.purchase_price = p;
  }
  if (certNumber !== undefined) patch.cert_number = certNumber || null;
  if (notes !== undefined) patch.notes = notes || null;
  await repo.portfolios.update(patch);
  return { ok: true, purchasePrice: patch.purchase_price, certNumber: patch.cert_number, notes: patch.notes };
}

export async function remove(repo, { userId, portfolioItemId }) {
  const item = await repo.portfolios.get(portfolioItemId);
  if (!item || item.user_id !== userId) {
    const e = new Error('Portfolio item not found'); e.status = 404; throw e;
  }
  // Delist first if listed
  if (item.listing_id) {
    const listing = await repo.listings.get(item.listing_id);
    if (listing) await repo.listings.update({ ...listing, status: 'cancelled' });
  }
  // Use DELETE query when Postgres is available, otherwise orphan the row in memory store
  if (repo.pool) {
    await repo.pool.query('DELETE FROM portfolios WHERE id = $1', [item.id]);
  } else {
    await repo.portfolios.update({ ...item, user_id: '__deleted__' });
  }
  return { ok: true };
}

export async function searchCatalog(repo, query) {
  const q = (query || '').trim();
  // Use DB-level search — never load all 500K cards into memory
  if (!repo.pool) {
    // fallback for in-memory store (dev only)
    const all = await repo.cards.list({});
    if (!q) return all.slice(0, 30);
    const norm = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const nq = norm(q);
    return all.filter(c => norm([c.player,c.card_set,c.variant,c.sport,c.grader,c.grade,c.number].filter(Boolean).join(' ')).includes(nq)).slice(0, 30);
  }
  if (!q) {
    const { rows } = await repo.pool.query(
      `SELECT * FROM cards ORDER BY catalog_price DESC NULLS LAST LIMIT 30`
    );
    return rows;
  }
  // Trigram similarity search — uses GIN index, sub-10ms on 500K rows
  const { rows } = await repo.pool.query(
    `SELECT *, similarity(player, $1) AS sim
     FROM cards
     WHERE player % $1 OR card_set ILIKE $2 OR variant ILIKE $2
     ORDER BY sim DESC, catalog_price DESC NULLS LAST
     LIMIT 30`,
    [q, `%${q}%`]
  );
  return rows;
}
