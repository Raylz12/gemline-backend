'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import CardDetail from '../components/CardDetail';
import useDarkPage from '../lib/useDarkPage';

const PAGE = 100;
const SORT_OPTIONS = [
  { value: 'movers', label: 'Biggest Moves' },
  { value: 'gainers', label: 'Gainers' },
  { value: 'losers', label: 'Losers' },
  { value: 'volume', label: 'Sales Volume' },
  { value: 'value', label: 'Price' },
];

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
          {c.grader && <span className="mchip mchip-grade" style={{ marginRight: 5 }}>{`${c.grader} ${c.grade || ''}`.trim()}</span>}
          {c.year}
          {c.sales7d > 0 ? `\u2002${c.sales7d} sold 7d` : c.sales30d > 0 ? `\u2002${c.sales30d} sold 30d` : ''}
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

const mapCard = (c) => ({
  id: c.cardId,
  player: c.player,
  sport: c.sport,
  set: c.set,
  year: c.year,
  grader: c.grader,
  grade: c.grade,
  variant: c.variant,
  num: c.num,
  market: Number(c.marketPrice) || 0,
  lo: Number(c.lo) || 0,
  hi: Number(c.hi) || 0,
  gain7d: Number(c.gain_7d ?? c.gain7d) || 0,
  sales7d: Number(c.sales_7d ?? c.sales7d) || 0,
  sales30d: Number(c.sales_30d ?? c.sales30d) || 0,
  confidence: c.confidence,
  thumbnail: c.thumbnail || c.image_url,
  rookie: c.rookie,
  cardhedge_id: c.cardhedge_id,
  ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase(),
  theme: ['#2a2a2a', '#555'],
});

export default function HeatmapPage() {
  useDarkPage();
  const [cards, setCards] = useState([]);
  const [total, setTotal] = useState(0);
  const [sports, setSports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [sport, setSport] = useState('All');
  const [sort, setSort] = useState('movers');
  const [selectedCard, setSelectedCard] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const offsetRef = useRef(0);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async ({ append = false, sportOverride, sortOverride } = {}) => {
    const sp = sportOverride ?? sport;
    const so = sortOverride ?? sort;
    const offset = append ? offsetRef.current : 0;
    try {
      if (append) setLoadingMore(true);
      const params = new URLSearchParams({ sort: so, limit: PAGE, offset });
      if (sp && sp !== 'All') params.set('sport', sp);
      const res = await fetch(`/api/market/heatmap?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const mapped = (data.cards || []).map(mapCard);
      setCards(prev => (append ? [...prev, ...mapped] : mapped));
      setTotal(Number(data.total) || mapped.length);
      if (Array.isArray(data.sports) && data.sports.length) setSports(data.sports);
      offsetRef.current = offset + mapped.length;
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError('Failed to load heatmap data');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sport, sort]);

  // Initial + on filter change
  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [sport, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh first page only (don't yank the rug after load-more)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (offsetRef.current <= PAGE) fetchData();
    }, 60_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  const sportTabs = ['All', ...sports];
  const hasMore = cards.length < total;

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

      {/* Sport tabs — real sports from the live pool */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {sportTabs.map(s => (
          <button
            key={s}
            onClick={() => setSport(s)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: sport === s ? 'var(--gold)' : 'var(--panel-2)',
              color: sport === s ? '#000' : 'var(--muted)',
              border: `1px solid ${sport === s ? 'var(--gold)' : 'var(--line)'}`,
              transition: 'all .12s', minHeight: 32,
            }}
          >{s}</button>
        ))}
      </div>

      {/* Sort options */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
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
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginLeft: 4 }}>7-day window</span>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', flexWrap: 'wrap' }}>
        <span>Color intensity = price movement magnitude</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'rgba(255,92,108,.7)' }} /> Decline
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'rgba(52,216,138,.7)' }} /> Gain
        </span>
      </div>

      {loading ? (
        <div className="hm2-grid">
          {[...Array(24)].map((_, i) => <div key={i} style={{ height: 86, background: 'var(--panel-2)', borderRadius: 8, opacity: 0.5 }} />)}
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--down)' }}>
          {error}
          <div style={{ marginTop: 12 }}>
            <button onClick={() => { setLoading(true); fetchData(); }} style={{ padding: '8px 18px', borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        </div>
      ) : cards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
          No cards with validated price movement in this view — try another sport or sort.
        </div>
      ) : (
        <>
          <div className="hm2-grid">
            {cards.map(c => (
              <HeatCard key={c.id} c={c} onClick={setSelectedCard} />
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '18px 0 4px' }}>
              <button onClick={() => fetchData({ append: true })} disabled={loadingMore}
                style={{ padding: '11px 28px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--txt)', cursor: loadingMore ? 'wait' : 'pointer', minHeight: 44 }}>
                {loadingMore ? 'Loading…' : `Load more (${cards.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}

      {cards.length > 0 && !loading && (
        <div style={{ marginTop: 14, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>
          {cards.length} of {total} liquid movers · Auto-refreshes every 60s
        </div>
      )}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
