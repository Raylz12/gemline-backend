'use client';
import { fmtDisplay, fmtRange, fmt } from '../lib/data';
import { useCardStore } from './CardStore';
import { useState } from 'react';
import { toast } from '../lib/toast';

export default function CardItem({ card: c, onClick }) {
  const { watch, toggleWatch } = useCardStore();
  const w = watch.has(String(c.id));
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Humanize price-confidence: raw values like "0.4177" or "catalog" mean
  // nothing to collectors. Show a clean verified/estimate signal instead.
  const confBadge = (() => {
    if (!c.confidence) return null;
    const raw = String(c.confidence).toLowerCase();
    if (raw === 'catalog') return <span className="conf-badge conf-est" title="Catalog estimate">EST</span>;
    const n = Number(raw);
    if (!isNaN(n)) {
      if (n >= 0.65) return <span className="conf-badge conf-hi" title="High-confidence live price">VERIFIED</span>;
      if (n >= 0.35) return <span className="conf-badge conf-med" title="Moderate sales data">LIVE</span>;
      return <span className="conf-badge conf-est" title="Limited sales data">EST</span>;
    }
    return <span className={`conf-badge conf-${raw}`}>{String(c.confidence).toUpperCase()}</span>;
  })();

  const isRC = (c.variant || '').toLowerCase().includes('rc') || 
               (c.variant || '').toLowerCase().includes('rookie') ||
               (c.set || '').toLowerCase().includes('rookie');

  return (
    <article className="card" data-id={c.id} onClick={() => onClick?.(c)}>
      <button className={`watch ${w ? 'on' : ''}`} onClick={e => {
        e.stopPropagation();
        const ok = toggleWatch(c.id);
        if (!ok) toast('Sign in to watch cards and get price alerts');
        else toast(w ? 'Removed from watchlist' : 'Watching — price + listing alerts on ✓');
      }}>
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
        {c.thumbnail && !imgError ? (
          <>
            {!imgLoaded && (
              <div className="card-placeholder card-shimmer" style={{ background: `linear-gradient(135deg,${c.theme[0]},${c.theme[1]})` }}>
                <span className="card-placeholder-text">{c.ini}</span>
              </div>
            )}
            <img
              src={c.thumbnail}
              alt={c.player}
              className="card-thumb"
              decoding="async"
              width={220}
              height={308}
              style={{
                opacity: imgLoaded ? 1 : 0,
                transition: 'opacity .25s ease',
                position: imgLoaded ? 'relative' : 'absolute',
                inset: 0,
              }}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          </>
        ) : (
          <div className="card-placeholder" style={{ display: 'flex', background: `linear-gradient(135deg,${c.theme[0]},${c.theme[1]})` }}>
            <span className="card-placeholder-text">{c.ini}</span>
          </div>
        )}
      </div>

      <div className="cardbody">
        <div className="card-sport-label">{c.sport.toUpperCase()}</div>
        <div className="pn">{c.player}</div>
        {/* Clean hierarchy — set on its own line, details as chips (no · joins) */}
        <div className="meta meta-set">{c.set}</div>
        <div className="meta-chips">
          <span className="mchip mchip-grade">{`${c.grader || 'RAW'} ${c.grade || ''}`.trim()}</span>
          {c.num && <span className="mchip">#{String(c.num).replace(/^#/, '')}</span>}
          {c.variant && c.variant !== 'Base' && (
            <span className="mchip mchip-var">{c.variant.length > 16 ? c.variant.slice(0, 14) + '…' : c.variant}</span>
          )}
          {c.gradeCount > 1 && <span className="mchip mchip-grades">{c.gradeCount} grades</span>}
        </div>
        <div className="priceline">
          <span className={`ask mono${c.market <= 0 ? ' no-price' : ''}`}>{fmtDisplay(c.market)}</span>
          {confBadge}
          {isRC && <span className="rc-tag">RC</span>}
        </div>
        {/* Multi-tier family: show the grade-price range across tiers; single
            tier keeps the FMV lo–hi band */}
        {c.gradeCount > 1 && c.priceMin > 0 && c.priceMax > c.priceMin ? (
          <div className="price-range mono" title="Price range across grades">{fmtRange(c.priceMin, c.priceMax)} across grades</div>
        ) : c.lo > 0 && c.hi > 0 && (
          <div className="price-range mono">{fmtRange(c.lo, c.hi)}</div>
        )}
      </div>
    </article>
  );
}
