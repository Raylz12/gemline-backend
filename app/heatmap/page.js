'use client';
import { useState, useEffect } from 'react';
import Heatmap from '../components/Heatmap';
import CardDetail from '../components/CardDetail';

export default function HeatmapPage() {
  const [cards, setCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/market/heatmap')
      .then(r => r.json())
      .then(data => {
        const mapped = (data.cards || []).map(c => ({
          id: c.cardId, player: c.player, sport: c.sport, set: c.set,
          grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
          num: c.num, market: Number(c.marketPrice) || 0,
          lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
          confidence: c.confidence, thumbnail: c.thumbnail || c.image_url,
          rookie: c.rookie, sales7d: Number(c.sales_7d) || 0,
          sales30d: Number(c.sales_30d) || 0, gain7d: Number(c.gain_7d) || 0,
        }));
        setCards(mapped);
      })
      .catch(err => console.error('Heatmap fetch error:', err))
      .finally(() => setLoading(false));
  }, []);

  const hotCards = cards.filter(c => c.market > 0);

  return (
    <>
      <div className="eyebrow">Market Heatmap</div>
      <h1 className="page">7-Day Price Movement</h1>
      <p className="sub">
        Top 100 movers by price change and volume. Tile size = 30-day volume. Color = 7-day gain.
        {!loading && ` ${hotCards.length} active cards tracked.`}
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>Loading heatmap data...</div>
      ) : (
        <Heatmap cards={hotCards} onSelect={setSelectedCard} />
      )}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
