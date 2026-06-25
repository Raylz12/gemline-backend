'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(Number(n));
  return '$' + Number(n).toFixed(2);
}

function StatTile({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--panel)', border: `1px solid var(--line)`,
      borderLeft: `3px solid ${accent || 'var(--gold)'}`,
      borderRadius: 12, padding: '14px 18px', flex: 1, minWidth: 120,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', right: -14, top: -14, width: 60, height: 60, borderRadius: '50%', background: `radial-gradient(circle, ${accent || 'rgba(232,179,57,.12)'}, transparent 70%)` }} />
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 22, color: accent || 'var(--gold)', letterSpacing: '-.01em' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function EdgeMeter({ pct, color }) {
  const width = Math.min(Math.abs(pct || 0), 100);
  const bg = color || (pct > 0 ? 'var(--up)' : 'var(--down)');
  return (
    <div style={{ height: 4, background: 'var(--panel-2)', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ height: '100%', width: `${width}%`, background: bg, borderRadius: 2, transition: 'width .4s ease' }} />
    </div>
  );
}

function CardRow({ card, onClick, rank }) {
  const gain = Number(card.gain7d || 0);
  const gainColor = gain > 0 ? 'var(--up)' : gain < 0 ? 'var(--down)' : 'var(--dim)';
  const gainBg = gain > 0 ? 'var(--up-soft)' : gain < 0 ? 'var(--down-soft)' : 'rgba(255,255,255,.04)';
  const gainStr = gain > 0 ? `+${gain.toFixed(1)}%` : `${gain.toFixed(1)}%`;

  return (
    <div onClick={() => onClick?.(card)} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
      background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--line)',
      cursor: 'pointer', transition: '.15s',
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}>

      {rank !== undefined && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', width: 18, textAlign: 'center', flexShrink: 0 }}>{rank}</div>
      )}

      {/* Card thumbnail */}
      <div style={{
        width: 40, height: 54, borderRadius: 5, flexShrink: 0, overflow: 'hidden',
        background: card.thumbnail
          ? `url(${card.thumbnail}) center/contain no-repeat var(--panel-2)`
          : 'linear-gradient(135deg,#1a1f35,#2a3050)',
      }} />

      {/* Name + set */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 5 }}>
          {card.player}
          {card.rookie && <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(91,141,239,.2)', color: '#5B8DEF', padding: '1px 5px', borderRadius: 4, letterSpacing: '.06em' }}>RC</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {card.grader && card.grade ? `${card.grader} ${card.grade}` : (card.grader || 'Raw')}
          {' · '}{card.year} {(card.set || '').replace(/^\d{4}\s+/, '')}
        </div>
        {/* Volume bar */}
        <EdgeMeter pct={Math.min((card.sales7d || 0) / 3, 100)} color="rgba(91,141,239,.6)" />
      </div>

      {/* Price */}
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 64 }}>
        <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14 }}>{fmtP(card.market)}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{card.sales7d || 0} sales/wk</div>
      </div>

      {/* Change pill */}
      {gain !== 0 && (
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
          color: gainColor, background: gainBg,
          padding: '4px 9px', borderRadius: 7, flexShrink: 0, minWidth: 60, textAlign: 'center',
        }}>{gainStr}</div>
      )}
    </div>
  );
}

function Section({ title, emoji, subtitle, cards, onClick, color, maxInitial = 8 }) {
  const [showAll, setShowAll] = useState(false);
  const display = showAll ? cards : cards.slice(0, maxInitial);
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>{emoji}</span>
        <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 17, color: color || 'var(--txt)' }}>{title}</h3>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', background: 'var(--panel)', border: '1px solid var(--line)', padding: '2px 7px', borderRadius: 20 }}>{cards.length}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>{subtitle}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {display.map((c, i) => <CardRow key={c.id || i} card={c} onClick={onClick} rank={i + 1} />)}
      </div>
      {cards.length > maxInitial && !showAll && (
        <button onClick={() => setShowAll(true)} style={{
          marginTop: 8, padding: '8px 20px', borderRadius: 8, fontSize: 12,
          background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--muted)',
          cursor: 'pointer', width: '100%', transition: '.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}>
          Show all {cards.length} →
        </button>
      )}
    </div>
  );
}

function TerminalHeader({ lastUpdate, onRefresh, loading }) {
  return (
    <div style={{
      background: '#060910', border: '1px solid var(--line)', borderRadius: 12,
      padding: '14px 20px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14,
      fontFamily: 'var(--mono)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(52,216,138,.12)', padding: '4px 10px', borderRadius: 6 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34D88A', boxShadow: '0 0 8px #34D88A', animation: 'pulse 1.4s infinite' }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: '#34D88A', letterSpacing: '.12em' }}>LIVE FEED</span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '.06em', color: 'var(--gold)', flex: 1, textAlign: 'center' }}>
        GEMLINE ARB DESK
      </div>
      <div style={{ fontSize: 10, color: 'var(--dim)', marginRight: 8 }}>
        {lastUpdate ? `Updated ${lastUpdate}` : 'Loading…'}
      </div>
      <button onClick={onRefresh} disabled={loading} style={{
        fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)',
        border: '1px solid var(--gold)', borderRadius: 6, padding: '5px 12px',
        background: 'none', cursor: loading ? 'default' : 'pointer', opacity: loading ? .5 : 1,
        transition: '.15s',
      }}>
        {loading ? '↻ ...' : '↻ Refresh'}
      </button>
    </div>
  );
}

function dedup(cards) {
  // Deduplicate by cardhedge_id + grader + grade combination
  const seen = new Set();
  return (cards || []).filter(c => {
    const key = `${c.cardhedge_id}|${c.grader}|${c.grade}`.toLowerCase().replace(/raw|ungraded/g, 'raw');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function ArbitrageContent({ onSelectCard }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [subStatus, setSubStatus] = useState(null);
  const [subLoading, setSubLoading] = useState(true);

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch('/api/market/arb')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLastUpdate(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      })
      .catch(err => console.error('Arb fetch error:', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      theme: ['#1a1f35', '#2a3050'],
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

  // Deduplicated data
  const undervalued = dedup(data?.undervalued);
  const gainers = dedup(data?.gainers);
  const losers = dedup(data?.losers);
  const mostTraded = dedup(data?.mostTraded);

  // Stats
  const topGain = gainers[0]?.gain7d;
  const topLoss = losers[0]?.gain7d;
  const totalVol = mostTraded.reduce((s, c) => s + (c.sales7d || 0), 0);

  if (loading && !data) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
        <div className="scout-spin" style={{ width: 24, height: 24, margin: '0 auto 12px' }} />
        Loading arbitrage data...
      </div>
    );
  }

  // Paywall gate
  if (!subLoading && !subStatus) {
    return (
      <div>
        <TerminalHeader lastUpdate={lastUpdate} onRefresh={fetchData} loading={loading} />
        <div style={{ position: 'relative' }}>
          <div style={{ filter: 'blur(3px)', pointerEvents: 'none', maxHeight: 480, overflow: 'hidden' }}>
            {undervalued.length > 0 && (
              <Section title="Undervalued Radar" emoji="🎯" subtitle="Cards with the biggest price spreads and real trading volume"
                cards={undervalued.slice(0, 5)} color="var(--gold)" maxInitial={5} />
            )}
          </div>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(to bottom, transparent, rgba(10,13,20,.97) 45%)',
          }}>
            <div style={{ textAlign: 'center', padding: 32, maxWidth: 420 }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>📊</div>
              <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 24, marginBottom: 8 }}>Arbitrage Pro</h3>
              <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
                Undervalued cards, price movers, gainers, losers, and volume leaders — updated every 5 minutes.
              </p>
              <button onClick={handleSubscribe} style={{
                padding: '14px 36px', borderRadius: 10, fontSize: 15, fontWeight: 700,
                background: 'var(--gold)', color: '#000', cursor: 'pointer', border: 'none', transition: '.15s',
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
      <TerminalHeader lastUpdate={lastUpdate} onRefresh={fetchData} loading={loading} />

      {/* Stat tiles */}
      {data && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
          <StatTile label="Top Gainer" value={topGain ? `+${Number(topGain).toFixed(0)}%` : '—'} sub={gainers[0]?.player || '—'} accent="var(--up)" />
          <StatTile label="Top Loser" value={topLoss ? `${Number(topLoss).toFixed(0)}%` : '—'} sub={losers[0]?.player || '—'} accent="var(--down)" />
          <StatTile label="Vol Leaders" value={totalVol.toLocaleString()} sub="total sales/wk (top 25)" accent="rgba(91,141,239,.8)" />
          <StatTile label="Cards Tracked" value={(undervalued.length + gainers.length + losers.length + mostTraded.length).toLocaleString()} sub="across all sections" accent="var(--gold)" />
        </div>
      )}

      {undervalued.length > 0 && (
        <Section title="Undervalued Radar" emoji="🎯"
          subtitle="Biggest price opportunity × trading volume — where the spread suggests a move"
          cards={undervalued} onClick={handleCardClick} color="var(--gold)" />
      )}
      {gainers.length > 0 && (
        <Section title="7-Day Gainers" emoji="📈"
          subtitle="Cards with the biggest price increases this week"
          cards={gainers} onClick={handleCardClick} color="var(--up)" />
      )}
      {losers.length > 0 && (
        <Section title="7-Day Losers" emoji="📉"
          subtitle="Cards losing value — potential buy-the-dip opportunities"
          cards={losers} onClick={handleCardClick} color="var(--down)" />
      )}
      {mostTraded.length > 0 && (
        <Section title="Most Traded" emoji="🔥"
          subtitle="Highest volume cards this week — where all the action is"
          cards={mostTraded} onClick={handleCardClick} />
      )}
    </div>
  );
}
