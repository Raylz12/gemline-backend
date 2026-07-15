'use client';

// ── Capability gate ──────────────────────────────────────────────────────────
// Reusable premium-content gate. Gating is driven by hasCapability(user, cap):
// 'free' capabilities unlock with any signed-in account; 'pro' capabilities
// need an active GEMLINE Pro subscription (user.plan === 'pro', hydrated from
// /api/state — webhook-driven off the subscriptions table).
// Capability → required plan.
const CAPABILITY_PLAN = {
  market_insight: 'free',
  analytics: 'free',   // /analytics + /heatmap (movers/heatmap)
  // PAYWALLED 2026-07: the entire /deal-finder page (Deals + Worth Grading +
  // Live Deals + Alerts + Track Record) is a paid GEMLINE Pro feature. The
  // server enforces this too — /api/market/arb & friends 402 for non-Pro.
  dealfinder: 'pro',   // /deal-finder — GEMLINE Pro only
  community: 'free',   // /community directory + feed
};

export function hasCapability(user, capability) {
  const plan = CAPABILITY_PLAN[capability] || 'free';
  // 'free' = free WITH AN ACCOUNT: signed-out visitors get the frosted
  // blurred teaser + "create a free account" CTA. Any signed-in user unlocks
  // it. Callers pass `user || token` style signals: user hydrates async via
  // /api/state, so pages should treat a stored token as signed-in to avoid
  // flashing the blur at logged-in users on load.
  if (plan === 'free') return !!user;
  return !!user && user.plan === plan;   // paid tiers (pro)
}

export default function ProGate({
  allowed,
  title = 'Sign in to unlock market intelligence',
  sub = 'Market score, liquidity, 7-day trend, and FMV spread, free with a GEMLINE account.',
  cta = 'Sign in, it’s free',
  onUnlock,
  page = false, // full-page gate: cap the blurred teaser height, fade bottom
  // Pro pitch mode: bullets + price render an upgrade card instead of the
  // plain free-account CTA. Supply all three for the paid-tier surface.
  bullets = null,
  price = null,      // e.g. '$7.99/mo'
  priceNote = null,  // e.g. '7-day free trial · cancel anytime'
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
        {Array.isArray(bullets) && bullets.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '14px auto 0', maxWidth: 440, textAlign: 'left', display: 'grid', gap: 8 }}>
            {bullets.map((b, i) => (
              <li key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.45, color: 'rgba(255,255,255,.78)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34D88A" strokeWidth="3" style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        {price && (
          <div style={{ marginTop: 16 }}>
            <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 26, fontWeight: 800, color: '#E8B339' }}>{price}</span>
            {priceNote && <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', marginTop: 4 }}>{priceNote}</div>}
          </div>
        )}
        <button className="progate-cta" onClick={onUnlock}>{cta}</button>
      </div>
    </div>
  );
}
