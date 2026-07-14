'use client';
// Deal Finder — the arb desk (buy-low / fair-value net-edge board) plus the
// "Worth Grading?" ROI calculator. Extracted from the retired standalone
// /arbitrage page so it can live as tabs inside the unified /market surface.
// Gated by ProGate capability 'arbitrage' (free WITH an account) — logged-out
// visitors get the frosted teaser + sign-up CTA. `view` picks the sub-surface:
//   'deals'   → net-edge deal board (default)
//   'grading' → Worth Grading? calculator
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import CardDetail from './CardDetail';
import AuthModal from './AuthModal';
import ProGate, { hasCapability } from './ProGate';
import WorthGrading from './WorthGrading';

// Tokenized play matcher — every search word must hit player/set/variant/year/grade.
const matchesArbQuery = (c, q) => {
  if (!q) return true;
  const hay = `${c.player || ''} ${c.set || ''} ${c.variant || ''} ${c.year || ''} ${c.grader || ''} ${c.grade || ''} ${c.sport || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
};

// Buy at the low ask, exit at Card Hedge high (FMV) net of the 7.5% marketplace
// fee — the same net-edge model the price guide arb tab uses.
const MARKETPLACE_FEE = 0.075;  // standard seller fee (first-5-sales intro rate is 5%)

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtP = (n) => {
  if (!n || n <= 0) return '—';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + Number(n).toFixed(2);
};
const fmtPct = (n) => {
  if (n === null || n === undefined) return '—';
  const s = Number(n) >= 0 ? '+' : '';
  return `${s}${Number(n).toFixed(1)}%`;
};
const fmtNum = (n) => n ? Number(n).toLocaleString('en-US') : '—';

// ─── Sparkline (mini price line for each card row) ────────────────────────────
function Spark({ vals = [], up }) {
  if (!vals || vals.length < 2) {
    const demo = [50, 48, 52, 47, 55, 51, 58, 54, 60];
    return <Spark vals={demo} up={true} />;
  }
  const W = 80, H = 28, pad = 2;
  const min = Math.min(...vals), max = Math.max(...vals);
  const rng = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / rng) * (H - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const color = up ? '#34D88A' : '#FF5C6C';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
      <polygon
        points={`${pad},${H - pad} ${pts} ${W - pad},${H - pad}`}
        fill={up ? 'rgba(52,216,138,0.12)' : 'rgba(255,92,108,0.12)'}
      />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts}
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Price range bar (Lo → Market → Hi) ──────────────────────────────────────
function RangeBar({ lo, market, hi }) {
  if (!lo || !hi) return <span style={{ color: 'var(--dim)', fontSize: 11 }}>—</span>;
  const rng = hi - lo || 1;
  const pos = Math.min(Math.max(((market - lo) / rng) * 100, 2), 98);
  return (
    <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 3 }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 3,
        background: 'linear-gradient(90deg,rgba(52,216,138,.3),rgba(22,199,132,.3),rgba(255,92,108,.3))',
      }} />
      <div style={{
        position: 'absolute', top: -2, left: `${pos}%`,
        transform: 'translateX(-50%)',
        width: 10, height: 10, borderRadius: '50%',
        background: '#E8B339', border: '2px solid #0a0d14',
      }} />
    </div>
  );
}

// ─── Market ticker strip ──────────────────────────────────────────────────────
function TickerStrip({ cards }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !cards.length) return;
    let x = 0;
    const speed = 0.4;
    let raf;
    const tick = () => {
      x -= speed;
      if (el.scrollWidth && Math.abs(x) > el.scrollWidth / 2) x = 0;
      el.style.transform = `translateX(${x}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cards]);

  if (!cards.length) return null;
  const items = [...cards, ...cards]; // duplicate for seamless loop
  return (
    <div style={{ overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,.07)', borderBottom: '1px solid rgba(255,255,255,.07)', background: '#080b12' }}>
      <div ref={ref} style={{ display: 'flex', gap: 0, whiteSpace: 'nowrap', willChange: 'transform' }}>
        {items.map((c, i) => {
          const up = (c.gain7d || 0) >= 0;
          return (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 20px', borderRight: '1px solid rgba(255,255,255,.05)',
              fontFamily: 'var(--mono)', fontSize: 11,
            }}>
              <span style={{ color: 'var(--muted)' }}>{c.player.split(' ').pop()?.toUpperCase()}</span>
              <span style={{ color: 'var(--txt)', fontWeight: 600 }}>{fmtP(c.market)}</span>
              <span style={{ color: up ? '#34D88A' : '#FF5C6C', fontSize: 10 }}>
                {up ? '▲' : '▼'} {Math.abs(c.gain7d || 0).toFixed(1)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────
function Panel({ title, badge, badgeColor, right, children, style = {} }) {
  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 4,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}>
      {/* Panel header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 12px',
        background: 'rgba(255,255,255,.03)',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: badgeColor || '#34D88A', boxShadow: `0 0 6px ${badgeColor || '#34D88A'}` }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.12em', color: 'rgba(255,255,255,.5)', textTransform: 'uppercase' }}>
            {title}
          </span>
          {badge && (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 5px',
              borderRadius: 3, background: 'rgba(255,255,255,.06)',
              color: 'var(--muted)', letterSpacing: '.04em',
            }}>{badge}</span>
          )}
        </div>
        {right && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>{right}</div>}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

// ─── Stat box ─────────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, color = 'var(--txt)', glow }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 4, padding: '10px 14px', flex: 1,
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color, textShadow: glow ? `0 0 12px ${color}` : 'none' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Heatmap cell ─────────────────────────────────────────────────────────────
function HeatCell({ card, onClick }) {
  const gain = card.gain7d || 0;
  const abs = Math.abs(gain);
  const intensity = Math.min(abs / 30, 1);
  const bg = gain > 0
    ? `rgba(52,216,138,${0.08 + intensity * 0.35})`
    : gain < 0
    ? `rgba(255,92,108,${0.08 + intensity * 0.35})`
    : 'rgba(255,255,255,.04)';
  const border = gain > 0 ? `1px solid rgba(52,216,138,${0.2 + intensity * 0.4})`
    : gain < 0 ? `1px solid rgba(255,92,108,${0.2 + intensity * 0.4})`
    : '1px solid rgba(255,255,255,.06)';
  return (
    <div onClick={onClick} style={{
      background: bg, border, borderRadius: 3,
      padding: '6px 8px', cursor: 'pointer',
      transition: 'all .15s',
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {card.player.split(' ').slice(-1)[0]}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: gain >= 0 ? '#34D88A' : '#FF5C6C', marginTop: 2 }}>
        {gain >= 0 ? '+' : ''}{gain.toFixed(1)}%
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,.35)', marginTop: 1 }}>{fmtP(card.market)}</div>
    </div>
  );
}

// ─── Volume bars panel ────────────────────────────────────────────────────────
function VolumeBars({ cards }) {
  const top = cards.slice(0, 12);
  const max = Math.max(...top.map(c => c.sales30d || 0), 1);
  return (
    <div style={{ padding: '8px 10px', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {top.map((c, i) => {
        const pct = ((c.sales30d || 0) / max) * 100;
        const color = i < 3 ? '#E8B339' : i < 6 ? '#5B8DEF' : 'rgba(255,255,255,.25)';
        return (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', width: 14, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1, height: 16, background: 'rgba(255,255,255,.04)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .4s ease' }} />
              <span style={{
                position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                fontFamily: 'var(--mono)', fontSize: 9, color: pct > 20 ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.6)',
                whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '60%', textOverflow: 'ellipsis',
              }}>
                {c.player.split(' ').slice(-1)[0].toUpperCase()}
              </span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', width: 36, textAlign: 'right', flexShrink: 0 }}>{fmtNum(c.sales30d)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Spread matrix (main table) ───────────────────────────────────────────────
function SpreadMatrix({ cards, onSelect }) {
  const [sortCol, setSortCol] = useState('netEdge');
  const [sortDir, setSortDir] = useState('desc');
  const [hover, setHover] = useState(null);

  const sorted = useMemo(() => {
    return [...cards].sort((a, b) => {
      const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [cards, sortCol, sortDir]);

  const onSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const Th = ({ label, col, w }) => (
    <div onClick={() => onSort(col)} style={{
      width: w, fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.1em',
      color: sortCol === col ? '#E8B339' : 'rgba(255,255,255,.3)',
      cursor: 'pointer', userSelect: 'none', textTransform: 'uppercase',
      display: 'flex', alignItems: 'center', gap: 3,
    }}>
      {label}
      {sortCol === col && <span style={{ fontSize: 8 }}>{sortDir === 'desc' ? '▼' : '▲'}</span>}
    </div>
  );

  return (
    <>
    {/* Mobile (<=768px): stacked play-cards instead of a clipped wide table */}
    <div className="arb-cards">
      <div className="arb-sortbar">
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Sort</span>
        <select value={sortCol} onChange={e => { const col = e.target.value; setSortCol(col); setSortDir(col === 'lo' ? 'asc' : 'desc'); }}
          style={{ padding: '7px 10px', borderRadius: 6, fontSize: 12, background: 'rgba(255,255,255,.05)', color: 'var(--txt,#eef1f6)', border: '1px solid rgba(255,255,255,.1)' }}>
          <option value="netEdge">Best deal $</option>
          <option value="netPct">Best deal %</option>
          <option value="lo">Buy price (low first)</option>
          <option value="sales30d">Liquidity (30d sales)</option>
          <option value="gain7d">7D move</option>
        </select>
      </div>
      {sorted.slice(0, 60).map((c) => {
        const netColor = c.netEdge > 0 ? '#34D88A' : '#FF5C6C';
        const liqLabel = (c.sales7d || 0) >= 5 ? 'high liq' : (c.sales7d || 0) >= 3 ? 'med liq' : (c.sales30d || 0) > 0 ? 'low liq' : 'thin';
        return (
          <div key={c.id} className="arb-card" onClick={() => onSelect(c)}>
            <div className="arb-card-top">
              {c.thumbnail && (
                <div style={{ width: 30, height: 40, borderRadius: 3, flexShrink: 0, overflow: 'hidden',
                  background: `url(${c.thumbnail}) center/contain no-repeat #111`, border: '1px solid rgba(255,255,255,.07)' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="arb-card-name">{c.player}{c.rookie ? ' · RC' : ''}</div>
                <div className="arb-card-sub"><span className="mchip mchip-grade">{`${c.grader || 'RAW'} ${c.grade || ''}`.trim()}</span> {c.set?.slice(0, 26)}</div>
              </div>
              <div className="arb-card-edge">
                <div className="v" style={{ color: netColor }}>{(c.netEdge >= 0 ? '+' : '') + fmtP(Math.abs(c.netEdge))}</div>
                <div className="k">you save</div>
              </div>
            </div>
            <div className="arb-card-play">
              Buy <b style={{ color: '#34D88A' }}>{fmtP(c.lo)}</b> · fair value <b style={{ color: 'var(--txt,#eef1f6)' }}>{fmtP(c.hi)}</b> · <b style={{ color: netColor }}>{(c.netEdge >= 0 ? '+' : '') + fmtP(Math.abs(c.netEdge))} after fees</b>
            </div>
            <div className="arb-card-chips">
              <span className={`arb-chip ${(c.sales7d || 0) >= 5 ? 'up' : ''}`}>{liqLabel} {c.sales7d || 0}/{c.sales30d || 0}</span>
              <span className="arb-chip" style={{ color: netColor }}>{(c.netPct >= 0 ? '+' : '') + c.netPct?.toFixed(0)}% value after fees</span>
              {c.momentum ? <span className="arb-chip hot">momentum</span> : null}
            </div>
          </div>
        );
      })}
    </div>
    <div className="arb-desktop" style={{ display: undefined }}>
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Table header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        padding: '6px 12px',
        background: 'rgba(255,255,255,.025)',
        borderBottom: '1px solid rgba(255,255,255,.05)',
        flexShrink: 0,
      }}>
        <div style={{ width: 32 }} />
        <div style={{ flex: 1, minWidth: 160, fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,.3)', textTransform: 'uppercase' }}>CARD</div>
        <Th label="BUY (LOW)" col="lo" w={72} />
        <Th label="FMV (HIGH)" col="hi" w={72} />
        <Th label="YOU SAVE $" col="netEdge" w={92} />
        <Th label="NET % (AF 7.5% FEE)" col="netPct" w={116} />
        <Th label="7D %" col="gain7d" w={64} />
        <Th label="7D VOL" col="sales7d" w={64} />
        <Th label="30D VOL" col="sales30d" w={68} />
      </div>
      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((c, i) => {
          const isUp = (c.gain7d || 0) >= 0;
          const netBarPct = Math.min(Math.max((c.netPct / 40) * 100, 0), 100);
          const netColor = c.netEdge > 0 ? '#34D88A' : '#FF5C6C';
          return (
            <div
              key={c.id}
              onClick={() => onSelect(c)}
              onMouseEnter={() => setHover(c.id)}
              onMouseLeave={() => setHover(null)}
              style={{
                display: 'flex', alignItems: 'center',
                padding: '7px 12px',
                borderBottom: '1px solid rgba(255,255,255,.03)',
                background: hover === c.id ? 'rgba(255,255,255,.04)' : i % 2 === 0 ? 'rgba(255,255,255,.01)' : 'transparent',
                cursor: 'pointer', transition: 'background .1s',
              }}
            >
              {/* Rank */}
              <span style={{ width: 32, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', textAlign: 'right', paddingRight: 8 }}>{i + 1}</span>
              {/* Card */}
              <div style={{ flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 8 }}>
                {c.thumbnail && (
                  <div style={{
                    width: 30, height: 40, borderRadius: 3, flexShrink: 0, overflow: 'hidden',
                    background: `url(${c.thumbnail}) center/contain no-repeat #111`,
                    border: '1px solid rgba(255,255,255,.07)',
                  }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.player} {c.rookie ? <span style={{ fontSize: 8, background: '#E8B339', color: '#000', borderRadius: 2, padding: '1px 3px', marginLeft: 3 }}>RC</span> : null}
                    {c.momentum ? <span title="Undervalued and trending up" style={{ fontSize: 8, background: 'rgba(52,216,138,.15)', color: '#34D88A', borderRadius: 2, padding: '1px 4px', marginLeft: 4, fontWeight: 700 }}>🔥 MOM</span> : null}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', marginTop: 1 }}>
                    <span className="mchip mchip-grade" style={{ marginRight: 5 }}>{`${c.grader || 'RAW'} ${c.grade || ''}`.trim()}</span>{c.set?.slice(0, 22)}{c.set?.length > 22 ? '…' : ''}
                  </div>
                </div>
              </div>
              {/* Buy (low ask) */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 11, color: '#34D88A', fontWeight: 600 }}>{fmtP(c.lo)}</span>
              {/* FMV (high) */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt)', fontWeight: 700 }}>{fmtP(c.hi)}</span>
              {/* Net edge $ (after 7.5% fee) */}
              <span style={{ width: 92, fontFamily: 'var(--mono)', fontSize: 11, color: netColor, fontWeight: 700 }}>{(c.netEdge >= 0 ? '+' : '') + fmtP(Math.abs(c.netEdge))}</span>
              {/* Net % bar */}
              <div style={{ width: 116, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${netBarPct}%`, height: '100%', background: netColor, borderRadius: 2 }} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: netColor, width: 40, textAlign: 'right' }}>{(c.netPct >= 0 ? '+' : '') + (c.netPct?.toFixed(0))}%</span>
              </div>
              {/* 7D change */}
              <span style={{ width: 64, fontFamily: 'var(--mono)', fontSize: 10, color: isUp ? '#34D88A' : '#FF5C6C', textAlign: 'right' }}>
                {c.gain7d ? `${isUp ? '+' : ''}${Number(c.gain7d).toFixed(1)}%` : '—'}
              </span>
              {/* 7D vol */}
              <span style={{ width: 64, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>{fmtNum(c.sales7d)}</span>
              {/* 30D vol */}
              <span style={{ width: 68, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>{fmtNum(c.sales30d)}</span>
            </div>
          );
        })}
      </div>
    </div>
    </div>
    </>
  );
}

// ─── Deal Finder (tabbed content inside /market) ──────────────────────────────
export default function DealFinder({ view = 'deals' }) {
  const { user, token } = useAuth();
  const [cards, setCards] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [query, setQuery] = useState('');

  // Clock
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setNow(fmt());
    const t = setInterval(() => setNow(fmt()), 1000);
    return () => clearInterval(t);
  }, []);

  const [lastUpdated, setLastUpdated] = useState(null);
  const arbIntervalRef = useRef(null);

  const fetchArbData = useCallback(async () => {
    try {
      const res = await fetch('/api/market/arb');
      const data = await res.json();
      // Merge all categories into a de-duped pool. arbPlays first — it's the
      // decision-grade net-edge bucket (real lo/hi inventory, net-positive
      // after the 7.5% fee) that also powers the price guide arb tab.
      const allCards = [
        ...(data.arbPlays || []),
        ...(data.gainers || []),
        ...(data.losers || []),
        ...(data.undervalued || []),
        ...(data.mostTraded || []),
      ];
      const seen = new Set();
      const unique = allCards.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });

      setCards(unique.map(c => ({
        id: c.id, player: c.player, sport: c.sport, set: c.set,
        grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
        market: Number(c.market) || 0,
        lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
        confidence: c.confidence, thumbnail: c.thumbnail,
        rookie: c.rookie, sales7d: Number(c.sales7d) || 0,
        sales30d: Number(c.sales30d) || 0,
        gain7d: Math.abs(Number(c.gain7d)) <= 999 ? Number(c.gain7d) : 0,
        cardhedge_id: c.cardhedge_id || null,
        theme: ['#1a1d28', '#252838'],
        ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      })));
      setLastUpdated(new Date());
    } catch {
      // silently keep old data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== 'deals') return;
    fetchArbData();
    arbIntervalRef.current = setInterval(fetchArbData, 120_000); // 2min auto-refresh
    return () => clearInterval(arbIntervalRef.current);
  }, [fetchArbData, view]);

  // Server-side search sweep — the default payload buckets are capped (~120
  // arb plays), so ?q= searches the FULL card universe and merges new rows in.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      fetch(`/api/market/arb?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => {
          const rows = (d.arbPlays || []).map(c => ({
            id: c.id, player: c.player, sport: c.sport, set: c.set,
            grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
            market: Number(c.market) || 0,
            lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
            confidence: c.confidence, thumbnail: c.thumbnail,
            rookie: c.rookie, sales7d: Number(c.sales7d) || 0,
            sales30d: Number(c.sales30d) || 0,
            gain7d: Math.abs(Number(c.gain7d)) <= 999 ? Number(c.gain7d) : 0,
            cardhedge_id: c.cardhedge_id || null,
            theme: ['#1a1d28', '#252838'],
            ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
          }));
          if (!rows.length) return;
          setCards(prev => {
            const seen = new Set(prev.map(c => c.id));
            const add = rows.filter(c => c.id && !seen.has(c.id));
            return add.length ? [...prev, ...add] : prev;
          });
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  // Search narrows every desk surface (panels, heatmap, matrix) to matching plays.
  const visible = useMemo(() => {
    const q = query.trim();
    return q ? cards.filter(c => matchesArbQuery(c, q)) : cards;
  }, [cards, query]);

  // Derived datasets — the play is: buy at the low ask, exit at Card Hedge high
  // (FMV) net of the 7.5% marketplace fee. Ranked by net edge $, momentum flag
  // for undervalued + trending up. Same treatment as the price guide arb tab.
  const cardsWithEdge = useMemo(() => visible
    .filter(c => c.lo > 0 && c.hi > 0 && c.market > 0 && c.market < 10000)
    .map(c => {
      const buy = c.lo, fmv = c.hi;
      const netEdge = +(fmv * (1 - MARKETPLACE_FEE) - buy).toFixed(2);
      const netPct = +((netEdge / buy) * 100).toFixed(1);
      return {
        ...c, buy, fmv, netEdge, netPct,
        edge: netPct,                       // sort key stays 'edge'
        spread: +(fmv - buy).toFixed(2),    // gross spread retained for reference
        momentum: netEdge > 0 && (c.gain7d || 0) > 0,
      };
    })
    .sort((a, b) => b.netEdge - a.netEdge), [visible]);

  // Believability guard: only volume-validated, sane moves rank as gainers/losers.
  // One row per underlying card — grade tiers of the same card move together and
  // wallpaper the panel otherwise (Wemby ×4 in a 12-row list).
  const saneMove = (c) => Math.abs(c.gain7d || 0) <= 150 && (c.sales7d || 0) >= 5;
  const dedupeFamily = (list) => {
    const seen = new Set();
    return list.filter(c => {
      const key = c.player || c.cardhedge_id; // one row per player in a 12-row panel
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const gainers = useMemo(() => dedupeFamily([...visible].filter(c => c.gain7d > 0 && c.market > 0 && saneMove(c)).sort((a, b) => b.gain7d - a.gain7d)).slice(0, 12), [visible]);
  const losers  = useMemo(() => dedupeFamily([...visible].filter(c => c.gain7d < 0 && c.market > 0 && saneMove(c)).sort((a, b) => a.gain7d - b.gain7d)).slice(0, 12), [visible]);
  const byVolume = useMemo(() => [...visible].filter(c => c.sales30d > 0).sort((a, b) => b.sales30d - a.sales30d).slice(0, 14), [visible]);
  const heatCards = useMemo(() => [...visible].filter(c => c.gain7d !== 0 && c.market > 0 && saneMove(c)).sort((a, b) => Math.abs(b.gain7d) - Math.abs(a.gain7d)).slice(0, 24), [visible]);
  const tickerCards = useMemo(() => [...gainers.slice(0, 8), ...losers.slice(0, 8)], [gainers, losers]);

  const topGainer = gainers[0];
  const topLoser  = losers[0];
  const totalVolume = useMemo(() => visible.reduce((s, c) => s + (c.sales30d || 0), 0), [visible]);
  const netPlays = useMemo(() => cardsWithEdge.filter(c => c.netEdge > 0), [cardsWithEdge]);
  const avgNetEdge = useMemo(() => netPlays.length ? (netPlays.reduce((s, c) => s + c.netEdge, 0) / netPlays.length).toFixed(0) : '—', [netPlays]);

  return (
    <div style={{ background: '#080b12', minHeight: '60vh', padding: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.06)' }}>
      <ProGate
        page
        allowed={hasCapability(user || (token ? {} : null), 'arbitrage')}
        title="Create a free account to unlock the Deal Finder"
        sub="Cards priced below fair value, fees already counted, plus movers and full-market search, free with a GEMLINE account."
        cta="Create a free account"
        onUnlock={() => setShowAuth(true)}
      >

      {view === 'grading' && <WorthGrading onSelect={setSelected} />}

      {view === 'deals' && (loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, gap: 12, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#34D88A', animation: 'pulse 1s infinite' }} />
          LOADING DEAL DATA...
        </div>
      ) : (
      <>
      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', flexWrap: 'wrap', gap: 8,
        background: '#0a0d14',
        borderBottom: '1px solid rgba(255,255,255,.07)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#E8B339', fontWeight: 700, letterSpacing: '.1em' }}>
            GEMLINE DEAL FINDER
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', letterSpacing: '.08em' }}>
            POWERED BY CARDHEDGE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>
            {cards.length.toLocaleString()} CARDS LOADED
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D88A', boxShadow: '0 0 6px #34D88A', animation: 'pulse 2s infinite' }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#34D88A' }}>LIVE</span>
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.4)', letterSpacing: '.06em' }}>{now}</span>
          {lastUpdated && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,.3)', letterSpacing: '.06em' }}>
              DATA {Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s AGO · AUTO ↻2m
            </span>
          )}
          <button
            onClick={() => { setLoading(true); fetchArbData(); }}
            style={{ padding: '3px 8px', borderRadius: 4, fontSize: 10, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontFamily: 'var(--mono)' }}
          >↻ REFRESH</button>
        </div>
      </div>

      {/* ── Ticker strip ── */}
      <TickerStrip cards={tickerCards} />

      {/* ── Play search ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 0', flexWrap: 'wrap' }}>
        <div className="arb-search" style={{ flex: '1 1 260px', maxWidth: 420 }}>
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
        {query.trim() && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', letterSpacing: '.06em' }}>
            {visible.length.toLocaleString()} MATCH{visible.length === 1 ? '' : 'ES'} · FULL-MARKET SWEEP
          </span>
        )}
      </div>

      {/* ── Stat row ── */}
      <div style={{ display: 'flex', gap: 1, padding: '8px', background: '#080b12', flexWrap: 'wrap' }}>
        <StatBox label="30D TOTAL VOLUME" value={fmtNum(totalVolume)} sub="transactions" color="#5B8DEF" />
        <StatBox label="TOP GAINER · 7D" value={topGainer ? `+${topGainer.gain7d.toFixed(1)}%` : '—'} sub={topGainer?.player || ''} color="#34D88A" glow />
        <StatBox label="TOP LOSER · 7D" value={topLoser ? `${topLoser.gain7d.toFixed(1)}%` : '—'} sub={topLoser?.player || ''} color="#FF5C6C" glow />
        <StatBox label="AVG SAVINGS" value={avgNetEdge === '—' ? '—' : `$${avgNetEdge}`} sub={`across ${netPlays.length} live deals`} color="#E8B339" />
        <StatBox label="DEALS TODAY" value={netPlays.length} sub="below fair value after the 7.5% fee" color="#9B7BFF" />
      </div>

      {/* ── Main 4-panel grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gridAutoRows: '260px',
        gap: 1,
        padding: '0 8px',
        background: '#080b12',
      }}>
        {/* Panel 1: Gainers */}
        <Panel title="7D GAINERS" badgeColor="#34D88A" badge={`${gainers.length}`} right="SORTED BY GAIN">
          <div style={{ overflowY: 'auto', height: '100%' }}>
            {gainers.map((c, i) => (
              <div key={c.id} onClick={() => setSelected(c)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                borderBottom: '1px solid rgba(255,255,255,.03)', cursor: 'pointer',
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', width: 16, textAlign: 'right' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.player}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--dim)' }}>{c.grader} {c.grade}</div>
                </div>
                <Spark vals={[50, 52, 49, 55, 53, 58, 57, 62, 60, 65]} up={true} />
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: '#34D88A' }}>+{c.gain7d.toFixed(1)}%</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>{fmtP(c.market)}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Panel 2: Losers */}
        <Panel title="7D LOSERS" badgeColor="#FF5C6C" badge={`${losers.length}`} right="SORTED BY DROP">
          <div style={{ overflowY: 'auto', height: '100%' }}>
            {losers.map((c, i) => (
              <div key={c.id} onClick={() => setSelected(c)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                borderBottom: '1px solid rgba(255,255,255,.03)', cursor: 'pointer',
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', width: 16, textAlign: 'right' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.player}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--dim)' }}>{c.grader} {c.grade}</div>
                </div>
                <Spark vals={[65, 60, 62, 57, 55, 53, 50, 48, 45, 43]} up={false} />
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: '#FF5C6C' }}>{c.gain7d.toFixed(1)}%</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>{fmtP(c.market)}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Panel 3: Volume bars */}
        <Panel title="30D VOLUME LEADERS" badgeColor="#E8B339" badge="TOP 12" right="TRANSACTIONS">
          <VolumeBars cards={byVolume} />
        </Panel>

        {/* Panel 4: Momentum heatmap */}
        <Panel title="MOMENTUM HEATMAP" badgeColor="#9B7BFF" badge="7D CHANGE" right="CLICK TO DRILL">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 3,
            padding: 8,
            height: '100%',
            overflowY: 'auto',
          }}>
            {heatCards.map(c => (
              <HeatCell key={c.id} card={c} onClick={() => setSelected(c)} />
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Spread matrix (full width) ── */}
      <div style={{ margin: '1px 8px 8px', height: 480 }}>
        <Panel
          title="DEAL BOARD"
          badgeColor="#E8B339"
          badge={`${netPlays.length} DEALS · FEES INCLUDED`}
          right="CLICK COLUMN TO SORT · CLICK ROW TO DRILL"
          style={{ height: '100%' }}
        >
          {cardsWithEdge.length > 0 ? (
            <SpreadMatrix cards={cardsWithEdge.slice(0, 100)} onSelect={setSelected} />
          ) : (
            <div style={{ padding: 24, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)' }}>
              NO DEAL DATA. CARDS NEED LO/HI RANGE FROM CARDHEDGE
            </div>
          )}
        </Panel>
      </div>
      </>
      ))}

      </ProGate>

      {selected && <CardDetail card={selected} onClose={() => setSelected(null)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
