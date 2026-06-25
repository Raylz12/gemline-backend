'use client';
import { fmtDisplay, fmtRange, fmt } from '../lib/data';
import { useCardStore } from './CardStore';

export default function CardItem({ card: c, onClick }) {
  const { watch, toggleWatch } = useCardStore();
  const w = watch.has(String(c.id));

  const confBadge = c.confidence ? (
    <span className={`conf-badge conf-${c.confidence.toLowerCase()}`}>CH {c.confidence}</span>
  ) : null;

  const isRC = (c.variant || '').toLowerCase().includes('rc') || 
               (c.variant || '').toLowerCase().includes('rookie') ||
               (c.set || '').toLowerCase().includes('rookie');

  return (
    <article className="card" data-id={c.id} onClick={() => onClick?.(c)}>
      <button className={`watch ${w ? 'on' : ''}`} onClick={e => { e.stopPropagation(); toggleWatch(c.id); }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill={w ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
          <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.7 0-3 .9-4 2-1-1.1-2.3-2-4-2A5.5 5.5 0 0 0 3 8.5c0 2.3 1.5 4 3 5.5l6 6Z" />
        </svg>
      </button>

      {/* Listing badges */}
      {c.hasListing && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 3,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
            padding: '3px 7px', borderRadius: 5,
            background: 'var(--gold)', color: '#000',
            letterSpacing: '.04em',
          }}>
            FOR SALE · {fmtDisplay(c.lowestListingPrice)}
          </span>
          {c.hasOffers && (
            <span style={{
              fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
              background: 'rgba(155,123,255,.2)', color: 'var(--violet)',
            }}>
              MAKE OFFER
            </span>
          )}
        </div>
      )}

      <div className="card-img-box">
        {c.thumbnail ? (
          <img src={c.thumbnail} alt={c.player} className="card-thumb" loading="lazy" 
               onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
        ) : null}
        <div className="card-placeholder" style={{ display: c.thumbnail ? 'none' : 'flex', background: `linear-gradient(135deg,${c.theme[0]},${c.theme[1]})` }}>
          <span className="card-placeholder-text">{c.ini}</span>
        </div>
      </div>

      <div className="cardbody">
        <div className="card-sport-label">{c.sport.toUpperCase()}</div>
        <div className="pn">{c.player}</div>
        <div className="meta">
          {c.grader} {c.grade} · {c.set}
          {c.variant && c.variant !== 'Base' && (
            <span style={{
              marginLeft: 4, fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)',
              padding: '2px 5px', borderRadius: 4, letterSpacing: '.02em',
              background: 'rgba(232,179,57,.12)', color: 'var(--gold)',
              verticalAlign: 'middle', whiteSpace: 'nowrap',
            }}>
              {c.variant.length > 20 ? c.variant.slice(0,18) + '…' : c.variant}
            </span>
          )}
          {c.gradeCount > 1 && (
            <span style={{
              marginLeft: 6, fontSize: 9, fontWeight: 700, fontFamily: 'var(--mono)',
              padding: '2px 6px', borderRadius: 4, letterSpacing: '.03em',
              background: 'rgba(155,123,255,.15)', color: 'var(--violet, #9b7bff)',
              verticalAlign: 'middle',
            }}>
              {c.gradeCount} grades
            </span>
          )}
        </div>
        <div className="priceline">
          <span className={`ask mono${c.market <= 0 ? ' no-price' : ''}`}>{fmtDisplay(c.market)}</span>
          {confBadge}
          {isRC && <span className="rc-tag">RC</span>}
        </div>
        {c.lo > 0 && c.hi > 0 && (
          <div className="price-range mono">{fmtRange(c.lo, c.hi)}</div>
        )}
      </div>
    </article>
  );
}
