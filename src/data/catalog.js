// Card catalog — identity only. No hardcoded prices.
// Prices are fetched live from eBay sold comps + active asks via Apify.
// The `ebayQuery` field is the optimized search string for each card.

export const CATALOG = [
  // ── Basketball ──────────────────────────────────────────────────────────────
  {
    player: 'Victor Wembanyama', sport: 'Basketball', set: '2023-24 Prizm', variant: 'Silver RC', num: '#1', grader: 'PSA', grade: '10',
    ebayQuery: 'Victor Wembanyama 2023 Prizm Silver RC PSA 10',
  },
  {
    player: 'Luka Dončić', sport: 'Basketball', set: '2018-19 Prizm', variant: 'Silver RC', num: '#280', grader: 'PSA', grade: '10',
    ebayQuery: 'Luka Doncic 2018 Prizm Silver RC PSA 10',
  },
  {
    player: 'LeBron James', sport: 'Basketball', set: '2003-04 Topps Chrome', variant: 'RC', num: '#111', grader: 'PSA', grade: '10',
    ebayQuery: 'LeBron James 2003 Topps Chrome RC PSA 10',
  },
  {
    player: 'Anthony Edwards', sport: 'Basketball', set: '2020-21 Prizm', variant: 'Silver RC', num: '#258', grader: 'PSA', grade: '10',
    ebayQuery: 'Anthony Edwards 2020 Prizm Silver RC PSA 10',
  },
  {
    player: 'Caitlin Clark', sport: 'WNBA', set: '2024 Prizm', variant: 'RC', num: '#1', grader: 'PSA', grade: '10',
    ebayQuery: 'Caitlin Clark 2024 Prizm RC PSA 10',
  },
  {
    player: 'Jayson Tatum', sport: 'Basketball', set: '2017-18 Prizm', variant: 'Silver RC', num: '#1', grader: 'PSA', grade: '10',
    ebayQuery: 'Jayson Tatum 2017 Prizm Silver RC PSA 10',
  },
  {
    player: 'Ja Morant', sport: 'Basketball', set: '2019-20 Prizm', variant: 'Silver RC', num: '#249', grader: 'BGS', grade: '9.5',
    ebayQuery: 'Ja Morant 2019 Prizm Silver RC BGS 9.5',
  },
  // ── Football ─────────────────────────────────────────────────────────────────
  {
    player: 'Patrick Mahomes', sport: 'Football', set: '2017 Prizm', variant: 'Silver RC', num: '#269', grader: 'PSA', grade: '10',
    ebayQuery: 'Patrick Mahomes 2017 Prizm Silver RC PSA 10',
  },
  {
    player: 'Josh Allen', sport: 'Football', set: '2018 Prizm', variant: 'Silver RC', num: '#1', grader: 'PSA', grade: '10',
    ebayQuery: 'Josh Allen 2018 Prizm Silver RC PSA 10',
  },
  {
    player: 'Justin Jefferson', sport: 'Football', set: '2020 Prizm', variant: 'Silver RC', num: '#398', grader: 'BGS', grade: '9.5',
    ebayQuery: 'Justin Jefferson 2020 Prizm Silver RC BGS 9.5',
  },
  {
    player: 'Caleb Williams', sport: 'Football', set: '2024 Prizm', variant: 'Silver RC', num: '#1', grader: 'PSA', grade: '10',
    ebayQuery: 'Caleb Williams 2024 Prizm Silver RC PSA 10',
  },
  // ── Baseball ─────────────────────────────────────────────────────────────────
  {
    player: 'Shohei Ohtani', sport: 'Baseball', set: '2018 Topps Chrome', variant: 'RC Auto', num: '#150', grader: 'BGS', grade: '9',
    ebayQuery: 'Shohei Ohtani 2018 Topps Chrome RC Auto BGS 9',
  },
  {
    player: 'Juan Soto', sport: 'Baseball', set: '2018 Topps Update', variant: 'RC', num: '#US300', grader: 'PSA', grade: '10',
    ebayQuery: 'Juan Soto 2018 Topps Update RC PSA 10',
  },
  {
    player: 'Ronald Acuña Jr.', sport: 'Baseball', set: '2018 Topps', variant: 'RC', num: '#698', grader: 'PSA', grade: '10',
    ebayQuery: 'Ronald Acuna 2018 Topps RC PSA 10',
  },
  // ── Hockey ───────────────────────────────────────────────────────────────────
  {
    player: 'Connor McDavid', sport: 'Hockey', set: '2015-16 Upper Deck', variant: 'Young Guns RC', num: '#201', grader: 'PSA', grade: '10',
    ebayQuery: 'Connor McDavid 2015 Upper Deck Young Guns RC PSA 10',
  },
  {
    player: 'Auston Matthews', sport: 'Hockey', set: '2016-17 Upper Deck', variant: 'Young Guns RC', num: '#201', grader: 'PSA', grade: '10',
    ebayQuery: 'Auston Matthews 2016 Upper Deck Young Guns RC PSA 10',
  },
  // ── Soccer ───────────────────────────────────────────────────────────────────
  {
    player: 'Erling Haaland', sport: 'Soccer', set: '2019-20 Prizm', variant: 'RC', num: '#107', grader: 'PSA', grade: '10',
    ebayQuery: 'Erling Haaland 2019 Prizm RC PSA 10',
  },
  {
    player: 'Kylian Mbappé', sport: 'Soccer', set: '2018-19 Prizm', variant: 'Silver RC', num: '#80', grader: 'PSA', grade: '10',
    ebayQuery: 'Kylian Mbappe 2018 Prizm Silver RC PSA 10',
  },
  // ── Pokémon ──────────────────────────────────────────────────────────────────
  {
    player: 'Charizard', sport: 'Pokémon', set: '1999 Base Set', variant: 'Holo 1st Edition', num: '#4', grader: 'PSA', grade: '9',
    ebayQuery: 'Charizard 1999 Base Set 1st Edition Holo PSA 9',
  },
  {
    player: 'Charizard', sport: 'Pokémon', set: '1999 Base Set', variant: 'Holo Shadowless', num: '#4', grader: 'PSA', grade: '10',
    ebayQuery: 'Charizard 1999 Base Set Shadowless Holo PSA 10',
  },
  {
    player: 'Umbreon', sport: 'Pokémon', set: '2022 Evolving Skies', variant: 'Alt Art VMAX', num: '#215', grader: 'PSA', grade: '10',
    ebayQuery: 'Umbreon VMAX Alt Art 215 Evolving Skies PSA 10',
  },
  {
    player: 'Pikachu Illustrator', sport: 'Pokémon', set: '1998 CoroCoro', variant: 'Promo', num: '#', grader: 'PSA', grade: '7',
    ebayQuery: 'Pikachu Illustrator CoroCoro Promo PSA 7',
  },
];
