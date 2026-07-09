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
import CardThumb from './CardThumb';
import { IconSettings, IconLogout, IconZap, IconTrophy, IconDollar, IconBell, IconGavel, IconCheck } from './Icons';


function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const NOTIF_ICONS = {
  outbid: IconZap, auction_won: IconTrophy, auction_sold: IconDollar, auction_ended: IconBell, auction_lost: IconBell,
  offer_received: IconGavel, offer_accepted: IconCheck, offer_declined: IconBell,
  price_alert: IconZap, watch_listing: IconDollar, offer_countered: IconGavel, order_message: IconBell,
  cancel_requested: IconBell, cancel_declined: IconBell, order_disputed: IconBell,
};

// Where a notification should take you when clicked.
function notifHref(n) {
  const d = n.data || {};
  const t = n.type || '';
  if (t.startsWith('order') || t === 'payment_confirmed' || d.action === 'complete_payment' || d.orderId) return '/portfolio?tab=orders';
  if (t.startsWith('offer')) return '/portfolio?tab=offers';
  if (t === 'price_alert' || t === 'watch_listing') return d.cardId ? `/card/${d.cardId}` : '/portfolio?tab=watchlist';
  if (t.startsWith('auction') || t === 'outbid') return d.cardId ? `/card/${d.cardId}` : '/live';
  if (d.cardId) return `/card/${d.cardId}`;
  return null;
}

function NotificationBell() {
  const { token, authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef(null);

  const load = () => {
    if (!token) return;
    authFetch('/api/notifications')
      .then(r => r.ok ? r.json() : { notifications: [], unread: 0 })
      .then(d => { setItems(d.notifications || []); setUnread(d.unread || 0); })
      .catch(() => {});
  };

  useEffect(() => {
    if (!token) return;
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      authFetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(() => setUnread(0))
        .catch(() => {});
    }
  };

  if (!token) return null;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button className="notif-bell" onClick={toggle} title="Notifications" aria-label="Notifications">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        {unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          <div className="notif-dd-head">Notifications</div>
          {items.length === 0 ? (
            <div className="notif-empty">Nothing yet — bids, offers, and wins land here.</div>
          ) : items.map(n => (
            <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`}
                 style={{ cursor: notifHref(n) ? 'pointer' : 'default' }}
                 onClick={() => { const h = notifHref(n); if (h) { setOpen(false); window.location.href = h; } }}>
              <span className="notif-ico" style={{ color: 'var(--gold)' }}>
                {(() => { const Ic = NOTIF_ICONS[n.type] || IconBell; return <Ic size={15} />; })()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="notif-title">{n.title}</div>
                {n.body && <div className="notif-body">{n.body}</div>}
              </div>
              <span className="notif-time">{timeAgo(n.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Display-layer nav: Sell + Trades promoted to top level (supply funnel);
// Portfolio reads as "Collection", Analytics as "Price Guide" (routes unchanged).
// `low: true` items hide first on narrow desktop widths (see globals.css).
const NAV_ITEMS = [
  { href: '/market', label: 'Market', key: 'market', public: true },
  { href: '/live', label: 'Live', key: 'live', public: true },
  { href: '/sell', label: 'Sell', key: 'sell', public: true },
  { href: '/trades', label: 'Trades', key: 'trades', public: true },
  { href: '/portfolio', label: 'Collection', key: 'portfolio', public: true },
  { href: '/analytics', label: 'Price Guide', key: 'analytics', public: true, low: true },
  { href: '/arbitrage', label: 'Deal Finder', key: 'arbitrage', public: true, low: true },
  { href: '/community', label: 'Community', key: 'community', public: true, low: true },
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
  const [recentCards, setRecentCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  // Credits economy is flag-gated OFF by default (no sink since packs retired).
  const [creditsOn, setCreditsOn] = useState(false);
  useEffect(() => {
    fetch('/api/flags').then(r => r.json()).then(d => setCreditsOn((d.flags || {}).credits === true)).catch(() => {});
  }, []);
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

  // Live typeahead — tokenized family search over the full 287K-card catalog
  // (POST /api/catalog/search: every word must match player/set/variant/year,
  // results grouped by card family). Falls back gracefully to nothing on error.
  const handleSearchInput = (val) => {
    setSearchQuery(val);
    clearTimeout(searchTimer.current);
    if (!val || val.length < 2) { setSearchResults([]); setSearchOpen(!!val ? false : recentCards.length > 0); return; }
    searchTimer.current = setTimeout(() => {
      fetch('/api/catalog/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: val }),
      })
        .then(r => r.json())
        .then(data => {
          const results = (data.families || []).slice(0, 8).map(f => {
            // Best tier for the row: the priced tier CardDetail should open on.
            const priced = (f.tiers || []).filter(t => t.price > 0);
            const best = priced.sort((a, b) => b.price - a.price)[0] || (f.tiers || [])[0] || {};
            return {
              id: best.id, player: f.player, sport: f.sport, set: f.card_set,
              grader: best.grader || 'RAW', grade: best.grade || '',
              market: Number(best.price) || Number(f.topPrice) || 0,
              thumbnail: f.ebay_thumb || f.image_url || null,
              variant: f.variant, year: f.year, num: f.number,
              gradeCount: (f.tiers || []).length,
            };
          }).filter(r => r.id);
          setSearchResults(results);
          setSearchOpen(results.length > 0);
        })
        .catch(() => {});
    }, 250);
  };

  // Recently viewed — CardDetail writes localStorage 'gemline_recent' on every
  // open; surface it when the search box is focused while empty.
  const loadRecent = () => {
    try { setRecentCards(JSON.parse(localStorage.getItem('gemline_recent') || '[]').slice(0, 6)); }
    catch { setRecentCards([]); }
  };

  // Close dropdown on click outside
  useEffect(() => {
    const close = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, []);

  const handleNavClick = () => {};

  // Navigate to /market with the current search applied (shared store state
  // already drives the market feed refetch).
  const goToMarket = () => {
    setSearchOpen(false);
    setSearchResults([]);
    if (pathname !== '/market') router.push('/market');
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimer.current);
      const val = (searchQuery || '').trim();
      if (val.length < 2) return;
      goToMarket();
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  return (
    <>
      <header className={headerHidden ? 'header-hidden' : ''}>
        <div className="nav">
          <Link href="/" className="brand">
            <div className="logo">G</div>
            <div><div className="wordmark">GEM<span>LINE</span></div><div className="tagline">THE CARD SHOW, ONLINE</div></div>
          </Link>

          <div className="search" ref={searchRef}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
            <input placeholder="Search players, sets, slabs…" value={searchQuery || ''} 
              onChange={e => handleSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => {
                if (searchResults.length > 0) { setSearchOpen(true); return; }
                if (!(searchQuery || '').trim()) { loadRecent(); setSearchOpen(true); }
              }} />
            <kbd>/</kbd>
            {searchOpen && (searchResults.length > 0 || (!(searchQuery || '').trim() && recentCards.length > 0)) && (
              <div className="search-dropdown">
                {searchResults.length === 0 && !(searchQuery || '').trim() && (
                  <div style={{ padding: '8px 12px 4px', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)' }}>Recently viewed</div>
                )}
                {(searchResults.length > 0 ? searchResults : recentCards).map(c => (
                  <div key={c.id} className="search-result" onClick={() => { setSelectedCard(c); setSearchOpen(false); }}>
                    <CardThumb src={c.thumbnail} name={c.player} sport={c.sport} size={36} radius={6} className="search-thumb" />
                    <div className="search-info">
                      <div className="search-name">{c.player}{c.gradeCount > 1 ? <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400, marginLeft: 6 }}>{c.gradeCount} grades</span> : null}</div>
                      <div className="search-meta"><span className="mchip mchip-grade" style={{ marginRight: 6 }}>{`${c.grader || 'RAW'} ${c.grade || ''}`.trim()}</span>{[String(c.set || '').startsWith(String(c.year)) ? null : c.year, c.set].filter(Boolean).join(' ')}</div>
                    </div>
                    <div className="search-price">
                      {c.market > 0 ? `$${c.market.toLocaleString()}` : 'TBD'}
                    </div>
                  </div>
                ))}
                {searchResults.length > 0 && (
                  <div className="search-all" onClick={goToMarket}>
                    View all results →
                  </div>
                )}
              </div>
            )}
          </div>

          <nav className="navlinks">
            {NAV_ITEMS.map(item => (
              <Link key={item.key} href={item.href} className={`navbtn ${item.low ? 'nav-low' : ''} ${pathname === item.href ? 'on' : ''}`}
                onClick={e => handleNavClick(e, item)}>
                {item.label}
                {item.key === 'trades' && user && trades.incoming.length > 0 && <span className="ncount">{trades.incoming.length}</span>}
              </Link>
            ))}
          </nav>

          <div className="nav-right">
            <NotificationBell />
            {user && creditsOn && (
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
                    <Link href={`/user/${user.handle || 'me'}`} className="avatar-dd-item">
                      My Profile
                    </Link>
                    <button className="avatar-dd-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { setAvatarOpen(false); setShowSettings(true); }}>
                      <IconSettings size={14} /> Settings
                    </button>
                    {wallet.isAdmin && (
                      <Link href="/admin" className="avatar-dd-item" style={{ color: 'var(--gold)' }}>
                        Admin Panel
                      </Link>
                    )}
                    <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
                    <button className="avatar-dd-item" style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { logout(); setAvatarOpen(false); }}>
                      <IconLogout size={14} /> Sign Out
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
            {[...NAV_ITEMS, { href: '/stores', label: 'Stores', key: 'stores' }].map(item => (
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
