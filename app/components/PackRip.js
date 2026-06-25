'use client';
import { useState, useCallback } from 'react';
import { SPORT_THEME } from '../lib/data';

const PACK_TYPES = [
  { name: 'Standard Pack', cost: 15, cards: 6, desc: '6 RANDOM CARDS', icon: 'G' },
  { name: 'Premium Pack', cost: 30, cards: 6, desc: '6 CARDS · GUARANTEED HIT', icon: '★' },
  { name: 'Elite Pack', cost: 75, cards: 9, desc: '9 CARDS · 2+ HITS', icon: '◆' },
];

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + Number(n).toFixed(2);
}

export default function PackRip({ allCards, onSelect }) {
  const [packType, setPackType] = useState(0);
  const [phase, setPhase] = useState('pick'); // pick | ripping | reveal
  const [packCards, setPackCards] = useState([]);
  const [flipped, setFlipped] = useState(new Set());
  const [hitText, setHitText] = useState('');

  const rip = useCallback(() => {
    // Pick random cards from allCards with prices
    const priced = allCards.filter(c => c.market > 0 && c.thumbnail);
    if (priced.length < 6) return;

    const pack = PACK_TYPES[packType];
    const count = pack.cards;
    
    // Weighted random — higher priced cards are rarer
    const shuffled = [...priced].sort(() => Math.random() - 0.5);
    
    // For premium/elite, guarantee at least one "hit" (card > $50)
    const hits = priced.filter(c => c.market >= 50);
    const commons = priced.filter(c => c.market < 50);
    
    let selected = [];
    if (packType >= 1 && hits.length > 0) {
      // Guaranteed hits
      const numHits = packType === 2 ? Math.min(2, hits.length) : 1;
      const hitPicks = [...hits].sort(() => Math.random() - 0.5).slice(0, numHits);
      const commonPicks = [...commons].sort(() => Math.random() - 0.5).slice(0, count - numHits);
      selected = [...hitPicks, ...commonPicks].sort(() => Math.random() - 0.5);
    } else {
      selected = shuffled.slice(0, count);
    }

    setPackCards(selected);
    setPhase('ripping');
    setFlipped(new Set());
    setHitText('');

    setTimeout(() => setPhase('reveal'), 600);
  }, [allCards, packType]);

  const flipCard = (idx) => {
    if (flipped.has(idx)) return;
    const next = new Set(flipped);
    next.add(idx);
    setFlipped(next);

    const card = packCards[idx];
    if (card.market >= 100) {
      setHitText(`🔥 HIT! ${card.player} — ${fmtP(card.market)}`);
    } else if (card.market >= 50) {
      setHitText(`⚡ Nice pull! ${card.player}`);
    }
  };

  const flipAll = () => {
    const all = new Set(packCards.map((_, i) => i));
    setFlipped(all);
    const best = [...packCards].sort((a, b) => b.market - a.market)[0];
    if (best.market >= 50) {
      setHitText(`🔥 Best pull: ${best.player} — ${fmtP(best.market)}`);
    }
  };

  const reset = () => {
    setPhase('pick');
    setPackCards([]);
    setFlipped(new Set());
    setHitText('');
  };

  return (
    <div className="pack-stage">
      {phase === 'pick' && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            {PACK_TYPES.map((p, i) => (
              <div key={i}
                onClick={() => setPackType(i)}
                style={{
                  padding: '14px 20px', borderRadius: 12, cursor: 'pointer',
                  border: `1px solid ${i === packType ? 'var(--gold)' : 'var(--line)'}`,
                  background: i === packType ? 'var(--gold-soft)' : 'var(--panel)',
                  textAlign: 'center', minWidth: 130,
                }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{p.icon}</div>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{p.desc}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)', marginTop: 6 }}>◈ {p.cost} credits</div>
              </div>
            ))}
          </div>

          <div className={`pack-wrap`} onClick={rip}>
            <div className="pack-foil">
              <div className="pl">{PACK_TYPES[packType].icon}</div>
              <div className="pt">{PACK_TYPES[packType].name}</div>
              <div className="ps">{PACK_TYPES[packType].desc}</div>
              <div className="riplabel">TAP TO RIP</div>
            </div>
          </div>
        </>
      )}

      {phase === 'ripping' && (
        <div className="pack-wrap ripping">
          <div className="pack-foil">
            <div className="pl">{PACK_TYPES[packType].icon}</div>
            <div className="pt">Opening...</div>
          </div>
        </div>
      )}

      {phase === 'reveal' && (
        <>
          <div className={`hit-banner ${hitText ? 'on' : ''}`}>{hitText}</div>
          
          <div className="pack-reveal on">
            {packCards.map((c, idx) => {
              const isFlipped = flipped.has(idx);
              const isHit = c.market >= 50;
              const theme = SPORT_THEME[c.sport] || ['#2a2a2a', '#555'];
              const ini = (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();

              return (
                <div key={idx} className={`pcard ${isFlipped ? 'flip' : ''} ${isFlipped && isHit ? 'hit' : ''}`}
                  onClick={() => isFlipped ? onSelect?.(c) : flipCard(idx)}>
                  <div className="pcard-inner">
                    <div className="face pf-back">G</div>
                    <div className="face pf-front" style={{ '--cardbg': `linear-gradient(135deg,${theme[0]},${theme[1]})` }}>
                      {c.thumbnail && (
                        <img src={c.thumbnail} alt="" style={{
                          position: 'absolute', inset: 0, width: '100%', height: '100%',
                          objectFit: 'contain', zIndex: 1, borderRadius: 9,
                        }} />
                      )}
                      {isHit && <div className="foil2" />}
                      <div style={{ position: 'relative', zIndex: 2, background: 'rgba(0,0,0,.6)', borderRadius: 6, padding: '4px 6px', marginTop: 'auto' }}>
                        <div className="nm">{c.player}</div>
                        <div className="pr">{fmtP(c.market)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pack-actions">
            {flipped.size < packCards.length && (
              <button className="btn-ghost" onClick={flipAll} style={{ fontSize: 12 }}>Flip All</button>
            )}
            <button className="btn-primary" onClick={reset} style={{ fontSize: 12 }}>Rip Another</button>
          </div>
        </>
      )}
    </div>
  );
}
