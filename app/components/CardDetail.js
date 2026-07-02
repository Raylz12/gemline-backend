'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { fmt, fmtDisplay, fmtRange, gradeClass } from '../lib/data';
import { useCardStore } from './CardStore';
import { useAuth } from './AuthContext';
import { toast } from '../lib/toast';
import PaymentModal from './PaymentModal';
import AuthModal from './AuthModal';

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
              stroke="rgba(22,199,132,0.5)" strokeWidth="1" strokeDasharray="4 3" />
            <text x={padL + chartW + 4} y={curY + 4} fontSize="9"
              fill="rgba(22,199,132,0.8)" fontFamily="monospace">NOW</text>
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
  const { token, authFetch } = useAuth();
  const [payModal, setPayModal] = useState(null); // { orderId, clientSecret, amount, fee }
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
  const [effectiveDays, setEffectiveDays] = useState(30); // actual window shown (auto-widens on sparse data)
  const [widened, setWidened] = useState(null); // { from, points } when auto-widened to 1Y
  const [showAuth, setShowAuth] = useState(false);
  const [chartGrade, setChartGrade] = useState(null); // null = use card's own grade
  const [cardWants, setCardWants] = useState([]);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidFormAmount, setBidFormAmount] = useState('');
  const [bidFormBoost, setBidFormBoost] = useState(0);
  const [submittingBid, setSubmittingBid] = useState(false);
  const [similarCards, setSimilarCards] = useState([]);
  const [isLiked, setIsLiked] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [tab, setTab] = useState('grades');
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
    if (!token) { setShowAuth(true); return; }
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

  // Fetch price history from Card Hedge — re-runs when grade or days changes.
  // Sparse data: if the requested window has <3 points, auto-widen to 1Y with a label.
  useEffect(() => {
    const chId = c.cardhedge_id;
    if (!chId) return;
    let cancelled = false;
    setHistoryLoading(true);
    const activeGrade = chartGrade || (c.grader && c.grade ? `${c.grader} ${c.grade}` : 'PSA 10');
    const getWindow = (days) =>
      fetch(`/api/cards/${chId}/history?grade=${encodeURIComponent(activeGrade)}&days=${days}`).then(r => r.json());
    (async () => {
      let d = { prices: [], comps: [], stats: null };
      let days = chartDays;
      let widenedFrom = null;
      try {
        d = await getWindow(chartDays);
        if ((d.prices || []).length < 3 && chartDays < 365) {
          const wide = await getWindow(365);
          if ((wide.prices || []).length > (d.prices || []).length) {
            widenedFrom = { from: chartDays, points: (d.prices || []).length };
            d = wide;
            days = 365;
          }
        }
      } catch {}
      if (cancelled) return;
      setPriceHistory(d.prices || []);
      setPriceComps(d.comps || []);
      setPriceStats(d.stats || null);
      setEffectiveDays(days);
      setWidened(widenedFrom);
      setHistoryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [c.cardhedge_id, c.grader, c.grade, chartDays, chartGrade]);

  const handleBuy = async (listing) => {
    if (!token) { setShowAuth(true); return; }
    setBuying(listing.id);
    try {
      const res = await fetch(`/api/listings/${listing.id}/buy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Purchase failed');
      if (data.requiresPayment && data.payment) {
        // Open the Payment Element modal to confirm the manual-capture PI.
        setPayModal({ ...data.payment, listingId: listing.id });
      } else if (data.url) window.location.href = data.url;
      else if (data.order) { toast('Purchase complete! '); setListings(prev => prev.filter(l => l.id !== listing.id)); }
      else throw new Error(data.error || 'Purchase failed');
    } catch (e) { toast(e.message, true); }
    finally { setBuying(null); }
  };

  const handleOffer = async () => {
    if (!token) { setShowAuth(true); return; }
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
    if (!token) { setShowAuth(true); return; }
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
    if (!token) { setShowAuth(true); return; }
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

  // ── Derived market intelligence ──
  const sales30 = c.sales30d || 0;
  const sales7 = c.sales7d || 0;
  const liquidity = sales30 >= 25 ? 'HIGH' : sales30 >= 8 ? 'MEDIUM' : sales30 >= 2 ? 'LOW' : 'THIN';
  const liqColor = sales30 >= 25 ? 'var(--up)' : sales30 >= 8 ? 'var(--gold)' : sales30 >= 2 ? '#e8b339' : 'var(--dim)';
  const confKey = (c.confidence || '').toLowerCase();
  const confScore = { very_high: 95, high: 82, medium: 58, low: 32, catalog: 22 }[confKey] || 40;
  const salesScore = Math.min(100, sales30 * 4);
  const trendOk = c.gain7d !== undefined && Math.abs(c.gain7d) <= 999;
  const stabilityScore = trendOk ? Math.max(0, 100 - Math.min(100, Math.abs(c.gain7d) * 2)) : 50;
  const marketScore = Math.round(salesScore * 0.4 + confScore * 0.4 + stabilityScore * 0.2);
  const scoreColor = marketScore >= 70 ? 'var(--up)' : marketScore >= 45 ? '#e8b339' : 'var(--down)';
  const spreadPct = hasRange && c.market > 0 ? Math.round(((c.hi - c.lo) / c.market) * 100) : null;

  const gainDisplay = trendOk && c.gain7d !== 0 ? c.gain7d : null;

  const TABS = [
    { id: 'grades', label: 'Price & Grades' },
    { id: 'insight', label: 'Market Insight' },
    { id: 'comps', label: `Comps${priceComps.length ? ` (${priceComps.length})` : ''}` },
  ];

  const openOffer = () => {
    if (lowestListing) {
      setShowOfferModal(lowestListing.id);
      setOfferAmount(String(Math.round(Number(lowestListing.price) * 0.85)));
    } else {
      setShowBidForm(v => !v);
    }
  };

  return (
    <div className="overlay on cd-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal cd-dark" style={{ position: 'relative', maxHeight: '92vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <button className="modal-close cd-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>

        <div className="cd-grid">
          {/* ── Left slab rail ── */}
          <aside className="cd-rail">
            <div className="cd-slab">
              {c.thumbnail ? (
                <img src={c.thumbnail} alt={c.player}
                     onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
              ) : null}
              <div className="cd-slab-fallback" style={{ display: c.thumbnail ? 'none' : 'flex', background: `linear-gradient(150deg,${c.theme?.[0] || '#1a1f2e'},${c.theme?.[1] || '#12151f'})` }}>
                <span className="cd-slab-ini">{c.ini}</span>
                <span className="cd-slab-name">{c.player}</span>
              </div>
              <span className={`grade cd-slab-grade ${gradeClass(c.grader)}`}>{c.grader} {c.grade}</span>
            </div>

            <div className="cd-rail-badges">
              {c.confidence && <span className={`conf-badge conf-${c.confidence.toLowerCase()}`}>{confidenceLabel(c.confidence)}</span>}
              {c.saleCount > 0 && <span className="pill">{c.saleCount} recent sales</span>}
            </div>

            <div className="cd-facts">
              {c.sport && <div className="cd-fact"><span>Sport</span><b>{c.sport}</b></div>}
              {c.set && <div className="cd-fact"><span>Set</span><b>{c.set}</b></div>}
              {c.num && <div className="cd-fact"><span>Card #</span><b>{c.num}</b></div>}
              {c.variant && <div className="cd-fact"><span>Variant</span><b>{c.variant}</b></div>}
              <div className="cd-fact"><span>Grade</span><b>{c.grader} {c.grade}</b></div>
              {isRC && <div className="cd-fact"><span>Rookie</span><b style={{ color: 'var(--gold)' }}>Yes — RC</b></div>}
            </div>
          </aside>

          {/* ── Right: intelligence panel ── */}
          <div className="cd-main">
            <div className="cd-head">
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h2>{c.player}</h2>
                  {isRC && <span className="rc-tag" style={{ fontSize: 11, padding: '3px 7px' }}>RC</span>}
                </div>
                <div className="cd-meta">{c.set}{c.variant ? ` · ${c.variant}` : ''}{c.num ? ` · ${c.num}` : ''}</div>
              </div>
              <div className="cd-head-icons">
                <button className={`cd-icon ${isLiked ? 'on-like' : ''}`} onClick={handleLike} title={isLiked ? 'Unlike' : 'Like'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                </button>
                <button className={`cd-icon ${isPinned ? 'on-pin' : ''}`} onClick={handlePin} title={isPinned ? 'Unpin' : 'Pin to portfolio'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>
                </button>
                <button className="cd-icon" disabled={addingToPortfolio} title="Add to portfolio"
                  onClick={async () => {
                    if (!token) { setShowAuth(true); return; }
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
                  }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                </button>
              </div>
            </div>

            {/* Hero price */}
            <div className="cd-hero">
              <div className="cd-hero-price">
                {hasPrice ? (
                  <>
                    <span className="cd-price mono">{fmtDisplay(c.market)}</span>
                    <span className="cd-price-label">market value</span>
                    {gainDisplay !== null && (
                      <span className={`cd-delta mono ${gainDisplay >= 0 ? 'up' : 'down'}`}>
                        {gainDisplay >= 0 ? '▲' : '▼'} {Math.abs(gainDisplay).toFixed(1)}% 7D
                      </span>
                    )}
                  </>
                ) : (
                  <span className="cd-price mono" style={{ color: 'var(--dim)' }}>Price TBD</span>
                )}
              </div>
              {hasRange && <FMVBar lo={c.lo} market={c.market} hi={c.hi} />}
            </div>

            {/* Tabs */}
            <div className="cd-tabs">
              {TABS.map(t => (
                <button key={t.id} className={`cd-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>

            {/* ── Tab: Price & Grades ── */}
            {tab === 'grades' && (
              <div className="cd-tabbody">
                {c.cardhedge_id && (
                  <div className="cd-block">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <h4 className="cd-h4">Price History</h4>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[7, 30, 90, 365].map(d => (
                          <button key={d} onClick={() => setChartDays(d)} className={`cd-chip ${chartDays === d ? 'on' : ''}`}>{d === 365 ? '1Y' : `${d}D`}</button>
                        ))}
                      </div>
                    </div>
                    {c.grades && c.grades.length > 1 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                        <button onClick={() => setChartGrade(null)} className={`cd-chip sm ${!chartGrade ? 'gold' : ''}`}>{c.grader} {c.grade}</button>
                        {c.grades
                          .filter(g => !(g.grader === c.grader && String(g.grade) === String(c.grade)))
                          .slice(0, 5)
                          .map((g, i) => {
                            const gLabel = `${g.grader} ${g.grade}`;
                            return <button key={i} onClick={() => setChartGrade(gLabel)} className={`cd-chip sm ${chartGrade === gLabel ? 'gold' : ''}`}>{gLabel}</button>;
                          })}
                      </div>
                    )}
                    {historyLoading ? (
                      <div className="cd-empty" style={{ height: 180 }}>
                        <span style={{ animation: 'spin 1s linear infinite', marginRight: 8, display: 'inline-block' }}>◌</span>
                        Loading price data...
                      </div>
                    ) : priceHistory.length > 1 ? (
                      <div className="cd-chartwrap">
                        {widened && (
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                            {widened.points === 0 ? 'No sales' : `${widened.points} sale${widened.points === 1 ? '' : 's'}`} in last {widened.from}D — showing 1Y
                          </div>
                        )}
                        <PriceChart prices={priceHistory} comps={priceComps} lo={c.lo || null} hi={c.hi || null} currentPrice={c.market || null} />
                        {priceStats && (
                          <div className="cd-tiles" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 10 }}>
                            {[
                              { label: 'OPEN', val: priceStats.open },
                              { label: 'CLOSE', val: priceStats.close },
                              { label: `${effectiveDays === 365 ? '1Y' : `${effectiveDays}D`} LOW`, val: priceStats.low },
                              { label: `${effectiveDays === 365 ? '1Y' : `${effectiveDays}D`} HIGH`, val: priceStats.high },
                            ].map(({ label, val }) => (
                              <div key={label} className="cd-tile">
                                <div className="cd-tile-label">{label}</div>
                                <div className="cd-tile-val mono">
                                  {val >= 1000 ? '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '$' + Number(val).toFixed(2)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="cd-legend">
                          <span><span style={{ color: priceHistory[priceHistory.length - 1]?.price >= priceHistory[0]?.price ? 'var(--up)' : 'var(--down)', marginRight: 4 }}>●</span>Price trend</span>
                          {priceComps.length > 0 && <span><span style={{ color: '#e8b339', marginRight: 4 }}>●</span>Actual sales ({priceComps.length})</span>}
                          {(c.lo || c.hi) && <span><span style={{ color: 'rgba(155,123,255,.6)', marginRight: 4 }}>■</span>FMV range</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="cd-empty" style={{ height: 64 }}>
                        {chartDays < 365 ? 'No sales in the last year for this grade' : `No price history for this ${chartDays === 365 ? '1Y' : `${chartDays}D`} window`}
                      </div>
                    )}
                  </div>
                )}

                {/* Grade ladder */}
                {c.grades && c.grades.length > 0 && (
                  <div className="cd-block">
                    <h4 className="cd-h4">Grade Ladder ({c.grades.length})</h4>
                    <div className="cd-ladder">
                      <div className="cd-ladder-head">
                        <span>Grade</span><span>Price</span><span>Range</span><span>Sales 7/30</span>
                      </div>
                      {[...c.grades]
                        .sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0))
                        .map((g, i) => {
                          const isCurrent = g.grader === c.grader && String(g.grade) === String(c.grade);
                          const maxP = Math.max(...c.grades.map(x => Number(x.price) || 0), 1);
                          const barW = Math.max(3, Math.round(((Number(g.price) || 0) / maxP) * 100));
                          return (
                            <div key={`${g.grader}-${g.grade}-${i}`} className={`cd-ladder-row ${isCurrent ? 'cur' : ''}`}>
                              <span className="cd-ladder-grade">
                                <span className={gradeClass(g.grader)} style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>{g.grader} {g.grade}</span>
                                {isCurrent && <span className="cd-cur-dot">●</span>}
                              </span>
                              <span className="cd-ladder-price mono">
                                {g.price > 0 ? fmtDisplay(g.price) : '—'}
                                <span className="cd-ladder-bar"><i style={{ width: `${barW}%` }} /></span>
                              </span>
                              <span className="mono cd-ladder-dim">{g.lo > 0 && g.hi > 0 ? fmtRange(g.lo, g.hi) : '—'}</span>
                              <span className="mono cd-ladder-dim">{(g.sales7d || 0) + (g.sales30d || 0) > 0 ? `${g.sales7d || 0} / ${g.sales30d || 0}` : '—'}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Market Insight ── */}
            {tab === 'insight' && (
              <div className="cd-tabbody">
                <div className="cd-tiles">
                  <div className="cd-tile big">
                    <div className="cd-tile-label">MARKET SCORE</div>
                    <div className="cd-tile-val mono" style={{ fontSize: 26, color: scoreColor }}>{marketScore}</div>
                    <div className="cd-scorebar"><i style={{ width: `${marketScore}%`, background: scoreColor }} /></div>
                  </div>
                  <div className="cd-tile">
                    <div className="cd-tile-label">LIQUIDITY</div>
                    <div className="cd-tile-val mono" style={{ color: liqColor }}>{liquidity}</div>
                  </div>
                  <div className="cd-tile">
                    <div className="cd-tile-label">CONFIDENCE</div>
                    <div className="cd-tile-val" style={{ fontSize: 12 }}>{c.confidence ? confidenceLabel(c.confidence) : '—'}</div>
                  </div>
                  <div className="cd-tile">
                    <div className="cd-tile-label">7D SALES</div>
                    <div className="cd-tile-val mono">{sales7 || '—'}</div>
                  </div>
                  <div className="cd-tile">
                    <div className="cd-tile-label">30D SALES</div>
                    <div className="cd-tile-val mono">{sales30 || '—'}</div>
                  </div>
                  <div className="cd-tile">
                    <div className="cd-tile-label">7D TREND</div>
                    <div className={`cd-tile-val mono ${gainDisplay !== null ? (gainDisplay >= 0 ? 'up' : 'down') : ''}`}>
                      {gainDisplay !== null ? `${gainDisplay >= 0 ? '+' : ''}${gainDisplay.toFixed(1)}%` : '—'}
                    </div>
                  </div>
                  {spreadPct !== null && (
                    <div className="cd-tile">
                      <div className="cd-tile-label">FMV SPREAD</div>
                      <div className="cd-tile-val mono">{spreadPct}%</div>
                    </div>
                  )}
                  {c.saleCount > 0 && (
                    <div className="cd-tile">
                      <div className="cd-tile-label">TOTAL COMPS</div>
                      <div className="cd-tile-val mono">{c.saleCount}</div>
                    </div>
                  )}
                </div>

                {c.cardhedge_id && c.market > 0 && (
                  <div className="cd-block">
                    <WhyCheap cardhedgeId={c.cardhedge_id} grade={`${c.grader} ${c.grade}`} market={c.market} />
                  </div>
                )}

                {similarCards.length > 0 && (
                  <div className="cd-block">
                    <h4 className="cd-h4">Similar Cards</h4>
                    <div className="cd-similar">
                      {similarCards.map((sc, i) => (
                        <div key={i} className="cd-sim-card">
                          {sc.ebay_thumb && (
                            <img src={sc.ebay_thumb} alt="" onError={e => e.target.style.display = 'none'} />
                          )}
                          <div className="cd-sim-name">{sc.player}</div>
                          <div className="cd-sim-grade">{sc.grader} {sc.grade}</div>
                          <div className="cd-sim-price mono">{sc.catalog_price ? fmtDisplay(Number(sc.catalog_price)) : '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Comps ── */}
            {tab === 'comps' && (
              <div className="cd-tabbody">
                <div className="cd-block">
                  <h4 className="cd-h4">Recent Sales</h4>
                  {priceComps.length > 0 ? (
                    <div className="cd-comps">
                      {priceComps.slice(0, 12).map((comp, i) => (
                        <div key={i} className="cd-comp-row">
                          <span className="mono cd-ladder-dim">
                            {comp.date ? new Date(comp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          </span>
                          {comp.url ? (
                            <a className="cd-comp-src" href={comp.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                              {comp.source || 'sale'} ↗
                            </a>
                          ) : (
                            <span className="cd-comp-src">{comp.source || 'sale'}</span>
                          )}
                          <span className="mono cd-comp-price">${Number(comp.price).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="cd-empty" style={{ height: 56 }}>No recent comparable sales for this grade</div>
                  )}
                </div>

                {cardWants.length > 0 && (
                  <div className="cd-block">
                    <h4 className="cd-h4">Open Bids ({cardWants.length})</h4>
                    <div className="cd-comps">
                      {cardWants.slice(0, 5).map(wt => (
                        <div key={wt.id} className="cd-comp-row">
                          <span className="cd-ladder-dim">@{wt.buyer_handle}</span>
                          <span className="cd-comp-src">{wt.boost_credits > 0 ? `${wt.boost_credits}cr boost` : 'bid'}</span>
                          <span className="mono cd-comp-price">{fmtDisplay(Number(wt.bid_amount) / 100)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── For Sale (always visible) ── */}
            <div className="cd-block cd-forsale">
              <h4 className="cd-h4">For Sale {listings.length > 0 ? `(${listings.length})` : ''}</h4>
              {loadingListings ? (
                <div className="cd-empty" style={{ height: 48 }}>Loading listings...</div>
              ) : listings.length > 0 ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {listings.slice(0, 5).map(l => (
                    <div key={l.id} className="cd-listing">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>{fmtDisplay(Number(l.price))}</span>
                          <DealBadge listingPrice={Number(l.price)} card={c} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          @{l.seller_handle || 'Seller'}
                          {hasPrice && <span> · Market {fmtDisplay(c.market)}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleBuy(l)} disabled={buying === l.id} className="cd-mini-buy">
                          {buying === l.id ? '...' : 'Buy Now'}
                        </button>
                        {(l.open_to_offers || l.listing_type === 'offer') && (
                          <button className="cd-mini-ghost" onClick={() => { setShowOfferModal(l.id); setOfferAmount(String(Math.round(Number(l.price) * 0.85))); }}>
                            Offer
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cd-empty" style={{ height: 56, flexDirection: 'column', gap: 4 }}>
                  <span>No active listings — be the first.</span>
                  <a href={`/sell?card=${c.id}`} style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 600 }}>List yours →</a>
                </div>
              )}
            </div>

            {/* Bid form */}
            {showBidForm && (
              <div className="cd-block cd-bidform">
                <h4 className="cd-h4">Place a Bid</h4>
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>$</span>
                  <input type="number" value={bidFormAmount} onChange={e => setBidFormAmount(e.target.value)}
                    placeholder="How much would you pay?" min="1" step="0.01" className="cd-input" />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                  {[
                    { credits: 0, label: 'No boost' },
                    { credits: 10, label: '10cr' },
                    { credits: 25, label: '25cr' },
                    { credits: 50, label: '50cr' },
                  ].map(b => (
                    <button key={b.credits} onClick={() => setBidFormBoost(b.credits)}
                      className={`cd-chip ${bidFormBoost === b.credits ? 'gold' : ''}`} style={{ flex: 1 }}>
                      {b.label}
                    </button>
                  ))}
                </div>
                <button onClick={handlePlaceBid} disabled={submittingBid} className="cd-mini-buy" style={{ width: '100%', padding: 10 }}>
                  {submittingBid ? 'Placing...' : 'Submit Bid'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Sticky action bar: Buy / Offer / Trade / List / Watch ── */}
        <div className="cd-actionbar">
          {lowestListing ? (
            <button className="cd-act buy" onClick={() => handleBuy(lowestListing)} disabled={buying === lowestListing?.id}>
              {buying === lowestListing?.id ? 'Processing...' : `Buy · ${fmtDisplay(Number(lowestListing.price))}`}
            </button>
          ) : (
            <button className="cd-act buy dim" onClick={openOffer}>No listings — Bid</button>
          )}
          <button className={`cd-act ghost ${showBidForm ? 'active' : ''}`} onClick={openOffer}>Offer</button>
          <a className="cd-act ghost" href="/trades">Trade</a>
          <a className="cd-act ghost" href={`/sell?card=${c.id}`}>List</a>
          <button className={`cd-act ghost cd-watch ${w ? "on" : ""}`} onClick={() => toggleWatch(c.id)} title={w ? 'Unwatch' : 'Watch'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill={w ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span className="cd-act-label">Watch</span>
          </button>
        </div>
      </div>

      {/* Offer Modal */}
      {showOfferModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'grid', placeItems: 'center' }}
             onClick={e => e.target === e.currentTarget && setShowOfferModal(null)}>
          <div className="cd-dark" style={{ background: 'var(--panel)', borderRadius: 14, padding: 24, width: '90%', maxWidth: 380, border: '1px solid var(--line-2)' }}>
            <h3 style={{ fontFamily: 'var(--disp)', marginBottom: 12, fontSize: 16, color: 'var(--txt)' }}>Make an Offer</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              Listed at {fmtDisplay(Number(listings.find(l => l.id === showOfferModal)?.price || 0))}
              {hasPrice && <> · Market {fmtDisplay(c.market)}</>}
            </p>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>$</span>
              <input type="number" value={offerAmount} onChange={e => setOfferAmount(e.target.value)}
                placeholder="0.00" min="1" step="0.01" className="cd-input" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowOfferModal(null)} className="cd-mini-ghost" style={{ flex: 1, padding: 10 }}>Cancel</button>
              <button onClick={handleOffer} disabled={submittingOffer} className="cd-mini-buy" style={{ flex: 1, padding: 10 }}>
                {submittingOffer ? '...' : 'Submit Offer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {payModal && (
        <PaymentModal
          payment={payModal}
          authFetch={authFetch}
          onPaid={() => {
            setPayModal(null);
            if (payModal.listingId) setListings(prev => prev.filter(l => l.id !== payModal.listingId));
            toast('Payment complete — your card is on the way!');
          }}
          onClose={() => setPayModal(null)}
        />
      )}
    </div>
  );
}
