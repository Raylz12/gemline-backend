'use client';

// ── Capability gate ──────────────────────────────────────────────────────────
// Reusable premium-content gate, architected for a future Pro tier: gating is
// driven by hasCapability(user, cap) so flipping a capability to paid later is
// a one-line change (e.g. check user.plan === 'pro'). Today every signed-in
// user has every capability free — visitors get a frosted teaser + sign-in CTA.
// No billing exists yet; do NOT wire prices here.
// Capability → required plan. Every capability is 'free' today (any account
// unlocks it); flipping analytics/arbitrage/community to a paid Pro tier later
// is a one-line config change here (set to 'pro').
const CAPABILITY_PLAN = {
  market_insight: 'free',
  analytics: 'free',   // /analytics + /heatmap (movers/heatmap/arb tab)
  arbitrage: 'free',   // /arbitrage terminal
  community: 'free',   // /community directory + feed
};

export function hasCapability(user, capability) {
  const plan = CAPABILITY_PLAN[capability] || 'free';
  // Gate ACTIONS, not information: free capabilities are readable signed-out
  // (analytics, deal finder, card insight, community). Write paths (post, bid,
  // buy, watch) each prompt sign-in at the point of action instead.
  if (plan === 'free') return true;
  return !!user && user.plan === plan;   // future paid tiers
}

export default function ProGate({
  allowed,
  title = 'Sign in to unlock market intelligence',
  sub = 'Market score, liquidity, 7-day trend, and FMV spread — free with a GEMLINE account.',
  cta = 'Sign in — it’s free',
  onUnlock,
  page = false, // full-page gate: cap the blurred teaser height, fade bottom
  children,
}) {
  if (allowed) return children;
  return (
    <div className={page ? 'progate progate-page' : 'progate'}>
      <div className="progate-blur" aria-hidden="true">{children}</div>
      <div className="progate-cover">
        <div className="progate-lock">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className="progate-title">{title}</div>
        <div className="progate-sub">{sub}</div>
        <button className="progate-cta" onClick={onUnlock}>{cta}</button>
      </div>
    </div>
  );
}
