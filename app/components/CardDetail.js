'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { fmt, fmtDisplay, fmtRange, gradeClass } from '../lib/data';
import { useCardStore } from './CardStore';
import { useAuth } from './AuthContext';
import { toast } from '../lib/toast';

function WhyCheap({ cardhedgeId, grade, market }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState('');

  const fetchWhy = async () => {
    if (explanation) { setOpen(!open); return; }
    setOpen(true);
    setLoading(true);
    try {
      const r = await fetch('/api/cards/' + cardhedgeId + '/fmv?grade=' + encodeURIComponent(grade));
      const data = await r.json();
      if (data.ai_explanation) {
        setExplanation(data.ai_explanation);
      } else if (data.price_explanation) {
        setExplanation(data.price_explanation);
      } else if (data.method) {
        const methods = {
          direct: 'Priced from direct recent sales data.',
          direct_indexed: 'Based on sales data, adjusted by a market movement index to account for staleness.',
          card_interpolation: 'No direct sales at this grade — price interpolated from other grades of the same card.',
          cross_provider: 'Price derived from a different grading company\'s data (e.g., BGS → PSA conversion).',
          anchor_multiplier: 'Estimated using a grade multiplier from a related grade of this card.',
          segment_fallback: 'No card-specific data available — using segment baseline (set × year × category average).',
          no_data: 'Insufficient market data to generate a price estimate.',
        };
        const conf = data.confidence_grade ? ` Confidence: ${data.confidence_grade} (${(data.confidence * 100).toFixed(0)}%).` : '';
        setExplanation((methods[data.method] || `Method: ${data.method}.`) + conf);
      } else {
        setExplanation('Price sourced from Card Hedge market data. Based on recent comparable sales.');
      }
    } catch {
      setExplanation('Unable to fetch pricing details.');
    }
    setLoading(false);
  };

  return (
    <div className="whycheap mr-section" style={{ marginBottom: 16 }}>
      <button onClick={fetchWhy}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3z"/>
        </svg>
        Why is it priced this way?
      </button>
      {loading && <div className="loading"><div className="scout-spin" /> Analyzing pricing...</div>}
      {open && explanation && <div className="ans">{explanation}</div>}
    </div>
  );
}

function DealBadge({ listingPrice, card }) {
  const lo = card.lo || (card.market * 0.85);
  const hi = card.hi || (card.market * 1.15);
  const catalog = card.ask || card.market;
  if (listingPrice < lo) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--up-soft)', color: 'var(--up)', fontWeight: 600 }}>Great Deal</span>;
  if (listingPrice < catalog) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--up-soft)', color: 'var(--up)' }}>Good Deal</span>;
  if (listingPrice > hi) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--down-soft)', color: 'var(--down)' }}>High</span>;
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--panel)', color: 'var(--muted)' }}>Fair</span>;
}

function PriceChart({ prices, comps = [], lo, hi, currentPrice }) {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null); // { x, y, price, date, idx }

  if (!prices || prices.length < 2) return null;
  const validPrices = prices.filter(p => p.price > 0);
  if (validPrices.length < 2) return null;

  const W = 560, H = 200, padL = 52, padR = 16, padT = 16, padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const vals = validPrices.map(p => p.price);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  // Expand range so the line doesn't hug the edges
  const pad5 = (rawMax - rawMin) * 0.15 || rawMax * 0.1;
  const minV = Math.max(0, rawMin - pad5);
  const maxV = rawMax + pad5;
  const range = maxV - minV || 1;

  const up = vals[vals.length - 1] >= vals[0];
  const lineColor = up ? '#34D88A' : '#FF5C6C';
  const fillColor = up ? 'rgba(52,216,138,0.08)' : 'rgba(255,92,108,0.08)';

  const cx = i => padL + (i / (validPrices.length - 1)) * chartW;
  const cy = v => padT + (1 - (v - minV) / range) * chartH;

  const linePts = validPrices.map((p, i) => `${cx(i)},${cy(p.price)}`).join(' ');
  const areaPts = `${padL},${padT + chartH} ${linePts} ${padL + chartW},${padT + chartH}`;

  // Y-axis ticks (4 gridlines)
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = minV + (range * i) / ticks;
    return { v, y: cy(v) };
  });

  // X-axis labels (show ~5 dates)
  const xStep = Math.max(1, Math.floor(validPrices.length / 5));
  const xLabels = validPrices
    .map((p, i) => ({ i, date: p.date }))
    .filter((_, i) => i % xStep === 0 || i === validPrices.length - 1);

  // Lo/Hi band
  const loY = lo ? cy(Math.min(lo, maxV)) : null;
  const hiY = hi ? cy(Math.max(hi, minV)) : null;

  // Current price dashed line
  const curY = currentPrice ? cy(Math.min(Math.max(currentPrice, minV), maxV)) : null;

  const handleMouseMove = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    const relX = mx - padL;
    if (relX < 0 || relX > chartW) { setTooltip(null); return; }
    const idx = Math.round((relX / chartW) * (validPrices.length - 1));
    const clamped = Math.min(Math.max(idx, 0), validPrices.length - 1);
    const p = validPrices[clamped];
    setTooltip({ x: cx(clamped), y: cy(p.price), price: p.price, date: p.date, idx: clamped });
  }, [validPrices, chartW]);

  const fmtTooltipDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const fmtPrice = (v) => {
    if (!v) return '—';
    if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return '$' + Number(v).toFixed(2);
  };

  const firstVal = vals[0];
  const lastVal = vals[vals.length - 1];
  // Guard: if baseline is near-zero, don't show a wild percentage
  const pctChange = vals.length >= 2 && firstVal >= 1
    ? (((lastVal - firstVal) / firstVal) * 100).toFixed(1)
    : null;
  // Cap display at ±999%
  const pctDisplay = pctChange !== null && Math.abs(Number(pctChange)) > 999 ? null : pctChange;

  return (
    <div style={{ position: 'relative' }}>
      {/* Header: price delta */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
          {validPrices.length} data points
        </span>
        {pctDisplay !== null && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: Number(pctDisplay) >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {Number(pctDisplay) >= 0 ? '▲' : '▼'} {Math.abs(pctDisplay)}%
          </span>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', cursor: 'crosshair', userSelect: 'none' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Gridlines + Y labels */}
        {yTicks.map(({ v, y }) => (
          <g key={y}>
            <line x1={padL} y1={y} x2={padL + chartW} y2={y}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={padL - 6} y={y + 4} textAnchor="end"
              fontSize="10" fill="rgba(255,255,255,0.35)" fontFamily="monospace">
              {v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v)}
            </text>
          </g>
        ))}

        {/* Lo/Hi range band */}
        {loY !== null && hiY !== null && (
          <rect
            x={padL} y={Math.min(loY, hiY)}
            width={chartW} height={Math.abs(loY - hiY)}
            fill="rgba(155,123,255,0.07)" rx="2"
          />
        )}

        {/* Current price dashed line */}
        {curY !== null && (
          <>
            <line x1={padL} y1={curY} x2={padL + chartW} y2={curY}
              stroke="rgba(232,179,57,0.5)" strokeWidth="1" strokeDasharray="4 3" />
            <text x={padL + chartW + 4} y={curY + 4} fontSize="9"
              fill="rgba(232,179,57,0.8)" fontFamily="monospace">NOW</text>
          </>
        )}

        {/* Area fill */}
        <polygon points={areaPts} fill={fillColor} />

        {/* Main line */}
        <polyline
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          points={linePts}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Sale dots on the line */}
        {validPrices.map((p, i) => (
          <circle
            key={i}
            cx={cx(i)} cy={cy(p.price)} r="2.5"
            fill={lineColor} opacity="0.6"
          />
        ))}

        {/* Comp sale dots (eBay/other actual sales) */}
        {comps.filter(c => c.price >= minV && c.price <= maxV && c.date).map((c, i) => {
          // Position by date relative to price range dates
          const dates = validPrices.map(p => new Date(p.date).getTime()).filter(Boolean);
          if (!dates.length) return null;
          const dMin = Math.min(...dates), dMax = Math.max(...dates);
          const cTime = new Date(c.date).getTime();
          if (cTime < dMin || cTime > dMax) return null;
          const xPos = padL + ((cTime - dMin) / (dMax - dMin || 1)) * chartW;
          const yPos = cy(c.price);
          return (
            <circle key={`comp-${i}`} cx={xPos} cy={yPos} r="4"
              fill="var(--gold)" opacity="0.8" stroke="var(--ink)" strokeWidth="1.5" />
          );
        })}

        {/* X-axis labels */}
        {xLabels.map(({ i, date }) => (
          <text key={i}
            x={cx(i)} y={H - 6}
            textAnchor="middle" fontSize="9"
            fill="rgba(255,255,255,0.3)" fontFamily="monospace">
            {date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
          </text>
        ))}

        {/* Tooltip vertical line + dot */}
        {tooltip && (
          <>
            <line
              x1={tooltip.x} y1={padT}
              x2={tooltip.x} y2={padT + chartH}
              stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3 2"
            />
            <circle cx={tooltip.x} cy={tooltip.y} r="5"
              fill={lineColor} stroke="var(--ink)" strokeWidth="2" />
          </>
        )}
      </svg>

      {/* Tooltip box */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          top: 28,
          left: `calc(${(tooltip.x / W) * 100}% + 8px)`,
          transform: tooltip.x > W * 0.6 ? 'translateX(-110%)' : 'none',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '6px 10px',
          pointerEvents: 'none',
          zIndex: 10,
          minWidth: 110,
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: lineColor }}>
            {fmtPrice(tooltip.price)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            {fmtTooltipDate(tooltip.date)}
          </div>
        </div>
      )}
    </div>
  );
}

// Map raw confidence values to human-readable labels
const CONFIDENCE_LABELS = {
  catalog: 'Estimated',
  low: 'Low confidence',
  medium: 'Moderate confidence',
  high: 'High confidence — recent sales',
  very_high: 'Very high confidence',
};
function confidenceLabel(raw) {
  if (!raw) return '';
  return CONFIDENCE_LABELS[raw.toLowerCase()] || raw;
}

function FMVBar({ lo, market, hi }) {
  if (!lo || !hi || !market) return null;
  const range = hi - lo || 1;
  const pos = Math.min(Math.max(((market - lo) / range) * 100, 5), 95);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>
        <span>Lo {fmtDisplay(lo)}</span>
        <span>Hi {fmtDisplay(hi)}</span>
      </div>
      <div style={{ position: 'relative', height: 8, background: 'linear-gradient(90deg, var(--up-soft), var(--gold-soft), var(--down-soft))', borderRadius: 4 }}>
        <div style={{
          position: 'absolute', top: -2, left: `${pos}%`, transform: 'translateX(-50%)',
          width: 12, height: 12, borderRadius: 6, background: 'var(--gold)', border: '2px solid var(--ink)',
        }} />
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--gold)', fontWeight: 600, marginTop: 4 }}>
        Market {fmtDisplay(market)}
      </div>
    </div>
  );
}

export default function CardDetail({ card: c, onClose }) {
  const { watch, toggleWatch } = useCardStore();
  const { token } = useAuth();
  const [addingToPortfolio, setAddingToPortfolio] = useState(false);
  const [listings, setListings] = useState([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [showOfferModal, setShowOfferModal] = useState(null);
  const [offerAmount, setOfferAmount] = useState('');
  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [buying, setBuying] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [priceComps, setPriceComps] = useState([]);
  const [priceStats, setPriceStats] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [chartDays, setChartDays] = useState(30);
  const [chartGrade, setChartGrade] = useState(null); // null = use card's own grade
  const [cardWants, setCardWants] = useState([]);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidFormAmount, setBidFormAmount] = useState('');
  const [bidFormBoost, setBidFormBoost] = useState(0);
  const [submittingBid, setSubmittingBid] = useState(false);
  const [similarCards, setSimilarCards] = useState([]);
  const [isLiked, setIsLiked] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  if (!c) return null;

  const isRC = c.rookie || (c.variant || '').toLowerCase().includes('rc') ||
               (c.variant || '').toLowerCase().includes('rookie') ||
               (c.set || '').toLowerCase().includes('rookie');

  useEffect(() => {
    setLoadingListings(true);
    fetch(`/api/listings/for-card/${c.id}`)
      .then(r => r.json())
      .then(d => setListings(d.listings || []))
      .catch(() => {})
      .finally(() => setLoadingListings(false));
  }, [c.id]);

  // Fetch existing bids/wants for this card
  useEffect(() => {
    fetch(`/api/wants?cardId=${c.id}`)
      .then(r => r.json())
      .then(d => setCardWants(d.wants || []))
      .catch(() => {});
  }, [c.id]);

  const handlePlaceBid = async () => {
    if (!token) { toast('Please log in first', true); return; }
    if (!bidFormAmount || Number(bidFormAmount) <= 0) { toast('Enter a valid amount', true); return; }
    setSubmittingBid(true);
    try {
      const res = await fetch('/api/wants', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: c.id, bidAmount: Number(bidFormAmount), boostCredits: bidFormBoost || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to place bid');
      toast('Bid placed! ');
      setShowBidForm(false);
      setBidFormAmount('');
      setBidFormBoost(0);
      // Refresh wants
      fetch(`/api/wants?cardId=${c.id}`).then(r => r.json()).then(d => setCardWants(d.wants || [])).catch(() => {});
    } catch (e) { toast(e.message, true); }
    finally { setSubmittingBid(false); }
  };

  // Fetch price history from Card Hedge — re-runs when grade or days changes
  useEffect(() => {
    const chId = c.cardhedge_id;
    if (!chId) return;
    setHistoryLoading(true);
    const activeGrade = chartGrade || (c.grader && c.grade ? `${c.grader} ${c.grade}` : 'PSA 10');
    fetch(`/api/cards/${chId}/history?grade=${encodeURIComponent(activeGrade)}&days=${chartDays}`)
      .then(r => r.json())
      .then(d => {
        setPriceHistory(d.prices || []);
        setPriceComps(d.comps || []);
        setPriceStats(d.stats || null);
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [c.cardhedge_id, c.grader, c.grade, chartDays, chartGrade]);

  const handleBuy = async (listing) => {
    if (!token) { toast('Please log in first', true); return; }
    setBuying(listing.id);
    try {
      const res = await fetch(`/api/listings/${listing.id}/buy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else if (data.order) { toast('Purchase complete! '); setListings(prev => prev.filter(l => l.id !== listing.id)); }
      else throw new Error(data.error || 'Purchase failed');
    } catch (e) { toast(e.message, true); }
    finally { setBuying(null); }
  };

  const handleOffer = async () => {
    if (!token) { toast('Please log in first', true); return; }
    if (!offerAmount || Number(offerAmount) <= 0) { toast('Enter a valid amount', true); return; }
    setSubmittingOffer(true);
    try {
      const res = await fetch(`/api/listings/${showOfferModal}/offer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(offerAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Offer failed');
      toast('Offer submitted! ');
      setShowOfferModal(null);
      setOfferAmount('');
    } catch (e) { toast(e.message, true); }
    finally { setSubmittingOffer(false); }
  };

  const w = watch.has(String(c.id));
  const lowestListing = listings.length > 0 ? listings.reduce((min, l) => Number(l.price) < Number(min.price) ? l : min, listings[0]) : null;
  const hasPrice = c.market > 0;
  const hasRange = c.lo > 0 && c.hi > 0;

  // Close on Escape key
  // Fetch similar cards (same player or same set)
  useEffect(() => {
    if (!c.player) return;
    const params = new URLSearchParams({ q: c.player });
    fetch(`/api/catalog/search?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: c.player }),
    })
      .then(r => r.json())
      .then(d => {
        const results = (d.results || [])
          .filter(r => r.id !== c.id && Number(r.catalog_price) > 0)
          .slice(0, 4);
        setSimilarCards(results);
      })
      .catch(() => {});
  }, [c.id, c.player]);

  const handleLike = async () => {
    if (!token) { toast('Please log in to like cards', true); return; }
    const newState = !isLiked;
    setIsLiked(newState);
    try {
      await fetch(`/api/cards/${c.id}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ liked: newState }),
      });
    } catch { setIsLiked(!newState); }
  };

  const handlePin = async () => {
    if (!token) { toast('Please log in to pin cards', true); return; }
    const newState = !isPinned;
    setIsPinned(newState);
    try {
      await fetch(`/api/portfolio/pin`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: c.id, pinned: newState }),
      });
      toast(newState ? 'Pinned to portfolio ✓' : 'Unpinned');
    } catch { setIsPinned(!newState); }
  };

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="overlay on" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ position: 'relative', maxHeight: '90vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <button className="modal-close" onClick={onClose} style={{ minWidth: 44, minHeight: 44, width: 44, height: 44, cursor: 'pointer', zIndex: 10 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
        <div className="modal-grid">
          {/* Left: card image */}
          <div className="modal-left">
            <div className="bigslab">
              {c.thumbnail ? (
                <img src={c.thumbnail} alt={c.player} style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 12 }}
                     onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
              ) : null}
              <div style={{ display: c.thumbnail ? 'none' : 'flex', width: '100%', height: 260, borderRadius: 12, background: `linear-gradient(150deg,${c.theme[0]},${c.theme[1]})`, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontFamily: 'var(--disp)', fontSize: 36, fontWeight: 800, color: 'rgba(255,255,255,.7)' }}>{c.ini}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{c.player}</span>
              </div>
            </div>
            <div style={{ marginTop: 18, textAlign: 'center' }}>
              {c.confidence && <span className={`conf-badge conf-${c.confidence.toLowerCase()}`} style={{ fontSize: 12, padding: '4px 10px' }}>{confidenceLabel(c.confidence)}</span>}
              {c.saleCount > 0 && <span className="pill" style={{ fontSize: 11, marginLeft: 8 }}>{c.saleCount} recent sales</span>}
            </div>
          </div>

          {/* Right: details */}
          <div className="modal-right">
            <div className="mr-head">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2>{c.player}</h2>
                  {isRC && <span className="rc-tag" style={{ fontSize: 11, padding: '3px 7px' }}>RC</span>}
                </div>
                <div className="meta">{c.set}{c.variant ? ` · ${c.variant}` : ''}{c.num ? ` · ${c.num}` : ''}</div>
              </div>
              <span className={`grade ${gradeClass(c.grader)}`}>{c.grader} {c.grade}</span>
            </div>

            {/* Price section */}
            <div className="mr-price">
              {hasPrice ? (
                <>
                  <span className="ask mono">{fmtDisplay(c.market)}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)', paddingBottom: 7 }}>catalog price</span>
                </>
              ) : (
                <span className="ask mono" style={{ color: 'var(--dim)' }}>Price TBD</span>
              )}
            </div>

            {/* FMV Range Bar */}
            {hasRange && (
              <div className="mr-section" style={{ marginBottom: 16 }}>
                <h4>FMV Range</h4>
                <FMVBar lo={c.lo} market={c.market} hi={c.hi} />
              </div>
            )}

            {/* Price History Chart */}
            {c.cardhedge_id && (
              <div className="mr-section" style={{ marginBottom: 20 }}>
                {/* Chart header: title + range tabs */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h4 style={{ margin: 0 }}>Price History</h4>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[7, 30, 90].map(d => (
                      <button key={d} onClick={() => setChartDays(d)} style={{
                        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                        padding: '3px 8px', borderRadius: 5, cursor: 'pointer', border: 'none',
                        background: chartDays === d ? 'var(--violet)' : 'var(--panel-2)',
                        color: chartDays === d ? '#fff' : 'var(--muted)',
                        transition: 'background .15s',
                      }}>{d}D</button>
                    ))}
                  </div>
                </div>

                {/* Grade selector — show if card has multiple grades */}
                {c.grades && c.grades.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    <button onClick={() => setChartGrade(null)} style={{
                      fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px',
                      borderRadius: 4, cursor: 'pointer', border: 'none',
                      background: !chartGrade ? 'var(--gold)' : 'var(--panel-2)',
                      color: !chartGrade ? '#000' : 'var(--muted)',
                    }}>
                      {c.grader} {c.grade}
                    </button>
                    {c.grades
                      .filter(g => !(g.grader === c.grader && String(g.grade) === String(c.grade)))
                      .slice(0, 5)
                      .map((g, i) => {
                        const gLabel = `${g.grader} ${g.grade}`;
                        return (
                          <button key={i} onClick={() => setChartGrade(gLabel)} style={{
                            fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px',
                            borderRadius: 4, cursor: 'pointer', border: 'none',
                            background: chartGrade === gLabel ? 'var(--gold)' : 'var(--panel-2)',
                            color: chartGrade === gLabel ? '#000' : 'var(--muted)',
                          }}>{gLabel}</button>
                        );
                      })}
                  </div>
                )}

                {/* Chart body */}
                {historyLoading ? (
                  <div style={{
                    height: 180, background: 'var(--panel-2)', borderRadius: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--dim)', fontSize: 12,
                  }}>
                    <span style={{ animation: 'spin 1s linear infinite', marginRight: 8, display: 'inline-block' }}>◌</span>
                    Loading price data...
                  </div>
                ) : priceHistory.length > 1 ? (
                  <div style={{ background: 'var(--panel-2)', borderRadius: 10, padding: '12px 10px 4px' }}>
                    <PriceChart
                      prices={priceHistory}
                      comps={priceComps}
                      lo={c.lo || null}
                      hi={c.hi || null}
                      currentPrice={c.market || null}
                    />
                    {/* Stats bar */}
                    {priceStats && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                        {[
                          { label: 'OPEN', val: priceStats.open },
                          { label: 'CLOSE', val: priceStats.close },
                          { label: `${chartDays}D LOW`, val: priceStats.low },
                          { label: `${chartDays}D HIGH`, val: priceStats.high },
                        ].map(({ label, val }) => (
                          <div key={label} style={{ flex: '1 1 60px', background: 'rgba(255,255,255,.04)', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', letterSpacing: '.08em' }}>{label}</div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                              {val >= 1000 ? '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '$' + Number(val).toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Legend */}
                    <div style={{ display: 'flex', gap: 12, padding: '4px 4px 8px', fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                      <span><span style={{ color: priceHistory.length > 1 && priceHistory[priceHistory.length-1]?.price >= priceHistory[0]?.price ? 'var(--up)' : 'var(--down)', marginRight: 4 }}>●</span>Price trend</span>
                      {priceComps.length > 0 && <span><span style={{ color: 'var(--gold)', marginRight: 4 }}>●</span>Actual sales ({priceComps.length})</span>}
                      {(c.lo || c.hi) && <span><span style={{ color: 'rgba(155,123,255,.6)', marginRight: 4 }}>■</span>FMV range</span>}
                    </div>
                  </div>
                ) : priceComps.length > 0 ? (
                  /* Has comp sales but not enough for a trend line — show them as a scatter */
                  <div style={{ background: 'var(--panel-2)', borderRadius: 10, padding: '12px 10px 8px' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
                      {priceComps.length} sale{priceComps.length !== 1 ? 's' : ''} in the last {chartDays}D
                    </div>
                    {priceComps.slice(0, 8).map((comp, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                          {comp.date ? new Date(comp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>
                          ${Number(comp.price).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{
                    height: 60, background: 'var(--panel-2)', borderRadius: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--dim)', fontSize: 12,
                  }}>
                    No price history available for this {chartDays}D window
                  </div>
                )}
              </div>
            )}

            {/* Market Stats */}
            <div className="mr-section" style={{ marginBottom: 16 }}>
              <h4>Market Stats</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {c.sales7d > 0 && (
                  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em' }}>7D SALES</div>
                    <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{c.sales7d}</div>
                  </div>
                )}
                {c.sales30d > 0 && (
                  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em' }}>30D SALES</div>
                    <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{c.sales30d}</div>
                  </div>
                )}
                {c.gain7d !== undefined && c.gain7d !== 0 && Math.abs(c.gain7d) <= 999 && (
                  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em' }}>7D GAIN</div>
                    <div className={`mono ${c.gain7d >= 0 ? 'up' : 'down'}`} style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                      {c.gain7d >= 0 ? '+' : ''}{c.gain7d.toFixed(1)}%
                    </div>
                  </div>
                )}
                {c.gain7d !== undefined && Math.abs(c.gain7d) > 999 && (
                  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em' }}>7D GAIN</div>
                    <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 4, color: 'var(--dim)' }}>N/A</div>
                  </div>
                )}
                {c.confidence && (
                  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em' }}>CONFIDENCE</div>
                    <div className={`mono conf-badge conf-${c.confidence.toLowerCase()}`} style={{ fontSize: 13, fontWeight: 600, marginTop: 6, display: 'inline-block' }}>{confidenceLabel(c.confidence)}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Available Grades */}
            {c.grades && c.grades.length > 1 && (
              <div className="mr-section" style={{ marginBottom: 16 }}>
                <h4>Available Grades ({c.grades.length})</h4>
                <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                    padding: '8px 12px', background: 'var(--panel-2)',
                    fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)',
                    letterSpacing: '.08em', textTransform: 'uppercase',
                  }}>
                    <span>Grade</span><span>Price</span><span>Range</span><span>Sales</span>
                  </div>
                  {c.grades.map((g, i) => {
                    const isCurrent = g.grader === c.grader && g.grade === c.grade;
                    return (
                      <div key={`${g.grader}-${g.grade}-${i}`} style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                        padding: '8px 12px', fontSize: 13, alignItems: 'center',
                        background: isCurrent ? 'var(--gold-soft, rgba(255,215,0,.08))' : 'transparent',
                        borderTop: '1px solid var(--line)',
                      }}>
                        <span style={{ fontWeight: isCurrent ? 700 : 500 }}>
                          <span className={gradeClass(g.grader)} style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                            {g.grader} {g.grade}
                          </span>
                          {isCurrent && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--gold)' }}>●</span>}
                        </span>
                        <span className="mono" style={{ fontWeight: 600 }}>
                          {g.price > 0 ? fmtDisplay(g.price) : '—'}
                        </span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {g.lo > 0 && g.hi > 0 ? fmtRange(g.lo, g.hi) : '—'}
                        </span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {(g.sales7d || 0) + (g.sales30d || 0) > 0
                            ? `${g.sales7d || 0}/${g.sales30d || 0}`
                            : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 6 }}>
                  Sales shown as 7d/30d. Displaying highest-grade price.
                </div>
              </div>
            )}

            {/* Why is it priced this way? */}
            {c.cardhedge_id && c.market > 0 && (
              <WhyCheap cardhedgeId={c.cardhedge_id} grade={`${c.grader} ${c.grade}`} market={c.market} />
            )}

            {/* Active Listings */}
            {listings.length > 0 && (
              <div className="mr-section" style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 10 }}>For Sale ({listings.length})</h4>
                <div style={{ display: 'grid', gap: 8 }}>
                  {listings.slice(0, 5).map(l => (
                    <div key={l.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: 8, background: 'var(--panel)',
                      border: '1px solid var(--line)',
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>
                            {fmtDisplay(Number(l.price))}
                          </span>
                          <DealBadge listingPrice={Number(l.price)} card={c} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          @{l.seller_handle || 'Seller'}
                          {hasPrice && <span> · Market {fmtDisplay(c.market)}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleBuy(l)} disabled={buying === l.id}
                          style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--gold)', color: '#000', cursor: buying === l.id ? 'wait' : 'pointer' }}>
                          {buying === l.id ? '...' : 'Buy Now'}
                        </button>
                        {(l.open_to_offers || l.listing_type === 'offer') && (
                          <button onClick={() => { setShowOfferModal(l.id); setOfferAmount(String(Math.round(Number(l.price) * 0.85))); }}
                            style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500, background: 'var(--panel-2)', color: 'var(--txt)', border: '1px solid var(--line)' }}>
                            Offer
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {listings.length === 0 && !loadingListings && (
              <div className="mr-section" style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--panel)', borderRadius: 8, color: 'var(--muted)', fontSize: 12 }}>
                No active listings for this card.
              </div>
            )}

            <div className="mr-actions">
              {lowestListing ? (
                <button className="buy" onClick={() => handleBuy(lowestListing)} disabled={buying === lowestListing?.id}>
                  {buying === lowestListing?.id ? 'Processing...' : `Buy Now · ${fmtDisplay(Number(lowestListing.price))}`}
                </button>
              ) : (
                <button className="buy" style={{ opacity: 0.5, cursor: 'default' }}>No listings</button>
              )}
              <button className="offer" onClick={() => setShowBidForm(!showBidForm)} style={{ background: showBidForm ? 'var(--gold-soft)' : undefined, color: showBidForm ? 'var(--gold)' : undefined, borderColor: showBidForm ? 'var(--gold)' : undefined }}>
                Place a Bid
              </button>
              <button className={`offer watch ${w ? 'on' : ''}`} onClick={() => toggleWatch(c.id)} style={{ width: 'auto' }}>♥</button>
              <button
                onClick={handleLike}
                title={isLiked ? 'Unlike' : 'Like'}
                style={{
                  width: 'auto', padding: '8px 12px', borderRadius: 8, fontSize: 16, cursor: 'pointer',
                  background: isLiked ? 'rgba(255,92,108,.15)' : 'var(--panel-2)',
                  color: isLiked ? '#FF5C6C' : 'var(--muted)',
                  border: `1px solid ${isLiked ? 'rgba(255,92,108,.4)' : 'var(--line)'}`,
                  transition: 'all .15s',
                }}
              >👍</button>
              <button
                onClick={handlePin}
                title={isPinned ? 'Unpin' : 'Pin to portfolio'}
                style={{
                  width: 'auto', padding: '8px 12px', borderRadius: 8, fontSize: 16, cursor: 'pointer',
                  background: isPinned ? 'rgba(232,179,57,.15)' : 'var(--panel-2)',
                  color: isPinned ? 'var(--gold)' : 'var(--muted)',
                  border: `1px solid ${isPinned ? 'rgba(232,179,57,.4)' : 'var(--line)'}`,
                  transition: 'all .15s',
                }}
              >📌</button>
              <button
                className="offer"
                disabled={addingToPortfolio}
                style={{ width: 'auto', fontSize: 12 }}
                onClick={async () => {
                  if (!token) { toast('Please log in first', true); return; }
                  setAddingToPortfolio(true);
                  try {
                    const res = await fetch('/api/portfolio/add', {
                      method: 'POST',
                      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ cardId: c.id, quantity: 1 }),
                    });
                    if (res.ok) toast('Added to portfolio ✓');
                    else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to add', true); }
                  } catch { toast('Failed to add to portfolio', true); }
                  finally { setAddingToPortfolio(false); }
                }}
              >
                {addingToPortfolio ? '...' : '+ Portfolio'}
              </button>
            </div>

            {/* Bid Form */}
            {showBidForm && (
              <div className="card-bids-section" style={{ marginBottom: 16 }}>
                <h4 style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>Place a Bid</h4>
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>$</span>
                  <input type="number" value={bidFormAmount} onChange={e => setBidFormAmount(e.target.value)}
                    placeholder="How much would you pay?" min="1" step="0.01"
                    style={{ width: '100%', padding: '10px 14px 10px 28px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 16, fontFamily: 'var(--mono)', outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                  {[
                    { credits: 0, label: 'No boost' },
                    { credits: 10, label: '10cr' },
                    { credits: 25, label: '25cr' },
                    { credits: 50, label: '50cr' },
                  ].map(b => (
                    <button key={b.credits} onClick={() => setBidFormBoost(b.credits)}
                      style={{
                        flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                        background: bidFormBoost === b.credits ? 'var(--gold-soft)' : 'var(--panel-2)',
                        color: bidFormBoost === b.credits ? 'var(--gold)' : 'var(--muted)',
                        border: `1px solid ${bidFormBoost === b.credits ? 'var(--gold)' : 'var(--line)'}`,
                      }}>
                      {b.label}
                    </button>
                  ))}
                </div>
                <button onClick={handlePlaceBid} disabled={submittingBid}
                  style={{ width: '100%', padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 700, background: 'var(--gold)', color: '#000', cursor: submittingBid ? 'wait' : 'pointer' }}>
                  {submittingBid ? 'Placing...' : 'Submit Bid'}
                </button>
              </div>
            )}

            {/* Existing Bids */}
            {cardWants.length > 0 && (
              <div className="mr-section" style={{ marginBottom: 16 }}>
                <h4>Open Bids ({cardWants.length})</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {cardWants.slice(0, 5).map(w => (
                    <div key={w.id} className="card-bid-item">
                      <div>
                        <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>
                          {fmtDisplay(Number(w.bid_amount) / 100)}
                        </span>
                        {w.boost_credits > 0 && (
                          <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--gold-soft)', color: 'var(--gold)', fontFamily: 'var(--mono)' }}>
                            {w.boost_credits >= 50 ? '' : w.boost_credits >= 25 ? '' : ''} {w.boost_credits}cr
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>@{w.buyer_handle}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Similar Cards */}
            {similarCards.length > 0 && (
              <div className="mr-section" style={{ marginBottom: 16 }}>
                <h4>Similar Cards</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                  {similarCards.map((sc, i) => (
                    <div key={i} style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--line)', cursor: 'pointer' }}>
                      {sc.ebay_thumb && (
                        <img src={sc.ebay_thumb} alt="" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 6, marginBottom: 6 }} onError={e => e.target.style.display='none'} />
                      )}
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.player}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{sc.grader} {sc.grade}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>
                        {sc.catalog_price ? fmtDisplay(Number(sc.catalog_price)) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Card info summary */}
            <div className="mr-section">
              <h4>Card Details</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {c.sport && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Sport:</span> {c.sport}</div>}
                {c.set && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Set:</span> {c.set}</div>}
                {c.grader && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Grader:</span> {c.grader} {c.grade}</div>}
                {c.num && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Card #:</span> {c.num}</div>}
                {c.variant && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>Variant:</span> {c.variant}</div>}
                {isRC && <div style={{ fontSize: 13 }}><span className="rc-tag">Rookie Card</span></div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Offer Modal */}
      {showOfferModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'grid', placeItems: 'center' }}
             onClick={e => e.target === e.currentTarget && setShowOfferModal(null)}>
          <div style={{ background: 'var(--panel)', borderRadius: 'var(--r)', padding: 24, width: '90%', maxWidth: 380, border: '1px solid var(--line)' }}>
            <h3 style={{ fontFamily: 'var(--disp)', marginBottom: 12, fontSize: 16 }}>Make an Offer</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              Listed at {fmtDisplay(Number(listings.find(l => l.id === showOfferModal)?.price || 0))}
              {hasPrice && <> · Market {fmtDisplay(c.market)}</>}
            </p>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>$</span>
              <input type="number" value={offerAmount} onChange={e => setOfferAmount(e.target.value)}
                placeholder="0.00" min="1" step="0.01"
                style={{ width: '100%', padding: '12px 14px 12px 28px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--txt)', fontSize: 16, fontFamily: 'var(--mono)', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowOfferModal(null)}
                style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--panel-2)', color: 'var(--muted)', fontSize: 13 }}>Cancel</button>
              <button onClick={handleOffer} disabled={submittingOffer}
                style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'var(--gold)', color: '#000', fontSize: 13, fontWeight: 600 }}>
                {submittingOffer ? '...' : 'Submit Offer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
