'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import { fmt, fmtDisplay } from '../lib/data';
import { toast } from '../lib/toast';
import CardDetail from '../components/CardDetail';
import CameraScanner from '../components/CameraScanner';
import SignupTeaser from '../components/SignupTeaser';
import PreviewGate, { SamplePortfolio } from '../components/PreviewGate';
import TradesContent from '../components/TradesContent';
import SellContent from '../components/SellContent';

export default function PortfolioPage() {
  const { token, authFetch } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState(null);
  const [pulls, setPulls] = useState([]);
  const [pullsLoading, setPullsLoading] = useState(false);

  // Sort & filter
  const [sortBy, setSortBy] = useState('value_desc');
  const [showCount, setShowCount] = useState(20);
  const [pullSearch, setPullSearch] = useState('');
  const [pullSort, setPullSort] = useState('value_desc');

  // Modal states
  const [subTab, setSubTab] = useState('cards');
  const [showSearch, setShowSearch] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(null); // cardId being added

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

  // Fetch pack pulls
  useEffect(() => {
    if (!token) return;
    setPullsLoading(true);
    authFetch('/api/packs/collection')
      .then(r => r.ok ? r.json() : { pulls: [] })
      .then(d => setPulls(d.pulls || []))
      .catch(() => {})
      .finally(() => setPullsLoading(false));
  }, [token, authFetch]);

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
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, doSearch]);

  // Add card to portfolio
  const addCard = useCallback(async (cardId) => {
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
        setShowSearch(false);
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

  // Camera scan result handler
  const handleScanResult = useCallback(async (cardInfo) => {
    setShowCamera(false);
    if (!cardInfo || !cardInfo.player) {
      toast('Could not identify card', true);
      return;
    }
    // Search catalog for a match
    try {
      const res = await fetch('/api/catalog/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: cardInfo.player }),
      });
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        // Find best match by grader/grade
        const match = data.results.find(r =>
          r.grader === cardInfo.grader && r.grade === cardInfo.grade
        ) || data.results[0];
        await addCard(match.id);
      } else {
        // Create via catalog/create if no match, then add
        const createRes = await authFetch('/api/catalog/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player: cardInfo.player,
            year: cardInfo.year,
            set: cardInfo.set,
            cardNumber: cardInfo.cardNumber,
            grader: cardInfo.grader || 'RAW',
            grade: cardInfo.grade || '',
            sport: cardInfo.sport || 'Other',
          }),
        });
        if (createRes.ok) {
          const newCard = await createRes.json();
          await addCard(newCard.id);
        } else {
          toast('Could not add scanned card', true);
        }
      }
    } catch {
      toast('Failed to search catalog', true);
    }
  }, [addCard, authFetch]);

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

      {subTab === 'cards' && <>
      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 20, marginBottom: 24, flexWrap: 'wrap' }}>
        <button className="buy" style={{ padding: '10px 20px', fontSize: 13 }} onClick={() => setShowSearch(true)}>
          + Search &amp; Add Card
        </button>
        <button className="offer" style={{ padding: '10px 20px', fontSize: 13 }} onClick={() => setShowCamera(true)}>
          Scan Card
        </button>
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

      {/* Sort toolbar */}
      {items.length > 0 && (
        <div className="toolbar" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
            Showing {Math.min(showCount, items.length)} of {items.length}
          </span>
        </div>
      )}

      {/* Portfolio items */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>Loading portfolio...</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
          <p style={{ fontSize: 15, marginBottom: 8 }}>Your portfolio is empty</p>
          <p style={{ fontSize: 13 }}>Search the catalog or scan a card to get started</p>
        </div>
      ) : (
        <div className="holdings">
          {[...items].sort((a, b) => {
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
              {item.pnlPct !== null && (
                <div className={`num ${item.pnl >= 0 ? 'up' : 'down'}`}>
                  {item.pnl >= 0 ? '+' : ''}{item.pnlPct}%
                  <small>{item.purchasePrice ? fmt(item.purchasePrice) : ''} cost</small>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {item.isListed && (
                  <span style={{ fontSize: 10, color: 'var(--gold)', fontFamily: 'var(--mono)', padding: '2px 6px', background: 'var(--gold-soft)', borderRadius: 4 }}>LISTED</span>
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

      {/* Search Catalog Modal */}
      {showSearch && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setShowSearch(false)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <button className="modal-close" onClick={() => setShowSearch(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <h2 style={{ fontFamily: 'var(--disp)', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Search Catalog</h2>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Search by player name, set, sport..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
                style={{
                  width: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
                  borderRadius: 10, padding: '11px 14px', color: 'var(--txt)', fontSize: 14, outline: 'none',
                }}
              />
            </div>
            {searching && <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 12 }}>Searching...</div>}
            {!searching && searchResults.length === 0 && searchQuery.length >= 2 && (
              <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>No cards found</div>
            )}
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {searchResults.map(card => (
                <div key={card.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  borderRadius: 8, cursor: 'pointer', transition: '.15s',
                  background: adding === card.id ? 'var(--panel-2)' : 'transparent',
                }}
                  onMouseEnter={e => { if (adding !== card.id) e.currentTarget.style.background = 'var(--panel)'; }}
                  onMouseLeave={e => { if (adding !== card.id) e.currentTarget.style.background = 'transparent'; }}
                  onClick={() => addCard(card.id)}
                >
                  <div style={{
                    width: 36, height: 48, borderRadius: 6, flexShrink: 0,
                    background: card.ebay_thumb || card.image_url
                      ? `url(${card.ebay_thumb || card.image_url}) center/cover`
                      : 'linear-gradient(135deg, var(--panel-2), var(--line))',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{card.player}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>
                      {card.card_set || card.set || ''} · {card.grader || 'RAW'} {card.grade || ''}
                      {card.sport ? ` · ${card.sport}` : ''}
                    </div>
                  </div>
                  {card.catalog_price && (
                    <div className="mono" style={{ fontSize: 13, color: 'var(--gold)' }}>
                      {fmt(Number(card.catalog_price))}
                    </div>
                  )}
                  {adding === card.id ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Adding...</span>
                  ) : (
                    <span style={{ fontSize: 18, color: 'var(--up)' }}>+</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* My Pulls Section */}
      {pulls.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Digital Collection</div>
          <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Cards from Packs ({pulls.length})</h3>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
              <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="text" value={pullSearch} onChange={e => { setPullSearch(e.target.value); setShowCount(20); }}
                placeholder="Search pulls..."
                style={{ width: '100%', padding: '8px 12px 8px 30px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 12, outline: 'none' }} />
            </div>
            <select className="sortsel" value={pullSort} onChange={e => setPullSort(e.target.value)} style={{ fontSize: 12 }}>
              <option value="value_desc">Value High→Low</option>
              <option value="value_asc">Value Low→High</option>
              <option value="name_asc">Player A→Z</option>
              <option value="newest">Newest First</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {(() => {
              const q = pullSearch.toLowerCase();
              let filtered = q ? pulls.filter(p => (p.player||'').toLowerCase().includes(q) || (p.card_set||'').toLowerCase().includes(q) || (p.sport||'').toLowerCase().includes(q)) : pulls;
              filtered = [...filtered].sort((a,b) => {
                const pa = Number(a.market||a.catalog_price||0), pb = Number(b.market||b.catalog_price||0);
                switch(pullSort) {
                  case 'value_asc': return pa - pb;
                  case 'name_asc': return (a.player||'').localeCompare(b.player||'');
                  case 'newest': return (b.pulled_at||'').localeCompare(a.pulled_at||'');
                  default: return pb - pa;
                }
              });
              return filtered.slice(0, showCount).map((pull, i) => {
              const price = Number(pull.market || pull.catalog_price || 0);
              const tierClass = price >= 5000 ? 'tier-mythic' : price >= 1500 ? 'tier-legendary' : price >= 500 ? 'tier-epic' : price >= 200 ? 'tier-rare' : price >= 50 ? 'tier-uncommon' : 'tier-common';
              return (
                <div key={pull.id || i}
                  className={tierClass}
                  onClick={() => setSelectedCard({
                    id: pull.card_id, player: pull.player, sport: pull.sport,
                    set: pull.card_set, grader: pull.grader, grade: pull.grade,
                    variant: pull.variant, market: price,
                    thumbnail: pull.thumbnail || pull.image_url,
                    cardhedge_id: pull.cardhedge_id,
                    ini: (pull.player || '').split(' ').map(w => w[0]).join('').slice(0,4).toUpperCase(),
                    theme: ['#2a2a2a', '#555'],
                  })}
                  style={{
                    cursor: 'pointer', background: 'var(--panel)', borderRadius: 12,
                    border: '1px solid var(--line)',
                    overflow: 'hidden', position: 'relative',
                  }}>
                  <div style={{
                    height: 120,
                    background: (pull.thumbnail || pull.image_url)
                      ? `url(${pull.thumbnail || pull.image_url}) center/contain no-repeat var(--panel-2)`
                      : 'linear-gradient(135deg, #2a2a2a, #555)',
                  }} />
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pull.player}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 10 }}>{pull.grader} {pull.grade}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: price >= 200 ? 'var(--gold)' : 'var(--txt)', marginTop: 2 }}>
                      {price > 0 ? '$' + price.toLocaleString() : '—'}
                    </div>
                  </div>
                </div>
              );
            });
            })()}
          </div>
          {pulls.length > showCount && (
            <div style={{ textAlign: 'center', margin: '12px 0' }}>
              <button onClick={() => setShowCount(c => c + 20)}
                style={{ padding: '8px 24px', borderRadius: 8, fontSize: 12, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>
                Show more ({pulls.length - showCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Camera Scanner Modal */}
      {showCamera && (
        <CameraScanner onResult={handleScanResult} onClose={() => setShowCamera(false)} />
      )}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
      </>}
    </>
  );
}
