'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { fmt } from '../lib/data';
import CardDetail from './CardDetail';

export default function Ticker() {
  const [tickerCards, setTickerCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [paused, setPaused] = useState(false);
  const pauseTimer = useRef(null);

  // Fetch a small, cheap slice — only cards with movement for the tape
  useEffect(() => {
    fetch('/api/market/feed?limit=60&sort=gain&page=1')
      .then(r => r.json())
      .then(data => {
        const feed = (data.feed || []).filter(c => {
          const price = Number(c.marketPrice) || 0;
          const gain = Number(c.gain7d) || 0;
          // Sanity: skip thin-sale garbage moves (±10,000%) that make the tape look broken
          return price >= 5 && price <= 2000 && Math.abs(gain) <= 500 && gain !== 0;
        }).slice(0, 50);
        setTickerCards(feed.map(c => ({
          id: c.cardId,
          player: c.player,
          sport: c.sport,
          set: c.set,
          grader: c.grader,
          grade: c.grade,
          year: c.year,
          variant: c.variant,
          market: Number(c.marketPrice) || 0,
          gain7d: Number(c.gain7d) || 0,
          thumbnail: c.thumbnail,
          lo: Number(c.lo) || 0,
          hi: Number(c.hi) || 0,
          sales7d: Number(c.sales7d) || 0,
          sales30d: Number(c.sales30d) || 0,
          rookie: c.rookie,
          confidence: c.confidence,
          cardhedge_id: c.cardhedge_id,
          ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase(),
          theme: ['#2a2a2a', '#555'],
        })));
      })
      .catch(() => {});
  }, []);

  const openCard = useCallback((card) => {
    clearTimeout(pauseTimer.current);
    setPaused(true);
    setSelectedCard(card);
    pauseTimer.current = setTimeout(() => setPaused(false), 5000);
  }, []);

  const resumeAfterTouch = useCallback(() => {
    clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => setPaused(false), 3000);
  }, []);

  // Clean up timer on unmount
  useEffect(() => () => clearTimeout(pauseTimer.current), []);

  const tape = tickerCards.length > 0
    ? tickerCards.map((c, i) => {
        const gain = c.gain7d || 0;
        const arrow = gain >= 0 ? '▲' : '▼';
        const cls = gain >= 0 ? 'up' : 'down';
        return (
          <span className="tk" key={i} onClick={() => openCard(c)}>
            <b>{c.player}</b>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{[c.grader, c.grade].filter(Boolean).join(' ')}</span>
            <span className="px">{fmt(c.market)}</span>
            <span className={`ch ${cls}`}>
              {arrow}{gain >= 0 ? '+' : ''}{Number(gain).toFixed(1)}%
            </span>
            <span className="sep">·</span>
          </span>
        );
      })
    : Array.from({ length: 8 }, (_, i) => (
        <span className="tk" key={i}>
          <b style={{ color: 'rgba(255,255,255,0.3)' }}>Loading…</b>
          <span className="sep">·</span>
        </span>
      ));

  return (
    <>
      <div
        className="ticker"
        onTouchStart={() => { clearTimeout(pauseTimer.current); setPaused(true); }}
        onTouchEnd={resumeAfterTouch}
      >
        <div className="tag">LIVE TAPE</div>
        <div
          className="ticker-track"
          style={paused ? { animationPlayState: 'paused' } : {}}
        >
          {tape}
          {/* Duplicate for seamless loop */}
          {tape}
        </div>
      </div>
      {selectedCard && (
        <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />
      )}
    </>
  );
}
