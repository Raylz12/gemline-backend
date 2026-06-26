'use client';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import CardDetail from '../components/CardDetail';

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

// ─── Inline bar chart (for volume) ───────────────────────────────────────────
function BarChart({ data = [], color = '#E8B339', label }) {
  const max = Math.max(...data.map(d => d.v), 1);
  const W = 200, H = 60, barW = Math.max(2, Math.floor((W - 4) / data.length) - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {data.map((d, i) => {
        const barH = Math.max(1, (d.v / max) * (H - 8));
        const x = 2 + i * (barW + 1);
        const y = H - barH - 2;
        return (
          <rect key={i} x={x} y={y} width={barW} height={barH}
            fill={color} opacity={d.highlight ? 1 : 0.55} rx="1" />
        );
      })}
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
        background: 'linear-gradient(90deg,rgba(52,216,138,.3),rgba(232,179,57,.3),rgba(255,92,108,.3))',
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
  const [sortCol, setSortCol] = useState('edge');
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
        <Th label="LOW" col="lo" w={72} />
        <Th label="MKT" col="market" w={72} />
        <Th label="HIGH" col="hi" w={72} />
        <Th label="SPREAD $" col="spread" w={78} />
        <Th label="EDGE %" col="edge" w={110} />
        <Th label="7D %" col="gain7d" w={64} />
        <Th label="7D VOL" col="sales7d" w={64} />
        <Th label="30D VOL" col="sales30d" w={68} />
      </div>
      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((c, i) => {
          const isUp = (c.gain7d || 0) >= 0;
          const edgePct = Math.min((c.edge / 80) * 100, 100);
          const edgeColor = c.edge > 30 ? '#34D88A' : c.edge > 15 ? '#E8B339' : '#5B8DEF';
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
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', marginTop: 1 }}>
                    {c.grader} {c.grade} · {c.set?.slice(0, 22)}{c.set?.length > 22 ? '…' : ''}
                  </div>
                </div>
              </div>
              {/* Lo */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 11, color: '#34D88A', fontWeight: 600 }}>{fmtP(c.lo)}</span>
              {/* Market */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt)', fontWeight: 700 }}>{fmtP(c.market)}</span>
              {/* Hi */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 11, color: '#FF5C6C', fontWeight: 600 }}>{fmtP(c.hi)}</span>
              {/* Spread $ */}
              <span style={{ width: 78, fontFamily: 'var(--mono)', fontSize: 11, color: '#E8B339', fontWeight: 600 }}>{fmtP(c.spread)}</span>
              {/* Edge bar */}
              <div style={{ width: 110, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${edgePct}%`, height: '100%', background: edgeColor, borderRadius: 2 }} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: edgeColor, width: 34, textAlign: 'right' }}>{c.edge?.toFixed(0)}%</span>
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
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ArbitragePage() {
  const { token } = useAuth();
  const [cards, setCards] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState('');

  // Clock
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setNow(fmt());
    const t = setInterval(() => setNow(fmt()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch('/api/market/feed?limit=200&sort=gain')
      .then(r => r.json())
      .then(data => {
        const feed = data.feed || [];
        setCards(feed.map(c => ({
          id: c.cardId, player: c.player, sport: c.sport, set: c.set,
          grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
          num: c.num, market: Number(c.marketPrice) || 0,
          lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
          confidence: c.confidence, thumbnail: c.thumbnail,
          rookie: c.rookie, sales7d: Number(c.sales7d) || Number(c.sales_7d) || 0,
          sales30d: Number(c.sales30d) || Number(c.sales_30d) || 0,
          gain7d: Number(c.gain7d) || 0,
          cardhedge_id: c.cardhedge_id || null,
          theme: ['#1a1d28', '#252838'],
          ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Derived datasets
  const cardsWithEdge = useMemo(() => cards
    .filter(c => c.lo > 0 && c.hi > 0 && c.market > 0 && c.market < 10000)
    .map(c => ({
      ...c,
      edge: +((( c.hi - c.lo) / c.lo) * 100).toFixed(1),
      spread: +(c.hi - c.lo).toFixed(2),
    }))
    .sort((a, b) => b.edge - a.edge), [cards]);

  const gainers = useMemo(() => [...cards].filter(c => c.gain7d > 0 && c.market > 0).sort((a, b) => b.gain7d - a.gain7d).slice(0, 12), [cards]);
  const losers  = useMemo(() => [...cards].filter(c => c.gain7d < 0 && c.market > 0).sort((a, b) => a.gain7d - b.gain7d).slice(0, 12), [cards]);
  const byVolume = useMemo(() => [...cards].filter(c => c.sales30d > 0).sort((a, b) => b.sales30d - a.sales30d).slice(0, 14), [cards]);
  const heatCards = useMemo(() => [...cards].filter(c => c.gain7d !== 0 && c.market > 0).sort((a, b) => Math.abs(b.gain7d) - Math.abs(a.gain7d)).slice(0, 24), [cards]);
  const tickerCards = useMemo(() => [...gainers.slice(0, 8), ...losers.slice(0, 8)], [gainers, losers]);

  const topGainer = gainers[0];
  const topLoser  = losers[0];
  const totalVolume = useMemo(() => cards.reduce((s, c) => s + (c.sales30d || 0), 0), [cards]);
  const avgEdge = useMemo(() => cardsWithEdge.length ? (cardsWithEdge.reduce((s, c) => s + c.edge, 0) / cardsWithEdge.length).toFixed(1) : '—', [cardsWithEdge]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, gap: 12, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#34D88A', animation: 'pulse 1s infinite' }} />
        LOADING MARKET DATA...
      </div>
    );
  }

  return (
    <div style={{ background: '#080b12', minHeight: '100vh', padding: 0 }}>

      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        background: '#0a0d14',
        borderBottom: '1px solid rgba(255,255,255,.07)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#E8B339', fontWeight: 700, letterSpacing: '.1em' }}>
            GEMLINE ARB TERMINAL
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
        </div>
      </div>

      {/* ── Ticker strip ── */}
      <TickerStrip cards={tickerCards} />

      {/* ── Stat row ── */}
      <div style={{ display: 'flex', gap: 1, padding: '8px', background: '#080b12' }}>
        <StatBox label="30D TOTAL VOLUME" value={fmtNum(totalVolume)} sub="transactions" color="#5B8DEF" />
        <StatBox label="TOP GAINER · 7D" value={topGainer ? `+${topGainer.gain7d.toFixed(1)}%` : '—'} sub={topGainer?.player || ''} color="#34D88A" glow />
        <StatBox label="TOP LOSER · 7D" value={topLoser ? `${topLoser.gain7d.toFixed(1)}%` : '—'} sub={topLoser?.player || ''} color="#FF5C6C" glow />
        <StatBox label="AVG SPREAD EDGE" value={`${avgEdge}%`} sub={`${cardsWithEdge.length} cards with spread data`} color="#E8B339" />
        <StatBox label="ARB OPPORTUNITIES" value={cardsWithEdge.filter(c => c.edge > 15).length} sub="edge > 15%" color="#9B7BFF" />
      </div>

      {/* ── Main 4-panel grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr 1fr',
        gridTemplateRows: '260px',
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
          title="PRICE SPREAD MATRIX"
          badgeColor="#E8B339"
          badge={`${cardsWithEdge.length} OPPORTUNITIES`}
          right="CLICK COLUMN TO SORT · CLICK ROW TO DRILL"
          style={{ height: '100%' }}
        >
          {cardsWithEdge.length > 0 ? (
            <SpreadMatrix cards={cardsWithEdge.slice(0, 100)} onSelect={setSelected} />
          ) : (
            <div style={{ padding: 24, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)' }}>
              NO SPREAD DATA — CARDS NEED LO/HI RANGE FROM CARDHEDGE
            </div>
          )}
        </Panel>
      </div>

      {selected && <CardDetail card={selected} onClose={() => setSelected(null)} />}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
