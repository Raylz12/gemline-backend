'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthContext';
import { useCardStore } from './CardStore';
import AuthModal from './AuthModal';
import SettingsModal from './SettingsModal';
import CreditsModal from './CreditsModal';
import CardDetail from './CardDetail';


const NAV_ITEMS = [
  { href: '/market', label: 'Market', key: 'market', public: true },
  { href: '/live', label: 'Live', key: 'live', dot: true, public: true },
  { href: '/analytics', label: 'Analytics', key: 'analytics', public: true },
  { href: '/portfolio', label: 'Portfolio', key: 'portfolio', public: true },
  { href: '/community', label: 'Community', key: 'community', public: true },
  { href: '/stores', label: 'Stores', key: 'stores', public: true },
  { href: '/packs', label: 'Mystery Pulls', key: 'packs', public: true },
];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const { wallet, trades, searchQuery, setSearchQuery } = useCardStore();
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const searchTimer = useRef(null);
  const lastScroll = useRef(0);
  const searchRef = useRef(null);

  // Close avatar dropdown on outside click
  useEffect(() => {
    if (!avatarOpen) return;
    const close = (e) => { if (!e.target.closest('.avatar-wrap')) setAvatarOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [avatarOpen]);

  // Hide header on scroll down, show on scroll up (mobile only)
  useEffect(() => {
    const onScroll = () => {
      if (window.innerWidth > 768) { setHeaderHidden(false); return; }
      const y = window.scrollY;
      if (y > 80 && y > lastScroll.current + 8) setHeaderHidden(true);
      else if (y < lastScroll.current - 4) setHeaderHidden(false);
      lastScroll.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Live search dropdown
  const handleSearchInput = (val) => {
    setSearchQuery(val);
    clearTimeout(searchTimer.current);
    if (!val || val.length < 2) { setSearchResults([]); setSearchOpen(false); return; }
    searchTimer.current = setTimeout(() => {
      fetch(`/api/market/feed?limit=8&search=${encodeURIComponent(val)}`)
        .then(r => r.json())
        .then(data => {
          const results = (data.feed || []).map(c => ({
            id: c.cardId, player: c.player, sport: c.sport, set: c.set,
            grader: c.grader, grade: c.grade, market: Number(c.marketPrice) || 0,
            thumbnail: c.thumbnail, gain7d: Number(c.gain_7d) || 0,
            lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
            sales7d: Number(c.sales_7d) || 0, sales30d: Number(c.sales_30d) || 0,
            rookie: c.rookie, variant: c.variant, year: c.year, confidence: c.confidence,
          }));
          setSearchResults(results);
          setSearchOpen(results.length > 0);
        })
        .catch(() => {});
    }, 250);
  };

  // Close dropdown on click outside
  useEffect(() => {
    const close = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, []);

  const handleNavClick = () => {};

  return (
    <>
      <header className={headerHidden ? 'header-hidden' : ''}>
        <div className="nav">
          <Link href="/" className="brand">
            <div className="logo">G</div>
            <div><div className="wordmark">GEM<span>LINE</span></div><div className="tagline">THE CARD EXCHANGE</div></div>
          </Link>

          <div className="search" ref={searchRef}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
            <input placeholder="Search players, sets, slabs…" value={searchQuery || ''} 
              onChange={e => handleSearchInput(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setSearchOpen(true); }} />
            <kbd>/</kbd>
            {searchOpen && searchResults.length > 0 && (
              <div className="search-dropdown">
                {searchResults.map(c => (
                  <div key={c.id} className="search-result" onClick={() => { setSelectedCard(c); setSearchOpen(false); }}>
                    {c.thumbnail && <img src={c.thumbnail} alt="" className="search-thumb" />}
                    <div className="search-info">
                      <div className="search-name">{c.player}</div>
                      <div className="search-meta">{c.grader} {c.grade} · {c.set}</div>
                    </div>
                    <div className="search-price">
                      {c.market > 0 ? `$${c.market.toLocaleString()}` : 'TBD'}
                    </div>
                  </div>
                ))}
                <div className="search-all" onClick={() => { setSearchOpen(false); if (pathname !== '/') router.push('/'); }}>
                  View all results →
                </div>
              </div>
            )}
          </div>

          <nav className="navlinks">
            {NAV_ITEMS.map(item => (
              <Link key={item.key} href={item.href} className={`navbtn ${pathname === item.href ? 'on' : ''}`}
                onClick={e => handleNavClick(e, item)}>
                {item.dot && <span className="dot" />}
                {item.label}
                {item.badge && user && trades.incoming.length > 0 && <span className="ncount">{trades.incoming.length}</span>}
              </Link>
            ))}
          </nav>

          <div className="nav-right">
            {user && (
              <button id="walletPill" title="Buy credits" onClick={() => setShowCredits(true)}>
                <span className="mono">{wallet.credits}</span>
                <span className="addc">+</span>
              </button>
            )}

            {user ? (
              <div className="avatar-wrap" style={{ position: 'relative' }}>
                <button className="avatar" onClick={() => setAvatarOpen(v => !v)} style={{ cursor: 'pointer' }}>
                  {(user.handle || user.email || 'R')[0].toUpperCase()}
                </button>
                {avatarOpen && (
                  <div className="avatar-dropdown" onClick={() => setAvatarOpen(false)}>
                    <Link href={`/profile/${user.handle || 'me'}`} className="avatar-dd-item">
                      My Profile
                    </Link>
                    <button className="avatar-dd-item" onClick={() => { setAvatarOpen(false); setShowSettings(true); }}>
                      ⚙️ Settings
                    </button>
                    <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
                    <button className="avatar-dd-item" style={{ color: '#ef4444' }} onClick={() => { logout(); setAvatarOpen(false); }}>
                      🚪 Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="btn-signin" onClick={() => setShowAuth(true)}>
                Sign In
              </button>
            )}

            <button className="menu" onClick={() => setMenuOpen(!menuOpen)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <div style={{ padding: '8px 22px 14px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {NAV_ITEMS.map(item => (
              <Link key={item.key} href={item.href} onClick={e => { handleNavClick(e, item); setMenuOpen(false); }}
                className={`navbtn ${pathname === item.href ? 'on' : ''}`} style={{ fontSize: 13, padding: '8px 14px' }}>
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </header>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showCredits && <CreditsModal onClose={() => setShowCredits(false)} />}
      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
