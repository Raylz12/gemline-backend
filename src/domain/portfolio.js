// Portfolio domain — a user's personal card collection.
// Each portfolio item references a card in the shared catalog.
// Users can list portfolio cards on the marketplace or offer them in trades.

export async function list(repo, userId) {
  const items = await repo.portfolios.list({ user_id: userId });
  return Promise.all(items.map(async (item) => {
    const card = await repo.cards.get(item.card_id);
    // Get current market price from active listings for this card
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

  const listing = await repo.listings.insert({
    card_id: item.card_id,
    seller_id: userId,
    vault_item_id: null,
    kind: 'buy_now',
    price: Number(price),
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
  // Memory store: delete via update with __deleted marker; pg needs a DELETE query
  // For now mark as removed by storing in a way app.js can filter
  await repo.portfolios.update({ ...item, user_id: null }); // effectively orphans it
  return { ok: true };
}

const normalize = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export async function searchCatalog(repo, query) {
  const all = await repo.cards.list({});
  const q = normalize(query || '').trim();
  if (!q) return all.slice(0, 30);
  return all.filter(c =>
    normalize([c.player, c.card_set, c.variant, c.sport, c.grader, c.grade, c.number]
      .filter(Boolean).join(' ')).includes(q)
  ).slice(0, 30);
}
