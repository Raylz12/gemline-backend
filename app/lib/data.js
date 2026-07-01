// Shared data constants and helpers — mirrors reference_design.html logic

export const PLATFORMS = [
  { n: 'GEMLINE', c: '#16c784' }, { n: 'eBay', c: '#5B8DEF' }, { n: 'COMC', c: '#34D88A' },
  { n: 'PWCC', c: '#9B7BFF' }, { n: 'Goldin', c: '#FF5C6C' }, { n: 'Whatnot', c: '#ff8a3d' },
  { n: 'SportsCardHQ', c: '#22d3ee' },
];

export const SPORT_THEME = {
  Basketball: ['#3a1f6e', '#7b4dd6'], Football: ['#1f3a2e', '#2f8f5b'], Baseball: ['#3a1f1f', '#c0473a'],
  Hockey: ['#16263f', '#3a6ea5'], Soccer: ['#0f3a33', '#1fb89a'], 'Pokémon': ['#3a2a0d', '#e8b339'],
  WNBA: ['#3a1530', '#d6478f'], F1: ['#3a1212', '#e23b3b'], UFC: ['#2a2a2a', '#888'],
  Golf: ['#1f3326', '#4a9d5e'], College: ['#2a1f3a', '#6a4dd6'],
};

function rnd(a, b) { return Math.random() * (b - a) + a; }

export function spark(base, n = 24, vol = 0.08) {
  let v = base, out = [v];
  for (let i = 1; i < n; i++) { v = Math.max(base * 0.6, v * (1 + rnd(-vol, vol))); out.push(v); }
  return out;
}

const NAMES = [
  ['Victor Wembanyama','Basketball','2023 Prizm','RC Silver','#23','PSA','10',4200,'WEMBY'],
  ['LeBron James','Basketball','2003 Topps Chrome','Rookie','#111','PSA','9',2150,'LBJ'],
  ['Luka Dončić','Basketball','2018 Prizm','Silver RC','#280','PSA','10',1380,'LUKA'],
  ['Michael Jordan','Basketball','1986 Fleer','Rookie','#57','PSA','8',38500,'MJ'],
  ['Stephen Curry','Basketball','2009 Topps','Rookie','#321','BGS','9.5',980,'CURRY'],
  ['Patrick Mahomes','Football','2017 Prizm','Silver RC','#269','PSA','10',2650,'MAHO'],
  ['Tom Brady','Football','2000 Bowman','Rookie','#236','PSA','9',6900,'TB12'],
  ['C.J. Stroud','Football','2023 Prizm','RC','#301','PSA','10',420,'CJS'],
  ['Justin Jefferson','Football','2020 Prizm','Silver RC','#398','BGS','9.5',740,'JJ'],
  ['Caitlin Clark','WNBA','2024 Prizm','RC','#1','PSA','10',1850,'CC22'],
  ['Mike Trout','Baseball','2011 Topps Update','Rookie','#US175','PSA','10',3100,'TROUT'],
  ['Shohei Ohtani','Baseball','2018 Topps Chrome','RC Auto','#150','BGS','9',9200,'SHO'],
  ['Ronald Acuña Jr.','Baseball','2018 Topps','RC','#698','PSA','10',560,'RAJ'],
  ['Connor McDavid','Hockey','2015 Upper Deck','Young Guns','#201','PSA','10',2300,'McD'],
  ['Auston Matthews','Hockey','2016 Upper Deck','Young Guns','#201','PSA','9',680,'AM34'],
  ['Lionel Messi','Soccer','2004 Panini','Rookie','#71','PSA','8',14500,'MESSI'],
  ['Erling Haaland','Soccer','2019 Panini Prizm','RC','#107','PSA','10',1120,'HAAL'],
  ['Kylian Mbappé','Soccer','2018 Prizm World Cup','Silver','#172','PSA','10',890,'MBAP'],
  ['Charizard','Pokémon','1999 Base Set','Holo 1st Ed','#4','PSA','9',12800,'CHAR'],
  ['Pikachu','Pokémon','1999 Base Set','Red Cheeks','#58','PSA','8',2400,'PIKA'],
  ['Umbreon','Pokémon','2022 Evolving Skies','Alt Art VMAX','#215','PSA','10',1650,'UMBR'],
  ['Lugia','Pokémon','2000 Neo Genesis','Holo 1st Ed','#9','PSA','9',4800,'LUGI'],
  ['Max Verstappen','F1','2020 Topps Chrome','RC','#1','PSA','10',520,'MV1'],
  ['Lewis Hamilton','F1','2020 Topps Chrome','Base','#44','PSA','10',380,'LH44'],
  ['Jon Jones','UFC','2011 Topps','Rookie','#88','PSA','9',340,'JBJ'],
  ['Tiger Woods','Golf','2001 Upper Deck','Rookie','#1','PSA','9',2900,'TIGR'],
  ['Anthony Edwards','Basketball','2020 Prizm','Silver RC','#258','PSA','10',1240,'ANT'],
  ['Ja Morant','Basketball','2019 Prizm','Silver RC','#249','BGS','9.5',560,'JA12'],
  ['Bryce Harper','Baseball','2012 Bowman Chrome','RC Auto','#BCP10','PSA','10',1980,'HARP'],
  ['Travis Hunter','College','2024 Bowman U','Chrome RC','#1','PSA','10',640,'HUNT'],
];

const sellers = ['VaultGrade','SlabCity','PristineCo','HobbyDesk','TopLoaderTom','GemRack','CardLab','ArbitrageAce'];

let nextId = 1;
export function gradeClass(g) { return g === 'PSA' ? 'psa' : g === 'BGS' ? 'bgs' : g === 'SGC' ? 'sgc' : 'raw'; }

export function generateCards() {
  nextId = 1;
  return NAMES.map((r, i) => {
    const [player, sport, set, variant, num, grader, grade, base, ini] = r;
    const market = Math.round(base * rnd(0.97, 1.12));
    const plats = PLATFORMS.map(p => ({ ...p, price: Math.round(market * rnd(0.86, 1.18)) }));
    plats[0].price = Math.round(market * rnd(0.9, 1.04));
    const lo = Math.min(...plats.map(p => p.price));
    const hi = Math.max(...plats.map(p => p.price));
    const edge = +((( hi - lo) / lo) * 100).toFixed(1);
    const ch = +rnd(-14, 22).toFixed(1);
    const live = Math.random() < 0.28;
    const owned = i % 5 === 0;
    const lo90 = Math.round(market * rnd(0.62, 0.82));
    const hi90 = Math.round(market * rnd(1.12, 1.5));
    return {
      id: nextId++, player, sport, set, variant, num, grader, grade,
      ask: plats[0].price, market, plats, lo, hi, edge, ch,
      sp: spark(market, 24, 0.06), seller: owned ? 'You' : sellers[i % sellers.length],
      ini, theme: SPORT_THEME[sport], type: live ? 'auction' : 'buy',
      endsIn: live ? Math.floor(rnd(40, 900)) : null,
      bids: live ? Math.floor(rnd(4, 40)) : 0,
      popGem: Math.floor(rnd(20, 3200)), pop9: Math.floor(rnd(400, 9000)),
      pop8: Math.floor(rnd(800, 14000)), popLow: Math.floor(rnd(2000, 40000)),
      owned, listed: owned, boost: null,
      costBasis: owned ? Math.round(market * rnd(0.5, 0.95)) : null,
      vel: +rnd(0.4, 9).toFixed(1), liq: Math.floor(rnd(18, 98)), lo90, hi90,
      lastSold: Math.round(market * rnd(0.9, 1.08)), watchers: Math.floor(rnd(3, 420)),
    };
  });
}

export function fmt(n) {
  if (n == null || isNaN(n)) return null;
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 100) return sign + '$' + abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '$' + Math.round(abs).toLocaleString();
}
export function fmtDisplay(n) {
  const v = fmt(n);
  return v || 'Price TBD';
}
export function fmtRange(lo, hi) {
  if (!lo && !hi) return null;
  if (lo && hi && lo !== hi) return `${fmt(lo)} – ${fmt(hi)}`;
  return fmt(lo || hi);
}
export const popFmt = n => n == null ? '—' : Number(n).toLocaleString();

export function chTxt(v) {
  const s = v >= 0 ? 'up' : 'down';
  const a = v >= 0 ? '▲' : '▼';
  return { cls: s, text: `${a} ${Math.abs(v)}%` };
}

export function slabStyle(c) {
  return { '--cardbg': `linear-gradient(150deg,${c.theme[0]},${c.theme[1]})` };
}

export function miniStyle(c) {
  return { background: `linear-gradient(135deg,${c.theme[0]},${c.theme[1]})` };
}

export function sparkSVG() {
  // Sparklines removed — no real historical data available
  return '';
}

export const BOOST_TIERS = [
  { tier: 'bump', label: 'Bump', icon: '↑', rank: 1, cost: 25, dur: '6h', desc: 'Nudge above standard listings for 6 hours.' },
  { tier: 'spotlight', label: 'Spotlight', icon: '✦', rank: 2, cost: 75, dur: '24h', desc: 'Featured row plus a badge. Ranks above bumps for 24 hours.' },
  { tier: 'frontline', label: 'Front of Line', icon: '⚡', rank: 3, cost: 200, dur: '24h', desc: 'Top of the marketplace and first in the live queue for 24 hours.' },
];

export const CREDIT_PACKS = [
  { cr: 100, price: 9.99, bonus: 0 },
  { cr: 550, price: 49.99, bonus: 50 },
  { cr: 1200, price: 99.99, bonus: 200, best: true },
  { cr: 3000, price: 199.99, bonus: 600 },
];
