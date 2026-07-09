'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import { useCardStore } from '../components/CardStore';
import { fmt, SPORT_THEME, slabStyle } from '../lib/data';
import { toast } from '../lib/toast';
import useDarkPage from '../lib/useDarkPage';
// PackRipContent removed - replaced by Mystery Pulls at /packs
import PreviewGate, { SampleLivePreview } from '../components/PreviewGate';
import { IconGavel } from '../components/Icons';


/* ─── helpers ─────────────────────────────────────────────────────────── */
function Countdown({ endTime, showUrgency = false }) {
  const [left, setLeft] = useState('');
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    const tick = () => {
      const ms = new Date(endTime).getTime() - Date.now();
      if (ms <= 0) { setLeft('ENDED'); setUrgent(false); return; }
      const isUrgent = ms < 5 * 60 * 1000;
      setUrgent(isUrgent);
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setLeft(h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTime]);
  if (!showUrgency) return <span>{left}</span>;
  return <span style={{ color: urgent ? 'var(--down)' : 'inherit', fontWeight: urgent ? 700 : 'inherit' }}>{left}</span>;
}

function boostTier(credits) {
  if (credits >= 50) return { label: 'Diamond', cls: 'boost-diamond' };
  if (credits >= 25) return { label: 'Supercharged', cls: 'boost-super' };
  if (credits >= 10) return { label: 'Hot', cls: 'boost-hot' };
  return null;
}

function BoostBadge({ credits }) {
  const tier = boostTier(credits);
  if (!tier) return null;
  return <span className={`boost-badge ${tier.cls}`}>{tier.label}</span>;
}

function CardThumb({ item, size = 50 }) {
  const thumb = item.ebay_thumb || item.image_url;
  const initials = (item.player || '').split(' ').map(w => w[0]).join('').slice(0, 3);
  return thumb ? (
    <img src={thumb} alt="" style={{ width: size, height: size * 1.3, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
         onError={e => { e.target.style.display = 'none'; e.target.nextSibling && (e.target.nextSibling.style.display = 'grid'); }} />
  ) : (
    <div style={{ width: size, height: size * 1.3, borderRadius: 8, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', flexShrink: 0, fontFamily: 'var(--disp)', fontWeight: 800, fontSize: size * 0.35, color: 'var(--dim)' }}>
      {initials}
    </div>
  );
}

/* ─── main page ───────────────────────────────────────────────────────── */
export default function LivePage() {
  useDarkPage(); // full dark intelligence theme - no half-dark hero on a light page
  const { token, userId } = useAuth();
  const { cards } = useCardStore();

  // State
  const [tab, setTab] = useState('auctions');
  const [search, setSearch] = useState('');
  const [auctions, setAuctions] = useState([]);
  const [wants, setWants] = useState([]);
  const [topBids, setTopBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auctionSort, setAuctionSort] = useState('ending_soon');
  const [wantSort, setWantSort] = useState('amount_desc');
  // Never advertise a dead floor: when there are zero auctions/bids the hero
  // shows the always-alive catalog stat instead of "0 AUCTIONS · 0 OPEN BIDS".
  const [cardsPriced, setCardsPriced] = useState(0);
  // Credits economy is feature-flagged OFF by default (no honest sink since
  // packs retired) — boost badges/buttons/tiers only render when re-enabled.
  const [creditsOn, setCreditsOn] = useState(false);
  useEffect(() => {
    fetch('/api/stats/live').then(r => r.json()).then(d => setCardsPriced(Number(d.totalCards) || 0)).catch(() => {});
    fetch('/api/flags').then(r => r.json()).then(d => setCreditsOn((d.flags || {}).credits === true)).catch(() => {});
  }, []);

  // Bid modal (auction)
  const [bidModal, setBidModal] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [submittingBid, setSubmittingBid] = useState(false);
  const [bidHistory, setBidHistory] = useState([]);

  // Want modal (place a want/bid)
  const [wantModal, setWantModal] = useState(false);
  const [wantSearch, setWantSearch] = useState('');
  const [wantResults, setWantResults] = useState([]);
  const [wantCard, setWantCard] = useState(null);
  const [wantAmount, setWantAmount] = useState('');
  const [wantBoost, setWantBoost] = useState(0);
  const [submittingWant, setSubmittingWant] = useState(false);

  // Boost modal
  const [boostModal, setBoostModal] = useState(null);
  const [boostAmount, setBoostAmount] = useState(10);
  const [submittingBoost, setSubmittingBoost] = useState(false);

  // Create Auction modal
  const [createAuctionModal, setCreateAuctionModal] = useState(false);
  const [auctionSearch, setAuctionSearch] = useState('');
  const [auctionSearchResults, setAuctionSearchResults] = useState([]);
  const [auctionCard, setAuctionCard] = useState(null);
  const [auctionStartBid, setAuctionStartBid] = useState('');
  const [auctionReserve, setAuctionReserve] = useState('');
  const [auctionDuration, setAuctionDuration] = useState(24);
  const [submittingAuction, setSubmittingAuction] = useState(false);

  // Match modal
  const [matchModal, setMatchModal] = useState(null);
  const [submittingMatch, setSubmittingMatch] = useState(false);

  /* ─── data fetching ─────────────────────────────────────────────────── */
  const loadAuctions = useCallback(() => {
    fetch('/api/auctions/live')
      .then(r => r.json())
      .then(d => setAuctions(d.auctions || []))
      .catch(() => {});
  }, []);

  const loadWants = useCallback(() => {
    const params = new URLSearchParams({ sort: wantSort });
    if (search) params.set('search', search);
    fetch(`/api/wants?${params}`)
      .then(r => r.json())
      .then(d => setWants(d.wants || []))
      .catch(() => {});
  }, [wantSort, search]);

  const loadTopBids = useCallback(() => {
    fetch('/api/wants/top')
      .then(r => r.json())
      .then(d => setTopBids(d.wants || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([loadAuctions(), loadWants(), loadTopBids()])
      .finally(() => setLoading(false));
  }, [loadAuctions, loadWants, loadTopBids]);

  // Auctions refresh fast (10s - live floor); wants/top bids every 30s
  useEffect(() => {
    const fast = setInterval(loadAuctions, 10000);
    const slow = setInterval(() => { loadWants(); loadTopBids(); }, 30000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, [loadAuctions, loadWants, loadTopBids]);

  // Reload wants when sort changes
  useEffect(() => { loadWants(); }, [wantSort, loadWants]);

  /* ─── auction search filter ─────────────────────────────────────────── */
  const filteredAuctions = auctions.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (a.player || '').toLowerCase().includes(q) ||
           (a.card_set || '').toLowerCase().includes(q) ||
           (a.sport || '').toLowerCase().includes(q);
  });

  const sortedAuctions = [...filteredAuctions].sort((a, b) => {
    switch (auctionSort) {
      case 'ending_soon': return new Date(a.end_time) - new Date(b.end_time);
      case 'price_high': return (b.current_price || 0) - (a.current_price || 0);
      case 'price_low': return (a.current_price || 0) - (b.current_price || 0);
      case 'most_bids': return (b.bid_count || 0) - (a.bid_count || 0);
      case 'newest': return new Date(b.start_time || b.created_at) - new Date(a.start_time || a.created_at);
      default: return 0;
    }
  });

  const liveAuctions = sortedAuctions.filter(a => a.status === 'live');
  const upcomingAuctions = sortedAuctions.filter(a => a.status === 'scheduled');

  /* ─── auction bid ───────────────────────────────────────────────────── */
  const openBidModal = (auction) => {
    const currentPrice = auction.current_price / 100;
    const minBid = Math.max(currentPrice + 1, currentPrice * 1.05);
    setBidModal(auction);
    setBidAmount(String(Math.ceil(minBid)));
    setBidHistory([]);
    fetch(`/api/auctions/${auction.id}/bids`)
      .then(r => r.json())
      .then(d => setBidHistory(d.bids || []))
      .catch(() => {});
  };

  const minBidFor = (a) => {
    const cur = a.current_price / 100;
    return cur + Math.max(1, Math.round(cur * 0.05));
  };

  const placeBid = async () => {
    if (!token) { toast('Please log in to bid', true); return; }
    if (!bidAmount || Number(bidAmount) <= 0) { toast('Enter a valid bid', true); return; }
    setSubmittingBid(true);
    try {
      const res = await fetch(`/api/auctions/${bidModal.id}/bid`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(bidAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bid failed');
      toast(`Bid placed: $${Number(bidAmount || 0).toFixed(2)} `);
      setBidModal(null);
      setBidAmount('');
      loadAuctions();
    } catch (e) { toast(e.message, true); }
    finally { setSubmittingBid(false); }
  };

  /* ─── auction search for create modal ──────────────────────────────── */
  const searchAuctionCards = async (q) => {
    if (q.length < 2) { setAuctionSearchResults([]); return; }
    try {
      const res = await fetch('/api/catalog/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      setAuctionSearchResults(data.results || []);
    } catch { setAuctionSearchResults([]); }
  };

  useEffect(() => {
    const t = setTimeout(() => { if (auctionSearch) searchAuctionCards(auctionSearch); }, 300);
    return () => clearTimeout(t);
  }, [auctionSearch]);

  const createAuction = async () => {
    if (!token) { toast('Please log in first', true); return; }
    if (!auctionCard) { toast('Select a card first', true); return; }
    if (!auctionStartBid || Number(auctionStartBid) < 0.01) { toast('Enter a starting bid', true); return; }
    setSubmittingAuction(true);
    try {
      const res = await fetch('/api/auctions/create', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: auctionCard.id,
          startingBid: Number(auctionStartBid),
          reservePrice: auctionReserve ? Number(auctionReserve) : null,
          durationHours: auctionDuration,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create auction');
      toast(`Auction created for ${auctionCard.player}! `);
      setCreateAuctionModal(false);
      setAuctionCard(null);
      setAuctionSearch('');
      setAuctionStartBid('');
      setAuctionReserve('');
      setAuctionDuration(24);
      loadAuctions();
    } catch (e) { toast(e.message, true); }
    finally { setSubmittingAuction(false); }
  };

  /* ─── want/bid creation ─────────────────────────────────────────────── */
  const searchCards = async (q) => {
    if (q.length < 2) { setWantResults([]); return; }
    try {
      const res = await fetch('/api/catalog/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      setWantResults(data.results || []);
    } catch { setWantResults([]); }
  };

  useEffect(() => {
    const t = setTimeout(() => { if (wantSearch) searchCards(wantSearch); }, 300);
    return () => clearTimeout(t);
  }, [wantSearch]);

  const submitWant = async () => {
    if (!token) { toast('Please log in first', true); return; }
    if (!wantCard) { toast('Select a card first', true); return; }
    if (!wantAmount || Number(wantAmount) <= 0) { toast('Enter a bid amount', true); return; }
    setSubmittingWant(true);
    try {
      const res = await fetch('/api/wants', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: wantCard.id, bidAmount: Number(wantAmount), boostCredits: wantBoost || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to place bid');
      toast('Bid placed! ');
      setWantModal(false);
      setWantCard(null);
      setWantAmount('');
      setWantBoost(0);
      setWantSearch('');
      loadWants();
      loadTopBids();
    } catch (e) { toast(e.message, true); }
    finally { setSubmittingWant(false); }
  };

  /* ─── boost ─────────────────────────────────────────────────────────── */
  const submitBoost = async () => {
    if (!token) { toast('Please log in first', true); return; }
    setSubmittingBoost(true);
    try {
      const res = await fetch(`/api/wants/${boostModal.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ boostCredits: boostAmount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Boost failed');
      toast(`Boosted! `);
      setBoostModal(null);
      loadWants();
      loadTopBids();
    } catch (e) { toast(e.message, true); }
    finally { setSubmittingBoost(false); }
  };

  /* ─── match ─────────────────────────────────────────────────────────── */
  const submitMatch = async () => {
    if (!token) { toast('Please log in first', true); return; }
    setSubmittingMatch(true);
    try {
      const res = await fetch(`/api/wants/${matchModal.id}/match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Match failed');
      if (data.url) { window.location.href = data.url; return; }
      toast('Matched! ');
      setMatchModal(null);
      loadWants();
      loadTopBids();
    } catch (e) { toast(e.message, true); }
    finally { setSubmittingMatch(false); }
  };

  /* ─── cancel own want ───────────────────────────────────────────────── */
  const cancelWant = async (wantId) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/wants/${wantId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast('Bid cancelled');
      loadWants();
      loadTopBids();
    } catch (e) { toast(e.message, true); }
  };

  /* ─── render ────────────────────────────────────────────────────────── */
  return (
    <>
      {/* ══════════ HERO ══════════ */}
      <div className="live-hero">
        <div className="live-hero-bg" />
        <div className="live-hero-content">
          <div className="live-hero-eyebrow">
            <span className="live-pulse-dot" />
            <span className="live-eyebrow-text">LIVE TRADING FLOOR</span>
            <span className="live-hero-divider" />
            <span className="live-hero-stats">
              {(liveAuctions.length + wants.length) > 0
                ? `${liveAuctions.length} auction${liveAuctions.length !== 1 ? 's' : ''} \u00b7 ${wants.length} open bid${wants.length !== 1 ? 's' : ''}`
                : cardsPriced > 0
                  ? `${cardsPriced.toLocaleString()} cards priced live`
                  : 'The floor is open'}
            </span>
          </div>
          <h1 className="live-hero-title">The Hobby,<br /><span className="live-hero-gold">In Real Time.</span></h1>
          <p className="live-hero-sub">Bid on live auctions. Post open bids. Find your grail on the floor.</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-lg" onClick={() => { if (!token) { toast('Please log in first', true); return; } setCreateAuctionModal(true); }}>
              + List a Card for Auction
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => { if (!token) { toast('Please log in first', true); return; } setWantModal(true); }}>
              Post an Open Bid
            </button>
          </div>
        </div>
      </div>

      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <div className="live-search-wrap">
        <svg className="live-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search player, set, sport..."
          className="live-search-input"
        />
      </div>

      {/* ── Top Bids carousel ─────────────────────────────────────────── */}
      {topBids.length > 0 && (
        <div className="live-section" style={{ marginBottom: 28 }}>
          <div className="live-section-header">
            <h3 className="live-section-title">Top Bids</h3>
            <span className="live-section-sub">Most-wanted cards right now</span>
          </div>
          <div className="live-top-bids-rail">
            {topBids.map(w => {
              const tier = boostTier(w.boost_credits);
              return (
                <div key={w.id} className={`live-top-bid-card ${tier?.cls || ''}`} onClick={() => setMatchModal(w)}>
                  <div className="live-top-bid-img-wrap">
                    <CardThumb item={w} size={44} />
                  </div>
                  <div className="live-top-bid-info">
                    <div className="live-top-bid-player">{w.player}</div>
                    <div className="live-top-bid-meta">{w.grader} {w.grade}</div>
                    {creditsOn && tier && <BoostBadge credits={w.boost_credits} />}
                  </div>
                  <div className="live-top-bid-price">
                    <div className="live-top-bid-amount">{fmt(Number(w.bid_amount) / 100)}</div>
                    <div className="live-top-bid-label">open bid</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="live-tabs-wrap">
        <div className="live-tabs">
          <button
            className={`live-tab-pill ${tab === 'auctions' ? 'on' : ''}`}
            onClick={() => setTab('auctions')}
          >
            <span className={`live-tab-dot ${tab === 'auctions' ? 'visible' : ''}`} />
            Live Auctions
            {liveAuctions.length > 0 && <span className="live-tab-badge">{liveAuctions.length}</span>}
          </button>
          <button
            className={`live-tab-pill ${tab === 'bids' ? 'on' : ''}`}
            onClick={() => setTab('bids')}
          >
            Open Bids
            {wants.length > 0 && <span className="live-tab-badge">{wants.length}</span>}
          </button>

        </div>
      </div>

      {/* ══════════ AUCTIONS TAB ══════════ */}
      {tab === 'auctions' && (
        <>
          {/* Sort bar */}
          <div className="toolbar" style={{ marginBottom: 18 }}>
            <select className="sortsel" value={auctionSort} onChange={e => setAuctionSort(e.target.value)}>
              <option value="ending_soon">Ending Soon</option>
              <option value="price_high">Price: High → Low</option>
              <option value="price_low">Price: Low → High</option>
              <option value="most_bids">Most Bids</option>
              <option value="newest">Newest</option>
            </select>
            <span className="count">{liveAuctions.length} live · {upcomingAuctions.length} upcoming</span>
            <div className="spacer" />
            <button
              onClick={() => { if (!token) { toast('Please log in first', true); return; } setCreateAuctionModal(true); }}
              className="live-place-bid-btn"
              style={{ background: 'var(--gold)', color: '#000', fontWeight: 700 }}
            >
              + List a Card for Auction
            </button>
          </div>

          {liveAuctions.length > 0 ? (
            <div className="live-auction-grid">
              {liveAuctions.map(a => (
                <div key={a.id} className="live-auction-card" onClick={() => openBidModal(a)}>
                  {/* Card Image */}
                  <div className="live-auction-img-wrap">
                    {(a.ebay_thumb || a.image_url) ? (
                      <img src={a.ebay_thumb || a.image_url} alt="" className="live-auction-img" onError={e => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="live-auction-img-fallback">
                        {(a.player || '').split(' ').map(w => w[0]).join('').slice(0, 3)}
                      </div>
                    )}
                    {/* Glass overlay gradient */}
                    <div className="live-auction-img-overlay" />
                    {/* LIVE badge */}
                    <div className="live-auction-badge">
                      <span className="live-auction-badge-dot" /> LIVE
                    </div>
                    {/* Countdown on image */}
                    <div className="live-auction-countdown">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <Countdown endTime={a.end_time} showUrgency />
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="live-auction-body">
                    <div className="live-auction-player">{a.player}</div>
                    <div className="live-auction-meta">
                      {a.grader} {a.grade} {' '}{a.card_set}
                      {a.seller_handle && <span style={{ color: 'var(--dim)' }}>{' '}@{a.seller_handle}</span>}
                    </div>
                    {/* FMV comparison + reserve status */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {a.catalog_price > 0 && (() => {
                        const cur = a.current_price / 100;
                        const fmv = a.catalog_price;
                        const pct = Math.round(((fmv - cur) / fmv) * 100);
                        if (pct >= 5) return <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'var(--up-soft)', color: 'var(--up)' }}>{pct}% below FMV {fmt(fmv)}</span>;
                        if (pct <= -5) return <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'var(--down-soft)', color: 'var(--down)' }}>{Math.abs(pct)}% over FMV {fmt(fmv)}</span>;
                        return <span style={{ fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 7px', borderRadius: 5, background: 'var(--panel-2)', color: 'var(--muted)' }}>Near FMV {fmt(fmv)}</span>;
                      })()}
                      {a.has_reserve && (
                        <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 600, padding: '2px 7px', borderRadius: 5,
                          background: a.reserve_met ? 'var(--up-soft)' : 'var(--panel-2)',
                          color: a.reserve_met ? 'var(--up)' : 'var(--muted)',
                          border: a.reserve_met ? 'none' : '1px dashed var(--line-2)' }}>
                          {a.reserve_met ? '✓ Reserve met' : 'Reserve not met'}
                        </span>
                      )}
                    </div>
                    <div className="live-auction-foot">
                      <div className="live-auction-bid-info">
                        <div className="live-auction-bid-label">CURRENT BID</div>
                        <div className="live-auction-bid-amount">{fmt(a.current_price / 100)}</div>
                        <div className="live-auction-bid-count">
                          {a.bid_count || 0} bid{(a.bid_count || 0) !== 1 ? 's' : ''}
                          {a.highest_bidder && a.bid_count > 0 && <span style={{ color: 'var(--dim)' }}>{' '}@{a.highest_bidder}</span>}
                        </div>
                      </div>
                      <button
                        className="live-auction-bid-btn"
                        onClick={e => { e.stopPropagation(); openBidModal(a); }}
                      >
                        Place Bid
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── Empty state (no live auctions) ─── */
            <div className="live-empty2">
              <div className="live-empty2-icon"><IconGavel size={30} /></div>
              <h2 className="live-empty2-title">No Live Auctions</h2>
              <p className="live-empty2-sub">The floor is open - be the first to list and every collector here sees your card.</p>
              <div className="live-empty2-steps">
                {[
                  ['1', 'List', 'a card from your collection'],
                  ['2', 'Bid', 'buyers compete in real time'],
                  ['3', 'Win', 'highest bid takes the card'],
                ].map(([n, label, desc]) => (
                  <div key={n} className="live-empty2-step"><span className="n">{n}</span><b>{label}</b> {desc}</div>
                ))}
              </div>
              <div className="live-empty2-ctas">
                <button className="live-empty-cta" onClick={() => { if (!token) { toast('Please log in first', true); return; } setCreateAuctionModal(true); }}>
                  Be the First to List →
                </button>
                <a href="/sell" className="live-empty-cta" style={{ background: 'var(--panel-2)', color: 'var(--txt)', border: '1px solid var(--line-2)' }}>
                  Sell a Card
                </a>
              </div>
            </div>
          )}

          {upcomingAuctions.length > 0 && (
            <>
              <h3 className="live-section-title" style={{ marginTop: 36, marginBottom: 16, fontSize: 18 }}>Coming Up</h3>
              <div className="live-auction-grid">
                {upcomingAuctions.map(a => (
                  <div key={a.id} className="live-auction-card live-auction-card--upcoming">
                    <div className="live-auction-img-wrap">
                      {(a.ebay_thumb || a.image_url) ? (
                        <img src={a.ebay_thumb || a.image_url} alt="" className="live-auction-img" style={{ opacity: 0.7 }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <div className="live-auction-img-fallback" style={{ opacity: 0.5 }}>
                          {(a.player || '').split(' ').map(w => w[0]).join('').slice(0, 3)}
                        </div>
                      )}
                      <div className="live-auction-img-overlay" />
                      <div className="live-auction-upcoming-badge">UPCOMING</div>
                    </div>
                    <div className="live-auction-body">
                      <div className="live-auction-player">{a.player}</div>
                      <div className="live-auction-meta">{a.grader} {a.grade} {' '}{a.card_set}</div>
                      <div className="live-auction-foot">
                        <div className="live-auction-bid-info">
                          <div className="live-auction-bid-label">STARTING AT</div>
                          <div className="live-auction-bid-amount">{fmt(a.starting_price / 100)}</div>
                        </div>
                        <span className="live-upcoming-pill">Upcoming</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ══════════ OPEN BIDS TAB ══════════ */}
      {tab === 'bids' && (
        <>
          <div className="toolbar" style={{ marginBottom: 18 }}>
            <select className="sortsel" value={wantSort} onChange={e => setWantSort(e.target.value)}>
              {creditsOn && <option value="boost_desc">Most Boosted</option>}
              <option value="amount_desc">Highest Bid</option>
              <option value="newest">Newest</option>
              <option value="ending_soon">Ending Soon</option>
            </select>
            <span className="count">{wants.length} open bids</span>
            <div className="spacer" />
            <button
              onClick={() => { if (!token) { toast('Please log in first', true); return; } setWantModal(true); }}
              className="live-place-bid-btn"
            >
              + Place a Bid
            </button>
          </div>

          {wants.length > 0 ? (
            <div className="live-wants-grid">
              {wants.map(w => {
                const tier = boostTier(w.boost_credits);
                const isOwn = w.user_id === userId;
                return (
                  <div key={w.id} className={`live-want-card ${tier?.cls || ''}`}>
                    {/* Card image section */}
                    <div className="live-want-img-wrap">
                      <CardThumb item={w} size={60} />
                      {tier && <div className="live-want-boost-glow" />}
                    </div>
                    {/* Info */}
                    <div className="live-want-info">
                      <div className="live-want-player">{w.player}</div>
                      <div className="live-want-meta">{w.grader} {w.grade} {' '}{w.card_set}</div>
                      <div className="live-want-buyer">@{w.buyer_handle}</div>
                      {creditsOn && tier && <BoostBadge credits={w.boost_credits} />}
                    </div>
                    {/* Price + actions */}
                    <div className="live-want-right">
                      <div className="live-want-amount">{fmt(Number(w.bid_amount) / 100)}</div>
                      <div className="live-want-expires">exp. {new Date(w.expires_at).toLocaleDateString()}</div>
                      <div className="live-want-actions">
                        {isOwn ? (
                          <>
                            {creditsOn && (
                              <button onClick={() => { setBoostModal(w); setBoostAmount(10); }} className="live-want-boost-btn">
                                Boost
                              </button>
                            )}
                            <button onClick={() => cancelWant(w.id)} className="live-want-cancel-btn">✕</button>
                          </>
                        ) : (
                          <button onClick={() => setMatchModal(w)} className="live-want-match-btn">
                            I Have This
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="live-bids-empty">
              <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>No Open Bids Yet</h3>
              <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20, maxWidth: 340, margin: '0 auto 20px' }}>
                Post what you&#39;re looking for and sellers will come to you.
              </p>
              <button onClick={() => { if (!token) { toast('Please log in first', true); return; } setWantModal(true); }}
                className="live-empty-cta" style={{ display: 'inline-block' }}>
                Place a Bid
              </button>
            </div>
          )}
        </>
      )}

      {/* ══════════ PACK RIP TAB ══════════ */}


      {/* ══════════ AUCTION BID MODAL ══════════ */}
      {bidModal && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setBidModal(null)}>
          <div className="live-modal">
            <div className="live-modal-header">
              <h3 className="live-modal-title">Place a Bid</h3>
              <button className="live-modal-close" onClick={() => setBidModal(null)}>✕</button>
            </div>
            <div className="live-modal-card-preview">
              <CardThumb item={bidModal} size={52} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{bidModal.player}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {bidModal.grader} {bidModal.grade} {' '}{bidModal.card_set}
                  {bidModal.seller_handle && ` @${bidModal.seller_handle}`}
                </div>
              </div>
            </div>
            <div className="live-modal-stats">
              <div className="live-modal-stat">
                <div className="live-modal-stat-label">CURRENT BID</div>
                <div className="live-modal-stat-value">{fmt(bidModal.current_price / 100)}</div>
              </div>
              <div className="live-modal-stat" style={{ textAlign: 'right' }}>
                <div className="live-modal-stat-label">ENDS IN</div>
                <div className="live-modal-stat-value" style={{ color: 'var(--down)', fontSize: 16 }}>
                  <Countdown endTime={bidModal.end_time} showUrgency />
                </div>
              </div>
            </div>
            {/* FMV + reserve context */}
            {(bidModal.catalog_price > 0 || bidModal.has_reserve) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {bidModal.catalog_price > 0 && (
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                    FMV <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(bidModal.catalog_price)}</span>
                  </span>
                )}
                {bidModal.has_reserve && (
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: bidModal.reserve_met ? 'var(--up)' : 'var(--muted)' }}>
                    {bidModal.reserve_met ? '✓ Reserve met' : 'Reserve not met yet'}
                  </span>
                )}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              Min bid: ${minBidFor(bidModal).toFixed(2)}
            </div>
            {/* Quick-bid chips */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(() => {
                const cur = bidModal.current_price / 100;
                const min = minBidFor(bidModal);
                const opts = [
                  { label: `Min $${Math.ceil(min)}`, val: Math.ceil(min) },
                  { label: `+10% $${Math.ceil(cur * 1.1 < min ? min : cur * 1.1)}`, val: Math.ceil(Math.max(cur * 1.1, min)) },
                  { label: `+25% $${Math.ceil(cur * 1.25 < min ? min : cur * 1.25)}`, val: Math.ceil(Math.max(cur * 1.25, min)) },
                ];
                return opts.map(o => (
                  <button key={o.label} onClick={() => setBidAmount(String(o.val))}
                    style={{
                      flex: 1, padding: '7px 4px', borderRadius: 7, fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)',
                      background: Number(bidAmount) === o.val ? 'var(--gold-soft)' : 'var(--panel-2)',
                      color: Number(bidAmount) === o.val ? 'var(--gold)' : 'var(--muted)',
                      border: `1px solid ${Number(bidAmount) === o.val ? 'var(--gold)' : 'var(--line)'}`,
                      cursor: 'pointer',
                    }}>
                    {o.label}
                  </button>
                ));
              })()}
            </div>
            <div className="live-modal-input-wrap">
              <span className="live-modal-input-prefix">$</span>
              <input type="number" value={bidAmount} onChange={e => setBidAmount(e.target.value)}
                placeholder="0.00" min="1" step="0.01"
                className="live-modal-input" autoFocus />
            </div>
            {/* Bid history */}
            {bidHistory.length > 0 && (
              <div style={{ margin: '12px 0 2px', maxHeight: 130, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                {bidHistory.map((b, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', fontSize: 11 }}>
                    <span style={{ color: 'var(--muted)' }}>@{b.bidder_handle}</span>
                    <span style={{ color: 'var(--dim)', fontSize: 10 }}>{new Date(b.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="mono" style={{ fontWeight: 700, color: i === 0 ? 'var(--gold)' : 'var(--txt)' }}>{fmt(Number(b.amount) / 100)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="live-modal-actions">
              <button onClick={() => setBidModal(null)} className="live-modal-cancel">Cancel</button>
              <button onClick={placeBid} disabled={submittingBid} className="live-modal-submit">
                {submittingBid ? 'Placing...' : `Bid $${Number(bidAmount || 0).toFixed(2)}`}
              </button>
            </div>
            <div className="live-modal-footer-note">
              {bidModal.bid_count || 0} bid{(bidModal.bid_count || 0) !== 1 ? 's' : ''} so far · Auto-extends in last 2 min
            </div>
          </div>
        </div>
      )}

      {/* ══════════ WANT/BID MODAL ══════════ */}
      {wantModal && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setWantModal(false)}>
          <div className="live-modal">
            <div className="live-modal-header">
              <h3 className="live-modal-title">Place a Bid</h3>
              <button className="live-modal-close" onClick={() => setWantModal(false)}>✕</button>
            </div>

            {!wantCard ? (
              <>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Search for a card you want to buy:</p>
                <input type="text" value={wantSearch} onChange={e => setWantSearch(e.target.value)}
                  placeholder="Search player, set..."
                  autoFocus
                  style={{ width: '100%', padding: '10px 14px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--txt)', fontSize: 14, outline: 'none', marginBottom: 10 }} />
                <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {wantResults.map(c => (
                    <div key={c.id} onClick={() => setWantCard(c)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
                      <CardThumb item={c} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.player}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.grader} {c.grade} {' '}{c.card_set}</div>
                      </div>
                      {c.catalog_price && <span className="mono" style={{ fontSize: 12, color: 'var(--gold)' }}>{fmt(Number(c.catalog_price))}</span>}
                    </div>
                  ))}
                  {wantSearch.length >= 2 && wantResults.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 16, color: 'var(--dim)', fontSize: 12 }}>No cards found. Try a different search.</div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--ink)', borderRadius: 10, marginBottom: 14 }}>
                  <CardThumb item={wantCard} size={40} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{wantCard.player}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{wantCard.grader} {wantCard.grade} {' '}{wantCard.card_set}</div>
                  </div>
                  <button onClick={() => setWantCard(null)} style={{ color: 'var(--muted)', fontSize: 12 }}>Change</button>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>Your bid amount</label>
                  <div className="live-modal-input-wrap">
                    <span className="live-modal-input-prefix">$</span>
                    <input type="number" value={wantAmount} onChange={e => setWantAmount(e.target.value)}
                      placeholder="0.00" min="1" step="0.01"
                      className="live-modal-input" />
                  </div>
                </div>

                {creditsOn && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: 'block' }}>Boost your bid (optional)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { credits: 0, label: 'None', icon: '' },
                      { credits: 10, label: 'Hot', icon: '' },
                      { credits: 25, label: 'Super', icon: '' },
                      { credits: 50, label: 'Diamond', icon: '' },
                    ].map(b => (
                      <button key={b.credits} onClick={() => setWantBoost(b.credits)}
                        style={{
                          flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                          textAlign: 'center',
                          background: wantBoost === b.credits ? 'var(--gold-soft)' : 'var(--panel-2)',
                          color: wantBoost === b.credits ? 'var(--gold)' : 'var(--muted)',
                          border: `1px solid ${wantBoost === b.credits ? 'var(--gold)' : 'var(--line)'}`,
                        }}>
                        {b.label}
                        {b.credits > 0 && <div style={{ fontSize: 10, marginTop: 2, opacity: 0.7 }}>{b.credits} cr</div>}
                      </button>
                    ))}
                  </div>
                </div>
                )}

                <div className="live-modal-actions">
                  <button onClick={() => setWantModal(false)} className="live-modal-cancel">Cancel</button>
                  <button onClick={submitWant} disabled={submittingWant} className="live-modal-submit">
                    {submittingWant ? 'Placing...' : 'Place Bid'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════ BOOST MODAL ══════════ */}
      {boostModal && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setBoostModal(null)}>
          <div className="live-modal" style={{ maxWidth: 380 }}>
            <div className="live-modal-header">
              <h3 className="live-modal-title">Boost Your Bid</h3>
              <button className="live-modal-close" onClick={() => setBoostModal(null)}>✕</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              Boosted bids appear higher and get visual treatment. Current boost: {boostModal.boost_credits || 0} credits.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[
                { credits: 10, label: 'Hot', desc: 'Gold highlight' },
                { credits: 25, label: 'Super', desc: 'Gold border + badge' },
                { credits: 50, label: 'Diamond', desc: 'Top + animated glow' },
              ].map(b => (
                <button key={b.credits} onClick={() => setBoostAmount(b.credits)}
                  style={{
                    flex: 1, padding: '10px 6px', borderRadius: 8, fontSize: 12, fontWeight: 600, textAlign: 'center',
                    background: boostAmount === b.credits ? 'var(--gold-soft)' : 'var(--panel-2)',
                    color: boostAmount === b.credits ? 'var(--gold)' : 'var(--muted)',
                    border: `1px solid ${boostAmount === b.credits ? 'var(--gold)' : 'var(--line)'}`,
                  }}>
                  {b.label}
                  <div style={{ fontSize: 10, marginTop: 3, opacity: 0.7 }}>{b.credits} credits</div>
                  <div style={{ fontSize: 9, marginTop: 2, opacity: 0.5 }}>{b.desc}</div>
                </button>
              ))}
            </div>
            <div className="live-modal-actions">
              <button onClick={() => setBoostModal(null)} className="live-modal-cancel">Cancel</button>
              <button onClick={submitBoost} disabled={submittingBoost} className="live-modal-submit">
                {submittingBoost ? '...' : `Boost (${boostAmount} cr)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MATCH MODAL ══════════ */}
      {matchModal && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setMatchModal(null)}>
          <div className="live-modal" style={{ maxWidth: 400 }}>
            <div className="live-modal-header">
              <h3 className="live-modal-title">Match This Bid</h3>
              <button className="live-modal-close" onClick={() => setMatchModal(null)}>✕</button>
            </div>
            <div className="live-modal-card-preview">
              <CardThumb item={matchModal} size={52} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{matchModal.player}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{matchModal.grader} {matchModal.grade} {' '}{matchModal.card_set}</div>
              </div>
            </div>
            <div className="live-modal-stats">
              <div className="live-modal-stat">
                <div className="live-modal-stat-label">BID AMOUNT</div>
                <div className="live-modal-stat-value" style={{ fontSize: 26 }}>{fmt(Number(matchModal.bid_amount) / 100)}</div>
              </div>
              <div className="live-modal-stat" style={{ textAlign: 'right' }}>
                <div className="live-modal-stat-label">BUYER</div>
                <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>@{matchModal.buyer_handle}</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              By matching, you agree to sell this card at the bid price. The buyer will be charged and you&#39;ll receive payment minus a 0.75% fee.
            </p>
            <div className="live-modal-actions">
              <button onClick={() => setMatchModal(null)} className="live-modal-cancel">Cancel</button>
              <button onClick={submitMatch} disabled={submittingMatch}
                style={{ flex: 2, padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 700, background: 'var(--up)', color: '#04140c', cursor: submittingMatch ? 'wait' : 'pointer' }}>
                {submittingMatch ? 'Processing...' : 'Match & Sell'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Create Auction Modal ── */}
      {createAuctionModal && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setCreateAuctionModal(false)}>
          <div className="live-modal" style={{ maxWidth: 480 }}>
            <div className="live-modal-header">
              <h3 className="live-modal-title">List a Card for Auction</h3>
              <button className="live-modal-close" onClick={() => setCreateAuctionModal(false)}>✕</button>
            </div>

            {/* Card selection */}
            {!auctionCard ? (
              <>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Search for the card you want to auction:</p>
                <input
                  type="text"
                  value={auctionSearch}
                  onChange={e => setAuctionSearch(e.target.value)}
                  placeholder="Search player, set..."
                  autoFocus
                  style={{ width: '100%', padding: '10px 14px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--txt)', fontSize: 14, outline: 'none', marginBottom: 10 }}
                />
                <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {auctionSearchResults.map(c => (
                    <div key={c.id} onClick={() => { setAuctionCard(c); if (c.catalog_price) setAuctionStartBid(String((Number(c.catalog_price) * 0.7).toFixed(2))); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: 'var(--panel-2)', border: '1px solid var(--line)' }}
                      onMouseOver={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                      onMouseOut={e => e.currentTarget.style.borderColor = 'var(--line)'}
                    >
                      {(c.ebay_thumb || c.image_url) && (
                        <img src={c.ebay_thumb || c.image_url} alt="" style={{ width: 40, height: 52, objectFit: 'cover', borderRadius: 6 }} onError={e => e.target.style.display='none'} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.player}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.grader} {c.grade} {' '}{c.card_set}</div>
                      </div>
                      {c.catalog_price && <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>{fmt(Number(c.catalog_price))}</span>}
                    </div>
                  ))}
                  {auctionSearch.length >= 2 && auctionSearchResults.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 16, color: 'var(--dim)', fontSize: 12 }}>No cards found.</div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Selected card */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--ink)', borderRadius: 10, marginBottom: 16 }}>
                  {(auctionCard.ebay_thumb || auctionCard.image_url) && (
                    <img src={auctionCard.ebay_thumb || auctionCard.image_url} alt="" style={{ width: 44, height: 58, objectFit: 'cover', borderRadius: 6 }} onError={e => e.target.style.display='none'} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{auctionCard.player}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{auctionCard.grader} {auctionCard.grade} {' '}{auctionCard.card_set}</div>
                    {auctionCard.catalog_price && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', marginTop: 2 }}>FMV: {fmt(Number(auctionCard.catalog_price))}</div>}
                  </div>
                  <button onClick={() => setAuctionCard(null)} style={{ color: 'var(--muted)', fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'var(--panel-2)', border: '1px solid var(--line)', cursor: 'pointer' }}>Change</button>
                </div>

                {/* Auction settings */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5, display: 'block' }}>STARTING BID</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>$</span>
                      <input type="number" value={auctionStartBid} onChange={e => setAuctionStartBid(e.target.value)} placeholder="0.00" min="0.01" step="0.01"
                        style={{ width: '100%', padding: '10px 10px 10px 24px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 14, fontFamily: 'var(--mono)', outline: 'none' }} />
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5, display: 'block' }}>RESERVE (optional)</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>$</span>
                      <input type="number" value={auctionReserve} onChange={e => setAuctionReserve(e.target.value)} placeholder="0.00" min="0" step="0.01"
                        style={{ width: '100%', padding: '10px 10px 10px 24px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 14, fontFamily: 'var(--mono)', outline: 'none' }} />
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, display: 'block' }}>DURATION</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[{ h: 1, label: '1 hour' }, { h: 6, label: '6 hours' }, { h: 24, label: '24 hours' }, { h: 168, label: '7 days' }].map(opt => (
                      <button key={opt.h} onClick={() => setAuctionDuration(opt.h)}
                        style={{
                          flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          background: auctionDuration === opt.h ? 'var(--gold-soft)' : 'var(--panel-2)',
                          color: auctionDuration === opt.h ? 'var(--gold)' : 'var(--muted)',
                          border: `1px solid ${auctionDuration === opt.h ? 'var(--gold)' : 'var(--line)'}`,
                        }}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>

                <div className="live-modal-actions">
                  <button onClick={() => setCreateAuctionModal(false)} className="live-modal-cancel">Cancel</button>
                  <button onClick={createAuction} disabled={submittingAuction} className="live-modal-submit" style={{ background: 'var(--gold)', color: '#000' }}>
                    {submittingAuction ? 'Creating...' : 'List for Auction'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
