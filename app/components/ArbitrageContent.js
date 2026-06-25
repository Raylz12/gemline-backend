'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(Number(n));
  return '$' + Number(n).toFixed(2);
}

function fmtPct(n) {
  if (!n) return null;
  const abs = Math.abs(Number(n));
  return { sign: n > 0 ? '+' : '-', val: abs.toFixed(1) + '%', positive: n > 0 };
}

// Deduplicate by cardhedge_id+grader — keeps the one with raw grader normalized
function dedupe(arr) {
  const seen = new Map();
  return arr.filter(c => {
    const key = (c.cardhedge_id || '') + '_' + (c.grader || '').toLowerCase().replace('raw ungraded', 'raw') + '_' + (c.grade || '').toLowerCase();
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

// ── Terminal Header ─────────────────────────────────────────────────────────
function TerminalHeader({ lastFetch }) {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      background: 'linear-gradient(90deg, rgba(10,13,20,1), rgba(20,25,40,1))',
      border: '1px solid rgba(232,179,57,.2)', borderRadius: 10, marginBottom: 16,
      fontFamily: 'var(--mono)', fontSize: 11,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: '#34d88a',
          boxShadow: '0 0 6px #34d88a', animation: 'pulse-live 2s ease-in-out infinite',
          display: 'inline-block', flexShrink: 0,
        }} />
        <span style={{ color: '#34d88a', fontWeight: 700, letterSpacing: '.06em' }}>LIVE FEED</span>
      </span>
      <span style={{ color: 'rgba(232,179,57,.7)', fontWeight: 700, fontSize: 13, letterSpacing: '.04em', marginRight: 'auto' }}>
        GEMLINE ARB DESK
      </span>
      <span style={{ color: 'var(--muted)' }}>
        {time}
      </span>
    </div>
  );
}

// ── Stat Tile ───────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, color }) {
  return (
    <div style={{
      flex: 1, minWidth: 100, padding: '12px 14px',
      background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18, color: color || 'var(--txt)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--dim)' }}>{sub}</div>}
    </div>
  );
}

// ── Card Row (Bloomberg terminal style) ──────────────────────────────────────
function CardRow({ card, maxGain, onClick }) {
  const pct = fmtPct(card.gain7d);
  const barW = card.gain7d ? Math.min(100, Math.abs(card.gain7d) / (maxGain || 100) * 100) : 0;
  const barColor = card.gain7d > 0
    ? 'linear-gradient(90deg, #34d88a, rgba(52,216,138,.4))'
    : 'linear-gradient(90deg, #ff5c6c, rgba(255,92,108,.4))';

  return (
    <div
      onClick={() => onClick?.(card)}
      style={{
        display: 'grid',
        gridTemplateColumns: '44px 1fr auto auto',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        background: 'var(--panel)',
        borderRadius: 10,
        border: '1px solid var(--line)',
        cursor: 'pointer',
        transition: '.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(232,179,57,.4)'; e.currentTarget.style.background = 'var(--panel-2)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.background = 'var(--panel)'; }}
    >
      {/* Momentum bar across bottom */}
      {barW > 0 && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, height: 2,
          width: barW + '%', background: barColor, borderRadius: '0 2px 0 0',
        }} />
      )}

      {/* Thumbnail */}
      <div style={{
        width: 44, height: 58, borderRadius: 6, flexShrink: 0, overflow: 'hidden',
        background: card.thumbnail
          ? `url(${card.thumbnail}) center/contain no-repeat var(--panel-2)`
          : 'linear-gradient(135deg, #2a2a2a, #555)',
      }} />

      {/* Card info */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {card.player}
          {card.rookie && <span style={{ marginLeft: 5, fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,.15)', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '.05em' }}>RC</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 4,
            background: card.grader === 'PSA' ? 'rgba(91,141,239,.18)' : card.grader === 'BGS' ? 'rgba(155,123,255,.15)' : 'rgba(255,255,255,.07)',
            color: card.grader === 'PSA' ? '#7aa3f5' : card.grader === 'BGS' ? '#c4b5fd' : 'var(--muted)',
            fontWeight: 600, fontSize: 10, marginRight: 5,
          }}>
            {card.grader}{card.grade ? ' ' + card.grade : ''}
          </span>
          {card.set}
        </div>
        {/* Volume bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
          <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: Math.min(100, (card.sales7d || 0) / 300 * 100) + '%',
              background: 'linear-gradient(90deg, rgba(232,179,57,.6), rgba(232,179,57,.2))',
              borderRadius: 2,
            }} />
          </div>
          <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{card.sales7d || 0}/wk</span>
        </div>
      </div>

      {/* Price + change */}
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 68 }}>
        <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15 }}>{fmtP(card.market)}</div>
        {pct && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
            color: pct.positive ? 'var(--up)' : 'var(--down)',
            background: pct.positive ? 'rgba(52,216,138,.1)' : 'rgba(255,92,108,.1)',
            padding: '1px 6px', borderRadius: 4, marginTop: 2,
          }}>
            {pct.sign}{pct.val}
          </div>
        )}
      </div>

      {/* Edge badge */}
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 52 }}>
        {card.edge > 0 ? (
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
            color: '#000', background: 'var(--gold)',
            padding: '2px 7px', borderRadius: 5, textAlign: 'center',
          }}>
            {Number(card.edge).toFixed(0)}% edge
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', textAlign: 'right' }}>
            —
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────
function Section({ title, emoji, subtitle, cards, onClick, color }) {
  const [showAll, setShowAll] = useState(false);
  const display = showAll ? cards : cards.slice(0, 10);
  const maxGain = Math.max(...cards.map(c => Math.abs(c.gain7d || 0)), 1);

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 20 }}>{emoji}</span>
        <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 18, color: color || 'var(--txt)' }}>{title}</h3>
        <span style={{
          marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10,
          color: 'var(--dim)', letterSpacing: '.06em',
        }}>{cards.length} cards</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{subtitle}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {display.map((c, i) => (
          <CardRow key={c.id || i} card={c} onClick={onClick} maxGain={maxGain} />
        ))}
      </div>
      {cards.length > 10 && !showAll && (
        <button onClick={() => setShowAll(true)} style={{
          marginTop: 8, padding: '8px 20px', borderRadius: 8, fontSize: 12,
          background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer',
          width: '100%',
        }}>Show all {cards.length} →</button>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function ArbitrageContent({ onSelectCard }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subStatus, setSubStatus] = useState(null);
  const [subLoading, setSubLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState(null);

  useEffect(() => {
    fetch('/api/market/arb')
      .then(r => r.json())
      .then(raw => {
        // Deduplicate all arrays
        setData({
          undervalued: dedupe(raw.undervalued || []),
          gainers: dedupe(raw.gainers || []),
          losers: dedupe(raw.losers || []),
          mostTraded: dedupe(raw.mostTraded || []),
        });
        setLastFetch(new Date());
      })
      .catch(err => console.error('Arb fetch error:', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token) { setSubStatus(false); setSubLoading(false); return; }
    fetch('/api/subscription/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { subscribed: false })
      .then(d => { setSubStatus(d.subscribed); setSubLoading(false); })
      .catch(() => { setSubStatus(false); setSubLoading(false); });
  }, [token]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sub') === 'success') { setSubStatus(true); setSubLoading(false); }
  }, []);

  const handleCardClick = (card) => {
    const normalized = {
      ...card,
      ini: (card.player || '').split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase(),
      theme: ['#2a2a2a', '#555'],
    };
    onSelectCard?.(normalized);
  };

  const handleSubscribe = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'arb_pro' }),
      });
      const d = await res.json();
      if (d.url) window.location.href = d.url;
      else alert(d.error || 'Checkout failed');
    } catch { alert('Failed to start checkout'); }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
        <div className="scout-spin" style={{ width: 24, height: 24, margin: '0 auto 12px' }} />
        Loading arbitrage data...
      </div>
    );
  }

  // Paywall gate — show terminal header + blurred preview + subscribe CTA
  if (!subLoading && !subStatus) {
    return (
      <div>
        <TerminalHeader lastFetch={lastFetch} />
        {/* Preview: blurred */}
        <div style={{ position: 'relative' }}>
          <div style={{ filter: 'blur(3px)', pointerEvents: 'none', maxHeight: 500, overflow: 'hidden' }}>
            {data?.undervalued?.length > 0 && (
              <Section title="Undervalued Radar" emoji="🎯"
                subtitle="Cards with the biggest price spreads and real trading volume"
                cards={data.undervalued.slice(0, 5)} color="var(--gold)" />
            )}
          </div>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(to bottom, transparent, rgba(10,13,20,.95) 50%)',
          }}>
            <div style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
              <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 24, marginBottom: 8 }}>Arbitrage Pro</h3>
              <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20, maxWidth: 360, lineHeight: 1.5 }}>
                Undervalued cards, price spreads, gainers, losers, and volume leaders — updated every 5 minutes.
              </p>
              <button onClick={handleSubscribe} style={{
                padding: '14px 32px', borderRadius: 10, fontSize: 15, fontWeight: 700,
                background: 'var(--gold)', color: '#000', cursor: 'pointer', border: 'none',
              }}>
                Unlock for $7.99/mo
              </button>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 10 }}>Cancel anytime · Instant access</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Stat tiles ──────────────────────────────────────────────────────────────
  const allCards = [...(data?.undervalued || []), ...(data?.gainers || []), ...(data?.losers || []), ...(data?.mostTraded || [])];
  const totalVol = allCards.reduce((s, c) => s + (c.sales7d || 0), 0);
  const topGainer = data?.gainers?.[0];
  const topLoser = data?.losers?.[0];
  const topTraded = data?.mostTraded?.[0];

  return (
    <div>
      <TerminalHeader lastFetch={lastFetch} />

      {/* Stat tiles */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatTile
          label="Weekly Volume"
          value={totalVol.toLocaleString()}
          sub="sales across all cards"
          color="var(--gold)"
        />
        <StatTile
          label="Top Gainer"
          value={topGainer ? '+' + Math.abs(Number(topGainer.gain7d)).toFixed(0) + '%' : '—'}
          sub={topGainer?.player}
          color="var(--up)"
        />
        <StatTile
          label="Top Loser"
          value={topLoser ? '-' + Math.abs(Number(topLoser.gain7d)).toFixed(0) + '%' : '—'}
          sub={topLoser?.player}
          color="var(--down)"
        />
        <StatTile
          label="Most Traded"
          value={topTraded ? topTraded.sales7d + '/wk' : '—'}
          sub={topTraded?.player}
        />
      </div>

      {data?.undervalued?.length > 0 && (
        <Section title="Undervalued Radar" emoji="🎯"
          subtitle="Biggest price edge × trading volume — cards where the spread suggests opportunity"
          cards={data.undervalued} onClick={handleCardClick} color="var(--gold)" />
      )}
      {data?.gainers?.length > 0 && (
        <Section title="7-Day Gainers" emoji="📈"
          subtitle="Cards with the biggest price increases this week"
          cards={data.gainers} onClick={handleCardClick} color="var(--up)" />
      )}
      {data?.losers?.length > 0 && (
        <Section title="7-Day Losers" emoji="📉"
          subtitle="Cards losing value — potential buy-the-dip opportunities"
          cards={data.losers} onClick={handleCardClick} color="var(--down)" />
      )}
      {data?.mostTraded?.length > 0 && (
        <Section title="Most Traded" emoji="🔥"
          subtitle="Highest volume cards this week — where the action is"
          cards={data.mostTraded} onClick={handleCardClick} />
      )}
    </div>
  );
}
