'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtP = (n) => {
  if (!n || n <= 0) return '—';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + Number(n).toFixed(2);
};
const fmtNum = (n) => (n ? Number(n).toLocaleString('en-US') : '—');

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Spark({ up }) {
  const vals = up
    ? [42, 44, 43, 47, 45, 50, 48, 53, 52, 57, 55, 60]
    : [60, 58, 57, 54, 55, 51, 52, 48, 46, 44, 43, 40];
  const W = 72, H = 24, pad = 2;
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const pts = vals.map((v, i) => `${pad + (i / (vals.length - 1)) * (W - pad * 2)},${pad + (1 - (v - min) / rng) * (H - pad * 2)}`).join(' ');
  const color = up ? '#34D88A' : '#FF5C6C';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <polygon points={`${pad},${H} ${pts} ${W - pad},${H}`} fill={up ? 'rgba(52,216,138,.1)' : 'rgba(255,92,108,.1)'} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Scrolling ticker ──────────────────────────────────────────────────────────
function Ticker({ cards }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !cards.length) return;
    let x = 0; let raf;
    const run = () => { x -= 0.45; if (Math.abs(x) > el.scrollWidth / 2) x = 0; el.style.transform = `translateX(${x}px)`; raf = requestAnimationFrame(run); };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [cards]);
  if (!cards.length) return null;
  const items = [...cards, ...cards];
  return (
    <div style={{ overflow: 'hidden', background: '#060810', borderBottom: '1px solid rgba(255,255,255,.06)', padding: '4px 0' }}>
      <div ref={ref} style={{ display: 'flex', whiteSpace: 'nowrap', willChange: 'transform' }}>
        {items.map((c, i) => {
          const up = (c.gain7d || 0) >= 0;
          return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 18px', borderRight: '1px solid rgba(255,255,255,.04)', fontFamily: 'var(--mono)', fontSize: 10 }}>
              <span style={{ color: 'rgba(255,255,255,.35)' }}>{c.player.split(' ').pop()?.toUpperCase()}</span>
              <span style={{ color: 'var(--txt)', fontWeight: 600 }}>{fmtP(c.market)}</span>
              <span style={{ color: up ? '#34D88A' : '#FF5C6C' }}>{up ? '▲' : '▼'}{Math.abs(c.gain7d || 0).toFixed(1)}%</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Panel shell ───────────────────────────────────────────────────────────────
function Panel({ title, dot = '#34D88A', badge, right, children, style = {} }) {
  return (
    <div style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,.07)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'rgba(255,255,255,.025)', borderBottom: '1px solid rgba(255,255,255,.05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot, boxShadow: `0 0 5px ${dot}` }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.12em', color: 'rgba(255,255,255,.45)', textTransform: 'uppercase' }}>{title}</span>
          {badge && <span style={{ fontFamily: 'var(--mono)', fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,.05)', color: 'var(--muted)' }}>{badge}</span>}
        </div>
        {right && <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'rgba(255,255,255,.2)' }}>{right}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

// ── Stat box ──────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color = '#fff', glow }) {
  return (
    <div style={{ flex: 1, padding: '10px 14px', background: '#0d1117', border: '1px solid rgba(255,255,255,.07)', borderRadius: 4 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '.12em', color: 'rgba(255,255,255,.3)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color, textShadow: glow ? `0 0 14px ${color}` : 'none', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}

// ── Volume bar row ────────────────────────────────────────────────────────────
function VolBar({ card, rank, max, onClick }) {
  const pct = Math.min(((card.sales30d || 0) / Math.max(max, 1)) * 100, 100);
  const color = rank <= 3 ? '#E8B339' : rank <= 6 ? '#5B8DEF' : 'rgba(255,255,255,.2)';
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', width: 14, textAlign: 'right', flexShrink: 0 }}>{rank}</span>
      <div style={{ flex: 1, height: 18, background: 'rgba(255,255,255,.04)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: color, borderRadius: 2, transition: 'width .5s ease' }} />
        <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', fontFamily: 'var(--mono)', fontSize: 9, color: pct > 25 ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.55)', whiteSpace: 'nowrap' }}>
          {card.player.split(' ').slice(-1)[0].toUpperCase()}
        </span>
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', width: 34, textAlign: 'right', flexShrink: 0 }}>{fmtNum(card.sales30d)}</span>
    </div>
  );
}

// ── Heatmap cell ──────────────────────────────────────────────────────────────
function HeatCell({ card, onClick }) {
  const g = card.gain7d || 0;
  const intensity = Math.min(Math.abs(g) / 35, 1);
  const bg = g > 0 ? `rgba(52,216,138,${0.07 + intensity * 0.38})` : g < 0 ? `rgba(255,92,108,${0.07 + intensity * 0.38})` : 'rgba(255,255,255,.04)';
  const bdr = g > 0 ? `1px solid rgba(52,216,138,${0.15 + intensity * 0.45})` : g < 0 ? `1px solid rgba(255,92,108,${0.15 + intensity * 0.45})` : '1px solid rgba(255,255,255,.05)';
  return (
    <div onClick={onClick} style={{ background: bg, border: bdr, borderRadius: 3, padding: '5px 6px', cursor: 'pointer', transition: 'all .12s' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'rgba(255,255,255,.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {card.player.split(' ').slice(-1)[0]}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: g >= 0 ? '#34D88A' : '#FF5C6C', marginTop: 1 }}>
        {g >= 0 ? '+' : ''}{g.toFixed(1)}%
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'rgba(255,255,255,.3)', marginTop: 1 }}>{fmtP(card.market)}</div>
    </div>
  );
}

// ── Mover row ─────────────────────────────────────────────────────────────────
function MoverRow({ card, rank, onClick }) {
  const up = (card.gain7d || 0) >= 0;
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,.03)', cursor: 'pointer' }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', width: 16, textAlign: 'right' }}>{rank}</span>
      {card.thumbnail && (
        <div style={{ width: 28, height: 36, borderRadius: 3, flexShrink: 0, background: `url(${card.thumbnail}) center/contain no-repeat #111`, border: '1px solid rgba(255,255,255,.07)' }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.player}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--dim)', marginTop: 1 }}>{card.grader} {card.grade} · {card.set?.slice(0, 20)}</div>
      </div>
      <Spark up={up} />
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: up ? '#34D88A' : '#FF5C6C' }}>
          {up ? '+' : ''}{(card.gain7d || 0).toFixed(1)}%
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', marginTop: 1 }}>{fmtP(card.market)}</div>
      </div>
    </div>
  );
}

// ── Spread matrix table ───────────────────────────────────────────────────────
function SpreadTable({ cards, onSelect }) {
  const [sortCol, setSortCol] = useState('edge');
  const [sortDir, setSortDir] = useState('desc');
  const [hov, setHov] = useState(null);

  const sorted = useMemo(() => [...cards].sort((a, b) => {
    const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  }), [cards, sortCol, sortDir]);

  const onSort = (col) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } };

  const Th = ({ label, col, w, align = 'left' }) => (
    <div onClick={() => onSort(col)} style={{ width: w, fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none', color: sortCol === col ? '#E8B339' : 'rgba(255,255,255,.28)', display: 'flex', alignItems: 'center', gap: 3, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      {label}{sortCol === col && <span style={{ fontSize: 7 }}>{sortDir === 'desc' ? '▼' : '▲'}</span>}
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '5px 12px', background: 'rgba(255,255,255,.02)', borderBottom: '1px solid rgba(255,255,255,.05)', flexShrink: 0, gap: 0 }}>
        <div style={{ width: 28 }} />
        <div style={{ flex: 1, minWidth: 180, fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)' }}>CARD / EDGE</div>
        <Th label="LOW" col="lo" w={72} align="right" />
        <Th label="PRICE" col="market" w={74} align="right" />
        <Th label="HIGH" col="hi" w={72} align="right" />
        <Th label="SPREAD" col="spread" w={76} align="right" />
        <Th label="EDGE %" col="edge" w={120} />
        <Th label="7D" col="gain7d" w={58} align="right" />
        <Th label="7D VOL" col="sales7d" w={62} align="right" />
        <Th label="30D VOL" col="sales30d" w={66} align="right" />
      </div>
      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((c, i) => {
          const up = (c.gain7d || 0) >= 0;
          const edgeColor = c.edge > 30 ? '#34D88A' : c.edge > 15 ? '#E8B339' : '#5B8DEF';
          const edgePct = Math.min((c.edge / 80) * 100, 100);
          return (
            <div key={c.id} onClick={() => onSelect(c)} onMouseEnter={() => setHov(c.id)} onMouseLeave={() => setHov(null)}
              style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', background: hov === c.id ? 'rgba(255,255,255,.04)' : i % 2 === 0 ? 'rgba(255,255,255,.01)' : 'transparent', cursor: 'pointer', transition: 'background .1s' }}>
              {/* Rank */}
              <span style={{ width: 28, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', textAlign: 'right', paddingRight: 6 }}>{i + 1}</span>
              {/* Card */}
              <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 7 }}>
                {c.thumbnail && <div style={{ width: 28, height: 38, borderRadius: 3, flexShrink: 0, background: `url(${c.thumbnail}) center/contain no-repeat #111`, border: '1px solid rgba(255,255,255,.06)' }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.player}
                    {c.rookie && <span style={{ fontSize: 7, background: '#E8B339', color: '#000', borderRadius: 2, padding: '1px 3px', marginLeft: 4, fontWeight: 700 }}>RC</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', marginTop: 1 }}>{c.grader} {c.grade} · {c.set?.slice(0, 24)}{c.set?.length > 24 ? '…' : ''}</div>
                </div>
              </div>
              {/* Lo */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 11, color: '#34D88A', fontWeight: 600, textAlign: 'right' }}>{fmtP(c.lo)}</span>
              {/* Price */}
              <span style={{ width: 74, fontFamily: 'var(--mono)', fontSize: 11, color: '#fff', fontWeight: 700, textAlign: 'right' }}>{fmtP(c.market)}</span>
              {/* Hi */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 11, color: '#FF5C6C', fontWeight: 600, textAlign: 'right' }}>{fmtP(c.hi)}</span>
              {/* Spread $ */}
              <span style={{ width: 76, fontFamily: 'var(--mono)', fontSize: 11, color: '#E8B339', fontWeight: 600, textAlign: 'right' }}>{fmtP(c.spread)}</span>
              {/* Edge bar */}
              <div style={{ width: 120, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,.07)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${edgePct}%`, height: '100%', background: edgeColor, borderRadius: 2, transition: 'width .4s' }} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: edgeColor, width: 32, textAlign: 'right' }}>{c.edge?.toFixed(0)}%</span>
              </div>
              {/* 7D */}
              <span style={{ width: 58, fontFamily: 'var(--mono)', fontSize: 10, color: up ? '#34D88A' : '#FF5C6C', textAlign: 'right' }}>
                {c.gain7d ? `${up ? '+' : ''}${Number(c.gain7d).toFixed(1)}%` : '—'}
              </span>
              {/* 7D vol */}
              <span style={{ width: 62, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>{fmtNum(c.sales7d)}</span>
              {/* 30D vol */}
              <span style={{ width: 66, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', textAlign: 'right' }}>{fmtNum(c.sales30d)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ArbitrageContent({ onSelectCard }) {
  const { token } = useAuth();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState('');

  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('en-US', { hour12: false });
    setNow(fmt());
    const t = setInterval(() => setNow(fmt()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch('/api/market/feed?limit=200&sort=gain')
      .then(r => r.json())
      .then(data => setCards((data.feed || []).map(c => ({
        id: c.cardId, player: c.player, sport: c.sport, set: c.set,
        grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
        num: c.num, market: Number(c.marketPrice) || 0,
        lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
        confidence: c.confidence, thumbnail: c.thumbnail,
        rookie: c.rookie,
        sales7d: Number(c.sales7d) || Number(c.sales_7d) || 0,
        sales30d: Number(c.sales30d) || Number(c.sales_30d) || 0,
        gain7d: Number(c.gain7d) || 0,
        cardhedge_id: c.cardhedge_id || null,
        theme: ['#1a1d28', '#252838'],
        ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Derived slices
  const withEdge = useMemo(() => cards
    .filter(c => c.lo > 0 && c.hi > 0 && c.market > 0 && c.market < 10000)
    .map(c => ({ ...c, edge: +((( c.hi - c.lo) / c.lo) * 100).toFixed(1), spread: +(c.hi - c.lo).toFixed(2) }))
    .sort((a, b) => b.edge - a.edge), [cards]);

  const gainers   = useMemo(() => [...cards].filter(c => c.gain7d > 0 && c.market > 0).sort((a, b) => b.gain7d - a.gain7d).slice(0, 14), [cards]);
  const losers    = useMemo(() => [...cards].filter(c => c.gain7d < 0 && c.market > 0).sort((a, b) => a.gain7d - b.gain7d).slice(0, 14), [cards]);
  const byVol     = useMemo(() => [...cards].filter(c => c.sales30d > 0).sort((a, b) => b.sales30d - a.sales30d).slice(0, 14), [cards]);
  const heat      = useMemo(() => [...cards].filter(c => c.gain7d !== 0).sort((a, b) => Math.abs(b.gain7d) - Math.abs(a.gain7d)).slice(0, 28), [cards]);
  const ticker    = useMemo(() => [...gainers.slice(0, 8), ...losers.slice(0, 8)], [gainers, losers]);
  const volMax    = byVol[0]?.sales30d || 1;

  const topGainer = gainers[0];
  const topLoser  = losers[0];
  const totalVol  = useMemo(() => cards.reduce((s, c) => s + (c.sales30d || 0), 0), [cards]);
  const avgEdge   = useMemo(() => withEdge.length ? (withEdge.reduce((s, c) => s + c.edge, 0) / withEdge.length).toFixed(1) : '—', [withEdge]);
  const signals   = withEdge.filter(c => c.edge > 15).length;

  const select = (c) => onSelectCard?.(c);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, gap: 10, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)', background: '#080b12', borderRadius: 8 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#34D88A', animation: 'pulse 1s infinite' }} />
      LOADING MARKET DATA...
    </div>
  );

  return (
    <div style={{ background: '#080b12', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.07)', marginTop: 4 }}>

      {/* ── Terminal header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', background: '#0a0e18', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D88A', boxShadow: '0 0 6px #34D88A' }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#34D88A', letterSpacing: '.1em' }}>LIVE FEED</span>
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#E8B339', fontWeight: 700, letterSpacing: '.14em' }}>GEMLINE ARB DESK</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,.25)' }}>{cards.length.toLocaleString()} CARDS</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,.3)' }}>Last refresh: {now}</span>
        </div>
      </div>

      {/* ── Ticker ── */}
      <Ticker cards={ticker} />

      {/* ── Stat row ── */}
      <div style={{ display: 'flex', gap: 1, padding: '6px 6px 1px' }}>
        <Stat label="Top Gainer 7D" value={topGainer ? `+${topGainer.gain7d.toFixed(1)}%` : '—'} sub={topGainer?.player || 'no data'} color="#34D88A" glow />
        <Stat label="Top Loser 7D" value={topLoser ? `${topLoser.gain7d.toFixed(1)}%` : '—'} sub={topLoser?.player || 'no data'} color="#FF5C6C" glow />
        <Stat label="Weekly Volume" value={fmtNum(totalVol)} sub="trades tracked" color="#5B8DEF" />
        <Stat label="Signals Active" value={signals} sub="cross-platform" color="#9B7BFF" />
      </div>

      {/* ── 4-panel grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 1, padding: '1px 6px' }}>
        {/* Gainers */}
        <Panel title="7D Gainers" dot="#34D88A" badge={`${gainers.length}`}>
          <div style={{ overflowY: 'auto', maxHeight: 300 }}>
            {gainers.map((c, i) => <MoverRow key={c.id} card={c} rank={i + 1} onClick={() => select(c)} />)}
          </div>
        </Panel>

        {/* Losers */}
        <Panel title="7D Losers" dot="#FF5C6C" badge={`${losers.length}`}>
          <div style={{ overflowY: 'auto', maxHeight: 300 }}>
            {losers.map((c, i) => <MoverRow key={c.id} card={c} rank={i + 1} onClick={() => select(c)} />)}
          </div>
        </Panel>

        {/* Volume */}
        <Panel title="30D Volume Leaders" dot="#E8B339" right="TRANSACTIONS">
          <div style={{ overflowY: 'auto', maxHeight: 300 }}>
            {byVol.map((c, i) => <VolBar key={c.id} card={c} rank={i + 1} max={volMax} onClick={() => select(c)} />)}
          </div>
        </Panel>

        {/* Heatmap */}
        <Panel title="Momentum Heatmap" dot="#9B7BFF" right="CLICK TO DRILL">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, padding: 8, maxHeight: 300, overflowY: 'auto' }}>
            {heat.map(c => <HeatCell key={c.id} card={c} onClick={() => select(c)} />)}
          </div>
        </Panel>
      </div>

      {/* ── Undervalued Radar label ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>🎯</span>
          <span style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15, color: 'var(--txt)' }}>Undervalued Radar</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)' }}>biggest edge × trading volume</span>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#E8B339' }}>{withEdge.length} signals</span>
      </div>

      {/* ── Spread matrix ── */}
      <div style={{ margin: '4px 6px 6px', height: 460, background: '#0d1117', border: '1px solid rgba(255,255,255,.07)', borderRadius: 4, overflow: 'hidden' }}>
        {withEdge.length > 0 ? (
          <SpreadTable cards={withEdge.slice(0, 100)} onSelect={select} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>
            NO SPREAD DATA AVAILABLE
          </div>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
    </div>
  );
}
