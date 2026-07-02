// Runnable proof of the settlement engine. No test framework, no DB, no network:
//   node test/lifecycle.test.js
import { memoryRepo } from '../src/store/memory.js';
import { stripeStub } from '../src/store/repo.js';
import * as orders from '../src/domain/orders.js';
import * as trades from '../src/domain/trades.js';
import * as vault from '../src/domain/vault.js';
import * as ledger from '../src/domain/ledger.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } }
async function vaultedItem(repo, cardId, ownerId) {
  const v = await vault.requestIntake(repo, { cardId, ownerId });
  await vault.markReceived(repo, v);
  await vault.authenticate(repo, v, { result: 'passed' });
  return v;
}

const repo = memoryRepo();
const buyer = await repo.users.insert({ handle: 'buyer', email: 'b@x.com', role: 'buyer' });
const seller = await repo.users.insert({ handle: 'seller', email: 's@x.com', role: 'seller', stripe_account_id: 'acct_test_seller' });
const card = await repo.cards.insert({ player: 'Luka Dončić', grader: 'PSA', grade: '10' });

console.log('\n1. Direct-ship order, happy path');
{
  const o = await orders.create(repo, stripeStub, { cardId: card.id, buyerId: buyer.id, sellerId: seller.id, amount: 1380, fee: 138, method: 'direct' });
  ok('held in escrow, not paid to seller yet', o.status === 'awaiting_shipment');
  await orders.ship(repo, o, { carrier: 'UPS', tracking: '1Z999', insuredValue: 1380 });
  ok('shipped', o.status === 'shipped');
  await orders.markDelivered(repo, o);
  ok('inspection window opened on delivery', o.status === 'inspection');
  await orders.settle(repo, stripeStub, o);
  ok('order settled', o.status === 'settled');
  const esc = await repo.escrow.get(o.escrow_id);
  ok('escrow released to seller', esc.status === 'released' && !!esc.stripe_transfer_id);
}

console.log('\n2. Authenticated order, FAILS authentication → buyer refunded');
{
  const o = await orders.create(repo, stripeStub, { cardId: card.id, buyerId: buyer.id, sellerId: seller.id, amount: 5000, method: 'authenticated' });
  await orders.ship(repo, o, { carrier: 'FedEx', tracking: '77', insuredValue: 5000 });
  ok('routed to auth hub, not buyer', o.status === 'at_auth_hub');
  await orders.authenticateAtHub(repo, stripeStub, o, { result: 'failed' });
  ok('counterfeit caught → refunded', o.status === 'refunded');
  const esc = await repo.escrow.get(o.escrow_id);
  ok('escrow refunded to buyer', esc.status === 'refunded');
}

console.log('\n3. Authenticated order, PASSES → forwarded → settled');
{
  const o = await orders.create(repo, stripeStub, { cardId: card.id, buyerId: buyer.id, sellerId: seller.id, amount: 9200, method: 'authenticated' });
  await orders.ship(repo, o, { carrier: 'FedEx', tracking: '88', insuredValue: 9200 });
  await orders.authenticateAtHub(repo, stripeStub, o, { result: 'passed' });
  ok('verified and shipped to buyer', o.status === 'shipped');
  await orders.markDelivered(repo, o);
  await orders.settle(repo, stripeStub, o);
  ok('settled', o.status === 'settled');
}

console.log('\n4. Dispute during inspection → resolved as refund');
{
  const o = await orders.create(repo, stripeStub, { cardId: card.id, buyerId: buyer.id, sellerId: seller.id, amount: 2000, method: 'direct' });
  await orders.ship(repo, o, { carrier: 'UPS', tracking: '99', insuredValue: 2000 });
  await orders.markDelivered(repo, o);
  await orders.dispute(repo, o, { openerId: buyer.id, reason: 'not as described' });
  ok('disputed', o.status === 'disputed');
  await orders.resolveDispute(repo, stripeStub, o, { outcome: 'refund' });
  ok('resolved → refunded', o.status === 'refunded');
}

console.log('\n5. Vault sale → instant settle, ownership transfers, no shipping');
{
  const vi = await vaultedItem(repo, card.id, seller.id);
  const o = await orders.create(repo, stripeStub, { cardId: card.id, buyerId: buyer.id, sellerId: seller.id, amount: 1400, method: 'vault', vaultItemId: vi.id });
  ok('settled instantly', o.status === 'settled');
  const after = await repo.vault.get(vi.id);
  ok('vault ownership now buyer', after.owner_id === buyer.id);
  const ships = await repo.shipments.list({ order_id: o.id });
  ok('no shipment created', ships.length === 0);
}

console.log('\n6. Vault-to-vault trade → instant swap');
{
  const u1 = await repo.users.insert({ handle: 'alice', email: 'a@x.com' });
  const u2 = await repo.users.insert({ handle: 'bob', email: 'bob@x.com' });
  const cA = await repo.cards.insert({ player: 'Wemby', grader: 'PSA', grade: '10' });
  const cB = await repo.cards.insert({ player: 'Mahomes', grader: 'PSA', grade: '10' });
  const vA = await vaultedItem(repo, cA.id, u1.id);
  const vB = await vaultedItem(repo, cB.id, u2.id);
  const t = await trades.propose(repo, { proposerId: u1.id, counterpartyId: u2.id,
    give: [{ cardId: cA.id, vaultItemId: vA.id }], get: [{ cardId: cB.id, vaultItemId: vB.id }] });
  await trades.accept(repo, stripeStub, t);
  ok('settlement mode = vault_instant', t.settlement_mode === 'vault_instant');
  ok('trade settled instantly', t.status === 'settled');
  ok('card A now owned by bob', (await repo.vault.get(vA.id)).owner_id === u2.id);
  ok('card B now owned by alice', (await repo.vault.get(vB.id)).owner_id === u1.id);
}

console.log('\n7. Mixed trade (one shipped) → two-sided escrow, settles when received');
{
  const u1 = await repo.users.insert({ handle: 'carol', email: 'c@x.com' });
  const u2 = await repo.users.insert({ handle: 'dave', email: 'd@x.com' });
  const cA = await repo.cards.insert({ player: 'Trout', grader: 'PSA', grade: '10' });
  const cB = await repo.cards.insert({ player: 'Acuña', grader: 'PSA', grade: '10' });
  const vA = await vaultedItem(repo, cA.id, u1.id);                       // vaulted
  const t = await trades.propose(repo, { proposerId: u1.id, counterpartyId: u2.id,
    give: [{ cardId: cA.id, vaultItemId: vA.id }], get: [{ cardId: cB.id }], cashFromCounterparty: 200 });
  await trades.accept(repo, stripeStub, t);
  ok('settlement mode = escrow_ship', t.settlement_mode === 'escrow_ship');
  ok('held in settling until card arrives', t.status === 'settling');
  ok('cash boot escrowed', (await repo.escrow.list({ trade_id: t.id })).length === 1);
  const items = await repo.tradeItems.list({ trade_id: t.id });
  const physical = items.find(i => !i.vault_item_id);
  await trades.markItemReceived(repo, stripeStub, t, physical.id);
  ok('settled once shipped card received', t.status === 'settled');
  ok('vaulted card A transferred to dave', (await repo.vault.get(vA.id)).owner_id === u2.id);
}

console.log('\n8. Credits + boosts + guard');
{
  const u = await repo.users.insert({ handle: 'rhett', email: 'r@x.com' });
  const cX = await repo.cards.insert({ player: 'Edwards', grader: 'PSA', grade: '10' });
  const listing = await repo.listings.insert({ card_id: cX.id, seller_id: u.id, price: 1240, status: 'active', boost_rank: 0 });
  await ledger.purchase(repo, u.id, 250, 'pack_2');
  ok('balance after purchase = 250', (await ledger.balance(repo, u.id)) === 250);
  await ledger.boost(repo, { userId: u.id, listingId: listing.id, tier: 'spotlight' });
  ok('balance after spotlight (-75) = 175', (await ledger.balance(repo, u.id)) === 175);
  ok('listing boost_rank bumped', (await repo.listings.get(listing.id)).boost_rank === 2);
  let threw = false;
  try { await ledger.boost(repo, { userId: u.id, listingId: listing.id, tier: 'frontline' }); } catch (e) { threw = e.code === 'INSUFFICIENT_CREDITS'; }
  ok('frontline (200) blocked — insufficient credits', threw);
}

console.log('\n9. Illegal transition is rejected');
{
  const o = await orders.create(repo, stripeStub, { cardId: card.id, buyerId: buyer.id, sellerId: seller.id, amount: 100, method: 'direct' });
  let threw = false;
  try { await orders.settle(repo, stripeStub, o); } catch (e) { threw = e.code === 'ILLEGAL_TRANSITION'; }
  // settle() calls transition to 'settled' from 'awaiting_shipment' which is illegal
  ok('cannot settle an unshipped order', threw);
}

console.log('\n10. Audit trail recorded');
{
  const evs = await repo.events.list({ entity_type: 'order' });
  ok('order events logged', evs.length > 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
