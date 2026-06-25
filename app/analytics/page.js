'use client';
import { useState, useEffect } from 'react';
import Heatmap from '../components/Heatmap';
import CardDetail from '../components/CardDetail';
import ArbitrageContent from '../components/ArbitrageContent';

export default function AnalyticsPage() {
  const [tab, setTab] = useState('heatmap');
  const [selectedCard, setSelectedCard] = useState(null);
  const [heatmapCards, setHeatmapCards] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch heatmap data from dedicated endpoint
  useEffect(() => {
    fetch('/api/market/heatmap')
      .then(r => r.json())
      .then(data => {
        const mapped = (data.cards || []).map(c => {
          const ini = (c.player || '').split(' ').map(w => w[0]).join('').slice(0,4).toUpperCase();
          return {
            id: c.cardId, player: c.player, sport: c.sport, set: c.set,
            grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
            num: c.num, market: Number(c.marketPrice) || 0,
            lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
            confidence: c.confidence, thumbnail: c.thumbnail || c.image_url,
            rookie: c.rookie, sales7d: Number(c.sales_7d) || 0,
            sales30d: Number(c.sales_30d) || 0, gain7d: Number(c.gain_7d) || 0,
            cardhedge_id: c.cardhedge_id, ini, theme: ['#2a2a2a', '#555'],
          };
        });
        setHeatmapCards(mapped);
      })
      .catch(err => console.error('Heatmap fetch error:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="eyebrow">Analytics</div>
      <h1 className="page">Market Intelligence</h1>
      <p className="sub">Heatmaps, price spreads, and momentum — all the data you need to find the edge.</p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 18, marginTop: 16, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
        <button className={`live-tab ${tab === 'heatmap' ? 'on' : ''}`} onClick={() => setTab('heatmap')}>
          🗺️ Heatmap
        </button>
        <button className={`live-tab ${tab === 'arbitrage' ? 'on' : ''}`} onClick={() => setTab('arbitrage')}>
          📈 Arbitrage
        </button>
      </div>

      {tab === 'heatmap' && (
        <>
          <p className="sub" style={{ marginBottom: 16 }}>
            Tile size reflects market value. Color shows 7-day price change. Green = gaining, Red = losing.
            {!loading && ` ${heatmapCards.length} active cards tracked.`}
          </p>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading heatmap data...</div>
          ) : (
            <Heatmap cards={heatmapCards} onSelect={setSelectedCard} />
          )}
        </>
      )}

      {tab === 'arbitrage' && (
        <ArbitrageContent onSelectCard={setSelectedCard} />
      )}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
