'use client';
import { useState } from 'react';
import { useAuth } from './AuthContext';
import AuthModal from './AuthModal';

/**
 * Wraps content in a blurred preview with sign-up CTA for non-logged-in users.
 * Shows real children to logged-in users.
 * `preview` prop: JSX to show as the blurred sample (or uses children if not provided).
 * `cta`: main call-to-action text
 * `subtitle`: description below CTA
 * `icon`: emoji icon
 * `always`: if true, shows preview even when logged in (for empty states)
 */
export default function PreviewGate({ children, preview, cta, subtitle, icon = '', always = false }) {
  const { user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (user && !always) return children;

  // If logged in but `always` — show the empty-state message without sign-up CTA
  const isLoggedIn = !!user;

  return (
    <>
      <div className="preview-gate">
        <div className="preview-sample">
          {preview || children}
        </div>
        <div className="preview-overlay">
          <div className="preview-cta-card">
            <div style={{ fontSize: 40, marginBottom: 8 }}>{icon}</div>
            <h3>{cta || 'See the full picture'}</h3>
            <p>{subtitle || 'Create a free account to unlock this feature.'}</p>
            {!isLoggedIn && (
              <>
                <button onClick={() => setShowAuth(true)} className="preview-btn">
                  Create Free Account
                </button>
                <span className="preview-signin" onClick={() => setShowAuth(true)}>
                  Already have an account? <b>Sign in</b>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}

/**
 * Sample card grid for preview purposes — shows realistic-looking cards
 */
export function SampleCardGrid({ count = 12 }) {
  const samples = [
    { player: 'Victor Wembanyama', sport: 'Basketball', grade: 'PSA 10', price: '$247', gain: '+8.2%', up: true },
    { player: 'Shohei Ohtani', sport: 'Baseball', grade: 'BGS 9.5', price: '$189', gain: '+3.1%', up: true },
    { player: 'Patrick Mahomes', sport: 'Football', grade: 'PSA 9', price: '$156', gain: '-2.4%', up: false },
    { player: 'Connor McDavid', sport: 'Hockey', grade: 'PSA 10', price: '$312', gain: '+11.5%', up: true },
    { player: 'Luka Dončić', sport: 'Basketball', grade: 'SGC 10', price: '$94', gain: '+1.8%', up: true },
    { player: 'Mike Trout', sport: 'Baseball', grade: 'PSA 10', price: '$520', gain: '-4.2%', up: false },
    { player: 'Justin Jefferson', sport: 'Football', grade: 'PSA 10', price: '$78', gain: '+6.7%', up: true },
    { player: 'Ken Griffey Jr.', sport: 'Baseball', grade: 'BGS 9', price: '$445', gain: '+2.1%', up: true },
    { player: 'Jaylen Brown', sport: 'Basketball', grade: 'PSA 9', price: '$34', gain: '-1.3%', up: false },
    { player: 'LeBron James', sport: 'Basketball', grade: 'PSA 10', price: '$1,240', gain: '+0.5%', up: true },
    { player: 'Caitlin Clark', sport: 'Basketball', grade: 'PSA 10', price: '$67', gain: '+15.3%', up: true },
    { player: 'Bryce Harper', sport: 'Baseball', grade: 'PSA 9', price: '$42', gain: '-0.8%', up: false },
  ].slice(0, count);

  return (
    <div className="sample-grid">
      {samples.map((c, i) => (
        <div key={i} className="sample-card">
          <div className="sample-card-img">
            <span className="sample-initials">{c.player.split(' ').map(w => w[0]).join('')}</span>
            <span className="sample-sport">{c.sport}</span>
          </div>
          <div className="sample-card-info">
            <div className="sample-player">{c.player}</div>
            <div className="sample-grade">{c.grade}</div>
            <div className="sample-price-row">
              <span className="sample-price">{c.price}</span>
              <span className={`sample-gain ${c.up ? 'up' : 'down'}`}>{c.gain}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Sample portfolio preview
 */
export function SamplePortfolio() {
  return (
    <div style={{ padding: '0 16px' }}>
      <div className="sample-stats-row">
        <div className="sample-stat"><span className="sample-stat-val">$2,847</span><span className="sample-stat-label">Portfolio Value</span></div>
        <div className="sample-stat"><span className="sample-stat-val">23</span><span className="sample-stat-label">Cards</span></div>
        <div className="sample-stat"><span className="sample-stat-val up">+12.4%</span><span className="sample-stat-label">7d Change</span></div>
        <div className="sample-stat"><span className="sample-stat-val">8</span><span className="sample-stat-label">Trades</span></div>
      </div>
      <SampleCardGrid count={8} />
    </div>
  );
}

/**
 * Sample auction/live preview  
 */
export function SampleLivePreview() {
  const auctions = [
    { player: 'Wembanyama Prizm RC', bid: '$185', bids: 12, time: '2h 14m' },
    { player: 'Ohtani Topps Chrome', bid: '$94', bids: 8, time: '45m' },
    { player: 'Mahomes Optic RC', bid: '$312', bids: 23, time: '5h 02m' },
    { player: 'LeBron Mosaic Silver', bid: '$78', bids: 5, time: '1h 30m' },
  ];
  return (
    <div className="sample-auctions">
      {auctions.map((a, i) => (
        <div key={i} className="sample-auction-card">
          <div className="sample-auction-img">
            <div className="sample-live-badge">● LIVE</div>
            <span className="sample-initials">{a.player.split(' ')[0].slice(0,3).toUpperCase()}</span>
          </div>
          <div className="sample-auction-info">
            <div className="sample-player">{a.player}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--gold)' }}>{a.bid}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{a.bids} bids · {a.time} left</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Sample trade preview
 */
export function SampleTradePreview() {
  return (
    <div className="sample-trades">
      <div className="sample-trade">
        <div className="sample-trade-side">
          <span className="sample-trade-label">You send</span>
          <div className="sample-trade-card">Wembanyama Prizm RC PSA 10</div>
        </div>
        <div className="sample-trade-arrow">⇄</div>
        <div className="sample-trade-side">
          <span className="sample-trade-label">You receive</span>
          <div className="sample-trade-card">Ohtani Topps Chrome BGS 9.5</div>
          <div className="sample-trade-card">+ $45 credits</div>
        </div>
      </div>
    </div>
  );
}
