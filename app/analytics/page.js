'use client';
import { useState, useEffect, useRef } from 'react';
import CardDetail from '../components/CardDetail';
import { IconTrendUp, IconTrendDown, IconGrid, IconZap, IconVolume } from '../components/Icons';
import useDarkPage from '../lib/useDarkPage';
import { useAuth } from '../components/AuthContext';
import AuthModal from '../components/AuthModal';
import ProGate, { hasCapability } from '../components/ProGate';

const SPORT_TABS = ['All', 'Basketball', 'Baseball', 'Football', 'Pokemon', 'Hockey'];
const SPORT_COLOR = { Basketball: '#f59e0b', Baseball: '#2563eb', Football: '#7c3aed', Pokemon: '#eab308', Hockey: '#0ea5e9', Soccer: '#16a34a' };
function Thumb({ card: c, size = 34 }) {
  const ini = (c.player || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const color = SPORT_COLOR[c.sport] || '#16c784';
  return (
    <span style={{ width: size, height: Math.round(size * 1.35), borderRadius: 4, flexShrink: 0, overflow: 'hidden', background: color + '14', color, display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, border: '1px solid var(--line)' }}>
      {c.ebay_thumb ? <img src={c.ebay_thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.remove(); }} /> : ini}
    </span>
  );
}

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
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Thumb card={c} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.player}</div>
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 1, display: 'flex', gap: 6 }}><span className="mchip mchip-grade">{`${c.grader || 'RAW'} ${c.grade || ''}`.trim()}</span><span>{c.year || c.sport}</span></div>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: 'var(--txt)', alignSelf: 'center' }}>{fmt(c.market || c.catalog_price)}</div>
          <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13, color: pctColor(c.gain7d), alignSelf: 'center', fontWeight: 600 }}>{pctStr(c.gain7d)}</div>
          <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>{c.sales7d || '—'}</div>
        </div>
      ))}
    </div>
  );
}

// ── Arbitrage Table ───────────────────────────────────────────────────────────
const MARKETPLACE_FEE = 0.075; // 7.5% standard marketplace fee applied on the sell side
// Buy at the low ask (best acquire price), exit at Card Hedge high (FMV) net of fee.
function deriveEdge(r) {
  const buy = Number(r.lo) > 0 ? Number(r.lo) : Number(r.market) || 0;
  const fmv = Number(r.hi) || 0;
  const netEdge = fmv > 0 && buy > 0 ? fmv * (1 - MARKETPLACE_FEE) - buy : 0;
  const netPct = buy > 0 ? (netEdge / buy) * 100 : 0;
  return { buy, fmv, netEdge, netPct };
}

// Tokenized play matcher — every search word must hit player/set/variant/year/grade.
export function matchesArbQuery(c, q) {
  if (!q) return true;
  const hay = `${c.player || ''} ${c.set || c.card_set || ''} ${c.variant || ''} ${c.year || ''} ${c.grader || ''} ${c.grade || ''} ${c.sport || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}

function ArbTable({ onSelect }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [minNet, setMinNet] = useState(10);
  const [minLiq, setMinLiq] = useState(0);
  const [arbSport, setArbSport] = useState('All');
  const [arbSort, setArbSort] = useState('netEdge'); // netEdge | netPct | buy | liquidity
  const [query, setQuery] = useState('');

  // Server-side search — the default arb payload is capped, so ?q= sweeps the
  // full card universe and merges any new plays into the loaded pool.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/market/arb?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => {
          const extra = (d.arbPlays || []).filter(c => (c.hi || 0) > 0 && (c.lo || 0) > 0)
            .map(c => { const e = deriveEdge(c); return { ...c, ...e, momentum: e.netEdge > 0 && (c.gain7d || 0) > 0 }; });
          if (!extra.length) return;
          setRows(prev => {
            const seen = new Set(prev.map(r => r.id));
            const add = extra.filter(c => c.id && !seen.has(c.id));
            return add.length ? [...prev, ...add].sort((a, b) => b.netEdge - a.netEdge) : prev;
          });
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const load = () => {
    setLoading(true);
    fetch('/api/market/arb')
      .then(r => r.json())
      .then(d => {
        const all = [...(d.arbPlays || []), ...(d.undervalued || []), ...(d.gainers || []), ...(d.losers || []), ...(d.mostTraded || [])];
        const seen = new Set();
        const merged = all.filter(c => {
          if (!c.id || seen.has(c.id)) return false;
          seen.add(c.id);
          return (c.hi || 0) > 0 && (c.lo || 0) > 0;
        }).map(c => {
          const e = deriveEdge(c);
          return { ...c, ...e, momentum: e.netEdge > 0 && (c.gain7d || 0) > 0 };
        }).sort((a, b) => b.netEdge - a.netEdge);
        setRows(merged);
        setLastUpdated(new Date());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, []);

  const sportOpts = ['All', ...Array.from(new Set(rows.map(r => r.sport).filter(Boolean))).sort()];
  const ARB_SORTS = {
    netEdge: (a, b) => b.netEdge - a.netEdge,
    netPct: (a, b) => b.netPct - a.netPct,
    buy: (a, b) => a.buy - b.buy,
    liquidity: (a, b) => (b.sales30d || 0) - (a.sales30d || 0),
  };
  const q = query.trim();
  const filtered = rows.filter(r =>
    r.netEdge >= minNet &&
    (r.sales30d || 0) >= minLiq &&
    (arbSport === 'All' || r.sport === arbSport) &&
    matchesArbQuery(r, q)
  ).sort(ARB_SORTS[arbSort] || ARB_SORTS.netEdge);

  const btn = (active) => ({ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: active ? 'var(--gold)' : 'var(--panel-2)', color: active ? '#000' : 'var(--muted)', border: '1px solid var(--line)' });

  return (
    <div>
      {/* Filter bar: net edge / liquidity / sport */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="arb-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search player, set, variant…"
              aria-label="Search deals"
            />
            {query && <button className="arb-search-x" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Min savings:</span>
            {[0, 10, 25, 50].map(v => (
              <button key={v} onClick={() => setMinNet(v)} style={btn(minNet === v)}>${v}+</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Min liquidity (30d):</span>
            {[0, 5, 15, 50].map(v => (
              <button key={v} onClick={() => setMinLiq(v)} style={btn(minLiq === v)}>{v === 0 ? 'Any' : v + '+'}</button>
            ))}
          </div>
          <select value={arbSport} onChange={e => setArbSport(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, background: 'var(--panel-2)', color: 'var(--txt)', border: '1px solid var(--line)', cursor: 'pointer' }}>
            {sportOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Sort:</span>
            <select value={arbSort} onChange={e => setArbSort(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, background: 'var(--panel-2)', color: 'var(--txt)', border: '1px solid var(--line)', cursor: 'pointer' }}>
              <option value="netEdge">Best deal $</option>
              <option value="netPct">Best deal %</option>
              <option value="buy">Buy price (low first)</option>
              <option value="liquidity">Liquidity (30d sales)</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastUpdated && <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button onClick={load} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...Array(6)].map((_, i) => <div key={i} style={{ height: 56, background: 'var(--panel-2)', borderRadius: 8, opacity: 0.5 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ color: 'var(--dim)', marginBottom: 10, display: 'flex', justifyContent: 'center' }}><IconZap size={32} /></div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{q ? `No plays match “${q}”` : 'No plays match these filters'}</div>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>{q ? 'Try fewer words, or clear the liquidity/sport filters.' : 'Lower the min savings or liquidity filter.'}</p>
        </div>
      ) : (
        <div>
          {/* Desktop: wide table. Mobile (<=768px): stacked play-cards, no clipped columns. */}
          <div className="arb-desktop">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(220px,300px) 96px 82px', gap: 8, padding: '6px 12px', fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid var(--line)' }}>
            <div>Card</div><div>The Deal (after {Math.round(MARKETPLACE_FEE * 100)}% fee)</div><div style={{ textAlign: 'right' }}>You Save</div><div style={{ textAlign: 'right' }}>Liquidity</div>
          </div>
          {filtered.map((r, i) => {
            const liqLabel = (r.sales7d || 0) >= 5 ? 'high' : (r.sales7d || 0) >= 3 ? 'med' : (r.sales30d || 0) > 0 ? 'low' : 'thin';
            const liqColor = liqLabel === 'high' ? 'var(--up)' : liqLabel === 'med' ? 'var(--muted)' : 'var(--dim)';
            const netColor = r.netEdge > 0 ? 'var(--up)' : 'var(--down)';
            return (
              <div key={i} onClick={() => onSelect && onSelect(r)}
                style={{ display: 'grid', gridTemplateColumns: '1fr minmax(220px,300px) 96px 82px', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', transition: 'background .12s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Thumb card={{ player: r.player, sport: r.sport, ebay_thumb: r.thumbnail }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {r.player || r.card}
                      {r.momentum && <span title="Undervalued and trending up" style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'var(--up-soft)', color: 'var(--up)', letterSpacing: '.04em' }}>🔥 MOMENTUM</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 1, display: 'flex', gap: 6 }}><span className="mchip mchip-grade">{`${r.grader || 'RAW'} ${r.grade || ''}`.trim()}</span><span>{r.year || r.sport}</span></div>
                  </div>
                </div>
                <div style={{ alignSelf: 'center', fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color: 'var(--muted)' }}>Buy </span>
                  <span style={{ color: 'var(--txt)', fontWeight: 700 }}>{fmt(r.buy)}</span>
                  <span style={{ color: 'var(--dim)' }}> · fair value </span>
                  <span style={{ color: 'var(--txt)', fontWeight: 700 }}>{fmt(r.fmv)}</span>
                  <span style={{ color: 'var(--dim)' }}> → </span>
                  <span style={{ color: netColor, fontWeight: 700 }}>{r.netEdge >= 0 ? '+' : ''}{fmt(r.netEdge)} after fees</span>
                </div>
                <div style={{ textAlign: 'right', alignSelf: 'center' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: netColor }}>{r.netEdge >= 0 ? '+' : ''}{fmt(r.netEdge)}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: netColor, opacity: .8 }}>{r.netPct >= 0 ? '+' : ''}{r.netPct.toFixed(0)}%</div>
                </div>
                <div style={{ textAlign: 'right', alignSelf: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: liqColor }}>{liqLabel}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{(r.sales7d || 0)}/{(r.sales30d || 0)}</div>
                </div>
              </div>
            );
          })}
          </div>

          {/* Mobile stacked cards */}
          <div className="arb-cards">
            {filtered.map((r, i) => {
              const liqLabel = (r.sales7d || 0) >= 5 ? 'high liq' : (r.sales7d || 0) >= 3 ? 'med liq' : (r.sales30d || 0) > 0 ? 'low liq' : 'thin';
              const netColor = r.netEdge > 0 ? '#3ee6a0' : '#ff8093';
              return (
                <div key={i} className="arb-card" onClick={() => onSelect && onSelect(r)}>
                  <div className="arb-card-top">
                    <Thumb card={{ player: r.player, sport: r.sport, ebay_thumb: r.thumbnail }} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="arb-card-name">{r.player || r.card}</div>
                      <div className="arb-card-sub"><span className="mchip mchip-grade">{`${r.grader || 'RAW'} ${r.grade || ''}`.trim()}</span> {r.year || r.sport}</div>
                    </div>
                    <div className="arb-card-edge">
                      <div className="v" style={{ color: netColor }}>{r.netEdge >= 0 ? '+' : ''}{fmt(r.netEdge)}</div>
                      <div className="k">you save</div>
                    </div>
                  </div>
                  <div className="arb-card-play">
                    Buy <b style={{ color: 'var(--txt)' }}>{fmt(r.buy)}</b> · fair value <b style={{ color: 'var(--txt)' }}>{fmt(r.fmv)}</b> · <b style={{ color: netColor }}>{r.netEdge >= 0 ? '+' : ''}{fmt(r.netEdge)} after fees</b>
                  </div>
                  <div className="arb-card-chips">
                    <span className={`arb-chip ${(r.sales7d || 0) >= 5 ? 'up' : ''}`}>{liqLabel} {(r.sales7d || 0)}/{(r.sales30d || 0)}</span>
                    <span className="arb-chip" style={{ color: netColor }}>{r.netPct >= 0 ? '+' : ''}{r.netPct.toFixed(0)}% value after fees</span>
                    {r.momentum && <span className="arb-chip hot">momentum</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Heatmap Grid ──────────────────────────────────────────────────────────────
function HeatGrid({ cards, onSelect, loading }) {
  if (loading) return (
    <div className="hm2-grid">
      {[...Array(24)].map((_, i) => <div key={i} style={{ height: 86, background: 'var(--panel-2)', borderRadius: 8, opacity: 0.5 }} />)}
    </div>
  );
  if (!cards.length) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)', fontSize: 13 }}>No heatmap data available</div>
  );
  return (
    <div className="hm2-grid">
      {cards.slice(0, 60).map((c, i) => {
        const g = c.gain7d || 0;
        const t = Math.min(Math.abs(g) / 60, 1); // intensity scaled by move magnitude
        const alpha = 0.12 + t * 0.42;
        const bg = g > 0 ? `rgba(22,199,132,${alpha})` : g < 0 ? `rgba(239,68,68,${alpha})` : 'var(--panel-2)';
        const border = g > 0 ? `rgba(22,199,132,${0.25 + t * 0.4})` : g < 0 ? `rgba(239,68,68,${0.25 + t * 0.4})` : 'var(--line)';
        return (
          <div key={c.id || i} className="hm2-tile" onClick={() => onSelect(c)}
            style={{ background: bg, border: `1px solid ${border}` }}>
            <div className="hm2-main">
              <div className="hm2-player">{c.player}</div>
              <div className="hm2-meta">{`${c.grader || 'RAW'} ${c.grade || ''}`.trim()}{c.sales7d ? `\u2002${c.sales7d} sold 7d` : ''}</div>
            </div>
            <div className="hm2-foot">
              <span className="hm2-price">{fmt(c.market || c.catalog_price)}</span>
              <span className="hm2-pct" style={{ color: g >= 0 ? '#3ee6a0' : '#ff8093' }}>{pctStr(g)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  useDarkPage();
  const { user, token } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [view, setView] = useState('movers'); // movers | heatmap | arbitrage
  // Deep links (incl. the retired /heatmap redirect): /analytics?view=heatmap
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('view');
      if (['movers', 'heatmap', 'arbitrage'].includes(v)) setView(v);
    } catch {}
  }, []);
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
      <div className="eyebrow">Price Guide</div>
      <h1 className="page">Know what it’s worth.</h1>
      <p className="sub">Live prices across 287K+ cards — movers, heat, and deals, refreshed all day.</p>

      <ProGate
        page
        allowed={hasCapability(user || (token ? {} : null), 'analytics')}
        title="Create a free account to unlock the Price Guide"
        sub="Movers, the heat map, and the deal screener — live across 287K+ cards, free with a GEMLINE account."
        cta="Create a free account"
        onUnlock={() => setShowAuth(true)}
      >

      {/* View selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, marginTop: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="seg">
          {[['movers', 'Movers', IconTrendUp], ['heatmap', 'Heatmap', IconGrid], ['arbitrage', 'Deals', IconZap]].map(([v, label, Ic]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ic size={13} /> {label}</button>
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
              <button key={s} className={sport === s ? 'on' : ''} onClick={() => setSport(s)}>{s}</button>
            ))}
          </div>
          {view === 'movers' && (
            <div className="seg">
              {[['gainers', 'Gainers', 'var(--up)'], ['losers', 'Losers', 'var(--down)'], ['volume', 'Volume', 'var(--blue)'], ['value', 'Value', 'var(--gold)']].map(([v, label, dot]) => (
                <button key={v} className={sort === v ? 'on' : ''} onClick={() => setSort(v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} />{label}
                </button>
              ))}
            </div>
          )}
          {view === 'heatmap' && (
            <div className="seg">
              {[['gainers', 'Gainers first', 'var(--up)'], ['losers', 'Losers first', 'var(--down)'], ['value', 'By value', 'var(--gold)']].map(([v, label, dot]) => (
                <button key={v} className={sort === v ? 'on' : ''} onClick={() => setSort(v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} />{label}
                </button>
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

      {/* Content — trade desk surface */}
      <div className="desk" style={{ overflow: 'hidden' }}>
        {/* Market pulse strip */}
        {!loading && cards.length > 0 && (() => {
          const adv = cards.filter(c => (c.gain7d || 0) > 0).length;
          const dec = cards.filter(c => (c.gain7d || 0) < 0).length;
          const vol = cards.reduce((a, c) => a + (c.sales7d || 0), 0);
          const top = [...cards].sort((a, b) => (b.gain7d || 0) - (a.gain7d || 0))[0];
          const bot = [...cards].sort((a, b) => (a.gain7d || 0) - (b.gain7d || 0))[0];
          return (
            <div className="desk-pulse">
              <div className="dp"><div className="dp-k">Advancing</div><div className="dp-v up">{adv}</div><div className="dp-s">cards up 7d</div></div>
              <div className="dp"><div className="dp-k">Declining</div><div className="dp-v down">{dec}</div><div className="dp-s">cards down 7d</div></div>
              <div className="dp"><div className="dp-k">7D Volume</div><div className="dp-v">{vol.toLocaleString()}</div><div className="dp-s">tracked sales</div></div>
              {top && <div className="dp"><div className="dp-k">Top Gainer</div><div className="dp-v up">+{Number(top.gain7d).toFixed(0)}%</div><div className="dp-s">{top.player}</div></div>}
              {bot && <div className="dp"><div className="dp-k">Top Loser</div><div className="dp-v down">{Number(bot.gain7d).toFixed(0)}%</div><div className="dp-s">{bot.player}</div></div>}
            </div>
          );
        })()}
        {view === 'movers' && <MoversTable cards={filtered} onSelect={setSelectedCard} loading={loading} />}
        {view === 'heatmap' && <div style={{ padding: 14 }}><HeatGrid cards={filtered} onSelect={setSelectedCard} loading={loading} /></div>}
        {view === 'arbitrage' && <div style={{ padding: 16 }}><ArbTable onSelect={setSelectedCard} /></div>}
      </div>

      {/* Help text */}
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {view === 'movers' && [
          [IconTrendUp, 'var(--up)', 'Gainers', 'Cards with the biggest 7-day price increase'],
          [IconTrendDown, 'var(--down)', 'Losers', 'Cards with the biggest 7-day price drop'],
          [IconVolume, 'var(--blue)', 'Volume', 'Most sales activity in the last 7 days'],
        ].map(([Ic, color, title, desc]) => (
          <div key={title} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ color, marginBottom: 6 }}><Ic size={18} /></div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>{desc}</div>
          </div>
        ))}
        {view === 'heatmap' && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--up)', display: 'inline-block' }} /> <strong>Green</strong> = price up in 7 days <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--down)', display: 'inline-block' }} /> <strong>Red</strong> = price down. Darker = bigger move. Click any card for details.</div>
            <a href="/heatmap" style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)' }}>Open the full heatmap →</a>
          </div>
        )}
        {view === 'arbitrage' && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}><strong>Spread</strong> = difference between lowest ask and highest bid · Auto-refreshes every 2 minutes · Low data points marked as low confidence</div>
          </div>
        )}
      </div>

      </ProGate>

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
