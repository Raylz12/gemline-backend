'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';

function fmt(cents) {
  if (!cents) return '?';
  const n = cents / 100;
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function PoolCard({ pool, onPull, pulling }) {
  const sportEmoji = { Basketball: '🏀', Baseball: '⚾', Football: '🏈', Pokemon: '🃏', Hockey: '🏒', Soccer: '⚽' }[pool.sport] || '🎴';
  const available = Number(pool.cards_available) || 0;

  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16,
      overflow: 'hidden', transition: 'border-color .15s, transform .15s',
      display: 'flex', flexDirection: 'column',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = 'none'; }}
    >
      {/* Header banner */}
      <div style={{ height: 90, background: 'linear-gradient(135deg,#1a1f35,#2a3060)', display: 'grid', placeItems: 'center', fontSize: 48, position: 'relative' }}>
        {sportEmoji}
        {pool.store_verified && (
          <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 9, background: 'rgba(22,199,132,.15)', border: '1px solid rgba(22,199,132,.3)', color: 'var(--gold)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--mono)' }}>✓ VERIFIED</div>
        )}
        <div style={{ position: 'absolute', top: 8, left: 10, fontSize: 9, background: 'rgba(0,0,0,.5)', color: available > 0 ? 'var(--up)' : 'var(--down)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--mono)' }}>
          {available} card{available !== 1 ? 's' : ''} left
        </div>
      </div>

      <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15 }}>{pool.name}</div>
          {pool.store_name && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>by @{pool.store_handle}</div>}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: 18, color: 'var(--gold)' }}>{pool.price_credits}</div>
            <div style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Credits</div>
          </div>
          {(pool.min_value_cents || pool.max_value_cents) && (
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16, color: 'var(--txt)' }}>
                {fmt(pool.min_value_cents)}–{fmt(pool.max_value_cents)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Est. Value</div>
            </div>
          )}
        </div>

        <button
          onClick={() => onPull(pool)}
          disabled={pulling || available === 0}
          style={{
            marginTop: 'auto', padding: '11px 0', borderRadius: 9, fontWeight: 800, fontSize: 14,
            cursor: pulling || available === 0 ? 'not-allowed' : 'pointer',
            background: available === 0 ? 'var(--panel-2)' : 'linear-gradient(135deg, #16c784, #0fa76f)',
            color: available === 0 ? 'var(--dim)' : '#000',
            border: 'none', transition: 'opacity .15s',
            opacity: pulling ? 0.7 : 1,
          }}
        >
          {available === 0 ? 'Sold Out' : pulling ? 'Pulling...' : `🎴 Pull Now · ${pool.price_credits} credits`}
        </button>
      </div>
    </div>
  );
}

function RevealModal({ card, onClose }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 800);
    return () => clearTimeout(t);
  }, []);

  if (!card) return null;
  const val = card.estimatedValue ? '$' + (card.estimatedValue / 100).toFixed(2) : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'grid', placeItems: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div style={{ textAlign: 'center', padding: 40 }} onClick={e => e.stopPropagation()}>
        {/* Card flip */}
        <div style={{
          width: 200, height: 280, margin: '0 auto 24px', borderRadius: 14,
          background: revealed ? 'linear-gradient(135deg,#1a2040,#2a3060)' : 'linear-gradient(135deg,#111,#222)',
          border: `2px solid ${revealed ? 'var(--gold)' : 'var(--line)'}`,
          display: 'grid', placeItems: 'center', fontSize: 48,
          boxShadow: revealed ? '0 0 40px rgba(22,199,132,.4)' : 'none',
          transition: 'all .6s cubic-bezier(.34,1.56,.64,1)',
          transform: revealed ? 'rotateY(0deg) scale(1.05)' : 'rotateY(90deg)',
        }}>
          {revealed ? '🎴' : '❓'}
        </div>

        {revealed && (
          <>
            <div style={{ fontFamily: 'var(--disp)', fontSize: 24, fontWeight: 800, marginBottom: 6 }}>
              {card.name || 'Mystery Card'}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--muted)', marginBottom: 8 }}>
              {card.grade || 'RAW'}
            </div>
            {val && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 800, color: 'var(--gold)', marginBottom: 20 }}>
                Est. {val}
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 20 }}>
              This card will ship from the store within 3–5 business days.
            </p>
          </>
        )}

        <button onClick={onClose} style={{
          padding: '10px 28px', borderRadius: 9, background: 'var(--gold)', color: '#000',
          fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
        }}>
          {revealed ? 'Awesome! Close' : 'Skip reveal'}
        </button>
      </div>
    </div>
  );
}

export default function MysteryPullsPage() {
  const { user, token, authFetch } = useAuth();
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/mystery/pools')
      .then(r => r.json())
      .then(d => { setPools(d.pools || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handlePull = async (pool) => {
    if (!user) { setError('Sign in to pull cards'); return; }
    setPulling(true); setError('');
    try {
      const res = await authFetch(`/api/mystery/pools/${pool.id}/pull`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Pull failed'); return; }
      setReveal(data.card);
      // Refresh pools to update card counts
      fetch('/api/mystery/pools').then(r => r.json()).then(d => setPools(d.pools || [])).catch(() => {});
    } catch (e) {
      setError('Something went wrong. Try again.');
    } finally {
      setPulling(false);
    }
  };

  return (
    <>
      {reveal && <RevealModal card={reveal} onClose={() => setReveal(null)} />}

      <div className="eyebrow">Marketplace</div>
      <h1 className="page">Mystery Pulls</h1>
      <p className="sub">Real cards, real value. Verified stores submit cards to pools — you pull one and it ships to you.</p>

      {/* How it works banner */}
      <div style={{ background: 'rgba(22,199,132,.06)', border: '1px solid rgba(22,199,132,.15)', borderRadius: 12, padding: '14px 18px', marginBottom: 24, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {[
          ['🏪', 'Verified stores submit real cards to each pool'],
          ['🎴', 'You buy a pull with credits and get a random card'],
          ['📦', 'Your card ships directly from the store in 3–5 days'],
        ].map(([icon, text]) => (
          <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
            <span style={{ fontSize: 18 }}>{icon}</span> {text}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: 'rgba(255,92,108,.1)', border: '1px solid rgba(255,92,108,.3)', borderRadius: 9, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--down)' }}>
          {error}
        </div>
      )}

      {!user && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', marginBottom: 20, fontSize: 13, color: 'var(--muted)' }}>
          Sign in to pull cards from pools.
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, height: 280, opacity: 0.5 }} />
          ))}
        </div>
      ) : pools.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🎴</div>
          <div style={{ fontFamily: 'var(--disp)', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>No pools open right now</div>
          <p style={{ color: 'var(--muted)', maxWidth: 380, margin: '0 auto 20px', fontSize: 13 }}>
            Mystery Pull pools are created by verified stores. Check back soon — or apply to become a store and create your own pool.
          </p>
          <a href="/sell" style={{ padding: '10px 22px', background: 'var(--gold)', color: '#000', borderRadius: 9, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            Apply to Sell →
          </a>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {pools.map(p => <PoolCard key={p.id} pool={p} onPull={handlePull} pulling={pulling} />)}
        </div>
      )}

      {/* Store CTA */}
      <div style={{ marginTop: 40, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15 }}>Are you a verified store?</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>Submit cards to a pool and reach collectors directly. No listing fees on pool cards.</p>
        </div>
        <a href="/sell" style={{ padding: '10px 20px', background: 'var(--gold)', color: '#000', borderRadius: 9, fontWeight: 700, fontSize: 13, textDecoration: 'none', flexShrink: 0 }}>
          Submit Cards to a Pool →
        </a>
      </div>
    </>
  );
}
