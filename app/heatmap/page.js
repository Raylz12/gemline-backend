'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import CardDetail from '../components/CardDetail';
import useDarkPage from '../lib/useDarkPage';

const SPORT_TABS = ['All', 'Basketball', 'Baseball', 'Football', 'Pokemon', 'Other'];
const SORT_OPTIONS = [
  { value: 'gainers', label: 'Biggest Gainers' },
  { value: 'losers', label: 'Biggest Losers' },
  { value: 'volume', label: 'Most Volume' },
  { value: 'value', label: 'Highest Value' },
];

function pctColor(gain7d) {
  if (gain7d === null || gain7d === undefined) return 'rgba(255,255,255,.05)';
  const clamped = Math.max(-25, Math.min(25, gain7d));
  if (clamped >= 0) {
    const t = clamped / 25;
    return `rgba(52,216,138,${0.12 + t * 0.55})`;
  } else {
    const t = (-clamped) / 25;
    return `rgba(255,92,108,${0.12 + t * 0.55})`;
  }
}

function fmt(n) {
  if (!n || isNaN(n)) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return '$' + Number(n).toFixed(2);
}

function HeatCard({ c, onClick }) {
  const gain = typeof c.gain7d === 'number' ? c.gain7d : 0;
  const absGain = Math.abs(gain);
  const showGain = absGain > 0 && absGain <= 999;
  const t = Math.min(absGain / 60, 1); // intensity scales with move magnitude
  const alpha = 0.12 + t * 0.42;
  const bg = !showGain ? 'var(--panel-2)'
    : gain > 0 ? `rgba(22,199,132,${alpha})`
    : `rgba(239,68,68,${alpha})`;
  const border = !showGain ? 'var(--line)'
    : gain > 0 ? `rgba(22,199,132,${0.25 + t * 0.4})`
    : `rgba(239,68,68,${0.25 + t * 0.4})`;

  return (
    <div className="hm2-tile" onClick={() => onClick(c)} style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="hm2-main">
        <div className="hm2-player">{c.player}</div>
        <div className="hm2-meta">
          {[c.grader && `${c.grader} ${c.grade || ''}`.trim(), c.year].filter(Boolean).join(' · ')}
          {c.sales7d > 0 ? ` · ${c.sales7d} sold 7d` : c.sales30d > 0 ? ` · ${c.sales30d} sold 30d` : ''}
        </div>
      </div>
      <div className="hm2-foot">
        <span className="hm2-price">{fmt(c.market)}</span>
        {showGain ? (
          <span className="hm2-pct" style={{ color: gain >= 0 ? '#3ee6a0' : '#ff8093' }}>
            {gain >= 0 ? '+' : ''}{gain.toFixed(1)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function HeatmapPage() {
  useDarkPage();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sport, setSport] = useState('All');
  const [sort, setSort] = useState('gainers');
  const [selectedCard, setSelectedCard] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/market/heatmap');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const mapped = (data.cards || []).map(c => ({
        id: c.cardId,
        player: c.player,
        sport: c.sport,
        set: c.set,
        year: c.year,
        grader: c.grader,
        grade: c.grade,
        variant: c.variant,
        market: Number(c.marketPrice) || 0,
        lo: Number(c.lo) || 0,
        hi: Number(c.hi) || 0,
        gain7d: Number(c.gain_7d || c.gain7d) || 0,
        sales7d: Number(c.sales_7d || c.sales7d) || 0,
        sales30d: Number(c.sales_30d || c.sales30d) || 0,
        confidence: c.confidence,
        thumbnail: c.thumbnail || c.image_url,
        rookie: c.rookie,
        cardhedge_id: c.cardhedge_id,
        ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase(),
        theme: ['#2a2a2a', '#555'],
      }));
      setCards(mapped);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError('Failed to load heatmap data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  // Filter + sort
  const displayed = (() => {
    let pool = cards.filter(c => c.market > 0);

    if (sport !== 'All') {
      if (sport === 'Other') {
        const mainSports = ['Basketball', 'Baseball', 'Football', 'Pokemon'];
        pool = pool.filter(c => !mainSports.includes(c.sport));
      } else {
        pool = pool.filter(c => (c.sport || '').toLowerCase() === sport.toLowerCase());
      }
    }

    // Guard: remove absurd % changes before sorting
    const safe = (c) => Math.abs(c.gain7d) <= 999;

    switch (sort) {
      case 'gainers':
        return pool.filter(c => safe(c) && c.gain7d > 0).sort((a, b) => b.gain7d - a.gain7d).slice(0, 80);
      case 'losers':
        return pool.filter(c => safe(c) && c.gain7d < 0).sort((a, b) => a.gain7d - b.gain7d).slice(0, 80);
      case 'volume':
        return pool.sort((a, b) => (b.sales7d + b.sales30d) - (a.sales7d + a.sales30d)).slice(0, 80);
      case 'value':
        return pool.sort((a, b) => b.market - a.market).slice(0, 80);
      default:
        return pool.slice(0, 80);
    }
  })();

  const openCard = (c) => setSelectedCard(c);

  const secondsAgo = lastUpdated
    ? Math.round((Date.now() - lastUpdated.getTime()) / 1000)
    : null;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="eyebrow">Market Heatmap</div>
          <h1 className="page" style={{ marginBottom: 4 }}>Price Movers</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {secondsAgo !== null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
              Updated {secondsAgo < 5 ? 'just now' : `${secondsAgo}s ago`}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Sport tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {SPORT_TABS.map(s => (
          <button
            key={s}
            onClick={() => setSport(s)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: sport === s ? 'var(--gold)' : 'var(--panel-2)',
              color: sport === s ? '#000' : 'var(--muted)',
              border: `1px solid ${sport === s ? 'var(--gold)' : 'var(--line)'}`,
              transition: 'all .12s',
            }}
          >{s}</button>
        ))}
      </div>

      {/* Sort options */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSort(opt.value)}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: sort === opt.value ? 'var(--violet)' : 'var(--panel-2)',
              color: sort === opt.value ? '#fff' : 'var(--muted)',
              border: `1px solid ${sort === opt.value ? 'var(--violet)' : 'var(--line)'}`,
              transition: 'all .12s',
            }}
          >{opt.label}</button>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
        <span>Color intensity = price movement magnitude</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'rgba(255,92,108,.7)' }} /> Decline
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'rgba(52,216,138,.7)' }} /> Gain
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⬛⬛⬛</div>
          Loading heatmap data...
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--down)' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
          {error}
          <div style={{ marginTop: 12 }}>
            <button onClick={fetchData} style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
          No cards with price movement data in this view.
        </div>
      ) : (
        <div className="hm2-grid">
          {displayed.map(c => (
            <HeatCard key={c.id} c={c} onClick={openCard} />
          ))}
        </div>
      )}

      {displayed.length > 0 && !loading && (
        <div style={{ marginTop: 16, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>
          {displayed.length} cards · Auto-refreshes every 60s
        </div>
      )}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
