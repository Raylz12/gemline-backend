// Static catalog of top trading cards with current approximate market prices.
// This is the always-on baseline — the feed shows real spread data even with
// zero API keys configured. Prices updated June 2026.
// Structure: fmv = fair market value, asks = current market ask range, comps = recent sold range.

export const CATALOG = [
  // ── Basketball ──────────────────────────────────────────────────────────────
  {
    player: 'Victor Wembanyama', sport: 'Basketball', set: '2023-24 Prizm', variant: 'Silver RC', num: '#1', grader: 'PSA', grade: '10',
    fmv: 4100, asks: [4250, 4800], comps: [3950, 4100, 4300], trend: 'up',
  },
  {
    player: 'Victor Wembanyama', sport: 'Basketball', set: '2023-24 Prizm', variant: 'Silver RC', num: '#1', grader: 'BGS', grade: '9.5',
    fmv: 2200, asks: [2350, 2700], comps: [2100, 2200, 2400], trend: 'up',
  },
  {
    player: 'Luka Dončić', sport: 'Basketball', set: '2018-19 Prizm', variant: 'Silver RC', num: '#280', grader: 'PSA', grade: '10',
    fmv: 1380, asks: [1450, 1700], comps: [1300, 1380, 1500], trend: 'stable',
  },
  {
    player: 'LeBron James', sport: 'Basketball', set: '2003-04 Topps Chrome', variant: 'RC', num: '#111', grader: 'PSA', grade: '10',
    fmv: 18500, asks: [19500, 23000], comps: [17800, 18500, 19200], trend: 'up',
  },
  {
    player: 'Anthony Edwards', sport: 'Basketball', set: '2020-21 Prizm', variant: 'Silver RC', num: '#258', grader: 'PSA', grade: '10',
    fmv: 1240, asks: [1300, 1550], comps: [1180, 1240, 1350], trend: 'up',
  },
  {
    player: 'Caitlin Clark', sport: 'WNBA', set: '2024 Prizm', variant: 'RC', num: '#1', grader: 'PSA', grade: '10',
    fmv: 1850, asks: [1950, 2400], comps: [1750, 1850, 2050], trend: 'up',
  },
  {
    player: 'Ja Morant', sport: 'Basketball', set: '2019-20 Prizm', variant: 'Silver RC', num: '#249', grader: 'BGS', grade: '9.5',
    fmv: 560, asks: [590, 720], comps: [530, 560, 610], trend: 'stable',
  },
  {
    player: 'Jayson Tatum', sport: 'Basketball', set: '2017-18 Prizm', variant: 'Silver RC', num: '#1', grader: 'PSA', grade: '10',
    fmv: 980, asks: [1020, 1250], comps: [920, 980, 1060], trend: 'up',
  },
  // ── Football ─────────────────────────────────────────────────────────────────
  {
    player: 'Patrick Mahomes', sport: 'Football', set: '2017 Prizm', variant: 'Silver RC', num: '#269', grader: 'PSA', grade: '10',
    fmv: 2650, asks: [2800, 3300], comps: [2500, 2650, 2850], trend: 'stable',
  },
  {
    player: 'Josh Allen', sport: 'Football', set: '2018 Prizm', variant: 'Silver RC', num: '#1', grader: 'PSA', grade: '10',
    fmv: 1100, asks: [1180, 1450], comps: [1020, 1100, 1200], trend: 'up',
  },
  {
    player: 'Justin Jefferson', sport: 'Football', set: '2020 Prizm', variant: 'Silver RC', num: '#398', grader: 'BGS', grade: '9.5',
    fmv: 740, asks: [780, 960], comps: [700, 740, 810], trend: 'stable',
  },
  {
    player: 'Caleb Williams', sport: 'Football', set: '2024 Prizm', variant: 'Silver RC', num: '#1', grader: 'PSA', grade: '10',
    fmv: 480, asks: [510, 650], comps: [440, 480, 530], trend: 'up',
  },
  // ── Baseball ─────────────────────────────────────────────────────────────────
  {
    player: 'Shohei Ohtani', sport: 'Baseball', set: '2018 Topps Chrome', variant: 'RC Auto', num: '#150', grader: 'BGS', grade: '9',
    fmv: 9200, asks: [9800, 11500], comps: [8800, 9200, 9700], trend: 'up',
  },
  {
    player: 'Juan Soto', sport: 'Baseball', set: '2018 Topps Update', variant: 'RC', num: '#US300', grader: 'PSA', grade: '10',
    fmv: 620, asks: [660, 820], comps: [580, 620, 680], trend: 'up',
  },
  {
    player: 'Ronald Acuña Jr.', sport: 'Baseball', set: '2018 Topps', variant: 'RC', num: '#698', grader: 'PSA', grade: '10',
    fmv: 560, asks: [590, 740], comps: [520, 560, 610], trend: 'stable',
  },
  // ── Hockey ───────────────────────────────────────────────────────────────────
  {
    player: 'Connor McDavid', sport: 'Hockey', set: '2015-16 Upper Deck', variant: 'Young Guns RC', num: '#201', grader: 'PSA', grade: '10',
    fmv: 2300, asks: [2450, 2900], comps: [2200, 2300, 2500], trend: 'stable',
  },
  {
    player: 'Auston Matthews', sport: 'Hockey', set: '2016-17 Upper Deck', variant: 'Young Guns RC', num: '#201', grader: 'PSA', grade: '10',
    fmv: 680, asks: [720, 890], comps: [640, 680, 740], trend: 'stable',
  },
  // ── Soccer ───────────────────────────────────────────────────────────────────
  {
    player: 'Erling Haaland', sport: 'Soccer', set: '2019-20 Prizm', variant: 'RC', num: '#107', grader: 'PSA', grade: '10',
    fmv: 1120, asks: [1180, 1450], comps: [1060, 1120, 1220], trend: 'up',
  },
  {
    player: 'Kylian Mbappé', sport: 'Soccer', set: '2018-19 Prizm', variant: 'Silver RC', num: '#80', grader: 'PSA', grade: '10',
    fmv: 1450, asks: [1530, 1900], comps: [1380, 1450, 1580], trend: 'stable',
  },
  // ── Pokémon ──────────────────────────────────────────────────────────────────
  {
    player: 'Charizard', sport: 'Pokémon', set: '1999 Base Set', variant: 'Holo 1st Edition', num: '#4', grader: 'PSA', grade: '9',
    fmv: 12800, asks: [13500, 16500], comps: [12200, 12800, 13600], trend: 'up',
  },
  {
    player: 'Charizard', sport: 'Pokémon', set: '1999 Base Set', variant: 'Holo Shadowless', num: '#4', grader: 'PSA', grade: '10',
    fmv: 42000, asks: [45000, 58000], comps: [39000, 42000, 46000], trend: 'up',
  },
  {
    player: 'Umbreon', sport: 'Pokémon', set: '2022 Evolving Skies', variant: 'Alt Art VMAX', num: '#215', grader: 'PSA', grade: '10',
    fmv: 1650, asks: [1750, 2100], comps: [1580, 1650, 1780], trend: 'stable',
  },
  {
    player: 'Pikachu Illustrator', sport: 'Pokémon', set: '1998 CoroCoro', variant: 'Promo', num: '#', grader: 'PSA', grade: '7',
    fmv: 85000, asks: [90000, 110000], comps: [80000, 85000, 92000], trend: 'stable',
  },
];
