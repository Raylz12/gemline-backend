'use client';
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { SPORT_THEME } from '../lib/data';

const CardStoreContext = createContext(null);

function formatPrice(val) {
  if (!val || val <= 0) return null;
  if (val >= 1000) return '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (val >= 100) return '$' + Math.round(val);
  return '$' + Number(val).toFixed(2);
}

function mapFeedCard(c, i) {
  const market = c.marketPrice || 0;
  const lo = c.lo && c.lo > 0 ? c.lo : null;
  const hi = c.hi && c.hi > 0 ? c.hi : null;
  const edge = (lo && hi && lo > 0) ? +((( hi - lo) / lo) * 100).toFixed(1) : 0;
  const sport = c.sport || 'Other';
  const theme = SPORT_THEME[sport] || ['#2a2a2a', '#555'];
  const ini = (c.player || '').split(' ').map(w => w[0]).join('').slice(0,4).toUpperCase();
  return {
    id: c.cardId || i,
    player: c.player || 'Unknown',
    sport,
    set: c.set || '',
    variant: c.variant || '',
    num: c.num || '',
    grader: c.grader || 'RAW',
    grade: c.grade || '',
    ask: market,
    market,
    lo, hi, edge,
    priceDisplay: formatPrice(market),
    loDisplay: formatPrice(lo),
    hiDisplay: formatPrice(hi),
    ch: 0,
    seller: null,
    ini,
    theme,
    type: 'buy',
    endsIn: null,
    bids: 0,
    owned: false,
    listed: false,
    boost: null,
    costBasis: null,
    thumbnail: c.thumbnail || null,
    confidence: c.confidence || null,
    saleCount: c.sales30d || c.saleCount || 0,
    sales7d: c.sales7d || 0,
    sales30d: c.sales30d || 0,
    gain7d: c.gain7d || 0,
    rookie: c.rookie || false,
    cardhedge_id: c.cardhedge_id || null,
    gradeCount: c.gradeCount || 1,
    grades: c.grades || [],
  };
}

export function CardStoreProvider({ children }) {
  const [cards, setCards] = useState([]);
  const [totalCards, setTotalCards] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sportCounts, setSportCounts] = useState([]);
  const [brandCounts, setBrandCounts] = useState([]);
  const [filterBrand, setFilterBrand] = useState('');
  const [wallet, setWallet] = useState({ credits: 240 });
  const [trades, setTrades] = useState({ incoming: [], outgoing: [] });
  const [watch, setWatch] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('trending');
  const [filterSport, setFilterSport] = useState('All');
  const initialized = useRef(false);
  const fetchTimeout = useRef(null);

  // Server-side fetch with pagination, search, sort, filter.
  // Uses refs for stable identity — avoids stale-closure issues in effects.
  const filterSportRef = useRef(filterSport);
  const searchQueryRef = useRef(searchQuery);
  const sortByRef = useRef(sortBy);
  const filterBrandRef = useRef(filterBrand);
  filterSportRef.current = filterSport;
  searchQueryRef.current = searchQuery;
  sortByRef.current = sortBy;
  filterBrandRef.current = filterBrand;

  const fetchFeed = useRef((opts = {}) => {
    const page = opts.page || 1;
    const sport = opts.sport !== undefined ? opts.sport : filterSportRef.current;
    const search = opts.search !== undefined ? opts.search : searchQueryRef.current;
    const sort = opts.sort !== undefined ? opts.sort : sortByRef.current;
    const brand = opts.brand !== undefined ? opts.brand : filterBrandRef.current;
    const append = opts.append || false;

    const params = new URLSearchParams({ page, limit: 100, sort });
    if (sport && sport !== 'All') params.set('sport', sport);
    if (search) params.set('search', search);
    if (brand) params.set('brand', brand);

    setLoading(true);
    fetch(`/api/market/feed?${params}`)
      .then(r => r.json())
      .then(data => {
        const feed = data.feed || [];
        const mapped = feed.map(mapFeedCard);
        if (append) {
          setCards(prev => [...prev, ...mapped]);
        } else {
          setCards(mapped);
        }
        setTotalCards(data.totalCards || feed.length);
        setCurrentPage(data.page || 1);
        setTotalPages(data.pages || 1);
        if (data.sportCounts) setSportCounts(data.sportCounts);
        if (data.brandCounts) setBrandCounts(data.brandCounts);
      })
      .catch(err => console.error('Feed error:', err))
      .finally(() => setLoading(false));
  }).current;

  // Initial load
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      fetchFeed({ page: 1 });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when sort, sport, or brand filter changes
  useEffect(() => {
    if (!initialized.current) return;
    fetchFeed({ page: 1, sport: filterSport, sort: sortBy, search: searchQuery, brand: filterBrand });
  }, [sortBy, filterSport, filterBrand]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    if (!initialized.current) return;
    clearTimeout(fetchTimeout.current);
    fetchTimeout.current = setTimeout(() => {
      fetchFeed({ page: 1, search: searchQuery });
    }, 300);
    return () => clearTimeout(fetchTimeout.current);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    if (currentPage < totalPages && !loading) {
      fetchFeed({ page: currentPage + 1, append: true });
    }
  };

  const toggleWatch = (id) => {
    setWatch(prev => {
      const next = new Set(prev);
      if (next.has(String(id))) next.delete(String(id));
      else next.add(String(id));
      return next;
    });
  };

  const updateCard = (id, updater) => {
    setCards(prev => prev.map(c => String(c.id) === String(id) ? { ...c, ...updater(c) } : c));
  };

  // Fetch credits on mount (needs auth token)
  useEffect(() => {
    const t = typeof window !== 'undefined' && localStorage.getItem('gemline_token');
    if (!t) return;
    fetch('/api/user/credits', { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.credits !== undefined) setWallet(w => ({ ...w, credits: d.credits })); })
      .catch(() => {});
  }, []);

  return (
    <CardStoreContext.Provider value={{ 
      cards, allCards: cards, setCards, totalCards, sportCounts, brandCounts, wallet, setWallet, 
      trades, setTrades, watch, toggleWatch, updateCard, 
      searchQuery, setSearchQuery, sortBy, setSortBy, filterSport, setFilterSport,
      filterBrand, setFilterBrand, loadMore, loading, currentPage, totalPages,
    }}>
      {children}
    </CardStoreContext.Provider>
  );
}

export function useCardStore() {
  const ctx = useContext(CardStoreContext);
  if (!ctx) throw new Error('useCardStore must be inside CardStoreProvider');
  return ctx;
}
