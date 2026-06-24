// Spread engine: merges multi-source offers into a single GEMLINE card shape.
// Edge % = (hi_ask - lo_ask) / lo_ask * 100, rounded to 1 decimal.

let _seq = 0;
export function resetIds() { _seq = 0; }

export function buildCard({ player, sport, set, variant, num, grader, grade, fmv, offers = [], comps = [], history = [] }) {
  if (!offers.length) return null;

  const prices = offers.map(o => Number(o.price)).filter(p => p > 0).sort((a, b) => a - b);
  if (!prices.length) return null;

  const lo = prices[0];
  const hi = prices[prices.length - 1];
  const edge = hi > lo ? Math.round(((hi - lo) / lo) * 1000) / 10 : 0;

  return {
    id: ++_seq,
    player, sport, set, variant, num, grader, grade,
    fmv: fmv ?? lo,
    lo, hi, edge,
    offers: offers.map(o => ({ source: o.source, price: Number(o.price), url: o.url || null, kind: o.kind || 'ask' })),
    comps: comps.slice(0, 5),
    history: history.slice(0, 10),
  };
}
