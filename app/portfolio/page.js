'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import { fmt, fmtDisplay } from '../lib/data';
import { toast } from '../lib/toast';
import { SkeletonList } from '../components/Skeleton';
import CardDetail from '../components/CardDetail';
import CameraScanner from '../components/CameraScanner';
import SignupTeaser from '../components/SignupTeaser';
import PreviewGate, { SamplePortfolio } from '../components/PreviewGate';
import TradesContent from '../components/TradesContent';
import SellContent from '../components/SellContent';
import OffersContent from '../components/OffersContent';
import OrdersContent from '../components/OrdersContent';

export default function PortfolioPage() {
  const { token, authFetch, user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState(null);


  // Sort & filter
  const [sortBy, setSortBy] = useState('value_desc');
  const [showCount, setShowCount] = useState(20);
  const [holdingSearch, setHoldingSearch] = useState('');

  // Cost-basis editing
  const [costItem, setCostItem] = useState(null);
  const [costValue, setCostValue] = useState('');
  const [costSaving, setCostSaving] = useState(false);

  // Recently added (bulk-add UX)
  const [addedIds, setAddedIds] = useState(new Set());

  // Modal states
  const [subTab, setSubTab] = useState('cards');
  const [showSearch, setShowSearch] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [listingItem, setListingItem] = useState(null); // item to list for sale
  const [listingPrice, setListingPrice] = useState('');
  const [listingSubmitting, setListingSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]); // card families
  const [expandedFam, setExpandedFam] = useState(null); // family key with open tier picker
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(null); // cardId being added
  const [scanInfo, setScanInfo] = useState(null); // AI-extracted card info from camera scan (confirmation mode)
  const [verifyItem, setVerifyItem] = useState(null); // item in the verify chooser (scan vs cert)
  const [verifyScanItem, setVerifyScanItem] = useState(null); // item being verified by camera scan
  const [certValue, setCertValue] = useState('');
  const [certSaving, setCertSaving] = useState(false);

  // Fetch portfolio
  const fetchPortfolio = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try {
      const res = await authFetch('/api/portfolio');
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.warn('Failed to load portfolio', e);
    } finally {
      setLoading(false);
    }
  }, [token, authFetch]);

  useEffect(() => { fetchPortfolio(); }, [fetchPortfolio]);



  // Search catalog
  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch('/api/catalog/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      // Prefer grouped families (one row per card, grade tiers nested); fall back to flat results
      if (Array.isArray(data.families) && data.families.length) {
        setSearchResults(data.families);
      } else if (Array.isArray(data.results) && data.results.length) {
        setSearchResults(data.results.map(r => ({
          player: r.player, card_set: r.card_set, variant: r.variant || '', sport: r.sport || '',
          topPrice: Number(r.catalog_price) || 0, ebay_thumb: r.ebay_thumb, image_url: r.image_url,
          tiers: [{ id: r.id, grader: r.grader || 'RAW', grade: r.grade || '', price: Number(r.catalog_price) || 0 }],
        })));
      } else {
        setSearchResults([]);
      }
      setExpandedFam(null);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (scanInfo) return; // scan flow sets results directly; typing clears scanInfo and resumes text search
    const t = setTimeout(() => doSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, doSearch, scanInfo]);

  // Add card to portfolio — keeps the search modal OPEN so you can bulk-add
  const addCard = useCallback(async (cardId, { closeAfter = false } = {}) => {
    if (!token) { toast('Please log in first', true); return; }
    setAdding(cardId);
    try {
      const res = await authFetch('/api/portfolio/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, quantity: 1 }),
      });
      if (res.ok) {
        toast('Card added to portfolio ✓');
        setAddedIds(prev => new Set([...prev, cardId]));
        if (closeAfter) { setShowSearch(false); }
        setShowCamera(false);
        fetchPortfolio();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || 'Failed to add card', true);
      }
    } catch {
      toast('Failed to add card', true);
    } finally {
      setAdding(null);
    }
  }, [token, authFetch, fetchPortfolio]);

  // Save cost basis
  const saveCost = useCallback(async () => {
    if (!costItem) return;
    const p = costValue === '' ? null : parseFloat(costValue);
    if (p !== null && (isNaN(p) || p < 0)) { toast('Enter a valid amount', true); return; }
    setCostSaving(true);
    try {
      const res = await authFetch(`/api/portfolio/${costItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchasePrice: p }),
      });
      if (res.ok) {
        toast(p === null ? 'Cost cleared' : 'Cost basis saved ✓');
        setCostItem(null);
        setCostValue('');
        fetchPortfolio();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || 'Failed to save', true);
      }
    } catch { toast('Failed to save', true); }
    finally { setCostSaving(false); }
  }, [costItem, costValue, authFetch, fetchPortfolio]);

  // Share public collection link
  const shareCollection = useCallback(() => {
    const handle = user?.handle;
    if (!handle) { toast('Log in to share your collection', true); return; }
    const url = `${window.location.origin}/user/${handle}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => toast('Collection link copied ✓')).catch(() => toast(url));
    } else { toast(url); }
  }, [user]);

  // Remove card from portfolio
  const removeCard = useCallback(async (item) => {
    if (!token) return;
    try {
      // If it's listed, delist first
      if (item.isListed && item.id) {
        await authFetch('/api/portfolio/delist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ portfolioItemId: item.id }),
        });
      }
      const res = await authFetch(`/api/portfolio/${item.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast('Card removed from portfolio');
        fetchPortfolio();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || 'Failed to remove card', true);
      }
    } catch {
      toast('Failed to remove card', true);
    }
  }, [token, authFetch, fetchPortfolio]);

  // Save cert number for verification (pending review until PSA lookup exists)
  const submitCert = useCallback(async () => {
    if (!verifyItem || !certValue.trim()) return;
    setCertSaving(true);
    try {
      const res = await authFetch(`/api/portfolio/${verifyItem.id}/verify-cert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certNumber: certValue.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast(d.verified ? 'Card verified ✓' : (d.message || 'Cert saved — pending review'));
        setVerifyItem(null);
        setCertValue('');
        fetchPortfolio();
      } else {
        toast(d.error || 'Failed to save cert', true);
      }
    } catch { toast('Failed to save cert', true); }
    finally { setCertSaving(false); }
  }, [verifyItem, certValue, authFetch, fetchPortfolio]);

  // List card for sale
  const listCardForSale = useCallback(async () => {
    if (!listingItem || !listingPrice) return;
    const price = parseFloat(listingPrice);
    if (isNaN(price) || price <= 0) { toast('Enter a valid price', true); return; }
    setListingSubmitting(true);
    try {
      const res = await authFetch('/api/portfolio/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolioItemId: listingItem.id, price }),
      });
      if (res.ok) {
        toast('Card listed for sale ✓');
        setListingItem(null);
        setListingPrice('');
        fetchPortfolio();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || 'Failed to list card', true);
      }
    } catch { toast('Failed to list card', true); }
    finally { setListingSubmitting(false); }
  }, [listingItem, listingPrice, authFetch, fetchPortfolio]);

  // Camera scan result handler — opens a confirmation picker. NEVER auto-adds.
  const handleScanResult = useCallback(async (cardInfo) => {
    setShowCamera(false);
    if (!cardInfo || !cardInfo.player) {
      toast('Could not identify the card — try a clearer, well-lit photo', true);
      return;
    }
    setScanInfo(cardInfo);
    setAddedIds(new Set());
    setSearchQuery('');
    setSearchResults([]);
    setExpandedFam(null);
    setShowSearch(true);
    setSearching(true);
    try {
      // Progressive family search: full context (player + year + set) first, then fewer tokens.
      const parts = [cardInfo.player, cardInfo.year, cardInfo.set]
        .map(s => (s || '').toString().trim())
        .filter(Boolean);
      const queries = [];
      for (let n = parts.length; n >= 1; n--) queries.push(parts.slice(0, n).join(' '));
      let fams = [];
      for (const q of [...new Set(queries)]) {
        const res = await fetch('/api/catalog/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q }),
        });
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.families) && data.families.length) { fams = data.families; break; }
      }
      // Rank exact card-number matches first when the scan read a number.
      const norm = (v) => String(v || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
      const scanNum = norm(cardInfo.cardNumber);
      if (scanNum && fams.length > 1) {
        fams = [...fams].sort((a, b) =>
          (norm(a.number) === scanNum ? 0 : 1) - (norm(b.number) === scanNum ? 0 : 1));
      }
      setSearchResults(fams);
      // Single confident match → open its tier picker so the user just picks a version.
      if (fams.length === 1) {
        setExpandedFam(`${fams[0].player}|${fams[0].card_set}|${fams[0].variant || ''}|0`);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Calculate totals
  const totalValue = items.reduce((s, i) => s + (i.marketValue || 0), 0);
  const totalCost = items.reduce((s, i) => s + (i.purchasePrice || 0), 0);
  const totalPnl = totalCost > 0 ? totalValue - totalCost : 0;
  const totalPnlPct = totalCost > 0 ? ((totalPnl / totalCost) * 100).toFixed(1) : 0;

  const subTabBar = (
    <div style={{ display: 'flex', gap: 4, marginBottom: 18, marginTop: 16, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
      <button className={`live-tab ${subTab === 'cards' ? 'on' : ''}`} onClick={() => setSubTab('cards')}>
        My Cards
      </button>
      <button className={`live-tab ${subTab === 'trades' ? 'on' : ''}`} onClick={() => setSubTab('trades')}>
        Trades
      </button>
      <button className={`live-tab ${subTab === 'sell' ? 'on' : ''}`} onClick={() => setSubTab('sell')}>
        Sell
      </button>
      <button className={`live-tab ${subTab === 'offers' ? 'on' : ''}`} onClick={() => setSubTab('offers')}>
        Offers
      </button>
      <button className={`live-tab ${subTab === 'orders' ? 'on' : ''}`} onClick={() => setSubTab('orders')}>
        Orders
      </button>
    </div>
  );

  if (!token) {
    return (
      <>
        <div className="eyebrow">Your Collection</div>
        <h1 className="page">Portfolio</h1>
        <p className="sub">Every slab you own, marked to the live market. Cost basis, unrealized gains, and where the value sits.</p>
        {subTabBar}
        {subTab === 'trades' && <TradesContent />}
        {subTab === 'sell' && <SellContent />}
        {subTab === 'offers' && <OffersContent />}
        {subTab === 'orders' && <OrdersContent />}
        {subTab === 'cards' && (
          <PreviewGate
            icon="📂"
            cta="Track your collection"
            subtitle="Add cards by searching or scanning. See live market values, gains, and manage your portfolio."
            preview={<SamplePortfolio />}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="eyebrow">Your Collection</div>
      <h1 className="page">Portfolio</h1>
      <p className="sub">Every slab you own, marked to the live market. Cost basis, unrealized gains, and where the value sits.</p>

      {subTabBar}

      {subTab === 'trades' && <TradesContent />}
      {subTab === 'sell' && <SellContent />}
      {subTab === 'offers' && <OffersContent />}
      {subTab === 'orders' && <OrdersContent />}

      {subTab === 'cards' && <>
      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="buy" style={{ padding: '10px 20px', fontSize: 13 }} onClick={() => { setAddedIds(new Set()); setScanInfo(null); setShowSearch(true); }}>
          + Search &amp; Add Card
        </button>
        <button className="offer" style={{ padding: '10px 20px', fontSize: 13 }} onClick={() => setShowCamera(true)}>
          Scan Card
        </button>
        {user?.handle && items.length > 0 && (
          <button className="offer" style={{ padding: '10px 20px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }} onClick={shareCollection}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
            Share Collection
          </button>
        )}
      </div>

      {/* Summary stats */}
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '.08em' }}>TOTAL VALUE</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{fmt(totalValue)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '.08em' }}>CARDS</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{items.length}</div>
          </div>
          {totalCost > 0 && (
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '.08em' }}>P&amp;L</div>
              <div className={`mono ${totalPnl >= 0 ? 'up' : 'down'}`} style={{ fontSize: 22, fontWeight: 700 }}>
                {totalPnl >= 0 ? '+' : ''}{fmt(totalPnl)} ({totalPnlPct}%)
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sort + search toolbar */}
      {items.length > 0 && (
        <div className="toolbar" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 180px', maxWidth: 280 }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" value={holdingSearch} onChange={e => { setHoldingSearch(e.target.value); setShowCount(20); }}
              placeholder="Search your cards..."
              style={{ width: '100%', padding: '8px 12px 8px 30px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 13, outline: 'none' }} />
          </div>
          <select className="sortsel" value={sortBy} onChange={e => { setSortBy(e.target.value); setShowCount(20); }}>
            <option value="value_desc">Value: High → Low</option>
            <option value="value_asc">Value: Low → High</option>
            <option value="name_asc">Player A → Z</option>
            <option value="name_desc">Player Z → A</option>
            <option value="gain_desc">Biggest Gain</option>
            <option value="gain_asc">Biggest Loss</option>
            <option value="newest">Newest First</option>
          </select>
          <span className="count" style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {(() => { const q = holdingSearch.trim().toLowerCase(); const n = q ? items.filter(i => `${i.player} ${i.set} ${i.grader} ${i.grade} ${i.sport}`.toLowerCase().includes(q)).length : items.length; return `Showing ${Math.min(showCount, n)} of ${n}`; })()}
          </span>
        </div>
      )}

      {/* Portfolio items */}
      {loading ? (
        <SkeletonList count={8} />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🗂</div>
          <h3>No cards in your portfolio</h3>
          <p>Search the catalog or scan a cert number to add a physical card.</p>
        </div>
      ) : (
        <div className="holdings">
          {[...items].filter(i => {
            const q = holdingSearch.trim().toLowerCase();
            if (!q) return true;
            return `${i.player} ${i.set} ${i.grader} ${i.grade} ${i.sport}`.toLowerCase().includes(q);
          }).sort((a, b) => {
            switch(sortBy) {
              case 'value_desc': return (b.marketValue || 0) - (a.marketValue || 0);
              case 'value_asc': return (a.marketValue || 0) - (b.marketValue || 0);
              case 'name_asc': return (a.player || '').localeCompare(b.player || '');
              case 'name_desc': return (b.player || '').localeCompare(a.player || '');
              case 'gain_desc': return (b.pnlPct || 0) - (a.pnlPct || 0);
              case 'gain_asc': return (a.pnlPct || 0) - (b.pnlPct || 0);
              case 'newest': return (b.addedAt || '').localeCompare(a.addedAt || '');
              default: return 0;
            }
          }).slice(0, showCount).map(item => (
            <div key={item.id} className="hold" style={{ cursor: 'default', position: 'relative' }}>
              <div className="mini" style={{
                width: 38, height: 52, borderRadius: 6, flexShrink: 0,
                background: item.imageUrl
                  ? `url(${item.imageUrl}) center/cover`
                  : 'linear-gradient(135deg, var(--panel-2), var(--line))',
              }} />
              <div className="nm" style={{ flex: 1, minWidth: 0 }}>
                {item.player}
                <small>{item.set} · {item.grader} {item.grade}</small>
              </div>
              <div className="num">
                {item.marketValue ? fmt(item.marketValue) : '—'}
                <small>market</small>
              </div>
              {item.pnlPct !== null ? (
                <div className={`num ${item.pnl >= 0 ? 'up' : 'down'}`} onClick={() => { setCostItem(item); setCostValue(item.purchasePrice ? String(item.purchasePrice) : ''); }} style={{ cursor: 'pointer' }} title="Edit cost basis">
                  {item.pnl >= 0 ? '+' : ''}{item.pnlPct}%
                  <small>{item.purchasePrice ? fmt(item.purchasePrice) : ''} cost</small>
                </div>
              ) : (
                <button
                  onClick={() => { setCostItem(item); setCostValue(''); }}
                  title="Set what you paid to track P&L"
                  style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--dim)', padding: '3px 8px', borderRadius: 5, border: '1px dashed var(--line-2)', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                >+ cost</button>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {item.verificationStatus === 'verified' ? (
                  <span title={`Verified via ${item.verificationMethod || 'scan'}`} style={{ fontSize: 10, color: 'var(--gold)', fontFamily: 'var(--mono)', padding: '2px 6px', background: 'var(--gold-soft)', borderRadius: 4, whiteSpace: 'nowrap' }}>✓ VERIFIED</span>
                ) : item.verificationStatus === 'pending' ? (
                  <span title="Cert submitted — pending review. Scan the card for instant verification." style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', padding: '2px 6px', border: '1px dashed var(--line-2)', borderRadius: 4, whiteSpace: 'nowrap' }}>CERT PENDING</span>
                ) : (
                  <button
                    onClick={() => { setVerifyItem(item); setCertValue(item.certNumber || ''); }}
                    title="Verify ownership — required before selling"
                    style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', padding: '3px 8px', borderRadius: 5, border: '1px dashed var(--line-2)', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >VERIFY</button>
                )}
                {item.isListed ? (
                  <span style={{ fontSize: 10, color: 'var(--gold)', fontFamily: 'var(--mono)', padding: '2px 6px', background: 'var(--gold-soft)', borderRadius: 4 }}>LISTED</span>
                ) : (
                  <button
                    onClick={() => {
                      if (item.verificationStatus !== 'verified') { setVerifyItem(item); setCertValue(item.certNumber || ''); return; }
                      setListingItem(item); setListingPrice(item.marketValue ? (item.marketValue).toFixed(2) : '');
                    }}
                    title="List for sale"
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                      background: 'var(--panel-2)', border: '1px solid var(--line)',
                      color: 'var(--muted)', cursor: 'pointer', transition: '.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--gold-soft)'; e.currentTarget.style.color = 'var(--gold)'; e.currentTarget.style.borderColor = 'var(--gold)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--panel-2)'; e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
                  >
                    Sell
                  </button>
                )}
                <button
                  onClick={() => removeCard(item)}
                  title="Remove from portfolio"
                  style={{
                    width: 28, height: 28, display: 'grid', placeItems: 'center',
                    borderRadius: 6, background: 'transparent', color: 'var(--muted)',
                    transition: '.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--down-soft)'; e.currentTarget.style.color = 'var(--down)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {items.length > showCount && (
        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          <button onClick={() => setShowCount(c => c + 20)}
            style={{ padding: '10px 32px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--txt)', cursor: 'pointer' }}>
            Show more ({items.length - showCount} remaining)
          </button>
        </div>
      )}

      {/* List for Sale Modal */}
      {listingItem && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setListingItem(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <button className="modal-close" onClick={() => setListingItem(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <h2 style={{ fontFamily: 'var(--disp)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>List for Sale</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              {listingItem.player} · {[listingItem.grader, listingItem.grade].filter(Boolean).join(' ')}
            </div>
            {listingItem.marketValue > 0 && (
              <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12, fontFamily: 'var(--mono)' }}>
                Market value: <span style={{ color: 'var(--gold)' }}>{fmt(listingItem.marketValue)}</span>
              </div>
            )}
            <label style={{ fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '.08em', color: 'var(--muted)', display: 'block', marginBottom: 6 }}>LISTING PRICE ($)</label>
            <div style={{ position: 'relative', marginBottom: 20 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>$</span>
              <input
                type="number"
                value={listingPrice}
                onChange={e => setListingPrice(e.target.value)}
                placeholder="0.00"
                min="1"
                step="0.01"
                autoFocus
                style={{
                  width: '100%', padding: '10px 14px 10px 28px',
                  background: 'var(--ink)', border: '1px solid var(--line)',
                  borderRadius: 8, color: 'var(--txt)', fontSize: 16,
                  fontFamily: 'var(--mono)', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setListingItem(null)} style={{
                padding: '10px 20px', fontSize: 13, borderRadius: 8,
                background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer',
              }}>Cancel</button>
              <button
                onClick={listCardForSale}
                disabled={listingSubmitting || !listingPrice || parseFloat(listingPrice) <= 0}
                className="btn-primary"
                style={{ padding: '10px 24px', fontSize: 13, opacity: listingSubmitting ? 0.6 : 1 }}
              >
                {listingSubmitting ? 'Listing…' : 'List for Sale'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Catalog Modal */}
      {showSearch && (
        <div className="overlay on" onClick={e => { if (e.target === e.currentTarget) { setShowSearch(false); setScanInfo(null); } }}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <button className="modal-close" onClick={() => { setShowSearch(false); setScanInfo(null); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <h2 style={{ fontFamily: 'var(--disp)', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{scanInfo ? 'Is this your card?' : 'Search Catalog'}</h2>
            {scanInfo ? (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: 4 }}>📷 SCANNED</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {scanInfo.player}
                  {scanInfo.year ? ` · ${scanInfo.year}` : ''}{scanInfo.set ? ` ${scanInfo.set}` : ''}
                  {scanInfo.cardNumber ? ` · #${scanInfo.cardNumber}` : ''}
                  {scanInfo.grader ? ` · ${scanInfo.grader} ${scanInfo.grade || ''}`.trimEnd() : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Pick the exact card and version below — nothing is added until you choose.</div>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Add as many cards as you like — the search stays open.{addedIds.size > 0 && <span style={{ color: 'var(--up)', fontWeight: 600 }}> {addedIds.size} added this session ✓</span>}</p>
            )}
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <input
                type="text"
                placeholder={scanInfo ? 'Not right? Type to search the catalog…' : 'Search by player name, set, sport...'}
                value={searchQuery}
                onChange={e => { setScanInfo(null); setSearchQuery(e.target.value); }}
                autoFocus={!scanInfo}
                style={{
                  width: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
                  borderRadius: 10, padding: '11px 14px', color: 'var(--txt)', fontSize: 14, outline: 'none',
                }}
              />
            </div>
            {searching && <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 12 }}>{scanInfo ? 'Matching your scan against the catalog…' : 'Searching...'}</div>}
            {!searching && searchResults.length === 0 && (searchQuery.length >= 2 || scanInfo) && (
              <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>
                {scanInfo
                  ? `No catalog match for “${[scanInfo.player, scanInfo.year, scanInfo.set].filter(Boolean).join(' ')}” — edit the search above or re-scan with better lighting.`
                  : 'No cards found'}
              </div>
            )}
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {searchResults.map((fam, idx) => {
                const famKey = `${fam.player}|${fam.card_set}|${fam.variant}|${idx}`;
                const open = expandedFam === famKey;
                const tiers = fam.tiers || [];
                const tierLabel = (t) => t.grader === 'RAW' && !t.grade ? 'Raw' : `${t.grader} ${t.grade}`.trim();
                return (
                  <div key={famKey} style={{ borderRadius: 8, marginBottom: 2, background: open ? 'var(--panel)' : 'transparent', transition: '.15s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', cursor: 'pointer' }}
                      onMouseEnter={e => { if (!open) e.currentTarget.parentElement.style.background = 'var(--panel)'; }}
                      onMouseLeave={e => { if (!open) e.currentTarget.parentElement.style.background = 'transparent'; }}
                      onClick={() => setExpandedFam(open ? null : famKey)}
                    >
                      <div style={{
                        width: 36, height: 48, borderRadius: 6, flexShrink: 0,
                        background: fam.ebay_thumb || fam.image_url
                          ? `url(${fam.ebay_thumb || fam.image_url}) center/cover`
                          : 'linear-gradient(135deg, var(--panel-2), var(--line))',
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{fam.player}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {fam.card_set || ''}{fam.number ? ` #${fam.number}` : ''}{fam.variant && fam.variant !== 'Base' ? ` · ${fam.variant}` : ''}
                          {fam.sport ? ` · ${fam.sport}` : ''}
                        </div>
                      </div>
                      {fam.topPrice > 0 && (
                        <div className="mono" style={{ fontSize: 13, color: 'var(--gold)', flexShrink: 0 }}>
                          {fmt(fam.topPrice)}
                        </div>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                        {tiers.length} version{tiers.length !== 1 ? 's' : ''} {open ? '▴' : '▾'}
                      </span>
                    </div>
                    {open && (
                      <div style={{ padding: '2px 12px 10px 60px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {tiers.map(t => (
                          <div key={t.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                            borderRadius: 6, cursor: addedIds.has(t.id) ? 'default' : 'pointer',
                            border: '1px solid var(--line)', background: 'var(--ink)', transition: '.15s',
                          }}
                            onMouseEnter={e => { if (!addedIds.has(t.id)) e.currentTarget.style.borderColor = 'var(--up)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; }}
                            onClick={(e) => { e.stopPropagation(); if (!addedIds.has(t.id)) addCard(t.id); }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--mono)', flex: 1 }}>{tierLabel(t)}</span>
                            {t.price > 0 && <span className="mono" style={{ fontSize: 12, color: 'var(--gold)' }}>{fmt(t.price)}</span>}
                            {adding === t.id ? (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Adding...</span>
                            ) : addedIds.has(t.id) ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--up)', fontFamily: 'var(--mono)' }}>✓ Added</span>
                            ) : (
                              <span style={{ fontSize: 15, color: 'var(--up)', lineHeight: 1 }}>+</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Cost Basis Modal */}
      {costItem && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setCostItem(null)}>
          <div className="modal" style={{ maxWidth: 380 }}>
            <button className="modal-close" onClick={() => setCostItem(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <h2 style={{ fontFamily: 'var(--disp)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>What did you pay?</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              {costItem.player} · {[costItem.grader, costItem.grade].filter(Boolean).join(' ')}
              {costItem.marketValue > 0 && <span> · Market <span style={{ color: 'var(--gold)', fontFamily: 'var(--mono)' }}>{fmt(costItem.marketValue)}</span></span>}
            </div>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)' }}>$</span>
              <input type="number" value={costValue} onChange={e => setCostValue(e.target.value)}
                placeholder="0.00" min="0" step="0.01" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') saveCost(); }}
                style={{ width: '100%', padding: '10px 14px 10px 28px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 16, fontFamily: 'var(--mono)', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {costItem.purchasePrice != null && (
                <button onClick={() => { setCostValue(''); }} style={{ padding: '10px 14px', fontSize: 12, borderRadius: 8, background: 'none', border: '1px solid var(--line)', color: 'var(--dim)', cursor: 'pointer', marginRight: 'auto' }}>Clear</button>
              )}
              <button onClick={() => setCostItem(null)} style={{ padding: '10px 18px', fontSize: 13, borderRadius: 8, background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveCost} disabled={costSaving} className="btn-primary" style={{ padding: '10px 22px', fontSize: 13, opacity: costSaving ? 0.6 : 1 }}>
                {costSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Scanner Modal */}
      {showCamera && (
        <CameraScanner onResult={handleScanResult} onClose={() => setShowCamera(false)} />
      )}

      {/* Verify chooser — selling requires verification; scan or cert */}
      {verifyItem && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setVerifyItem(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <button className="modal-close" onClick={() => setVerifyItem(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <h2 style={{ fontFamily: 'var(--disp)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Verify this card</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              {verifyItem.player} · {[verifyItem.grader, verifyItem.grade].filter(Boolean).join(' ')}
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 18 }}>
              Buyers trust verified cards. Verify once and this card can be listed for sale —
              scan the physical card with your camera, or enter its grading cert number.
            </p>
            <button
              onClick={() => { setVerifyScanItem(verifyItem); setVerifyItem(null); }}
              className="btn-primary"
              style={{ width: '100%', padding: '12px 0', fontSize: 14, marginBottom: 14 }}
            >📷 Scan the card — instant verification</button>
            <div style={{ fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '.08em', color: 'var(--dim)', margin: '4px 0 6px' }}>OR — GRADED SLAB CERT NUMBER</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={certValue}
                onChange={e => setCertValue(e.target.value)}
                placeholder="e.g. 162798272"
                style={{ flex: 1, padding: '10px 14px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 14, fontFamily: 'var(--mono)', outline: 'none' }}
              />
              <button
                onClick={submitCert}
                disabled={certSaving || !certValue.trim()}
                style={{ padding: '10px 18px', fontSize: 13, borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)', cursor: 'pointer', opacity: certSaving || !certValue.trim() ? 0.5 : 1 }}
              >{certSaving ? 'Saving…' : 'Submit'}</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8 }}>
              Cert numbers are held for review — scanning verifies instantly.
            </p>
          </div>
        </div>
      )}

      {/* Verification scan — AI must match the claimed card */}
      {verifyScanItem && (
        <CameraScanner
          verifyItemId={verifyScanItem.id}
          onResult={() => { setVerifyScanItem(null); toast('Card verified ✓ — it can now be listed'); fetchPortfolio(); }}
          onClose={() => setVerifyScanItem(null)}
        />
      )}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
      </>}
    </>
  );
}
