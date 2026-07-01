'use client';
import { useState, useEffect, useRef } from 'react';
import CardDetail from '../components/CardDetail';

const SPORT_TABS = ['All', 'Basketball', 'Baseball', 'Football', 'Pokemon', 'Hockey'];
const SPORT_EMOJI = { Basketball: '🏀', Baseball: '⚾', Football: '🏈', Pokemon: '🃏', Hockey: '🏒', All: '🌐' };

function fmt(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  if (n >= 100) return '$' + Math.round(n);
  return '$' + Number(n).toFixed(2);
}

function pctColor(n) {
  if (n == null || isNaN(n)) return 'var(--muted)';
  return n >= 0 ? 'var(--up)' : 'var(--down)';
}

function pctStr(n) {
  if (n == null || isNaN(n) || Math.abs(n) > 999) return 'N/A';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(1) + '%';
}

// ── Movers Table ──────────────────────────────────────────────────────────────
function MoversTable({ cards, onSelect, loading }) {
  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} style={{ height: 52, background: 'var(--panel-2)', borderRadius: 8, opacity: 0.5 }} />
      ))}
    </div>
  );
  if (!cards.length) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)', fontSize: 13 }}>No data available</div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 70px', gap: 8, padding: '6px 12px', fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid var(--line)' }}>
        <div>Card</div><div style={{ textAlign: 'right' }}>Price</div><div style={{ textAlign: 'right' }}>7D Change</div><div style={{ textAlign: 'right' }}>Sales</div>
      </div>
      {cards.map((c, i) => (
        <div key={c.id || i} onClick={() => onSelect(c)}
          style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 70px', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', transition: 'background .12s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {SPORT_EMOJI[c.sport] || '🃏'} {c.player}
            </div>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 1 }}>{c.grader} {c.grade} · {c.year}</div>
          </div>
          <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: 'var(--gold)', alignSelf: 'center' }}>{fmt(c.market || c.catalog_price)}</div>
          <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13, color: pctColor(c.gain7d), alignSelf: 'center', fontWeight: 600 }}>{pctStr(c.gain7d)}</div>
          <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>{c.sales7d || '—'}</div>
        </div>
      ))}
    </div>
  );
}

// ── Arbitrage Table ───────────────────────────────────────────────────────────
function ArbTable({ onSelect }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [minSpread, setMinSpread] = useState(10);

  const load = () => {
    setLoading(true);
    fetch('/api/market/arb')
      .then(r => r.json())
      .then(d => { setRows(d.opportunities || d.arb || []); setLastUpdated(new Date()); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, []);

  const filtered = rows.filter(r => (r.spread || 0) >= minSpread);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Min spread:</span>
          {[10, 25, 50, 100].map(v => (
            <button key={v} onClick={() => setMinSpread(v)}
              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: minSpread === v ? 'var(--gold)' : 'var(--panel-2)', color: minSpread === v ? '#000' : 'var(--muted)', border: '1px solid var(--line)' }}>
              ${v}+
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastUpdated && <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button onClick={load} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...Array(6)].map((_, i) => <div key={i} style={{ height: 52, background: 'var(--panel-2)', borderRadius: 8, opacity: 0.5 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>No opportunities at ${minSpread}+ spread</div>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Try lowering the minimum spread filter.</p>
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 70px', gap: 8, padding: '6px 12px', fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid var(--line)' }}>
            <div>Card</div><div style={{ textAlign: 'right' }}>Buy</div><div style={{ textAlign: 'right' }}>Sell</div><div style={{ textAlign: 'right' }}>Spread</div><div style={{ textAlign: 'right' }}>Conf.</div>
          </div>
          {filtered.map((r, i) => (
            <div key={i} onClick={() => onSelect && onSelect(r)}
              style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 70px', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', transition: 'background .12s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.player || r.card}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 1 }}>{r.grader} {r.grade}</div>
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--up)', alignSelf: 'center' }}>{fmt(r.buy || r.low)}</div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--down)', alignSelf: 'center' }}>{fmt(r.sell || r.high)}</div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: 'var(--gold)', alignSelf: 'center' }}>{fmt(r.spread)}</div>
              <div style={{ textAlign: 'right', fontSize: 11, color: r.confidence === 'high' ? 'var(--up)' : r.confidence === 'low' ? 'var(--down)' : 'var(--muted)', alignSelf: 'center' }}>{r.confidence || '—'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Heatmap Grid ──────────────────────────────────────────────────────────────
function HeatGrid({ cards, onSelect, loading }) {
  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 4 }}>
      {[...Array(40)].map((_, i) => <div key={i} style={{ height: 72, background: 'var(--panel-2)', borderRadius: 6, opacity: 0.5 }} />)}
    </div>
  );
  if (!cards.length) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)', fontSize: 13 }}>No heatmap data available</div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 4 }}>
      {cards.slice(0, 120).map((c, i) => {
        const g = c.gain7d || 0;
        const intensity = Math.min(Math.abs(g) / 50, 1);
        const bg = g > 0
          ? `rgba(52,216,138,${0.08 + intensity * 0.35})`
          : g < 0
          ? `rgba(255,92,108,${0.08 + intensity * 0.35})`
          : 'var(--panel-2)';
        const border = g > 0 ? `rgba(52,216,138,${0.2 + intensity * 0.4})` : g < 0 ? `rgba(255,92,108,${0.2 + intensity * 0.4})` : 'var(--line)';
        return (
          <div key={c.id || i} onClick={() => onSelect(c)}
            style={{ background: bg, border: `1px solid ${border}`, borderRadius: 7, padding: '7px 6px', cursor: 'pointer', transition: 'transform .1s', minHeight: 68 }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'none'}
          >
            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: 'var(--mono)', color: g > 0 ? 'var(--up)' : g < 0 ? 'var(--down)' : 'var(--muted)', marginBottom: 3 }}>{pctStr(g)}</div>
            <div style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.3, color: 'var(--txt)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.player}</div>
            <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2, fontFamily: 'var(--mono)' }}>{fmt(c.market || c.catalog_price)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [view, setView] = useState('movers'); // movers | heatmap | arbitrage
  const [sport, setSport] = useState('All');
  const [sort, setSort] = useState('gainers'); // gainers | losers | volume | value
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/market/heatmap')
      .then(r => r.json())
      .then(d => {
        const mapped = (d.cards || []).map(c => ({
          id: c.cardId, player: c.player, sport: c.sport, card_set: c.set,
          grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
          market: Number(c.marketPrice) || 0, catalog_price: Number(c.marketPrice) || 0,
          gain7d: Number(c.gain_7d) || 0, sales7d: Number(c.sales_7d) || 0,
          ebay_thumb: c.thumbnail || c.image_url, cardhedge_id: c.cardhedge_id,
        }));
        setCards(mapped);
        setLastUpdated(new Date());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const filtered = cards
    .filter(c => sport === 'All' || c.sport === sport)
    .filter(c => Math.abs(c.gain7d || 0) <= 999) // filter bad data
    .sort((a, b) => {
      if (sort === 'gainers') return (b.gain7d || 0) - (a.gain7d || 0);
      if (sort === 'losers') return (a.gain7d || 0) - (b.gain7d || 0);
      if (sort === 'volume') return (b.sales7d || 0) - (a.sales7d || 0);
      if (sort === 'value') return (b.market || 0) - (a.market || 0);
      return 0;
    });

  return (
    <>
      <div className="eyebrow">Analytics</div>
      <h1 className="page">Market Intelligence</h1>
      <p className="sub">Real-time price data across 287K+ cards. Find movers, spot spreads, and track the market.</p>

      {/* View selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, marginTop: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="seg">
          {[['movers', '📈 Movers'], ['heatmap', '🟩 Heatmap'], ['arbitrage', '⚡ Arbitrage']].map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastUpdated && <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button onClick={load} style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {/* Sport + Sort filters (not for arbitrage) */}
      {view !== 'arbitrage' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="seg">
            {SPORT_TABS.map(s => (
              <button key={s} className={sport === s ? 'on' : ''} onClick={() => setSport(s)}>
                {SPORT_EMOJI[s]} {s}
              </button>
            ))}
          </div>
          {view === 'movers' && (
            <div className="seg">
              {[['gainers', '🟢 Gainers'], ['losers', '🔴 Losers'], ['volume', '📦 Volume'], ['value', '💎 Value']].map(([v, label]) => (
                <button key={v} className={sort === v ? 'on' : ''} onClick={() => setSort(v)}>{label}</button>
              ))}
            </div>
          )}
          {view === 'heatmap' && (
            <div className="seg">
              {[['gainers', '🟢 Gainers first'], ['losers', '🔴 Losers first'], ['value', '💎 By value']].map(([v, label]) => (
                <button key={v} className={sort === v ? 'on' : ''} onClick={() => setSort(v)}>{label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Context line */}
      {view !== 'arbitrage' && !loading && (
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14, fontFamily: 'var(--mono)' }}>
          {filtered.length.toLocaleString()} cards · 7-day window
          {view === 'heatmap' && filtered.length > 120 && ' · showing top 120'}
        </div>
      )}

      {/* Content */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
        {view === 'movers' && <MoversTable cards={filtered} onSelect={setSelectedCard} loading={loading} />}
        {view === 'heatmap' && <div style={{ padding: 14 }}><HeatGrid cards={filtered} onSelect={setSelectedCard} loading={loading} /></div>}
        {view === 'arbitrage' && <div style={{ padding: 16 }}><ArbTable onSelect={setSelectedCard} /></div>}
      </div>

      {/* Help text */}
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {view === 'movers' && [
          ['📈', 'Gainers', 'Cards with the biggest 7-day price increase'],
          ['📉', 'Losers', 'Cards with the biggest 7-day price drop'],
          ['📦', 'Volume', 'Most sales activity in the last 7 days'],
        ].map(([icon, title, desc]) => (
          <div key={title} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>{desc}</div>
          </div>
        ))}
        {view === 'heatmap' && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>🟩 <strong>Green</strong> = price up in 7 days · 🟥 <strong>Red</strong> = price down · Darker = bigger move · Click any card for details</div>
          </div>
        )}
        {view === 'arbitrage' && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>⚡ <strong>Spread</strong> = difference between lowest ask and highest bid · Auto-refreshes every 2 minutes · Low data points marked as low confidence</div>
          </div>
        )}
      </div>

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
