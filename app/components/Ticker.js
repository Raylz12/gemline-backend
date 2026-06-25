'use client';
import { useState, useEffect, useRef } from 'react';
import { fmt } from '../lib/data';
import CardDetail from './CardDetail';

export default function Ticker() {
  const [tickerCards, setTickerCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef(null);

  // Fetch ticker-specific data: cheap cards with movement
  useEffect(() => {
    fetch('/api/market/feed?limit=200&sort=gain')
      .then(r => r.json())
      .then(data => {
        const feed = data.feed || [];
        const mapped = feed
          .filter(c => {
            const price = Number(c.marketPrice) || 0;
            return price > 0 && price <= 100;
          })
          .slice(0, 60)
          .map(c => ({
            id: c.cardId, player: c.player, sport: c.sport, set: c.set,
            grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
            market: Number(c.marketPrice) || 0, gain7d: Number(c.gain7d) || 0,
            thumbnail: c.thumbnail, lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
            sales7d: Number(c.sales7d) || 0, sales30d: Number(c.sales30d) || 0,
            rookie: c.rookie, confidence: c.confidence,
            cardhedge_id: c.cardhedge_id,
          }));
        setTickerCards(mapped);
      })
      .catch(() => {});
  }, []);

  const tape = tickerCards.length > 0
    ? tickerCards.map((c, i) => {
        const gain = c.gain7d || 0;
        const arrow = gain >= 0 ? '▲' : '▼';
        const cls = gain >= 0 ? 'up' : 'down';
        return (
          <span className="tk" key={i} onClick={(e) => { e.stopPropagation(); setPaused(true); setSelectedCard({...c, ini: (c.player||'').split(' ').map(w=>w[0]).join('').slice(0,4).toUpperCase(), theme: ['#2a2a2a','#555']}); setTimeout(() => setPaused(false), 5000); }}>
            <b>{c.player}</b>
            <span style={{ color: 'var(--muted)', fontSize: 10, margin: '0 2px' }}>{c.grader} {c.grade}</span>
            <span className="px mono">{fmt(c.market)}</span>
            <span className={`ch ${cls}`} style={{ fontWeight: 600 }}>
              {arrow}{gain >= 0 ? '+' : ''}{Number(gain).toFixed(1)}%
            </span>
          </span>
        );
      })
    : Array.from({ length: 8 }, (_, i) => (
        <span className="tk" key={i}><b>---</b><span className="px mono">$0</span><span className="ch muted">0%</span></span>
      ));

  return (
    <>
      <div className="ticker"
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setTimeout(() => setPaused(false), 3000)}>
        <div className="tag">LIVE TAPE</div>
        <div className="ticker-track" ref={trackRef}
          style={paused ? { animationPlayState: 'paused' } : {}}>
          {tape}
          {/* Duplicate for seamless loop */}
          {tape.map((el, i) => (
            <span key={`dup-${i}`} className="tk" onClick={(e) => {
              e.stopPropagation(); setPaused(true);
              if (tickerCards[i]) setSelectedCard({...tickerCards[i], ini: (tickerCards[i].player||'').split(' ').map(w=>w[0]).join('').slice(0,4).toUpperCase(), theme: ['#2a2a2a','#555']});
              setTimeout(() => setPaused(false), 5000);
            }}>{el.props.children}</span>
          ))}
        </div>
      </div>
      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
