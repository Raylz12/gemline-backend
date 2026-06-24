// Seeds a demo marketplace world for a new user.
// Idempotent: skips if the user already has listings.
import * as vault from './vault.js';
import * as trades from './trades.js';
import * as ledger from './ledger.js';

// Hardcoded image URLs from official free CDNs (NBA, ESPN, Pokémon TCG).
const IMAGES = {
  'Victor Wembanyama': 'https://cdn.nba.com/headshots/nba/latest/1040x760/1641709.png',
  'Luka Dončić':       'https://cdn.nba.com/headshots/nba/latest/1040x760/1629029.png',
  'Anthony Edwards':   'https://cdn.nba.com/headshots/nba/latest/1040x760/1630162.png',
  'Caitlin Clark':     'https://cdn.wnba.com/headshots/wnba/latest/1040x760/1642011.png',
  'Ja Morant':         'https://cdn.nba.com/headshots/nba/latest/1040x760/1629630.png',
  'Jayson Tatum':      'https://cdn.nba.com/headshots/nba/latest/1040x760/1628369.png',
  'Patrick Mahomes':   'https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png',
  'Josh Allen':        'https://a.espncdn.com/i/headshots/nfl/players/full/3918298.png',
  'Justin Jefferson':  'https://a.espncdn.com/i/headshots/nfl/players/full/4241478.png',
  'Caleb Williams':    'https://a.espncdn.com/i/headshots/nfl/players/full/4430806.png',
  'Shohei Ohtani':     'https://a.espncdn.com/i/headshots/mlb/players/full/33218.png',
  'Juan Soto':         'https://a.espncdn.com/i/headshots/mlb/players/full/40936.png',
  'Ronald Acuña Jr.':  'https://a.espncdn.com/i/headshots/mlb/players/full/41728.png',
  'Connor McDavid':    'https://a.espncdn.com/i/headshots/nhl/players/full/3114727.png',
  'Auston Matthews':   'https://a.espncdn.com/i/headshots/nhl/players/full/3895074.png',
  'Erling Haaland':    'https://a.espncdn.com/i/headshots/soccer/players/full/267921.png',
  'Kylian Mbappé':     'https://a.espncdn.com/i/headshots/soccer/players/full/189340.png',
  // Pokémon — official card art from pokemontcg.io
  'Charizard_1st':     'https://images.pokemontcg.io/base1/4_hires.png',
  'Charizard_shadow':  'https://images.pokemontcg.io/base1/4_hires.png',
  'Umbreon':           'https://images.pokemontcg.io/swsh7/215_hires.png',
  'Pikachu Illustrator': 'https://images.pokemontcg.io/bwp/BW83_hires.png',
  'Giannis Antetokounmpo': 'https://cdn.nba.com/headshots/nba/latest/1040x760/203507.png',
  'Nikola Jokić':          'https://cdn.nba.com/headshots/nba/latest/1040x760/203999.png',
  'Caleb Williams':        'https://a.espncdn.com/i/headshots/nfl/players/full/4430806.png',
  'Aaron Judge':           'https://a.espncdn.com/i/headshots/mlb/players/full/33039.png',
  'Fernando Tatis Jr.':    'https://a.espncdn.com/i/headshots/mlb/players/full/41862.png',
  'Saquon Barkley':        'https://a.espncdn.com/i/headshots/nfl/players/full/3929630.png',
  'CeeDee Lamb':           'https://a.espncdn.com/i/headshots/nfl/players/full/4259545.png',
  'Cade Cunningham':       'https://cdn.nba.com/headshots/nba/latest/1040x760/1630595.png',
  'David Pastrnak':        'https://a.espncdn.com/i/headshots/nhl/players/full/3114740.png',
  'Vinicius Jr.':          'https://a.espncdn.com/i/headshots/soccer/players/full/9467.png',
  'Mewtwo':                'https://images.pokemontcg.io/base1/10_hires.png',
  'Lugia':                 'https://images.pokemontcg.io/neo1/9_hires.png',
  'Tom Brady':             'https://a.espncdn.com/i/headshots/nfl/players/full/2330.png',
  'Mike Trout':            'https://a.espncdn.com/i/headshots/mlb/players/full/30836.png',
  'Tiger Woods':           'https://a.espncdn.com/i/headshots/golf/players/full/462.png',
  'LeBron James':          'https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png',
  'Lionel Messi':          'https://a.espncdn.com/i/headshots/soccer/players/full/45843.png',
};

const MARKETPLACE_SELLERS = ['VaultGrade', 'SlabCity', 'PristineCo', 'GemRack', 'RookieVault'];

// [player, sport, set, variant, num, grader, grade, price, imageKey?]
const CATALOG = [
  ['Victor Wembanyama', 'Basketball', '2023 Prizm',        'Silver RC',       '#1',   'PSA', '10',  4200],
  ['Luka Dončić',       'Basketball', '2018 Prizm',        'Silver RC',       '#280', 'PSA', '10',  1380],
  ['Anthony Edwards',   'Basketball', '2020 Prizm',        'Silver RC',       '#258', 'PSA', '10',  1240],
  ['Patrick Mahomes',   'Football',   '2017 Prizm',        'Silver RC',       '#269', 'PSA', '10',  2650],
  ['Justin Jefferson',  'Football',   '2020 Prizm',        'Silver RC',       '#398', 'BGS', '9.5',  740],
  ['Shohei Ohtani',     'Baseball',   '2018 Topps Chrome', 'RC Auto',         '#150', 'BGS', '9',   9200],
  ['Ronald Acuña Jr.',  'Baseball',   '2018 Topps',        'RC',              '#698', 'PSA', '10',   560],
  ['Connor McDavid',    'Hockey',     '2015 Upper Deck',   'Young Guns RC',   '#201', 'PSA', '10',  2300],
  ['Caitlin Clark',     'WNBA',       '2024 Prizm',        'Silver RC',       '#1',   'PSA', '10',  1850],
  ['Erling Haaland',    'Soccer',     '2019 Prizm',        'RC',              '#107', 'PSA', '10',  1120],
  ['Charizard',         'Pokémon',    '1999 Base Set',     'Holo 1st Ed',     '#4',   'PSA', '9',  12800, 'Charizard_1st'],
  ['Umbreon',           'Pokémon',    '2022 Evolving Skies','Alt Art VMAX',   '#215', 'PSA', '10',  1650],
  ['Ja Morant',         'Basketball', '2019 Prizm',        'Silver RC',       '#249', 'BGS', '9.5',  560],
  ['Jayson Tatum',      'Basketball', '2017 Prizm',        'Silver RC',       '#1',   'PSA', '10',   980],
  ['Josh Allen',        'Football',   '2018 Prizm',        'Silver RC',       '#1',   'PSA', '10',  1100],
  ['Caleb Williams',    'Football',   '2024 Prizm',        'Silver RC',       '#1',   'PSA', '10',   480],
  ['Juan Soto',         'Baseball',   '2018 Topps Update', 'RC',              '#US300','PSA','10',    620],
  ['Connor McDavid',    'Hockey',     '2015 Upper Deck',   'Young Guns RC',   '#201', 'BGS', '9.5',  980],
  ['Giannis Antetokounmpo','Basketball','2013 Prizm',       'RC',              '#290', 'PSA', '10',   980],
  ['Nikola Jokić',       'Basketball', '2015 Prizm',        'Silver RC',       '#78',  'PSA', '10',  1240],
  ['Caleb Williams',     'Football',   '2024 Prizm',        'Silver RC',       '#1',   'PSA', '10',   480],
  ['Aaron Judge',        'Baseball',   '2017 Topps',        'RC',              '#287', 'PSA', '10',   840],
  ['Fernando Tatis Jr.', 'Baseball',   '2019 Topps Chrome', 'RC',              '#149', 'PSA', '10',   620],
  ['Saquon Barkley',     'Football',   '2018 Prizm',        'Silver RC',       '#212', 'PSA', '10',   720],
  ['CeeDee Lamb',        'Football',   '2020 Prizm',        'Silver RC',       '#332', 'PSA', '10',   560],
  ['Cade Cunningham',    'Basketball', '2021 Prizm',        'Silver RC',       '#1',   'PSA', '10',   480],
  ['David Pastrnak',     'Hockey',     '2013 Upper Deck',   'Young Guns RC',   '#216', 'PSA', '10',   580],
  ['Vinicius Jr.',       'Soccer',     '2020 Topps Chrome', 'RC',              '#44',  'PSA', '10',   490],
  ['Mewtwo',             'Pokémon',    '1999 Base Set',     'Holo 1st Edition','#10',  'PSA', '9',   4200],
  ['Lugia',              'Pokémon',    '2000 Neo Genesis',  'Holo 1st Ed',     '#9',   'PSA', '9',   4800],
  ['Tom Brady',          'Football',   '2000 Bowman Chrome','RC Auto',         '#236', 'PSA', '9',   6900],
  ['Mike Trout',         'Baseball',   '2011 Topps Update', 'RC',              '#US175','PSA','10',  3100],
  ['LeBron James',       'Basketball', '2003 Topps Chrome', 'RC',              '#111', 'PSA', '10', 18500],
  ['Lionel Messi',       'Soccer',     '2004 Panini',       'RC',              '#71',  'PSA', '8',  14500],
];

export async function findUser(repo, userId) {
  return repo.users.get(userId);
}

export async function ensureSeed(repo, stripe, userId) {
  // Skip if user already has data
  const existing = await repo.listings.list({ seller_id: userId });
  if (existing.length > 0) return repo.users.get(userId);

  const me = await repo.users.get(userId);
  if (!me) return null;

  // Create marketplace seller accounts
  const sellers = [];
  for (const h of MARKETPLACE_SELLERS) {
    const existing = (await repo.users.list({ handle: h }))[0];
    sellers.push(existing || await repo.users.insert({ handle: h, email: `${h}@marketplace.app`, role: 'seller', created_at: new Date().toISOString() }));
  }

  const mine = [], others = [];
  for (let i = 0; i < CATALOG.length; i++) {
    const [player, sport, set, variant, num, grader, grade, price, imgKey] = CATALOG[i];
    // Pick image: explicit key override, or player name lookup
    const imageUrl = IMAGES[imgKey || player] || null;

    const card = await repo.cards.insert({ player, sport, card_set: set, variant, number: num, grader, grade, image_url: imageUrl });
    const ownedByMe = i % 4 === 0;
    const owner = ownedByMe ? me : sellers[i % sellers.length];

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

  await ledger.purchase(repo, me.id, 240, 'welcome');

  // Two incoming trade offers
  if (mine.length && others.length) {
    const o1 = others.find(o => o.vaultItemId) || others[0];
    const m1 = mine.find(m => m.vaultItemId) || mine[0];
    if (o1 && m1) {
      await trades.propose(repo, {
        proposerId: o1.sellerId, counterpartyId: me.id,
        give: [{ cardId: o1.card.id, vaultItemId: o1.vaultItemId }],
        get: [{ cardId: m1.card.id, vaultItemId: m1.vaultItemId }],
      });
    }
    const o2 = others.filter(o => o.vaultItemId)[1] || others[1];
    const m2 = mine[1] || mine[0];
    if (o2 && m2) {
      await trades.propose(repo, {
        proposerId: o2.sellerId, counterpartyId: me.id,
        give: [{ cardId: o2.card.id, vaultItemId: o2.vaultItemId }],
        get: [{ cardId: m2.card.id, vaultItemId: m2.vaultItemId }],
        cashFromProposer: 120,
      });
    }
  }
  return me;
}
