'use client';
import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(Number(n));
  return '$' + Number(n).toFixed(2);
}

function fmtPct(n) {
  if (!n) return '0.0%';
  const abs = Math.abs(Number(n));
  const sign = Number(n) >= 0 ? '+' : '−';
  return `${sign}${abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 }) : abs.toFixed(1)}%`;
}

/* ── Edge meter bar ── */
function EdgeMeter({ edge, maxEdge }) {
  const pct = Math.min((edge / Math.max(maxEdge, 1)) * 100, 100);
  const color = edge > 30 ? '#34D88A' : edge > 15 ? '#E8B339' : '#5B8DEF';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 4, borderRadius: 2,
        background: 'rgba(255,255,255,.06)', overflow: 'hidden',
      }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .4s ease' }} />
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color, minWidth: 36, textAlign: 'right' }}>
        {edge > 0 ? `${Number(edge).toFixed(0)}%` : '—'}
      </span>
    </div>
  );
}

/* ── Terminal card row ── */
function TerminalRow({ card, rank, maxEdge, onClick }) {
  const [hov, setHov] = useState(false);
  const chPos = Number(card.gain7d) >= 0;
  return (
    <div
      onClick={() => onClick?.(card)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 52px 1fr 90px 80px 90px',
        alignItems: 'center',
        gap: 10,
        padding: '9px 14px',
        background: hov ? 'var(--panel-2)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,.04)',
        cursor: 'pointer',
        transition: '.12s',
      }}
    >
      {/* Rank */}
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', textAlign: 'center' }}>
        {rank}
      </span>
      {/* Thumbnail */}
      <div style={{
        width: 44, height: 58, borderRadius: 6, flexShrink: 0, overflow: 'hidden',
        background: card.thumbnail
          ? `url(${card.thumbnail}) center/contain no-repeat var(--panel-2)`
          : 'linear-gradient(135deg,#1a1f3a,#2a3055)',
        border: '1px solid rgba(255,255,255,.06)',
      }} />
      {/* Name + meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--txt)' }}>
          {card.player}
          {card.rookie && <span style={{ marginLeft: 5, fontSize: 9, background: 'var(--gold)', color: '#000', borderRadius: 3, padding: '1px 4px', fontWeight: 700, letterSpacing: '.04em' }}>RC</span>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {card.grader} {card.grade} · {card.year} {card.set}
        </div>
        <div style={{ marginTop: 5 }}>
          <EdgeMeter edge={card.edge || 0} maxEdge={maxEdge} />
        </div>
      </div>
      {/* Market price */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: 'var(--txt)' }}>{fmtP(card.market)}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, marginTop: 2, color: 'var(--dim)' }}>FMV</div>
      </div>
      {/* 7d change */}
      <div style={{ textAlign: 'right' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
          color: card.gain7d !== 0 ? (chPos ? 'var(--up)' : 'var(--down)') : 'var(--dim)',
        }}>
          {card.gain7d !== 0 && (chPos ? '▲' : '▼')}
          {card.gain7d !== 0 ? `${Math.abs(Number(card.gain7d)).toFixed(1)}%` : '—'}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>7d</div>
      </div>
      {/* Volume */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt)' }}>
          {(card.sales7d || 0).toLocaleString()}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>sales/wk</div>
      </div>
    </div>
  );
}

/* ── Section ── */
function ArbSection({ title, emoji, subtitle, color, cards, onCardClick, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);
  const maxEdge = cards.reduce((m, c) => Math.max(m, c.edge || 0), 1);
  const display = showAll ? cards : cards.slice(0, 10);

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 14,
    }}>
      {/* Section header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          background: 'rgba(0,0,0,.25)',
          borderBottom: expanded ? '1px solid var(--line)' : 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 18 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15, color: color || 'var(--txt)' }}>{title}</span>
          <span style={{ marginLeft: 10, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', letterSpacing: '.06em' }}>{subtitle}</span>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>{cards.length} signals</span>
        <span style={{ color: 'var(--dim)', fontSize: 14, marginLeft: 4 }}>{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '28px 52px 1fr 90px 80px 90px',
            gap: 10, padding: '6px 14px',
            background: 'rgba(0,0,0,.15)',
            borderBottom: '1px solid rgba(255,255,255,.04)',
          }}>
            {['#', '', 'Card / Edge', 'Price', '7D', 'Volume'].map((h, i) => (
              <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.12em', color: 'var(--dim)', textTransform: 'uppercase', textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>

          {display.map((card, i) => (
            <TerminalRow key={card.id || i} card={card} rank={i + 1} maxEdge={maxEdge} onClick={onCardClick} />
          ))}

          {cards.length > 10 && (
            <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,.04)' }}>
              <button
                onClick={() => setShowAll(s => !s)}
                style={{
                  width: '100%', padding: '8px', borderRadius: 8, fontSize: 12,
                  background: 'none', border: '1px solid var(--line)',
                  color: 'var(--muted)', cursor: 'pointer', fontFamily: 'var(--mono)',
                }}
              >
                {showAll ? `▲ Show less` : `▼ Show all ${cards.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Stat tile ── */
function StatTile({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--panel)',
      border: `1px solid ${accent ? accent + '30' : 'var(--line)'}`,
      borderLeft: `3px solid ${accent || 'var(--line)'}`,
      borderRadius: 10,
      padding: '12px 16px',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.14em', color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 22, color: accent || 'var(--txt)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function ArbitrageContent({ onSelectCard }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subStatus, setSubStatus] = useState(null);
  const [subLoading, setSubLoading] = useState(true);
  const [refreshTime, setRefreshTime] = useState(new Date());

  useEffect(() => {
    fetch('/api/market/arb')
      .then(r => r.json())
      .then(d => { setData(d); setRefreshTime(new Date()); })
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
      theme: ['#1a1f3a', '#2a3055'],
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
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '.1em' }}>LOADING ARB FEED...</div>
      </div>
    );
  }

  /* ── Compute summary stats ── */
  const allCards = [...(data?.undervalued || []), ...(data?.gainers || []), ...(data?.losers || []), ...(data?.mostTraded || [])];
  const topGain = data?.gainers?.[0];
  const topLoss = data?.losers?.[0];
  const totalVol = (data?.mostTraded || []).reduce((s, c) => s + (c.sales7d || 0), 0);
  const timeStr = refreshTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  /* ── Paywall ── */
  if (!subLoading && !subStatus) {
    return (
      <div>
        {/* Terminal header (always visible) */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: '#060910', border: '1px solid var(--line)', borderRadius: 10,
          padding: '12px 18px', marginBottom: 16, fontFamily: 'var(--mono)',
        }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34D88A', boxShadow: '0 0 8px #34D88A', animation: 'pulse 1.4s infinite' }} />
          <span style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--up)', textTransform: 'uppercase', fontWeight: 600 }}>LIVE FEED</span>
          <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 15, letterSpacing: '.08em', color: 'var(--gold)' }}>GEMLINE ARB DESK</span>
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>{timeStr}</span>
        </div>

        {/* Preview (blurred) */}
        <div style={{ position: 'relative' }}>
          <div style={{ filter: 'blur(3px)', pointerEvents: 'none', maxHeight: 500, overflow: 'hidden' }}>
            {data?.undervalued?.length > 0 && (
              <ArbSection title="Undervalued Radar" emoji="🎯" subtitle="biggest edge × volume" color="var(--gold)"
                cards={data.undervalued.slice(0, 5)} onCardClick={null} />
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

  return (
    <div>
      {/* ── Terminal header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: '#060910', border: '1px solid var(--line)', borderRadius: 10,
        padding: '12px 18px', marginBottom: 16, fontFamily: 'var(--mono)',
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34D88A', boxShadow: '0 0 8px #34D88A', animation: 'pulse 1.4s infinite' }} />
        <span style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--up)', textTransform: 'uppercase', fontWeight: 600 }}>LIVE FEED</span>
        <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 15, letterSpacing: '.08em', color: 'var(--gold)' }}>GEMLINE ARB DESK</span>
        <span style={{ fontSize: 10, color: 'var(--dim)' }}>Last refresh: {timeStr}</span>
      </div>

      {/* ── Stat tiles ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <StatTile label="Top Gainer 7D" value={topGain ? fmtPct(topGain.gain7d) : '—'} sub={topGain?.player || '—'} accent="var(--up)" />
        <StatTile label="Top Loser 7D" value={topLoss ? fmtPct(topLoss.gain7d) : '—'} sub={topLoss?.player || '—'} accent="var(--down)" />
        <StatTile label="Weekly Volume" value={totalVol > 1000 ? `${(totalVol/1000).toFixed(1)}K` : totalVol} sub="trades tracked" accent="var(--gold)" />
        <StatTile label="Signals Active" value={allCards.length} sub="cross-platform" accent="var(--blue)" />
      </div>

      {/* ── Sections ── */}
      {data?.undervalued?.length > 0 && (
        <ArbSection title="Undervalued Radar" emoji="🎯"
          subtitle="biggest edge × trading volume"
          color="var(--gold)" cards={data.undervalued}
          onCardClick={handleCardClick} defaultExpanded={true} />
      )}
      {data?.gainers?.length > 0 && (
        <ArbSection title="7-Day Gainers" emoji="📈"
          subtitle="biggest price increases"
          color="var(--up)" cards={data.gainers}
          onCardClick={handleCardClick} defaultExpanded={true} />
      )}
      {data?.losers?.length > 0 && (
        <ArbSection title="7-Day Losers" emoji="📉"
          subtitle="buy-the-dip candidates"
          color="var(--down)" cards={data.losers}
          onCardClick={handleCardClick} defaultExpanded={false} />
      )}
      {data?.mostTraded?.length > 0 && (
        <ArbSection title="Most Traded" emoji="🔥"
          subtitle="highest weekly volume"
          color="var(--blue)" cards={data.mostTraded}
          onCardClick={handleCardClick} defaultExpanded={false} />
      )}
    </div>
  );
}
