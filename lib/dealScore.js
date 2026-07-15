// GEMLINE Score — a single 0–100 "how good is this deal" number, computed
// server-side so every surface (Deal Finder, alerts, snapshots, live deals)
// ranks cards identically. Higher = better deal.
//
// The blend (weights sum to 100):
//   • Net edge after fees (45 pts)  — the money. Buy at the low ask, exit at
//     FMV high net of the 7.5% marketplace fee. % return on the buy price,
//     full marks at ≥25% net.
//   • Liquidity (30 pts)            — can you actually exit? 30-day sales,
//     log-scaled so 10 sales ≠ noise but 500 ≠ 50× better than 100.
//   • 7-day trend stability (15 pts)— calm charts score high. |gain7d| > 80%
//     is junk-risk (thin sales, clamped spikes) and zeroes this component
//     plus draws an extra penalty.
//   • Spread confidence (10 pts)    — CardHedge ch_confidence when populated
//     (observed range ≈ 0–0.5); unknown gets a neutral half-credit.

const MARKETPLACE_FEE = 0.075;

/**
 * @param {object} c  card row (raw DB names or mapCard names both accepted)
 *   lo / ch_price_lo, hi / ch_price_hi, sales30d / sales_30d,
 *   gain7d / gain_7d, confidence / ch_confidence
 * @returns {number} integer 0–100
 */
export function computeDealScore(c) {
  const lo = Number(c.lo ?? c.ch_price_lo) || 0;
  const hi = Number(c.hi ?? c.ch_price_hi) || 0;
  const sales30 = Number(c.sales30d ?? c.sales_30d) || 0;
  const gain7Raw = c.gain7d ?? c.gain_7d;
  const gain7 = gain7Raw === null || gain7Raw === undefined ? null : Number(gain7Raw);
  const confRaw = c.confidence ?? c.ch_confidence;
  const conf = confRaw === null || confRaw === undefined || confRaw === '' ? null : Number(confRaw);

  if (lo <= 0 || hi <= 0) return 0;

  // ── 1. Net edge after the 7.5% fee (45 pts) — weighted most ──────────────
  const netEdge = hi * (1 - MARKETPLACE_FEE) - lo;      // $ you keep
  const netPct = (netEdge / lo) * 100;                  // % return on buy price
  // ≤0% net → 0 pts; 25%+ net → full 45 pts, linear between.
  const edgePts = Math.max(0, Math.min(1, netPct / 25)) * 45;

  // ── 2. Liquidity (30 pts) — log-scaled 30-day sales ──────────────────────
  // log10(1+x): 0 sales → 0, 10 → ~0.39, 100 → ~0.74, 500+ → 1.0 (capped).
  const liqPts = Math.min(1, Math.log10(1 + sales30) / Math.log10(1 + 500)) * 30;

  // ── 3. 7-day trend stability (15 pts) ────────────────────────────────────
  // |move| ≤ 15% = calm, full credit. Linearly decays to 0 at 80%. Beyond 80%
  // it's junk-risk (thin-sale spikes): 0 pts AND a flat -10 penalty.
  let trendPts;
  let junkPenalty = 0;
  if (gain7 === null || Number.isNaN(gain7)) {
    trendPts = 10; // unknown trend: slightly below full credit, not punished
  } else {
    const a = Math.abs(gain7);
    if (a <= 15) trendPts = 15;
    else if (a <= 80) trendPts = 15 * (1 - (a - 15) / 65);
    else { trendPts = 0; junkPenalty = 10; }
  }

  // ── 4. Spread confidence (10 pts) ────────────────────────────────────────
  // ch_confidence observed ≈ 0.2–0.5 when present; 0.5+ = full credit.
  // NULL (most rows) = neutral 5 pts — absence of data isn't negative signal.
  const confPts = conf === null || Number.isNaN(conf)
    ? 5
    : Math.max(0, Math.min(1, conf / 0.5)) * 10;

  let score = edgePts + liqPts + trendPts + confPts - junkPenalty;
  // No positive net edge = not a deal, whatever the liquidity: cap below the
  // gold band so a dead-spread card can never wear a 70+ chip.
  if (netPct <= 0) score = Math.min(score, 45);
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Color band for a score chip: 90+ green, 70+ gold, else neutral. */
export function scoreBand(score) {
  if (score >= 90) return 'green';
  if (score >= 70) return 'gold';
  return 'neutral';
}
