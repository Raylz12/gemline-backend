'use client';
// "Worth Grading?" — the collector question: is this raw card worth sending in?
// Entirely from our own price guide: Raw vs PSA 10 / PSA 9 tier prices per
// family. User sets the grading cost; we show net profit + ROI at both grades.
// No pop/gem-rate guessing — we don't hold that data yet (future enhancement).
import { useEffect, useMemo, useState } from 'react';
import CardThumb from './CardThumb';

const fmtP = (n) => {
  if (n == null || !isFinite(n)) return '—';
  const v = Number(n);
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 100) return '$' + Math.round(v);
  return '$' + v.toFixed(2);
};
const fmtNet = (n) => (n >= 0 ? '+' : '\u2212') + fmtP(Math.abs(n)).slice(0);

const CHIPS = [
  { key: 'all', label: 'All candidates', hint: 'Raw + PSA 10 priced in our guide' },
  { key: 'safe', label: '🛡 Safe Grades', hint: 'Still profitable even if it comes back a PSA 9' },
  { key: 'longshot', label: '🎯 Long Shots', hint: 'Big PSA 10 payoff — but a 9 loses money' },
  { key: 'quick', label: '⚡ Quick Wins', hint: 'Cheap raws ($25 or less) with fast ROI' },
];
const SPORTS = ['All', 'Basketball', 'Football', 'Baseball', 'Pokemon', 'Hockey', 'Soccer'];

export default function WorthGrading({ onSelect }) {
  const [sport, setSport] = useState('All');
  const [raw, setRaw] = useState(null); // null = loading
  const [cost, setCost] = useState(25);
  const [chip, setChip] = useState('all');
  const [sortBy, setSortBy] = useState('roi');
  const [shown, setShown] = useState(40);

  useEffect(() => {
    let dead = false;
    setRaw(null);
    fetch(`/api/market/worth-grading?sport=${encodeURIComponent(sport)}`)
      .then(r => r.json())
      .then(d => { if (!dead) setRaw(d.candidates || []); })
      .catch(() => { if (!dead) setRaw([]); });
    return () => { dead = true; };
  }, [sport]);

  const g = Math.max(0, Number(cost) || 0);
  const rows = useMemo(() => {
    if (!raw) return null;
    const enriched = raw.map(c => {
      const net10 = c.psa10 - c.raw - g;
      const net9 = c.psa9 != null ? c.psa9 - c.raw - g : null;
      const outlay = c.raw + g;
      const roi10 = outlay > 0 ? (net10 / outlay) * 100 : 0;
      return { ...c, net10, net9, roi10 };
    }).filter(c => c.net10 > 0);
    let filtered = enriched;
    if (chip === 'safe') filtered = enriched.filter(c => c.net9 != null && c.net9 > 0);
    else if (chip === 'longshot') filtered = enriched.filter(c => c.roi10 >= 150 && (c.net9 == null || c.net9 < 0));
    else if (chip === 'quick') filtered = enriched.filter(c => c.raw <= 25 && c.roi10 >= 100);
    return [...filtered].sort((a, b) => {
      if (sortBy === 'profit') return b.net10 - a.net10;
      if (sortBy === 'price') return a.raw - b.raw;
      return b.roi10 - a.roi10;
    });
  }, [raw, g, chip, sortBy]);

  useEffect(() => { setShown(40); }, [chip, sortBy, sport]);

  const activeChip = CHIPS.find(c => c.key === chip);

  return (
    <div style={{ padding: '8px' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '4px 4px 10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.06em' }}>
          GRADING COST
          <span style={{ display: 'inline-flex', alignItems: 'center', background: '#0d1117', border: '1px solid rgba(255,255,255,.12)', borderRadius: 4, padding: '0 0 0 8px' }}>
            <span style={{ color: '#E8B339', fontSize: 12 }}>$</span>
            <input type="number" min="0" max="500" value={cost}
              onChange={e => setCost(e.target.value)}
              style={{ width: 56, padding: '6px 8px 6px 3px', background: 'transparent', border: 'none', outline: 'none', color: '#E8B339', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700 }} />
          </span>
        </label>
        <select value={sport} onChange={e => setSport(e.target.value)}
          style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', background: '#0d1117', border: '1px solid rgba(255,255,255,.12)', borderRadius: 4, color: 'var(--txt)' }}>
          {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', background: '#0d1117', border: '1px solid rgba(255,255,255,.12)', borderRadius: 4, color: 'var(--txt)' }}>
          <option value="roi">Sort: ROI</option>
          <option value="profit">Sort: Profit @ 10</option>
          <option value="price">Sort: Cheapest raw</option>
        </select>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', letterSpacing: '.06em' }}>
          {rows ? `${rows.length.toLocaleString()} CANDIDATES` : 'LOADING…'} · OUR PRICE GUIDE · SELLING FEES NOT INCLUDED
        </span>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 4px 8px' }}>
        {CHIPS.map(c => (
          <button key={c.key} onClick={() => setChip(c.key)} title={c.hint}
            style={{
              padding: '6px 13px', fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)', letterSpacing: '.03em',
              borderRadius: 999, cursor: 'pointer', transition: '.15s',
              border: '1px solid', borderColor: chip === c.key ? 'rgba(232,179,57,.55)' : 'rgba(255,255,255,.1)',
              background: chip === c.key ? 'rgba(232,179,57,.12)' : '#0d1117',
              color: chip === c.key ? '#E8B339' : 'var(--muted)',
            }}>{c.label}</button>
        ))}
      </div>
      {activeChip && chip !== 'all' && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', padding: '0 6px 10px' }}>{activeChip.hint} — at ${g} grading cost</div>
      )}

      {/* Column header (desktop) */}
      <div className="wg-head" style={{ display: 'flex', gap: 8, padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.1em', color: 'var(--dim)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <span style={{ flex: '1 1 200px' }}>Card (raw)</span>
        <span style={{ width: 70, textAlign: 'right' }}>Raw</span>
        <span style={{ width: 70, textAlign: 'right' }}>PSA 10</span>
        <span style={{ width: 70, textAlign: 'right' }}>PSA 9</span>
        <span style={{ width: 84, textAlign: 'right' }}>Net @ 10</span>
        <span style={{ width: 84, textAlign: 'right' }}>Net @ 9</span>
        <span style={{ width: 64, textAlign: 'right' }}>ROI</span>
      </div>

      {/* Rows */}
      {rows === null ? (
        <div style={{ padding: 30, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>PRICING THE SUBMISSION BOX…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>
          NOTHING CLEARS ${g} GRADING COST HERE — TRY A LOWER COST OR ANOTHER FILTER
        </div>
      ) : (
        <>
          {rows.slice(0, shown).map(c => (
            <div key={c.cardhedgeId} className="wg-row" onClick={() => onSelect?.({ id: c.cardId })}
              style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.04)', cursor: 'pointer' }}>
              <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CardThumb src={c.thumbnail} name={c.player} sport={c.sport} width={30} height={40} radius={3} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.player}
                    {c.rookie ? <span style={{ fontSize: 8, background: '#E8B339', color: '#000', borderRadius: 2, padding: '1px 3px', marginLeft: 4 }}>RC</span> : null}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[(c.year && !String(c.set || '').startsWith(String(c.year))) ? c.year : null, c.set, c.variant, c.number && `#${c.number}`].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <span className="wg-stat" data-l="Raw" style={{ width: 70, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt)', fontWeight: 600 }}>{fmtP(c.raw)}</span>
              <span className="wg-stat" data-l="PSA 10" style={{ width: 70, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, color: '#34D88A', fontWeight: 700 }}>{fmtP(c.psa10)}</span>
              <span className="wg-stat" data-l="PSA 9" style={{ width: 70, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{fmtP(c.psa9)}</span>
              <span className="wg-stat" data-l="Net @10" style={{ width: 84, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: c.net10 >= 0 ? '#34D88A' : '#FF5C6C' }}>{fmtNet(c.net10)}</span>
              <span className="wg-stat" data-l="Net @9" style={{ width: 84, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: c.net9 == null ? 'var(--dim)' : c.net9 >= 0 ? '#34D88A' : '#FF5C6C' }}>{c.net9 == null ? '—' : fmtNet(c.net9)}</span>
              <span className="wg-stat" data-l="ROI" style={{ width: 64, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 800, color: '#E8B339' }}>{Math.round(c.roi10)}%</span>
            </div>
          ))}
          {rows.length > shown && (
            <div style={{ textAlign: 'center', padding: 14 }}>
              <button onClick={() => setShown(s => s + 40)}
                style={{ padding: '8px 22px', fontSize: 11, fontFamily: 'var(--mono)', background: '#0d1117', border: '1px solid rgba(255,255,255,.12)', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer' }}>
                SHOW MORE ({(rows.length - shown).toLocaleString()} LEFT)
              </button>
            </div>
          )}
        </>
      )}

      <p style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--dim)', padding: '12px 6px 4px', letterSpacing: '.04em', lineHeight: 1.6 }}>
        NET = GRADE PRICE − RAW PRICE − ${g} GRADING COST. ASSUMES THE CARD GEMS — CONDITION IS YOUR CALL.
        POP REPORTS &amp; GEM RATES: COMING SOON (WE DON&apos;T GUESS).
      </p>

      <style>{`
        @media (max-width: 720px) {
          .wg-head { display: none !important; }
          .wg-row { flex-wrap: wrap; row-gap: 6px; }
          .wg-row > div:first-child { flex: 1 1 100%; }
          .wg-stat { width: auto !important; flex: 1 1 30%; text-align: left !important; }
          .wg-stat::before { content: attr(data-l); display: block; font-size: 8px; letter-spacing: .1em; color: var(--dim); text-transform: uppercase; margin-bottom: 1px; }
        }
      `}</style>
    </div>
  );
}
