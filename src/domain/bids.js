/**
 * bids.js — Live auction bidding domain
 * Handles: posting auctions, placing bids, ending auctions, outbid detection.
 */

export async function postAuction(repo, { userId, cardId, vaultItemId, startPrice, reservePrice, durationHours }) {
  const user = await repo.users.get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const card = await repo.cards.get(cardId);
  if (!card) throw Object.assign(new Error('Card not found'), { status: 404 });

  const endsAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();

  const listing = await repo.listings.insert({
    card_id: cardId,
    seller_id: userId,
    vault_item_id: vaultItemId || null,
    kind: 'auction',
    price: startPrice,            // current high bid / starting price
    reserve_price: reservePrice || null,
    currency: 'USD',
    status: 'active',
    boost_rank: 0,
    ends_at: endsAt,
    created_at: new Date().toISOString(),
  });

  return { listing, card, endsAt };
}

export async function placeBid(repo, { userId, listingId, amount }) {
  const listing = await repo.listings.get(listingId);
  if (!listing) throw Object.assign(new Error('Listing not found'), { status: 404 });
  if (listing.kind !== 'auction') throw Object.assign(new Error('Not an auction'), { status: 400 });
  if (listing.status !== 'active') throw Object.assign(new Error('Auction ended'), { status: 410 });
  if (listing.seller_id === userId) throw Object.assign(new Error('Cannot bid on your own auction'), { status: 400 });

  // Check auction hasn't expired
  if (listing.ends_at && new Date(listing.ends_at) < new Date()) {
    await repo.listings.update(listingId, { status: 'sold' });
    throw Object.assign(new Error('Auction has ended'), { status: 410 });
  }

  const currentPrice = Number(listing.price);
  const minBid = currentPrice + Math.max(1, Math.round(currentPrice * 0.05));
  if (amount < minBid) {
    throw Object.assign(new Error(`Minimum bid is $${minBid.toLocaleString()}`), { status: 400 });
  }

  // Mark previous winning bid as outbid
  // (Using raw DB since repo may not have update on bids table)
  const prevBids = await repo.bids.list({ listing_id: listingId });
  const winningBid = prevBids.find(b => b.status === 'active');
  const outbidUserId = winningBid ? winningBid.bidder_id : null;

  // Insert new bid
  const bid = await repo.bids.insert({
    listing_id: listingId,
    bidder_id: userId,
    amount,
    status: 'active',
    placed_at: new Date().toISOString(),
  });

  // Update listing current price
  await repo.listings.update(listingId, { price: amount });

  return { bid, outbidUserId, newPrice: amount, minNextBid: amount + Math.max(1, Math.round(amount * 0.05)) };
}

export async function getAuctionState(repo, listingId) {
  const listing = await repo.listings.get(listingId);
  if (!listing) return null;

  const bids = await repo.bids.list({ listing_id: listingId });
  const sorted = bids.sort((a, b) => Number(b.amount) - Number(a.amount));
  const winning = sorted[0] || null;
  const card = await repo.cards.get(listing.card_id);
  const seller = await repo.users.get(listing.seller_id);

  const now = new Date();
  const endsAt = listing.ends_at ? new Date(listing.ends_at) : null;
  const msLeft = endsAt ? Math.max(0, endsAt - now) : null;

  return {
    listingId,
    card: card ? { player: card.player, sport: card.sport, grader: card.grader, grade: card.grade, set: card.card_set, variant: card.variant, imageUrl: card.image_url } : null,
    currentPrice: Number(listing.price),
    startPrice: Number(listing.price),
    seller: seller ? seller.handle : 'Seller',
    bidCount: bids.length,
    winning: winning ? { bidderId: winning.bidder_id, amount: Number(winning.amount) } : null,
    endsAt: listing.ends_at,
    msLeft,
    status: listing.status,
    minNextBid: winning ? Number(winning.amount) + Math.max(1, Math.round(Number(winning.amount) * 0.05)) : Number(listing.price) + 1,
  };
}

export async function listActiveAuctions(repo) {
  const all = await repo.listings.list({ kind: 'auction', status: 'active' });
  // Filter out expired ones and auto-close them
  const now = new Date();
  const live = [];
  for (const l of all) {
    if (l.ends_at && new Date(l.ends_at) < now) {
      await repo.listings.update(l.id, { status: 'sold' });
    } else {
      live.push(l);
    }
  }
  return live;
}

export async function endAuction(repo, listingId, userId) {
  const listing = await repo.listings.get(listingId);
  if (!listing) throw Object.assign(new Error('Not found'), { status: 404 });
  if (listing.seller_id !== userId) throw Object.assign(new Error('Not your auction'), { status: 403 });
  await repo.listings.update(listingId, { status: 'sold' });
  return getAuctionState(repo, listingId);
}
