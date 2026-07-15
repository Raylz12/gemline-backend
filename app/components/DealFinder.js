'use client';
// Deal Finder — the buy-low / fair-value net-edge deal board plus the
// "Worth Grading?" ROI calculator, Live Deals (eBay cross-ref), deal alerts,
// and the track record. THE paid surface: gated by ProGate capability
// 'dealfinder' = GEMLINE Pro. The server enforces it too (/api/market/arb
// 402s for non-Pro) — the blurred teaser renders DEMO data only, so no real
// deal data ever reaches non-Pro browsers. `view` picks the sub-surface:
//   'deals'   → net-edge deal board (default)
//   'grading' → Worth Grading? calculator
//   'track'   → Our Track Record (flagged deals vs what happened next)
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import CardDetail from './CardDetail';
import CardThumb from './CardThumb';
import AuthModal from './AuthModal';
import ProGate, { hasCapability } from './ProGate';
import WorthGrading from './WorthGrading';
import TrackRecord from './TrackRecord';

// Tokenized play matcher — every search word must hit player/set/variant/year/grade.
const matchesArbQuery = (c, q) => {
  if (!q) return true;
  const hay = `${c.player || ''} ${c.set || ''} ${c.variant || ''} ${c.year || ''} ${c.grader || ''} ${c.grade || ''} ${c.sport || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
};

// Buy at the low ask, exit at Card Hedge high (FMV) net of the 7.5% marketplace
// fee — the same net-edge model the price guide arb tab uses.
const MARKETPLACE_FEE = 0.075;  // standard seller fee (first-5-sales intro rate is 5%)

// ── Budget presets — filter every panel by the buy-at price, persisted ──────
const BUDGETS = [
  { key: 'all',   label: 'All budgets',  min: 0,   max: Infinity },
  { key: 'u100',  label: 'Under $100',   min: 0,   max: 100 },
  { key: 'b300',  label: '$100–300',     min: 100, max: 300 },
  { key: 'b750',  label: '$300–750',     min: 300, max: 750 },
  { key: 'b1500', label: '$750–1,500',   min: 750, max: 1500 },
];
const BUDGET_LS_KEY = 'gemline_deal_budget';

// ── GEMLINE Score chip — server-computed 0–100 deal quality ─────────────────
function ScoreChip({ score, big = false }) {
  const s = Number(score) || 0;
  const band = s >= 90
    ? { c: '#34D88A', bg: 'rgba(52,216,138,.14)', bd: 'rgba(52,216,138,.45)' }
    : s >= 70
    ? { c: '#E8B339', bg: 'rgba(232,179,57,.13)', bd: 'rgba(232,179,57,.45)' }
    : { c: 'rgba(255,255,255,.65)', bg: 'rgba(255,255,255,.07)', bd: 'rgba(255,255,255,.16)' };
  return (
    <span title="GEMLINE Score: net edge after fees, liquidity, trend stability, and spread confidence in one 0–100 number" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'var(--mono)', fontWeight: 800,
      fontSize: big ? 13 : 11, padding: big ? '3px 9px' : '1px 7px',
      borderRadius: 999, color: band.c, background: band.bg, border: `1px solid ${band.bd}`,
      whiteSpace: 'nowrap',
    }}>
      ◈ {s}
    </span>
  );
}

// ── Demo data for the paywall teaser — fabricated, deterministic, clearly not
// live. The blurred background behind the Pro pitch renders THIS, never real
// deal data (the API 402s for non-Pro anyway). ───────────────────────────
const DEMO_NAMES = [
  'V. Wembanyama', 'C. Bednard', 'S. Ohtami', 'P. Mahomas', 'L. Doncevic', 'J. Buroow',
  'A. Judgge', 'C. Strouud', 'K. Duraant', 'C. Williams', 'J. Chaase', 'B. Wagnner',
  'T. Lawrance', 'E. Rodrigez', 'M. Betz', 'D. Prescot', 'A. Richardsen', 'J. Jefferzon',
];
function demoCards() {
  return DEMO_NAMES.map((player, i) => {
    const lo = 60 + ((i * 97) % 900);
    const hi = lo * (1.18 + ((i * 13) % 20) / 100);
    return {
      id: `demo-${i}`, player, sport: 'Basketball', set: '2025 Sample Set Chrome',
      grader: 'PSA', grade: '10', year: '2025', variant: null,
      market: +(lo * 1.08).toFixed(0), lo, hi: +hi.toFixed(0),
      confidence: null, thumbnail: null, rookie: i % 4 === 0,
      sales7d: 4 + (i % 9), sales30d: 20 + ((i * 31) % 300),
      gain7d: ((i * 17) % 25) - 8, score: 55 + ((i * 11) % 45),
      cardhedge_id: null, theme: ['#1a1d28', '#252838'],
      ini: player.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
    };
  });
}

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
const fmtAgo = (d) => {
  if (!d) return null;
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

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
              padding: '6px 20px', borderRight: '1px solid rgba(255,255,255,.05)',
              fontFamily: 'var(--mono)', fontSize: 12,
            }}>
              <span style={{ color: 'var(--muted)' }}>{c.player.split(' ').pop()?.toUpperCase()}</span>
              <span style={{ color: 'var(--txt)', fontWeight: 600 }}>{fmtP(c.market)}</span>
              <span style={{ color: up ? '#34D88A' : '#FF5C6C', fontSize: 11 }}>
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
function Panel({ id, title, badge, badgeColor, right, help, children, style = {} }) {
  return (
    <div id={id} style={{
      background: '#0d1117',
      border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 8,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      scrollMarginTop: 116,
      ...style,
    }}>
      {/* Panel header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '9px 12px',
        background: 'rgba(255,255,255,.03)',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: badgeColor || '#34D88A', boxShadow: `0 0 6px ${badgeColor || '#34D88A'}` }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.1em', color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', fontWeight: 600 }}>
            {title}
          </span>
          {badge && (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px',
              borderRadius: 4, background: 'rgba(255,255,255,.06)',
              color: 'var(--muted)', letterSpacing: '.04em',
            }}>{badge}</span>
          )}
        </div>
        {right && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{right}</div>}
      </div>
      {/* Visible plain-English helper (not hover-only — mobile matters) */}
      {help && (
        <div style={{ padding: '7px 12px', fontFamily: 'var(--ui)', fontSize: 12.5, lineHeight: 1.45, color: 'rgba(255,255,255,.52)', borderBottom: '1px solid rgba(255,255,255,.04)', flexShrink: 0 }}>
          {help}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

// ─── Today's Top Deals — the simple layer. Big friendly cards a 10-year-old
// can read: what it is, what it costs, and what you save. Tap to open. ──────
function TopDeals({ deals, onSelect, onAlert }) {
  if (!deals.length) return null;
  return (
    <div id="df-top" style={{ padding: '18px 12px 6px', scrollMarginTop: 116 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--disp)', fontSize: 24, fontWeight: 800, color: 'var(--txt)', letterSpacing: 0 }}>
          Today's Top Deals
        </h2>
        <span style={{ fontFamily: 'var(--ui)', fontSize: 13.5, color: 'rgba(255,255,255,.55)' }}>
          Real deals in the $50&ndash;$1,500 range &mdash; priced below what they usually sell for, fees already counted.
        </span>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
        gap: 12, marginTop: 14,
      }}>
        {deals.map(c => {
          const up = (c.gain7d || 0) >= 5;
          return (
            <div key={c.id} onClick={() => onSelect(c)} className="df-topdeal" style={{
              background: 'linear-gradient(160deg, #11161f, #0c1018)',
              border: '1px solid rgba(52,216,138,.22)', borderRadius: 12,
              padding: 14, cursor: 'pointer', display: 'flex', gap: 12,
              transition: 'transform .15s, border-color .15s',
            }}>
              <CardThumb src={c.thumbnail} name={c.player} sport={c.sport} width={58} height={80} radius={6} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontFamily: 'var(--ui)', fontSize: 15, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                    {c.player}
                    {c.rookie ? <span style={{ fontSize: 10, background: '#E8B339', color: '#000', borderRadius: 3, padding: '1px 5px', marginLeft: 6, fontWeight: 800, verticalAlign: 'middle' }}>RC</span> : null}
                  </div>
                  <ScoreChip score={c.score} big />
                </div>
                <div style={{ fontFamily: 'var(--ui)', fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {`${c.grader || 'Raw'} ${c.grade || ''}`.trim()} · {c.set?.slice(0, 30)}
                </div>
                <div style={{ fontFamily: 'var(--ui)', fontSize: 13, color: 'rgba(255,255,255,.75)', marginTop: 8, lineHeight: 1.45 }}>
                  Buy at <b style={{ color: '#34D88A', fontFamily: 'var(--mono)' }}>{fmtP(c.lo)}</b>, usually sells for <b style={{ fontFamily: 'var(--mono)' }}>{fmtP(c.hi)}</b>{up ? <>, and it's up <b style={{ color: '#34D88A' }}>{c.gain7d.toFixed(0)}%</b> this week</> : null}
                </div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(52,216,138,.12)', border: '1px solid rgba(52,216,138,.3)', borderRadius: 999, padding: '3px 10px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: '#34D88A' }}>You keep {fmtP(c.netEdge)}</span>
                    <span style={{ fontFamily: 'var(--ui)', fontSize: 11, color: 'rgba(255,255,255,.5)' }}>after fees</span>
                  </span>
                  {onAlert && (
                    <button
                      title="Alert me about deals like this"
                      onClick={(e) => { e.stopPropagation(); onAlert(c); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 999, padding: '3px 10px', cursor: 'pointer', color: 'rgba(255,255,255,.65)', fontFamily: 'var(--ui)', fontSize: 11.5, fontWeight: 600 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                      Alert me
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Jump chips — obvious in-page navigation, sticky under the site header ──
const JUMPS = [
  ['df-top', 'Top Deals'],
  ['df-live', 'Live Deals'],
  ['df-movers', 'Movers'],
  ['df-volume', 'Most Traded'],
  ['df-heat', 'Heatmap'],
  ['df-board', 'Deal Board'],
];
function JumpChips() {
  return (
    <div style={{
      position: 'sticky', top: 58, zIndex: 15,
      display: 'flex', gap: 8, padding: '10px 12px',
      background: 'rgba(8,11,18,.94)', backdropFilter: 'blur(8px)',
      borderBottom: '1px solid rgba(255,255,255,.06)',
      overflowX: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      <span style={{ fontFamily: 'var(--ui)', fontSize: 12.5, color: 'rgba(255,255,255,.4)', alignSelf: 'center', flexShrink: 0 }}>Jump to</span>
      {JUMPS.map(([id, label]) => (
        <button key={id}
          onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          style={{
            flexShrink: 0, padding: '6px 14px', borderRadius: 999,
            fontFamily: 'var(--ui)', fontSize: 13, fontWeight: 600,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            color: 'rgba(255,255,255,.75)', cursor: 'pointer', transition: '.15s',
          }}>{label}</button>
      ))}
    </div>
  );
}

// ─── Budget filter — "What's your budget?" chips, persisted, filters ALL panels
function BudgetBar({ budgetKey, onPick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 0', flexWrap: 'wrap' }}>
      <span style={{ fontFamily: 'var(--ui)', fontSize: 13.5, fontWeight: 700, color: 'rgba(255,255,255,.75)' }}>What&apos;s your budget?</span>
      {BUDGETS.map(b => {
        const active = b.key === budgetKey;
        return (
          <button key={b.key} onClick={() => onPick(b.key)} style={{
            padding: '6px 14px', borderRadius: 999,
            fontFamily: 'var(--ui)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: '.15s',
            background: active ? '#E8B339' : 'rgba(255,255,255,.06)',
            border: active ? '1px solid #E8B339' : '1px solid rgba(255,255,255,.1)',
            color: active ? '#000' : 'rgba(255,255,255,.75)',
          }}>{b.label}</button>
        );
      })}
    </div>
  );
}

// ─── Live Deals — underpriced ACTIVE listings (GEMLINE first, then eBay) ─────
function LiveDeals({ deals, loaded, budget }) {
  const filtered = budget && budget.key !== 'all'
    ? deals.filter(d => (d.total || 0) >= budget.min && (d.total || 0) <= budget.max)
    : deals;
  return (
    <div id="df-live" style={{ padding: '18px 12px 6px', scrollMarginTop: 116 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--disp)', fontSize: 24, fontWeight: 800, color: 'var(--txt)' }}>Live Deals</h2>
        <span style={{ fontFamily: 'var(--ui)', fontSize: 13.5, color: 'rgba(255,255,255,.55)' }}>
          Real listings you can buy right now — on GEMLINE and eBay — priced below the going rate. Checked against live eBay inventory every ~45 minutes.
        </span>
      </div>
      {!loaded ? (
        <div style={{ padding: '18px 4px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)' }}>SCANNING LIVE LISTINGS…</div>
      ) : !filtered.length ? (
        <div style={{ padding: '18px 4px', fontFamily: 'var(--ui)', fontSize: 13.5, color: 'rgba(255,255,255,.5)' }}>
          No live listings beat the market{budget && budget.key !== 'all' ? ' in this budget' : ''} right now. This panel refreshes all day — the good ones go fast.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12, marginTop: 14 }}>
          {filtered.slice(0, 12).map((d, i) => {
            const isGem = d.source === 'gemline';
            return (
              <div key={i} style={{
                background: 'linear-gradient(160deg, #11161f, #0c1018)',
                border: isGem ? '1px solid rgba(232,179,57,.35)' : '1px solid rgba(91,141,239,.3)',
                borderRadius: 12, padding: 14, display: 'flex', gap: 12,
              }}>
                <CardThumb src={d.image} name={d.player} sport={d.sport} width={58} height={80} radius={6} />
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em',
                      padding: '1px 6px', borderRadius: 4,
                      background: isGem ? 'rgba(232,179,57,.15)' : 'rgba(91,141,239,.15)',
                      color: isGem ? '#E8B339' : '#5B8DEF',
                      border: isGem ? '1px solid rgba(232,179,57,.4)' : '1px solid rgba(91,141,239,.4)',
                    }}>{isGem ? 'ON GEMLINE' : 'ON EBAY'}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--ui)', fontSize: 13.5, fontWeight: 700, color: 'var(--txt)', marginTop: 6, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {d.title}
                  </div>
                  <div style={{ fontFamily: 'var(--ui)', fontSize: 12.5, color: 'rgba(255,255,255,.7)', marginTop: 6 }}>
                    Listed at <b style={{ color: '#34D88A', fontFamily: 'var(--mono)' }}>{fmtP(d.total)}</b>{d.shipping > 0 ? <span style={{ color: 'rgba(255,255,255,.45)', fontSize: 11 }}> (incl. ship)</span> : null} · going rate <b style={{ fontFamily: 'var(--mono)' }}>{fmtP(d.goingRate)}</b>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 700, color: '#34D88A' }}>
                      +{fmtP(d.margin)} <span style={{ fontWeight: 400, color: 'rgba(255,255,255,.5)', fontSize: 10.5, fontFamily: 'var(--ui)' }}>flip margin after fees</span>
                    </span>
                    <a href={d.url} target={isGem ? '_self' : '_blank'} rel="noopener noreferrer"
                      style={{
                        flexShrink: 0, padding: '6px 16px', borderRadius: 7, textDecoration: 'none',
                        fontFamily: 'var(--ui)', fontSize: 13, fontWeight: 800,
                        background: isGem ? '#E8B339' : '#5B8DEF', color: isGem ? '#000' : '#fff',
                      }}>BUY →</a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── My Alerts — manage deal alert subscriptions ────────────────────────────
function AlertsPanel({ alerts, open, onToggleOpen, onCreate, onDelete, onToggle, msg }) {
  const [name, setName] = useState('');
  const [budgetKey, setBudgetKey] = useState('all');
  const [minScore, setMinScore] = useState(0);
  const [playerQuery, setPlayerQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const b = BUDGETS.find(x => x.key === budgetKey) || BUDGETS[0];
    const ok = await onCreate({
      name: name.trim(),
      playerQuery: playerQuery.trim() || null,
      budgetMin: b.min > 0 ? b.min : null,
      budgetMax: Number.isFinite(b.max) ? b.max : null,
      minScore: Number(minScore) || 0,
    });
    if (ok) { setName(''); setPlayerQuery(''); }
    setSaving(false);
  };

  const inp = { padding: '8px 10px', borderRadius: 6, fontSize: 13, background: 'rgba(255,255,255,.05)', color: 'var(--txt,#eef1f6)', border: '1px solid rgba(255,255,255,.12)' };
  return (
    <div style={{ margin: '12px 12px 0', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, background: '#0d1117', overflow: 'hidden' }}>
      <button onClick={onToggleOpen} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', background: 'rgba(255,255,255,.03)', border: 'none', cursor: 'pointer',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.1em', color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', fontWeight: 600 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#E8B339" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          My Deal Alerts
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,.06)', color: 'var(--muted)' }}>{alerts.length}</span>
        </span>
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>
      {msg && <div style={{ padding: '8px 14px', fontFamily: 'var(--ui)', fontSize: 12.5, color: '#34D88A', borderTop: '1px solid rgba(255,255,255,.05)' }}>{msg}</div>}
      {open && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ fontFamily: 'var(--ui)', fontSize: 12.5, color: 'rgba(255,255,255,.55)', marginBottom: 10 }}>
            We check every price sync (3× a day) and email you when new deals match — at most one email per alert per day.
          </div>
          <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...inp, flex: '1 1 150px' }} placeholder="Alert name (e.g. Cheap PSA 10s)" value={name} onChange={e => setName(e.target.value)} maxLength={60} />
            <input style={{ ...inp, flex: '1 1 150px' }} placeholder="Player / set (optional)" value={playerQuery} onChange={e => setPlayerQuery(e.target.value)} maxLength={80} />
            <select style={inp} value={budgetKey} onChange={e => setBudgetKey(e.target.value)}>
              {BUDGETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <select style={inp} value={minScore} onChange={e => setMinScore(e.target.value)}>
              <option value="0">Any score</option>
              <option value="70">Score 70+</option>
              <option value="90">Score 90+</option>
            </select>
            <button type="submit" disabled={saving || !name.trim()} style={{
              padding: '8px 18px', borderRadius: 6, fontFamily: 'var(--ui)', fontSize: 13, fontWeight: 800,
              background: '#E8B339', color: '#000', border: 'none', cursor: 'pointer', opacity: saving || !name.trim() ? .5 : 1,
            }}>{saving ? 'Saving…' : '+ Create alert'}</button>
          </form>
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            {alerts.length === 0 && (
              <div style={{ fontFamily: 'var(--ui)', fontSize: 13, color: 'rgba(255,255,255,.45)' }}>No alerts yet — create one above, or tap “Alert me” on any top deal.</div>
            )}
            {alerts.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 6, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontFamily: 'var(--ui)', fontSize: 13.5, fontWeight: 700, color: a.active ? 'var(--txt)' : 'rgba(255,255,255,.4)' }}>{a.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)', marginTop: 2 }}>
                    {a.playerQuery ? `“${a.playerQuery}” · ` : ''}
                    {a.budgetMin || a.budgetMax ? `$${a.budgetMin || 0}–${a.budgetMax ? '$' + a.budgetMax : '∞'} · ` : 'any budget · '}
                    {a.minScore ? `score ${a.minScore}+ · ` : ''}
                    {a.lastSentAt ? `last sent ${new Date(a.lastSentAt).toLocaleDateString()}` : 'nothing sent yet'}
                  </div>
                </div>
                <button onClick={() => onToggle(a.id, !a.active)} style={{
                  padding: '4px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ui)',
                  background: a.active ? 'rgba(52,216,138,.13)' : 'rgba(255,255,255,.06)',
                  border: a.active ? '1px solid rgba(52,216,138,.4)' : '1px solid rgba(255,255,255,.12)',
                  color: a.active ? '#34D88A' : 'rgba(255,255,255,.5)',
                }}>{a.active ? 'Active' : 'Paused'}</button>
                <button onClick={() => onDelete(a.id)} title="Delete alert" style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,92,108,.35)', color: '#FF5C6C', fontFamily: 'var(--ui)', fontWeight: 700 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat box ─────────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, color = 'var(--txt)', glow }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 8, padding: '12px 14px', flex: 1, minWidth: 150,
    }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 21, fontWeight: 700, color, textShadow: glow ? `0 0 12px ${color}` : 'none' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--ui)', fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
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
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'rgba(255,255,255,.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {card.player.split(' ').slice(-1)[0]}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 700, color: gain >= 0 ? '#34D88A' : '#FF5C6C', marginTop: 2 }}>
        {gain >= 0 ? '+' : ''}{gain.toFixed(1)}%
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 1 }}>{fmtP(card.market)}</div>
    </div>
  );
}

// ─── Volume bars panel ────────────────────────────────────────────────────────
function VolumeBars({ cards }) {
  const top = cards.slice(0, 12);
  const max = Math.max(...top.map(c => c.sales30d || 0), 1);
  return (
    <div style={{ padding: '8px 10px', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {top.map((c, i) => {
        const pct = ((c.sales30d || 0) / max) * 100;
        const color = i < 3 ? '#E8B339' : i < 6 ? '#5B8DEF' : 'rgba(255,255,255,.25)';
        return (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1, height: 18, background: 'rgba(255,255,255,.04)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .4s ease' }} />
              <span style={{
                position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                fontFamily: 'var(--mono)', fontSize: 10, color: pct > 20 ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,.7)',
                whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '60%', textOverflow: 'ellipsis', fontWeight: 600,
              }}>
                {c.player.split(' ').slice(-1)[0].toUpperCase()}
              </span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--muted)', width: 40, textAlign: 'right', flexShrink: 0 }}>{fmtNum(c.sales30d)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Spread matrix (main table) ───────────────────────────────────────────────
function SpreadMatrix({ cards, onSelect }) {
  const [sortCol, setSortCol] = useState('score');
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
      width: w, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
      color: sortCol === col ? '#E8B339' : 'rgba(255,255,255,.4)',
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
          <option value="score">GEMLINE Score</option>
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
              <ScoreChip score={c.score} />
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
        <div style={{ flex: 1, minWidth: 160, fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase' }}>CARD</div>
        <Th label="SCORE" col="score" w={62} />
        <Th label="BUY AT" col="lo" w={72} />
        <Th label="GOING RATE" col="hi" w={84} />
        <Th label="YOU KEEP $" col="netEdge" w={92} />
        <Th label="% AFTER FEES" col="netPct" w={116} />
        <Th label="7D %" col="gain7d" w={64} />
        <Th label="7D SALES" col="sales7d" w={72} />
        <Th label="30D SALES" col="sales30d" w={78} />
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
                padding: '9px 12px',
                borderBottom: '1px solid rgba(255,255,255,.04)',
                background: hover === c.id ? 'rgba(255,255,255,.05)' : i % 2 === 0 ? 'rgba(255,255,255,.015)' : 'transparent',
                cursor: 'pointer', transition: 'background .1s',
              }}
            >
              {/* Rank */}
              <span style={{ width: 32, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', textAlign: 'right', paddingRight: 8 }}>{i + 1}</span>
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
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.player} {c.rookie ? <span style={{ fontSize: 9, background: '#E8B339', color: '#000', borderRadius: 3, padding: '1px 4px', marginLeft: 3 }}>RC</span> : null}
                    {c.momentum ? <span title="Priced below fair value and trending up" style={{ fontSize: 9, background: 'rgba(52,216,138,.15)', color: '#34D88A', borderRadius: 3, padding: '1px 5px', marginLeft: 4, fontWeight: 700 }}>🔥 HOT</span> : null}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)', marginTop: 2 }}>
                    <span className="mchip mchip-grade" style={{ marginRight: 5 }}>{`${c.grader || 'RAW'} ${c.grade || ''}`.trim()}</span>{c.set?.slice(0, 22)}{c.set?.length > 22 ? '…' : ''}
                  </div>
                </div>
              </div>
              {/* GEMLINE Score */}
              <span style={{ width: 62 }}><ScoreChip score={c.score} /></span>
              {/* Buy (low ask) */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 12.5, color: '#34D88A', fontWeight: 600 }}>{fmtP(c.lo)}</span>
              {/* Going rate (FMV high) */}
              <span style={{ width: 84, fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--txt)', fontWeight: 700 }}>{fmtP(c.hi)}</span>
              {/* Net edge $ (after 7.5% fee) */}
              <span style={{ width: 92, fontFamily: 'var(--mono)', fontSize: 12.5, color: netColor, fontWeight: 700 }}>{(c.netEdge >= 0 ? '+' : '') + fmtP(Math.abs(c.netEdge))}</span>
              {/* Net % bar */}
              <div style={{ width: 116, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${netBarPct}%`, height: '100%', background: netColor, borderRadius: 3 }} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: netColor, width: 44, textAlign: 'right' }}>{(c.netPct >= 0 ? '+' : '') + (c.netPct?.toFixed(0))}%</span>
              </div>
              {/* 7D change */}
              <span style={{ width: 64, fontFamily: 'var(--mono)', fontSize: 12, color: isUp ? '#34D88A' : '#FF5C6C', textAlign: 'right' }}>
                {c.gain7d ? `${isUp ? '+' : ''}${Number(c.gain7d).toFixed(1)}%` : '—'}
              </span>
              {/* 7D vol */}
              <span style={{ width: 72, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>{fmtNum(c.sales7d)}</span>
              {/* 30D vol */}
              <span style={{ width: 78, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>{fmtNum(c.sales30d)}</span>
            </div>
          );
        })}
      </div>
    </div>
    </div>
    </>
  );
}

// ─── Deal Finder (tabbed content on /deal-finder) ────────────────────────────
export default function DealFinder({ view = 'deals' }) {
  const { user, token, authFetch } = useAuth();
  const [cards, setCards] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [query, setQuery] = useState('');
  // Paywall state — the server 402s /api/market/arb for non-Pro; when that
  // happens the blurred teaser renders demo data and the Pro pitch covers it.
  const [gated, setGated] = useState(false);
  const [upgrade, setUpgrade] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  // Budget filter (persisted)
  const [budgetKey, setBudgetKey] = useState('all');
  // Live Deals (eBay + GEMLINE cross-ref)
  const [liveDeals, setLiveDeals] = useState([]);
  const [liveLoaded, setLiveLoaded] = useState(false);
  // Deal alerts
  const [alerts, setAlerts] = useState([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertMsg, setAlertMsg] = useState('');

  useEffect(() => {
    try {
      const k = localStorage.getItem(BUDGET_LS_KEY);
      if (k && BUDGETS.some(b => b.key === k)) setBudgetKey(k);
    } catch {}
  }, []);
  const pickBudget = (k) => {
    setBudgetKey(k);
    try { localStorage.setItem(BUDGET_LS_KEY, k); } catch {}
  };
  const budget = BUDGETS.find(b => b.key === budgetKey) || BUDGETS[0];

  // Kick off Stripe Checkout for GEMLINE Pro ($7.99/mo, 7-day trial)
  const startCheckout = useCallback(async () => {
    if (!token) { setShowAuth(true); return; }
    setCheckingOut(true);
    try {
      const res = await authFetch('/api/subscription/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const d = await res.json();
      if (d.url) { window.location.href = d.url; return; }
      alert(d.error || 'Could not start checkout — try again.');
    } catch { alert('Could not start checkout — try again.'); }
    setCheckingOut(false);
  }, [token, authFetch]);

  // Clock
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setNow(fmt());
    const t = setInterval(() => setNow(fmt()), 1000);
    return () => clearInterval(t);
  }, []);

  const [lastUpdated, setLastUpdated] = useState(null);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState(null);
  const arbIntervalRef = useRef(null);

  // "Prices updated X ago" — max ch_updated_at across the catalog, cheap cached endpoint.
  useEffect(() => {
    let dead = false;
    fetch('/api/market/freshness')
      .then(r => r.json())
      .then(d => { if (!dead && d.updatedAt) setPricesUpdatedAt(new Date(d.updatedAt)); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  const fetchArbData = useCallback(async () => {
    try {
      const res = await authFetch('/api/market/arb');
      const data = await res.json();
      if (data.gated || res.status === 402) {
        // Paywalled: render demo data behind the blur, show the Pro pitch.
        setGated(true);
        if (data.upgrade) setUpgrade(data.upgrade);
        setCards(demoCards());
        return;
      }
      setGated(false);
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
        score: Number(c.score) || 0,
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
  }, [authFetch]);

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
    if (q.length < 2 || gated) return;
    const t = setTimeout(() => {
      authFetch(`/api/market/arb?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => {
          if (d.gated) return;
          const rows = (d.arbPlays || []).map(c => ({
            id: c.id, player: c.player, sport: c.sport, set: c.set,
            grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
            market: Number(c.market) || 0,
            lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
            confidence: c.confidence, thumbnail: c.thumbnail,
            rookie: c.rookie, sales7d: Number(c.sales7d) || 0,
            sales30d: Number(c.sales30d) || 0,
            gain7d: Math.abs(Number(c.gain7d)) <= 999 ? Number(c.gain7d) : 0,
            score: Number(c.score) || 0,
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
  }, [query, gated, authFetch]);

  // Refetch when the hydrated user turns out to be Pro (or just subscribed).
  useEffect(() => {
    if (gated && user?.plan === 'pro') { setLoading(true); fetchArbData(); }
  }, [user?.plan, gated, fetchArbData]);

  // ── Live Deals + My Alerts (Pro-only data) ──────────────────────────────
  useEffect(() => {
    if (view !== 'deals' || gated || loading || !token) return;
    let dead = false;
    authFetch('/api/market/live-deals')
      .then(r => r.json())
      .then(d => { if (!dead && !d.gated) { setLiveDeals(d.deals || []); setLiveLoaded(true); } })
      .catch(() => {});
    authFetch('/api/deal-alerts')
      .then(r => r.json())
      .then(d => { if (!dead && Array.isArray(d.alerts)) setAlerts(d.alerts); })
      .catch(() => {});
    return () => { dead = true; };
  }, [view, gated, loading, token, authFetch]);

  const flashAlertMsg = (m) => { setAlertMsg(m); setTimeout(() => setAlertMsg(''), 3500); };

  const createAlert = useCallback(async (body) => {
    try {
      const res = await authFetch('/api/deal-alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.alert) {
        setAlerts(prev => [d.alert, ...prev]);
        flashAlertMsg(`Alert “${d.alert.name}” saved — we'll email you when deals match.`);
        return true;
      }
      flashAlertMsg(d.error || 'Could not save alert');
    } catch { flashAlertMsg('Could not save alert'); }
    return false;
  }, [authFetch]);

  const deleteAlert = useCallback(async (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
    try { await authFetch(`/api/deal-alerts/${id}`, { method: 'DELETE' }); } catch {}
  }, [authFetch]);

  const toggleAlert = useCallback(async (id, active) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, active } : a));
    try {
      await authFetch(`/api/deal-alerts/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
      });
    } catch {}
  }, [authFetch]);

  // "Alert me about deals like this" — one tap from a top deal card.
  const quickAlert = useCallback((c) => {
    createAlert({
      name: `${c.player} deals`,
      playerQuery: c.player,
      budgetMin: budget.min > 0 ? budget.min : null,
      budgetMax: Number.isFinite(budget.max) ? budget.max : null,
      minScore: 0,
    }).then(ok => { if (ok) setAlertsOpen(true); });
  }, [createAlert, budget]);

  // Search narrows every desk surface (panels, heatmap, matrix) to matching
  // plays; the budget preset narrows by BUY price (the low ask).
  const visible = useMemo(() => {
    const q = query.trim();
    let list = q ? cards.filter(c => matchesArbQuery(c, q)) : cards;
    if (budget.key !== 'all') {
      list = list.filter(c => (c.lo || c.market || 0) >= budget.min && (c.lo || c.market || 0) <= budget.max);
    }
    return list;
  }, [cards, query, budget]);

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

  // The simple layer: top 6 deals, one per player for variety, real liquidity only.
  // Price band $50–$1,500 — deals normal buyers can actually act on (guards
  // against stale cached API data too; the backend enforces the same band).
  const topDeals = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of cardsWithEdge) {
      if (c.netEdge <= 0) continue;
      if ((c.market || 0) < 50 || (c.market || 0) > 1500) continue;
      if ((c.sales30d || 0) < 3) continue;
      if (seen.has(c.player)) continue;
      seen.add(c.player);
      out.push(c);
      if (out.length === 6) break;
    }
    return out;
  }, [cardsWithEdge]);

  const topGainer = gainers[0];
  const topLoser  = losers[0];
  const totalVolume = useMemo(() => visible.reduce((s, c) => s + (c.sales30d || 0), 0), [visible]);
  const netPlays = useMemo(() => cardsWithEdge.filter(c => c.netEdge > 0), [cardsWithEdge]);
  const avgNetEdge = useMemo(() => netPlays.length ? (netPlays.reduce((s, c) => s + c.netEdge, 0) / netPlays.length).toFixed(0) : '—', [netPlays]);

  // Gate logic: hydrated users go by plan; a stored token is treated
  // optimistically as allowed until /api/state hydrates (the API withholds
  // data server-side regardless, so nothing can leak in that window).
  const allowed = user ? hasCapability(user, 'dealfinder') : (!!token && !gated);

  return (
    <div style={{ background: '#080b12', minHeight: '60vh', padding: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.06)' }}>
      <ProGate
        page
        allowed={allowed}
        title="Deal Finder is a GEMLINE Pro feature"
        sub="The whole market scanned for cards priced below their going rate — fees counted, every deal scored, checked against live eBay listings."
        bullets={upgrade?.features || [
          'Deal Finder: every card priced below fair value, fees already counted',
          'GEMLINE Score (0–100) on every deal — edge, liquidity, and risk in one number',
          'Live Deals: underpriced eBay + GEMLINE listings you can buy right now',
          'Deal alerts by email — your budget, your players, your minimum score',
          'Our Track Record: how flagged deals actually performed',
        ]}
        price={`$${(upgrade?.priceMonthly ?? 7.99).toFixed(2)}/mo`}
        priceNote={`${upgrade?.trialDays ?? 7}-day free trial · cancel anytime`}
        cta={token ? (checkingOut ? 'Opening checkout…' : 'Start your 7-day free trial') : 'Create an account to start your free trial'}
        onUnlock={startCheckout}
      >

      {view === 'grading' && <WorthGrading onSelect={setSelected} />}

      {view === 'track' && <TrackRecord />}

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
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#E8B339', fontWeight: 700, letterSpacing: '.1em' }}>
            GEMLINE DEAL FINDER
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', letterSpacing: '.08em' }}>
            POWERED BY CARDHEDGE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>
            {cards.length.toLocaleString()} CARDS LOADED
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D88A', boxShadow: '0 0 6px #34D88A', animation: 'pulse 2s infinite' }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#34D88A' }}>LIVE</span>
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,.4)', letterSpacing: '.06em' }}>{now}</span>
          {(pricesUpdatedAt || lastUpdated) && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,.45)', letterSpacing: '.04em' }}>
              PRICES UPDATED {fmtAgo(pricesUpdatedAt || lastUpdated).toUpperCase()}
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

      {/* ── Jump chips (sticky in-page nav) ── */}
      <JumpChips />

      {/* ── Budget filter — narrows every panel below ── */}
      <BudgetBar budgetKey={budgetKey} onPick={pickBudget} />

      {/* ── My Deal Alerts ── */}
      <AlertsPanel
        alerts={alerts} open={alertsOpen} onToggleOpen={() => setAlertsOpen(o => !o)}
        onCreate={createAlert} onDelete={deleteAlert} onToggle={toggleAlert} msg={alertMsg}
      />

      {/* ── Today's Top Deals — the simple layer ── */}
      <TopDeals deals={topDeals} onSelect={setSelected} onAlert={quickAlert} />

      {/* ── Live Deals — GEMLINE + eBay cross-ref ── */}
      <LiveDeals deals={liveDeals} loaded={liveLoaded} budget={budget} />

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
      <div style={{ display: 'flex', gap: 6, padding: '10px 8px', background: '#080b12', flexWrap: 'wrap' }}>
        <StatBox label="CARDS SOLD · 30 DAYS" value={fmtNum(totalVolume)} sub="across the whole market" color="#5B8DEF" />
        <StatBox label="TOP GAINER · 7 DAYS" value={topGainer ? `+${topGainer.gain7d.toFixed(1)}%` : '—'} sub={topGainer?.player || ''} color="#34D88A" glow />
        <StatBox label="BIGGEST DROP · 7 DAYS" value={topLoser ? `${topLoser.gain7d.toFixed(1)}%` : '—'} sub={topLoser?.player || ''} color="#FF5C6C" glow />
        <StatBox label="AVG SAVINGS" value={avgNetEdge === '—' ? '—' : `$${avgNetEdge}`} sub={`across ${netPlays.length} live deals`} color="#E8B339" />
        <StatBox label="LIVE DEALS" value={netPlays.length} sub="priced below fair value, fees counted" color="#9B7BFF" />
      </div>

      {/* ── Main 4-panel grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gridAutoRows: '320px',
        gap: 10,
        padding: '4px 8px',
        background: '#080b12',
      }}>
        {/* Panel 1: Gainers */}
        <Panel id="df-movers" title="PRICE GAINERS · 7 DAYS" badgeColor="#34D88A" badge={`${gainers.length}`}
          help="Cards selling for more than they did a week ago.">
          <div style={{ overflowY: 'auto', height: '100%' }}>
            {gainers.map((c, i) => (
              <div key={c.id} onClick={() => setSelected(c)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer',
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', width: 16, textAlign: 'right' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.player}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{c.grader} {c.grade}</div>
                </div>
                <Spark vals={[50, 52, 49, 55, 53, 58, 57, 62, 60, 65]} up={true} />
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 700, color: '#34D88A' }}>+{c.gain7d.toFixed(1)}%</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)' }}>{fmtP(c.market)}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Panel 2: Losers */}
        <Panel title="PRICE DROPS · 7 DAYS" badgeColor="#FF5C6C" badge={`${losers.length}`}
          help="Cards getting cheaper. A chance to buy in low.">
          <div style={{ overflowY: 'auto', height: '100%' }}>
            {losers.map((c, i) => (
              <div key={c.id} onClick={() => setSelected(c)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer',
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', width: 16, textAlign: 'right' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.player}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{c.grader} {c.grade}</div>
                </div>
                <Spark vals={[65, 60, 62, 57, 55, 53, 50, 48, 45, 43]} up={false} />
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 700, color: '#FF5C6C' }}>{c.gain7d.toFixed(1)}%</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)' }}>{fmtP(c.market)}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Panel 3: Volume bars */}
        <Panel id="df-volume" title="MOST TRADED · 30 DAYS" badgeColor="#E8B339" badge="TOP 12"
          help="The cards changing hands the most right now.">
          <VolumeBars cards={byVolume} />
        </Panel>

        {/* Panel 4: Momentum heatmap */}
        <Panel id="df-heat" title="MOMENTUM HEATMAP" badgeColor="#9B7BFF" badge="7 DAY CHANGE"
          help="What's heating up and cooling off. Green is up, red is down. Tap a tile to open the card.">
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
      <div style={{ margin: '10px 8px 10px', height: 560 }}>
        <Panel
          id="df-board"
          title="DEAL BOARD"
          badgeColor="#E8B339"
          badge={`${netPlays.length} DEALS · FEES INCLUDED`}
          right="CLICK A COLUMN TO SORT · CLICK A ROW TO OPEN"
          help="Every live deal in one table: buy at the low price, and the gap to the going rate is yours after fees."
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
