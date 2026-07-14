'use client';
import { useState, useMemo, useEffect } from 'react';
import { useCardStore } from '../components/CardStore';
import { fmt, fmtDisplay, fmtRange } from '../lib/data';
import StatBar from '../components/StatBar';
import FilterSidebar, { PRICE_RANGES, ERAS } from '../components/FilterSidebar';
import CardItem from '../components/CardItem';
import CardDetail from '../components/CardDetail';
import Scout from '../components/Scout';
import SavedSearches from '../components/SavedSearches';
import { SkeletonCard } from '../components/Skeleton';
import DealFinder from '../components/DealFinder';

const PAGE_SIZE = 50;

// Unified surface: one page, three views. "Browse" is the public price-guide
// feed (SEO). "Deals" and "Worth Grading" are the Deal Finder tabs (free-
// account gated via ProGate). URL-driven + deep-linkable via ?tab=.
const MARKET_TABS = [
  ['browse', 'Browse'],
  ['deals', 'Deals'],
  ['grading', 'Worth Grading'],
];
const VALID_TABS = new Set(MARKET_TABS.map(t => t[0]));

function ListRow({ card: c, onClick }) {
  const isRC = (c.variant || '').toLowerCase().includes('rc') ||
               (c.variant || '').toLowerCase().includes('rookie') ||
               (c.set || '').toLowerCase().includes('rookie');

  return (
    <a className="list-row" href={`/card/${c.id}`}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
        e.preventDefault();
        onClick?.(c);
      }}>
      <div className="list-thumb">
        {c.thumbnail ? (
          <img src={c.thumbnail} alt={c.player} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 4 }}
               onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
        ) : null}
        <div style={{ display: c.thumbnail ? 'none' : 'flex', width: '100%', height: '100%', borderRadius: 4, background: `linear-gradient(135deg,${c.theme[0]},${c.theme[1]})`, alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: 'var(--disp)', fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,.6)' }}>{c.ini}</span>
        </div>
      </div>
      <div className="list-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="list-player">{c.player}</span>
          {isRC && <span className="rc-tag">RC</span>}
        </div>
        <div className="list-meta">
          <span>{c.set}</span>
          {c.variant && c.variant !== 'Base' && <span className="mchip mchip-var">{c.variant}</span>}
          {c.num && <span className="mchip">#{String(c.num).replace(/^#/, '')}</span>}
        </div>
      </div>
      <div className="list-sport">
        <span className="sport-badge" style={{ '--sport-color': c.theme[0] }}>{c.sport}</span>
      </div>
      <div className="list-grade">
        <span className={`grade ${c.grader === 'PSA' ? 'psa' : c.grader === 'BGS' ? 'bgs' : c.grader === 'SGC' ? 'sgc' : 'raw'}`}>
          {c.grader} {c.grade}
        </span>
      </div>
      <div className="list-price mono">
        {c.market > 0 ? fmtDisplay(c.market) : <span style={{ color: 'var(--dim)' }}>Price TBD</span>}
      </div>
      {c.lo > 0 && c.hi > 0 && (
        <div className="list-range mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          {fmtRange(c.lo, c.hi)}
        </div>
      )}
      <div className="list-action">
        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}>View</button>
      </div>
    </a>
  );
}

export default function MarketplacePage() {
  const { cards, searchQuery, setSearchQuery, totalCards, sportCounts, brandCounts, loadMore, refreshFeed, loading, currentPage, totalPages, filterSport, setFilterSport, filterBrand, setFilterBrand, setSortBy } = useCardStore();
  const DEFAULT_FILTERS = {
    sport: 'All', grade: 'All', type: 'All', cardType: 'all',
    priceRange: 'all', era: 'all', edge: 'all', sort: 'trending', q: '', brand: '',
  };
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const q = (searchQuery || filters.q || '').toLowerCase();
  const [selectedCard, setSelectedCard] = useState(null);
  // Mobile collapses Scout behind a toggle — the header typeahead is the one
  // always-visible search box on small screens (audit: two stacked inputs).
  const [scoutOpen, setScoutOpen] = useState(false);
  const [activeListings, setActiveListings] = useState([]);
  const [viewMode, setViewMode] = useState('grid'); // grid | list
  const [page, setPage] = useState(1);
  // Top-level view: browse (price guide feed) | deals | grading (Deal Finder).
  const [activeTab, setActiveTab] = useState('browse');

  useEffect(() => { setPage(1); }, [filters, searchQuery]);

  // Deal Finder views (deals/grading) commit the page to the dark trade-desk
  // theme; Browse stays on the light price-guide theme. Toggled at body level
  // so header/footer follow, and cleanly reverted on unmount / tab switch.
  useEffect(() => {
    if (activeTab === 'browse') return;
    document.body.classList.add('page-dark');
    return () => document.body.classList.remove('page-dark');
  }, [activeTab]);

  // Read the active tab from the URL on load + keep it in sync with back/
  // forward navigation (?tab=deals is shareable and history-friendly).
  useEffect(() => {
    const readTab = () => {
      try {
        const t = new URLSearchParams(window.location.search).get('tab');
        setActiveTab(VALID_TABS.has(t) ? t : 'browse');
      } catch { setActiveTab('browse'); }
    };
    readTab();
    window.addEventListener('popstate', readTab);
    return () => window.removeEventListener('popstate', readTab);
  }, []);

  const selectTab = (t) => {
    setActiveTab(t);
    try {
      const url = new URL(window.location.href);
      if (t === 'browse') url.searchParams.delete('tab');
      else url.searchParams.set('tab', t);
      window.history.pushState(null, '', url.toString());
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch {}
  };

  // Deep link from SEO card pages and shares: /market?card=<uuid> auto-opens
  // the interactive CardDetail overlay for that card (it self-hydrates from id).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const cid = sp.get('card');
      if (cid && UUID_RE.test(cid)) setSelectedCard({ id: cid });
      // Deep link from the landing Hot Board (and shares): /market?q=Player Name
      const q = (sp.get('q') || '').slice(0, 120);
      if (q) setSearchQuery(q);
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the URL shareable: reflect the open card in ?card= without navigation.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (selectedCard?.id && UUID_RE.test(String(selectedCard.id))) url.searchParams.set('card', selectedCard.id);
      else url.searchParams.delete('card');
      window.history.replaceState(null, '', url.toString());
    } catch {}
  }, [selectedCard]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always show fresh market data on every visit — no stale in-memory feed
  // between navigations (server CDN cache still applies and is fine).
  useEffect(() => { refreshFeed?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/listings?limit=200')
      .then(r => r.json())
      .then(d => setActiveListings(d.listings || []))
      .catch(() => {});
  }, []);

  const listingsByCard = useMemo(() => {
    const map = {};
    activeListings.forEach(l => {
      const cid = l.card_id || l.cardId;
      if (!map[cid]) map[cid] = [];
      map[cid].push(l);
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => Number(a.price) - Number(b.price)));
    return map;
  }, [activeListings]);

  const enrichedCards = useMemo(() => {
    return cards.map(c => {
      const cardListings = listingsByCard[c.id] || [];
      if (cardListings.length === 0) return c;
      const lowest = cardListings[0];
      return {
        ...c,
        hasListing: true,
        listingCount: cardListings.length,
        lowestListingPrice: Number(lowest.price),
        hasOffers: cardListings.some(l => l.open_to_offers || l.listing_type === 'offer'),
      };
    });
  }, [cards, listingsByCard]);

  const filtered = useMemo(() => {
    let r = enrichedCards.filter(c => {
      if (filters.sport !== 'All' && c.sport !== filters.sport) return false;
      if (filters.grade !== 'All' && c.grader !== filters.grade) return false;
      if (filters.type !== 'All' && c.type !== filters.type) return false;
      if (filters.edge === 'hot' && c.edge < 15) return false;

      // Price range preset
      const pr = PRICE_RANGES.find(p => p.key === (filters.priceRange || 'all'));
      if (pr && pr.key !== 'all' && c.market > 0 && (c.market < pr.min || c.market > pr.max)) return false;
      if (pr && pr.key !== 'all' && !(c.market > 0)) return false;

      // Era filter (by card year)
      const era = ERAS.find(e => e.key === (filters.era || 'all'));
      if (era && era.key !== 'all') {
        const y = parseInt(c.year) || 0;
        if (!y || y < era.min || y > era.max) return false;
      }

      // Card type filter
      if (filters.cardType === 'rookie') {
        const v = ((c.variant || '') + ' ' + (c.set || '')).toLowerCase();
        if (!v.includes('rc') && !v.includes('rookie')) return false;
      } else if (filters.cardType === 'parallel') {
        const v = ((c.variant || '') + ' ' + (c.set || '')).toLowerCase();
        if (!v.includes('silver') && !v.includes('gold') && !v.includes('prizm') && !v.includes('refractor') && !v.includes('parallel') && !v.includes('holo') && !v.includes('chrome') && !v.includes('alt art')) return false;
      } else if (filters.cardType === 'base') {
        const v = ((c.variant || '') + ' ' + (c.set || '')).toLowerCase();
        if (v.includes('rc') || v.includes('rookie') || v.includes('auto') || v.includes('silver') || v.includes('gold') || v.includes('refractor') || v.includes('parallel') || v.includes('holo') || v.includes('alt art')) return false;
      }

      // Tokenized AND match — same semantics as the server search: every word
      // must appear somewhere across player/set/variant/year/number/sport/grade
      // ("emeka egbuka donruss" = player + brand mixed in one query).
      if (q) {
        const hay = (c.player + ' ' + c.set + ' ' + c.variant + ' ' + (c.year || '') + ' ' + (c.num || '') + ' ' + c.sport + ' ' + c.grader + ' ' + c.grade).toLowerCase();
        if (!q.split(/\s+/).filter(Boolean).every(t => hay.includes(t))) return false;
      }

      // Hide cards with no player name AND no price AND no image
      if (!c.player || c.player === 'Unknown') return false;

      return true;
    });

    const sorters = {
      hi: (a, b) => (b.market || 0) - (a.market || 0),
      lo: (a, b) => {
        // Cards with price first, then by price ascending
        if (a.market > 0 && b.market <= 0) return -1;
        if (a.market <= 0 && b.market > 0) return 1;
        return (a.market || 0) - (b.market || 0);
      },
      az: (a, b) => (a.player || '').localeCompare(b.player || ''),
      newest: (a, b) => (b.id || 0) - (a.id || 0),
      sport: (a, b) => (a.sport || '').localeCompare(b.sport || '') || (b.market || 0) - (a.market || 0),
      edge: (a, b) => b.edge - a.edge,
    };

    r.sort((a, b) => {
      // Listings always first
      if (a.hasListing && !b.hasListing) return -1;
      if (!a.hasListing && b.hasListing) return 1;
      // Then boost rank
      const ba = a.boost ? a.boost.rank : 0, bb = b.boost ? b.boost.rank : 0;
      if (ba !== bb) return bb - ba;
      // Then cards with prices before no-price
      if (filters.sort !== 'az' && filters.sort !== 'sport' && filters.sort !== 'newest') {
        if (a.market > 0 && b.market <= 0) return -1;
        if (a.market <= 0 && b.market > 0) return 1;
      }
      return (sorters[filters.sort] || sorters.hi)(a, b);
    });
    return r;
  }, [enrichedCards, filters, q]);

  const clientPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showStart = filtered.length > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const showEnd = Math.min(page * PAGE_SIZE, filtered.length);

  const boosted = enrichedCards.filter(c => c.boost).sort((a, b) => b.boost.rank - a.boost.rank);

  // One page header for all three views — the tab bar lives INSIDE it, right
  // under the title, so it reads as part of the page instead of a floating pill.
  const HERO = {
    browse: ['Every card, priced live.', 'Browse real market prices powered by Card Hedge. Buy, sell, and trade cards with confidence. Every price is verified against live market data.'],
    deals: ['Deal Finder', 'Cards priced below fair value, fees already counted. Live across the whole market, refreshed all day.'],
    grading: ['Worth grading?', 'Run the numbers before you send a card in. Raw price, graded price, and grading cost, all in one view.'],
  };

  return (
    <>
      {/* Unified page header — title + native tab bar (Browse | Deals | Worth
          Grading). The tab bar sticks under the site header while scrolling.
          .market-hero collapses on mobile so cards land in the first viewport. */}
      <div className="market-hero">
        <div className="eyebrow">Marketplace</div>
        <h1 className="page">{HERO[activeTab][0]}</h1>
        <p className="sub">{HERO[activeTab][1]}</p>
      </div>
      <div className="market-tabs" role="tablist" aria-label="Market views">
        {MARKET_TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={activeTab === k}
            className={`market-tab ${activeTab === k ? 'on' : ''}`}
            onClick={() => selectTab(k)}>{label}</button>
        ))}
      </div>

      {activeTab !== 'browse' && <DealFinder view={activeTab} />}

      {activeTab === 'browse' && <>
      {/* Scout — AI Card Search (collapsed behind a toggle on mobile) */}
      <div className={`scout-wrap ${scoutOpen ? 'open' : ''}`} style={{ marginBottom: 24 }}>
        <button className="scout-toggle" onClick={() => setScoutOpen(o => !o)}>
          <span>✨ Scout. AI search: describe any card</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: scoutOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div className="scout-body">
        <Scout onSelect={c => {
          setSelectedCard({
            id: c.card_id,
            player: c.player || c.description,
            sport: c.category || 'Other',
            set: c.set || '',
            variant: c.variant || '',
            num: c.number || '',
            grader: c.stats_grade?.split(' ')[0] || 'RAW',
            grade: c.stats_grade?.split(' ')[1] || '',
            market: c.prices?.[0]?.price ? Number(c.prices[0].price) : 0,
            thumbnail: c.image ? (c.image.startsWith('//') ? 'https:' + c.image : c.image) : null,
            ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0,4).toUpperCase(),
            theme: ['#2a2a2a', '#555'],
            cardhedge_id: c.card_id,
            rookie: c.rookie || false,
            sales7d: c['7 Day Sales'] || 0,
            sales30d: c['30 Day Sales'] || 0,
            gain7d: c.gain || 0,
          });
        }} />
        </div>
      </div>

      {/* Mobile sport filter strip */}
      <div className="mobile-sport-strip">
        {['All', ...(sportCounts || []).filter(s => s.count > 0).map(s => s.sport)].map(s => (
          <button key={s} className={`sport-pill ${filters.sport === s ? 'on' : ''}`}
            onClick={() => {
              setFilters(f => ({ ...f, sport: s }));
              setFilterSport(s);
            }}>
            {s}{s !== 'All' && sportCounts ? ` ${((sportCounts.find(sc => sc.sport === s) || {}).count || 0) >= 1000 ? ((sportCounts.find(sc => sc.sport === s) || {}).count / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : (sportCounts.find(sc => sc.sport === s) || {}).count}` : ''}
          </button>
        ))}
      </div>

      <div className="layout">
        <FilterSidebar filters={filters} setFilters={(f) => {
          const newFilters = typeof f === 'function' ? f(filters) : f;
          setFilters(newFilters);
          if (newFilters.sport !== filters.sport) setFilterSport(newFilters.sport);
        }} cards={enrichedCards} sportCounts={sportCounts} brandCounts={brandCounts} totalCards={totalCards}
          onBrandChange={(b) => setFilterBrand(b)} />

        <div>
          {/* Featured / boosted strip */}
          {boosted.length > 0 && (
            <div className="featured-strip">
              <div className="fs-head">
                <span className="fs-title">Boosted right now</span>
                <span className="fs-sub">Sellers paid to push these to the front</span>
              </div>
              <div className="fs-track">
                {boosted.map(c => (
                  <div key={c.id} className="fs-card" onClick={() => setSelectedCard(c)}>
                    <div className="fs-slab" style={{ background: `linear-gradient(135deg,${c.theme[0]},${c.theme[1]})` }} />
                    <div className="fs-info">
                      <div className={`fs-rib ${c.boost.tier}`}>{c.boost.icon} {c.boost.label}</div>
                      <div className="fs-nm">{c.player}</div>
                      <div className="fs-meta">{c.grader} {c.grade} · {fmtDisplay(c.ask)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active filter chips */}
          {(() => {
            const chips = [];
            if (filters.sport !== 'All') chips.push({ k: 'sport', label: filters.sport, reset: { sport: 'All' } });
            if (filters.brand) chips.push({ k: 'brand', label: filters.brand, reset: { brand: '' } });
            if ((filters.priceRange || 'all') !== 'all') chips.push({ k: 'price', label: PRICE_RANGES.find(p => p.key === filters.priceRange)?.label, reset: { priceRange: 'all' } });
            if ((filters.era || 'all') !== 'all') chips.push({ k: 'era', label: ERAS.find(e => e.key === filters.era)?.label, reset: { era: 'all' } });
            if ((filters.cardType || 'all') !== 'all') chips.push({ k: 'ct', label: filters.cardType === 'rookie' ? 'Rookies' : filters.cardType === 'base' ? 'Base' : 'Parallels', reset: { cardType: 'all' } });
            if (filters.grade !== 'All') chips.push({ k: 'grade', label: filters.grade, reset: { grade: 'All' } });
            if (filters.type !== 'All') chips.push({ k: 'type', label: filters.type === 'buy' ? 'Buy it now' : 'Auction', reset: { type: 'All' } });
            if (chips.length === 0) return null;
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.1em', color: 'var(--dim)', textTransform: 'uppercase' }}>Filters:</span>
                {chips.map(ch => (
                  <button key={ch.k} onClick={() => {
                    setFilters(f => ({ ...f, ...ch.reset }));
                    if (ch.k === 'sport') setFilterSport('All');
                    if (ch.k === 'brand') setFilterBrand('');
                  }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 16, fontSize: 12, fontWeight: 600, background: 'var(--gold-soft)', color: 'var(--gold)', border: '1px solid rgba(22,199,132,.3)', cursor: 'pointer' }}>
                    {ch.label}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                ))}
                <button onClick={() => { setFilters(DEFAULT_FILTERS); setFilterSport('All'); setFilterBrand(''); }}
                  style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  Clear all
                </button>
              </div>
            );
          })()}

          {/* Saved searches (logged-in only — component renders null when logged out) */}
          <div style={{ marginBottom: 12 }}>
            <SavedSearches
              filters={filters}
              searchQuery={searchQuery}
              onApply={(params) => {
                const next = { ...DEFAULT_FILTERS, ...params };
                setFilters(next);
                setFilterSport(next.sport || 'All');
                setFilterBrand(next.brand || '');
                setSearchQuery(next.q || '');
                const sortMap = { hi: 'price_desc', lo: 'price_asc', az: 'player', newest: 'newest', trending: 'trending', gain: 'gain', volume: 'sales' };
                setSortBy(sortMap[next.sort] || 'trending');
              }}
            />
          </div>

          {/* Toolbar */}
          <div className="toolbar">
            <span className="count">
              {filtered.length > 0
                ? `Showing ${showStart} to ${showEnd} of ${totalCards > filtered.length ? totalCards.toLocaleString() + ' total' : filtered.length + ' result' + (filtered.length !== 1 ? 's' : '')}`
                : '0 results'}
            </span>
            <div className="spacer" />

            {/* View toggle */}
            <div className="seg">
              <button className={viewMode === 'grid' ? 'on' : ''} onClick={() => setViewMode('grid')} title="Grid view">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
              </button>
              <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')} title="List view">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2.5" rx="1"/><rect x="1" y="6.75" width="14" height="2.5" rx="1"/><rect x="1" y="11.5" width="14" height="2.5" rx="1"/></svg>
              </button>
            </div>

            <select className="sortsel" value={filters.sort}
              onChange={e => {
                const v = e.target.value;
                setFilters(f => ({ ...f, sort: v }));
                // Map UI sort values to server-side sort keys
                const sortMap = { hi: 'price_desc', lo: 'price_asc', az: 'player', newest: 'newest', trending: 'trending', gain: 'gain', volume: 'sales' };
                setSortBy(sortMap[v] || 'trending');
              }}>
              <option value="trending">Trending</option>
              <option value="hi">Price: High → Low</option>
              <option value="lo">Price: Low → High</option>
              <option value="az">Player A to Z</option>
              <option value="newest">Newest First</option>
              <option value="gain">Biggest Movers</option>
              <option value="volume">Most Traded</option>
            </select>
          </div>

          {/* Card grid or list */}
          {viewMode === 'grid' ? (
            <div className="grid">
              {loading && paged.length === 0
                ? <div style={{ gridColumn: '1/-1' }}><SkeletonCard count={24} /></div>
                : paged.map(c => <CardItem key={c.id} card={c} onClick={setSelectedCard} />)
              }
            </div>
          ) : (
            <div className="list-view">
              <div className="list-header">
                <div className="list-thumb-h"></div>
                <div className="list-info-h">Card</div>
                <div className="list-sport-h">Sport</div>
                <div className="list-grade-h">Grade</div>
                <div className="list-price-h">Price</div>
                <div className="list-range-h">Range</div>
                <div className="list-action-h"></div>
              </div>
              {paged.map(c => (
                <ListRow key={c.id} card={c} onClick={setSelectedCard} />
              ))}
            </div>
          )}

          {filtered.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1/-1', paddingTop: 48 }}>
              <div className="empty-icon">🔍</div>
              <h3>No cards match your filters</h3>
              <p>Try broadening your search, adjusting the price range, or selecting a different sport.</p>
            </div>
          )}

          {/* Pagination */}
          {clientPages > 1 && (
            <div className="pagination">
              <button onClick={() => setPage(1)} disabled={page === 1} className="page-btn">First</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="page-btn">‹ Prev</button>
              <div className="page-nums">
                {Array.from({ length: Math.min(clientPages, 7) }, (_, i) => {
                  let p;
                  if (clientPages <= 7) p = i + 1;
                  else if (page <= 4) p = i + 1;
                  else if (page >= clientPages - 3) p = clientPages - 6 + i;
                  else p = page - 3 + i;
                  return (
                    <button key={p} className={`page-num ${p === page ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                  );
                })}
              </div>
              <button onClick={() => setPage(p => Math.min(clientPages, p + 1))} disabled={page === clientPages} className="page-btn">Next ›</button>
              <button onClick={() => setPage(clientPages)} disabled={page === clientPages} className="page-btn">Last</button>
            </div>
          )}

          {/* Server-side load more */}
          {currentPage < totalPages && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <button onClick={loadMore} disabled={loading}
                style={{
                  padding: '12px 32px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                  background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--txt)',
                  cursor: loading ? 'wait' : 'pointer',
                }}>
                {loading ? 'Loading...' : `Load more cards (${cards.length.toLocaleString()} of ${totalCards.toLocaleString()})`}
              </button>
            </div>
          )}
        </div>
      </div>
      </>}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
