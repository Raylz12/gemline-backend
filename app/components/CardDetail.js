'use client';
import { useState, useEffect } from 'react';
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
  if (listingPrice < lo) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--up-soft)', color: 'var(--up)', fontWeight: 600 }}>🔥 Great Deal</span>;
  if (listingPrice < catalog) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--up-soft)', color: 'var(--up)' }}>Good Deal</span>;
  if (listingPrice > hi) return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--down-soft)', color: 'var(--down)' }}>High</span>;
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--panel)', color: 'var(--muted)' }}>Fair</span>;
}

function PriceChart({ prices }) {
  if (!prices || prices.length < 2) return null;
  const w = 280, h = 80, pad = 4;
  const vals = prices.map(p => p.price).filter(v => v > 0);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? '#34D88A' : '#FF5C6C';
  const points = prices.map((p, i) => {
    const x = pad + (i / (prices.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (p.price - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  // Dates for x axis
  const firstDate = prices[0]?.date ? new Date(prices[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const lastDate = prices[prices.length - 1]?.date ? new Date(prices[prices.length - 1].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ display: 'block' }}>
        <polyline fill="none" stroke={color} strokeWidth="2" points={points} strokeLinejoin="round" strokeLinecap="round" />
        {/* Fill area under line */}
        <polygon
          fill={up ? 'rgba(52,216,138,0.1)' : 'rgba(255,92,108,0.1)'}
          points={`${pad},${h - pad} ${points} ${w - pad},${h - pad}`}
        />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>
        <span>{firstDate}</span>
        <span>{lastDate}</span>
      </div>
    </div>
  );
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
  const [historyLoading, setHistoryLoading] = useState(false);
  const [cardWants, setCardWants] = useState([]);
  const [showBidForm, setShowBidForm] = useState(false);
  const [bidFormAmount, setBidFormAmount] = useState('');
  const [bidFormBoost, setBidFormBoost] = useState(0);
  const [submittingBid, setSubmittingBid] = useState(false);
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
      toast('Bid placed! 🎯');
      setShowBidForm(false);
      setBidFormAmount('');
      setBidFormBoost(0);
      // Refresh wants
      fetch(`/api/wants?cardId=${c.id}`).then(r => r.json()).then(d => setCardWants(d.wants || [])).catch(() => {});
    } catch (e) { toast(e.message, true); }
    finally { setSubmittingBid(false); }
  };

  // Fetch price history from Card Hedge
  useEffect(() => {
    const chId = c.cardhedge_id;
    if (!chId) return;
    setHistoryLoading(true);
    const grade = c.grader && c.grade ? `${c.grader} ${c.grade}` : 'PSA 10';
    fetch(`/api/cards/${chId}/history?grade=${encodeURIComponent(grade)}&days=30`)
      .then(r => r.json())
      .then(d => setPriceHistory(d.prices || []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [c.cardhedge_id, c.grader, c.grade]);

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
      else if (data.order) { toast('Purchase complete! 🎉'); setListings(prev => prev.filter(l => l.id !== listing.id)); }
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
      toast('Offer submitted! 🤝');
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
              {c.confidence && <span className={`conf-badge conf-${c.confidence.toLowerCase()}`} style={{ fontSize: 12, padding: '4px 10px' }}>Card Hedge {c.confidence}</span>}
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
              <div className="mr-section" style={{ marginBottom: 16 }}>
                <h4>📈 30-Day Price History</h4>
                {historyLoading ? (
                  <div style={{ padding: 12, color: 'var(--dim)', fontSize: 12 }}>Loading price data...</div>
                ) : priceHistory.length > 1 ? (
                  <div style={{ marginTop: 8, padding: '8px 0' }}>
                    <PriceChart prices={priceHistory} />
                  </div>
                ) : (
                  <div style={{ padding: 12, color: 'var(--dim)', fontSize: 12 }}>No price history available for this card.</div>
                )}
              </div>
            )}

            {/* Market Stats */}
            <div className="mr-section" style={{ marginBottom: 16 }}>
              <h4>📊 Market Stats</h4>
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
                {c.gain7d !== undefined && c.gain7d !== 0 && (
                  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em' }}>7D GAIN</div>
                    <div className={`mono ${c.gain7d >= 0 ? 'up' : 'down'}`} style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                      {c.gain7d >= 0 ? '+' : ''}{c.gain7d.toFixed(1)}%
                    </div>
                  </div>
                )}
                {c.confidence && (
                  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em' }}>CONFIDENCE</div>
                    <div className={`mono conf-badge conf-${c.confidence.toLowerCase()}`} style={{ fontSize: 14, fontWeight: 600, marginTop: 6, display: 'inline-block' }}>{c.confidence}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Available Grades */}
            {c.grades && c.grades.length > 1 && (
              <div className="mr-section" style={{ marginBottom: 16 }}>
                <h4>🏅 Available Grades ({c.grades.length})</h4>
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
                <h4 style={{ marginBottom: 10 }}>🏷️ For Sale ({listings.length})</h4>
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
                🎯 Place a Bid
              </button>
              <button className={`offer watch ${w ? 'on' : ''}`} onClick={() => toggleWatch(c.id)} style={{ width: 'auto' }}>♥</button>
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
                    { credits: 10, label: '🔥 10cr' },
                    { credits: 25, label: '⚡ 25cr' },
                    { credits: 50, label: '💎 50cr' },
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
                  {submittingBid ? 'Placing...' : '🎯 Submit Bid'}
                </button>
              </div>
            )}

            {/* Existing Bids */}
            {cardWants.length > 0 && (
              <div className="mr-section" style={{ marginBottom: 16 }}>
                <h4>🎯 Open Bids ({cardWants.length})</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {cardWants.slice(0, 5).map(w => (
                    <div key={w.id} className="card-bid-item">
                      <div>
                        <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>
                          {fmtDisplay(Number(w.bid_amount) / 100)}
                        </span>
                        {w.boost_credits > 0 && (
                          <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--gold-soft)', color: 'var(--gold)', fontFamily: 'var(--mono)' }}>
                            {w.boost_credits >= 50 ? '💎' : w.boost_credits >= 25 ? '⚡' : '🔥'} {w.boost_credits}cr
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>@{w.buyer_handle}</span>
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
