// Seed strategy:
// 1. SHARED CATALOG — canonical card records, created once for all users.
//    If cards already exist in the DB we skip creation entirely.
// 2. USER SEED — each new user gets a starting portfolio (a subset of the
//    shared catalog), a welcome credit grant, and two incoming trade offers.
import * as vault from './vault.js';
import * as trades from './trades.js';
import * as ledger from './ledger.js';

// ── Shared image map ──────────────────────────────────────────────────────────
const IMAGES = {
  'Victor Wembanyama': 'https://cdn.nba.com/headshots/nba/latest/1040x760/1641709.png',
  'LeBron James':      'https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png',
  'Luka Dončić':       'https://cdn.nba.com/headshots/nba/latest/1040x760/1629029.png',
  'Michael Jordan':    'https://a.espncdn.com/i/headshots/nba/players/full/1025.png',
  'Stephen Curry':     'https://cdn.nba.com/headshots/nba/latest/1040x760/201939.png',
  'Anthony Edwards':   'https://cdn.nba.com/headshots/nba/latest/1040x760/1630162.png',
  'Ja Morant':         'https://cdn.nba.com/headshots/nba/latest/1040x760/1629630.png',
  'Jayson Tatum':      'https://cdn.nba.com/headshots/nba/latest/1040x760/1628369.png',
  'Giannis Antetokounmpo': 'https://cdn.nba.com/headshots/nba/latest/1040x760/203507.png',
  'Nikola Jokić':      'https://cdn.nba.com/headshots/nba/latest/1040x760/203999.png',
  'Cade Cunningham':   'https://cdn.nba.com/headshots/nba/latest/1040x760/1630595.png',
  'Patrick Mahomes':   'https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png',
  'Tom Brady':         'https://a.espncdn.com/i/headshots/nfl/players/full/2330.png',
  'Josh Allen':        'https://a.espncdn.com/i/headshots/nfl/players/full/3918298.png',
  'Justin Jefferson':  'https://a.espncdn.com/i/headshots/nfl/players/full/4241478.png',
  'C.J. Stroud':       'https://a.espncdn.com/i/headshots/nfl/players/full/4361529.png',
  'Caleb Williams':    'https://a.espncdn.com/i/headshots/nfl/players/full/4430806.png',
  'Saquon Barkley':    'https://a.espncdn.com/i/headshots/nfl/players/full/3929630.png',
  'CeeDee Lamb':       'https://a.espncdn.com/i/headshots/nfl/players/full/4259545.png',
  'Travis Hunter':     'https://a.espncdn.com/i/headshots/nfl/players/full/4432772.png',
  'Caitlin Clark':     'https://cdn.wnba.com/headshots/wnba/latest/1040x760/1642011.png',
  'Mike Trout':        'https://a.espncdn.com/i/headshots/mlb/players/full/30836.png',
  'Shohei Ohtani':     'https://a.espncdn.com/i/headshots/mlb/players/full/33218.png',
  'Ronald Acuña Jr.':  'https://a.espncdn.com/i/headshots/mlb/players/full/41728.png',
  'Bryce Harper':      'https://a.espncdn.com/i/headshots/mlb/players/full/30936.png',
  'Aaron Judge':       'https://a.espncdn.com/i/headshots/mlb/players/full/33039.png',
  'Fernando Tatis Jr.':'https://a.espncdn.com/i/headshots/mlb/players/full/41862.png',
  'Connor McDavid':    'https://a.espncdn.com/i/headshots/nhl/players/full/3114727.png',
  'Auston Matthews':   'https://a.espncdn.com/i/headshots/nhl/players/full/3895074.png',
  'David Pastrnak':    'https://a.espncdn.com/i/headshots/nhl/players/full/3114740.png',
  'Lionel Messi':      'https://a.espncdn.com/i/headshots/soccer/players/full/45843.png',
  'Erling Haaland':    'https://a.espncdn.com/i/headshots/soccer/players/full/267921.png',
  'Kylian Mbappé':     'https://a.espncdn.com/i/headshots/soccer/players/full/189340.png',
  'Vinicius Jr.':      'https://a.espncdn.com/i/headshots/soccer/players/full/9467.png',
  'Max Verstappen':    'https://a.espncdn.com/i/headshots/f1/drivers/full/4479.png',
  'Lewis Hamilton':    'https://a.espncdn.com/i/headshots/f1/drivers/full/793.png',
  'Tiger Woods':       'https://a.espncdn.com/i/headshots/golf/players/full/462.png',
  'Jon Jones':         'https://a.espncdn.com/i/headshots/mma/athletes/full/3058648.png',
  'Charizard':         'https://images.pokemontcg.io/base1/4_hires.png',
  'Pikachu':           'https://images.pokemontcg.io/base1/58_hires.png',
  'Umbreon':           'https://images.pokemontcg.io/swsh7/215_hires.png',
  'Lugia':             'https://images.pokemontcg.io/neo1/9_hires.png',
  'Mewtwo':            'https://images.pokemontcg.io/base1/10_hires.png',
};

// ── Shared catalog ────────────────────────────────────────────────────────────
// [player, sport, set, variant, number, grader, grade, basePrice]
const CATALOG = [
  ['Victor Wembanyama', 'Basketball', '2023 Prizm',           'RC Silver',        '#23',    'PSA', '10',  4200],
  ['LeBron James',      'Basketball', '2003 Topps Chrome',    'RC Refractor',     '#111',   'PSA', '10', 18500],
  ['Luka Dončić',       'Basketball', '2018 Prizm',           'Silver RC',        '#280',   'PSA', '10',  1380],
  ['Michael Jordan',    'Basketball', '1986 Fleer',           'Rookie',           '#57',    'PSA', '8',  38500],
  ['Stephen Curry',     'Basketball', '2009 Topps Chrome',    'RC Refractor',     '#321',   'BGS', '9.5',  980],
  ['Anthony Edwards',   'Basketball', '2020 Prizm',           'Silver RC',        '#258',   'PSA', '10',  1240],
  ['Ja Morant',         'Basketball', '2019 Prizm',           'Silver RC',        '#249',   'BGS', '9.5',  560],
  ['Jayson Tatum',      'Basketball', '2017 Prizm',           'Silver RC',        '#65',    'PSA', '10',   720],
  ['Giannis Antetokounmpo','Basketball','2013 Prizm',         'RC',               '#290',   'PSA', '10',   980],
  ['Nikola Jokić',      'Basketball', '2015 Prizm',           'Silver RC',        '#78',    'PSA', '10',  1240],
  ['Cade Cunningham',   'Basketball', '2021 Prizm',           'Silver RC',        '#1',     'PSA', '10',   480],
  ['Patrick Mahomes',   'Football',   '2017 Prizm',           'Silver RC',        '#269',   'PSA', '10',  2650],
  ['Tom Brady',         'Football',   '2000 Bowman Chrome',   'RC Auto',          '#236',   'PSA', '9',   6900],
  ['Josh Allen',        'Football',   '2018 Prizm',           'Silver RC',        '#247',   'PSA', '10',  1120],
  ['Justin Jefferson',  'Football',   '2020 Prizm',           'Silver RC',        '#398',   'BGS', '9.5',  740],
  ['C.J. Stroud',       'Football',   '2023 Prizm',           'RC',               '#301',   'PSA', '10',   420],
  ['Caleb Williams',    'Football',   '2024 Prizm',           'Silver RC',        '#1',     'PSA', '10',   480],
  ['Saquon Barkley',    'Football',   '2018 Prizm',           'Silver RC',        '#212',   'PSA', '10',   720],
  ['CeeDee Lamb',       'Football',   '2020 Prizm',           'Silver RC',        '#332',   'PSA', '10',   560],
  ['Travis Hunter',     'College',    '2024 Bowman U',        'Chrome RC',        '#1',     'PSA', '10',   640],
  ['Caitlin Clark',     'WNBA',       '2024 Prizm',           'RC Silver',        '#1',     'PSA', '10',  1850],
  ['Mike Trout',        'Baseball',   '2011 Topps Update',    'RC',               '#US175', 'PSA', '10',  3100],
  ['Shohei Ohtani',     'Baseball',   '2018 Topps Chrome',    'RC Auto',          '#150',   'BGS', '9',   9200],
  ['Ronald Acuña Jr.',  'Baseball',   '2018 Topps',           'RC',               '#698',   'PSA', '10',   560],
  ['Bryce Harper',      'Baseball',   '2012 Bowman Chrome',   'RC Auto',          '#BCP10', 'PSA', '10',  1980],
  ['Aaron Judge',       'Baseball',   '2017 Topps',           'RC',               '#287',   'PSA', '10',   840],
  ['Fernando Tatis Jr.','Baseball',   '2019 Topps Chrome',    'RC',               '#149',   'PSA', '10',   620],
  ['Connor McDavid',    'Hockey',     '2015 Upper Deck',      'Young Guns RC',    '#201',   'PSA', '10',  2300],
  ['Auston Matthews',   'Hockey',     '2016 Upper Deck',      'Young Guns RC',    '#201',   'PSA', '9',    680],
  ['David Pastrnak',    'Hockey',     '2013 Upper Deck',      'Young Guns RC',    '#216',   'PSA', '10',   580],
  ['Lionel Messi',      'Soccer',     '2004 Panini',          'RC',               '#71',    'PSA', '8',  14500],
  ['Erling Haaland',    'Soccer',     '2019 Prizm',           'Silver RC',        '#107',   'PSA', '10',  1120],
  ['Kylian Mbappé',     'Soccer',     '2018 Prizm World Cup', 'Silver',           '#172',   'PSA', '10',   890],
  ['Vinicius Jr.',      'Soccer',     '2020 Topps Chrome',    'RC',               '#44',    'PSA', '10',   490],
  ['Max Verstappen',    'F1',         '2020 Topps Chrome',    'RC',               '#1',     'PSA', '10',   520],
  ['Lewis Hamilton',    'F1',         '2020 Topps Chrome',    'Base',             '#44',    'PSA', '10',   380],
  ['Tiger Woods',       'Golf',       '2001 Upper Deck',      'RC',               '#1',     'PSA', '9',   2900],
  ['Jon Jones',         'UFC',        '2011 Topps UFC',       'RC',               '#88',    'PSA', '9',    340],
  ['Charizard',         'Pokémon',    '1999 Base Set',        'Holo 1st Edition', '#4',     'PSA', '9',  12800],
  ['Pikachu',           'Pokémon',    '1999 Base Set',        'Base Holo',        '#58',    'PSA', '8',   2400],
  ['Umbreon',           'Pokémon',    '2022 Evolving Skies',  'Alt Art VMAX',     '#215',   'PSA', '10',  1650],
  ['Lugia',             'Pokémon',    '2000 Neo Genesis',     'Holo 1st Ed',      '#9',     'PSA', '9',   4800],
  ['Mewtwo',            'Pokémon',    '1999 Base Set',        'Holo 1st Edition', '#10',    'PSA', '9',   4200],
];

const MARKETPLACE_SELLERS = ['VaultGrade', 'SlabCity', 'PristineCo', 'GemRack', 'CardLab'];

// ── ensureCatalog — idempotent, runs once globally ────────────────────────────
// Returns a map of player → [cardId, basePrice] for use in seeding.
export async function ensureCatalog(repo) {
  const existing = await repo.cards.list({});
  if (existing.length >= CATALOG.length) {
    // Already seeded — rebuild map with { card, basePrice } pairs from CATALOG
    const cardLookup = new Map();
    for (const c of existing) {
      cardLookup.set(`${c.player}|${c.card_set}|${c.grader}|${c.grade}`, c);
    }
    const map = new Map();
    for (const [player,, set,, , grader, grade, basePrice] of CATALOG) {
      const card = cardLookup.get(`${player}|${set}|${grader}|${grade}`);
      if (card) {
        if (!map.has(player)) map.set(player, []);
        map.get(player).push({ card, basePrice });
      }
    }
    return map;
  }

  // Build a set of (player+set+grader+grade) to avoid re-inserting
  const existingKeys = new Set(existing.map(c => `${c.player}|${c.card_set}|${c.grader}|${c.grade}`));
  const map = new Map();

  for (const [player, sport, set, variant, num, grader, grade, basePrice] of CATALOG) {
    const key = `${player}|${set}|${grader}|${grade}`;
    let card;
    if (existingKeys.has(key)) {
      card = existing.find(c => c.player === player && c.card_set === set && c.grader === grader && c.grade === grade);
    } else {
      card = await repo.cards.insert({
        player, sport, card_set: set, variant, number: num, grader, grade,
        image_url: IMAGES[player] || null,
        created_at: new Date().toISOString(),
      });
    }
    if (!map.has(player)) map.set(player, []);
    map.get(player).push({ card, basePrice });
  }
  return map;
}

// ── ensureSeed — per-user, idempotent ─────────────────────────────────────────
export async function ensureSeed(repo, _stripe, userId) {
  if (!userId) return null;
  const me = await repo.users.get(userId);
  if (!me) return null;

  // Skip if user already has portfolio items
  const existing = await repo.portfolios.list({ user_id: userId });
  if (existing.length > 0) return me;

  // Ensure the shared catalog exists
  const catalogMap = await ensureCatalog(repo);

  // Create marketplace bot sellers (idempotent)
  const sellers = [];
  for (const h of MARKETPLACE_SELLERS) {
    const found = (await repo.users.list({ handle: h }))[0];
    sellers.push(found || await repo.users.insert({
      handle: h, email: `${h.toLowerCase()}@marketplace.app`,
      role: 'seller', created_at: new Date().toISOString(),
    }));
  }

  // Flatten catalog entries
  const allEntries = [];
  for (const entries of catalogMap.values()) {
    for (const e of entries) allEntries.push(e);
  }

  const mine = [], others = [];

  for (let i = 0; i < allEntries.length; i++) {
    const { card, basePrice } = allEntries[i];
    const ownedByMe = i % 4 === 0;
    const owner = ownedByMe ? me : sellers[i % sellers.length];

    // Create vault item
    let vaultItemId = null;
    if (i % 5 !== 4) {
      const vi = await vault.requestIntake(repo, { cardId: card.id, ownerId: owner.id });
      await vault.markReceived(repo, vi);
      await vault.authenticate(repo, vi, { result: 'passed' });
      vaultItemId = vi.id;
    }

    // Create marketplace listing
    const price = Math.round(basePrice * (0.9 + Math.random() * 0.2));
    const listing = await repo.listings.insert({
      card_id: card.id, seller_id: owner.id, vault_item_id: vaultItemId,
      kind: 'buy_now', price, currency: 'USD', status: 'active', boost_rank: 0,
      created_at: new Date().toISOString(),
    });

    if (ownedByMe) {
      // Add to user's portfolio
      await repo.portfolios.insert({
        user_id: userId, card_id: card.id,
        purchase_price: Math.round(price * (0.7 + Math.random() * 0.25)),
        cert_number: null, is_listed: true, listing_id: listing.id,
        acquired_at: new Date().toISOString(), created_at: new Date().toISOString(),
      });
      mine.push({ card, listing, vaultItemId, sellerId: owner.id });
    } else {
      others.push({ card, listing, vaultItemId, sellerId: owner.id });
    }
  }

  // Welcome credits
  await ledger.purchase(repo, me.id, 240, 'welcome');

  // Two incoming trade offers
  if (mine.length >= 1 && others.length >= 2) {
    const [o1, o2] = others.filter(o => o.vaultItemId);
    const [m1, m2] = mine.filter(m => m.vaultItemId);
    if (o1 && m1) {
      await trades.propose(repo, {
        proposerId: o1.sellerId, counterpartyId: me.id,
        give: [{ cardId: o1.card.id, vaultItemId: o1.vaultItemId }],
        get:  [{ cardId: m1.card.id, vaultItemId: m1.vaultItemId }],
      });
    }
    if (o2 && m2) {
      await trades.propose(repo, {
        proposerId: o2.sellerId, counterpartyId: me.id,
        give: [{ cardId: o2.card.id, vaultItemId: o2.vaultItemId }],
        get:  [{ cardId: m2.card.id, vaultItemId: m2.vaultItemId }],
        cashFromProposer: 120,
      });
    }
  }
  return me;
}
