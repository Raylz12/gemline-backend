// Seeds a consistent demo world so the frontend has real, persistent entities
// to act on. Idempotent: it only seeds once (keyed on the demo user existing).
import * as vault from './vault.js';
import * as trades from './trades.js';
import * as ledger from './ledger.js';

const SELLERS = ['VaultGrade', 'SlabCity', 'PristineCo', 'GemRack'];
const CATALOG = [
  ['Victor Wembanyama', 'Basketball', '2023 Prizm', 'Silver RC', '#23', 'PSA', '10', 4200],
  ['Luka Dončić', 'Basketball', '2018 Prizm', 'Silver RC', '#280', 'PSA', '10', 1380],
  ['Anthony Edwards', 'Basketball', '2020 Prizm', 'Silver RC', '#258', 'PSA', '10', 1240],
  ['Patrick Mahomes', 'Football', '2017 Prizm', 'Silver RC', '#269', 'PSA', '10', 2650],
  ['Justin Jefferson', 'Football', '2020 Prizm', 'Silver RC', '#398', 'BGS', '9.5', 740],
  ['Shohei Ohtani', 'Baseball', '2018 Topps Chrome', 'RC Auto', '#150', 'BGS', '9', 9200],
  ['Ronald Acuña Jr.', 'Baseball', '2018 Topps', 'RC', '#698', 'PSA', '10', 560],
  ['Connor McDavid', 'Hockey', '2015 Upper Deck', 'Young Guns', '#201', 'PSA', '10', 2300],
  ['Caitlin Clark', 'WNBA', '2024 Prizm', 'RC', '#1', 'PSA', '10', 1850],
  ['Erling Haaland', 'Soccer', '2019 Prizm', 'RC', '#107', 'PSA', '10', 1120],
  ['Charizard', 'Pokémon', '1999 Base Set', 'Holo 1st Ed', '#4', 'PSA', '9', 12800],
  ['Umbreon', 'Pokémon', '2022 Evolving Skies', 'Alt Art VMAX', '#215', 'PSA', '10', 1650],
  ['Caitlin Clark', 'WNBA', '2024 Prizm', 'Silver', '#1', 'BGS', '9.5', 1450],
  ['Ja Morant', 'Basketball', '2019 Prizm', 'Silver RC', '#249', 'BGS', '9.5', 560],
];

async function findUser(repo, handle) { return (await repo.users.list({ handle }))[0] || null; }

export async function ensureSeed(repo, stripe) {
  let me = await findUser(repo, 'rhett');
  if (me) return me;                                  // already seeded

  me = await repo.users.insert({ handle: 'rhett', email: 'rhett@gemline.app', role: 'seller' });
  const sellers = [];
  for (const h of SELLERS) sellers.push(await repo.users.insert({ handle: h, email: `${h}@x.com`, role: 'seller' }));

  const mine = [], others = [];
  for (let i = 0; i < CATALOG.length; i++) {
    const [player, sport, set, variant, num, grader, grade, price] = CATALOG[i];
    const card = await repo.cards.insert({ player, sport, card_set: set, variant, number: num, grader, grade });
    const ownedByMe = i % 4 === 0;                    // ~4 of mine
    const owner = ownedByMe ? me : sellers[i % sellers.length];
    // Most listings are vaulted (so they trade/settle instantly); a few are raw-shipping.
    let vaultItemId = null;
    if (i % 5 !== 4) {
      const vi = await vault.requestIntake(repo, { cardId: card.id, ownerId: owner.id });
      await vault.markReceived(repo, vi);
      await vault.authenticate(repo, vi, { result: 'passed' });
      vaultItemId = vi.id;
    }
    const listing = await repo.listings.insert({
      card_id: card.id, seller_id: owner.id, vault_item_id: vaultItemId,
      kind: 'buy_now', price, currency: 'USD', status: 'active', boost_rank: 0,
      created_at: new Date().toISOString(),
    });
    (ownedByMe ? mine : others).push({ card, listing, vaultItemId, sellerId: owner.id });
  }

  await ledger.purchase(repo, me.id, 240, 'welcome');   // starting credits

  // Two incoming offers targeting my vaulted cards.
  if (mine.length && others.length) {
    const o1 = others.find(o => o.vaultItemId) || others[0];
    const m1 = mine.find(m => m.vaultItemId) || mine[0];
    await trades.propose(repo, {
      proposerId: o1.sellerId, counterpartyId: me.id,
      give: [{ cardId: o1.card.id, vaultItemId: o1.vaultItemId }],
      get: [{ cardId: m1.card.id, vaultItemId: m1.vaultItemId }],
    });
    const o2 = others.filter(o => o.vaultItemId)[1] || others[1] || others[0];
    const m2 = mine[1] || mine[0];
    await trades.propose(repo, {
      proposerId: o2.sellerId, counterpartyId: me.id,
      give: [{ cardId: o2.card.id, vaultItemId: o2.vaultItemId }],
      get: [{ cardId: m2.card.id, vaultItemId: m2.vaultItemId }],
      cashFromProposer: 120,
    });
  }
  return me;
}

export { findUser };
