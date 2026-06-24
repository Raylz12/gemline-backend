// Credits ledger (append-only) and boosts. Balance is always the sum of deltas,
// so there's no mutable balance field to drift. Credits are promotional and
// non-redeemable (spendable only on boosts) by design.
const BOOST_TIERS = {
  bump:      { rank: 1, credits: 25,  hours: 6 },
  spotlight: { rank: 2, credits: 75,  hours: 24 },
  frontline: { rank: 3, credits: 200, hours: 24 },
};

export async function balance(repo, userId) {
  const rows = await repo.ledger.list({ user_id: userId });
  return rows.reduce((s, r) => s + r.delta, 0);
}

async function post(repo, userId, delta, reason, refType, refId) {
  const after = (await balance(repo, userId)) + delta;
  if (after < 0) { const e = new Error('Insufficient credits'); e.code = 'INSUFFICIENT_CREDITS'; throw e; }
  return repo.ledger.insert({
    user_id: userId, delta, balance_after: after, reason,
    ref_type: refType, ref_id: refId, created_at: new Date().toISOString(),
  });
}

// Stripe: a successful payment for a credit pack triggers this.
export async function purchase(repo, userId, credits, packId) {
  return post(repo, userId, +credits, `Purchased ${credits} credits`, 'purchase', packId);
}

export async function boost(repo, { userId, listingId, tier }) {
  const t = BOOST_TIERS[tier];
  if (!t) { const e = new Error('Unknown boost tier'); e.code = 'BAD_TIER'; throw e; }
  await post(repo, userId, -t.credits, `Boost: ${tier}`, 'boost', listingId);
  const now = new Date();
  const b = await repo.boosts.insert({
    listing_id: listingId, user_id: userId, tier, credits_spent: t.credits, rank: t.rank,
    starts_at: now.toISOString(), ends_at: new Date(now.getTime() + t.hours * 3600e3).toISOString(),
    status: 'active', created_at: now.toISOString(),
  });
  const listing = await repo.listings.get(listingId);
  if (listing) { listing.boost_rank = t.rank; await repo.listings.update(listing); }
  return b;
}

export { BOOST_TIERS };
