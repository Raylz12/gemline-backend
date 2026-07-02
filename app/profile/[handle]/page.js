'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '../../components/AuthContext';
import { SPORT_THEME } from '../../lib/data';
import CardDetail from '../../components/CardDetail';
import useDarkPage from '../../lib/useDarkPage';

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + n.toFixed(2);
}

// Normalize profile card data to CardDetail format
function toCardDetail(raw) {
  const price = Number(raw.catalog_price || raw.market || 0);
  return {
    ...raw,
    id: raw.card_id || raw.id,
    market: price,
    set: raw.card_set || raw.set || '',
    lo: raw.lo || raw.ch_price_lo || price * 0.85,
    hi: raw.hi || raw.ch_price_hi || price * 1.15,
    thumbnail: raw.thumbnail || raw.ebay_thumb || raw.image_url || '',
    ini: (raw.player || '').split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase(),
    theme: SPORT_THEME[raw.sport] || ['#2a2a2a', '#555'],
  };
}

function getTierClass(price) {
  if (!price || price <= 0) return 'tier-common';
  if (price < 50) return 'tier-common';
  if (price < 200) return 'tier-uncommon';
  if (price < 500) return 'tier-rare';
  if (price < 1500) return 'tier-epic';
  if (price < 5000) return 'tier-legendary';
  return 'tier-mythic';
}

function getTierLabel(price) {
  if (!price || price < 50) return null;
  if (price < 200) return { label: 'Uncommon', cls: 'uncommon' };
  if (price < 500) return { label: 'Rare', cls: 'rare' };
  if (price < 1500) return { label: 'Epic', cls: 'epic' };
  if (price < 5000) return { label: 'Legendary', cls: 'legendary' };
  return { label: 'Mythic', cls: 'mythic' };
}

const BADGE_TIER_ORDER = { diamond: 0, gold: 1, emerald: 2, silver: 3, bronze: 4 };

function getHighestTier(badges) {
  if (!badges || !badges.length) return null;
  for (const tier of ['diamond', 'gold', 'emerald', 'silver', 'bronze']) {
    if (badges.some(b => b.tier === tier)) return tier;
  }
  return null;
}

export default function ProfilePage() {
  useDarkPage(); // dark brand — matches live/analytics/community
  const params = useParams();
  const handle = params.handle;
  const { user, authFetch, token } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [badgeModalOpen, setBadgeModalOpen] = useState(false);
  const [featuredKeys, setFeaturedKeys] = useState([]);
  const [savingBadges, setSavingBadges] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [allBadgesList, setAllBadgesList] = useState([]);

  const [portfolioSearch, setPortfolioSearch] = useState('');

  const isOwnProfile = user && profile && (user.handle?.toLowerCase() === handle?.toLowerCase() || user.id === profile.id);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/profile/${encodeURIComponent(handle)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Profile not found');
        return;
      }
      const data = await res.json();
      setProfile(data);
      setFeaturedKeys(data.featured_badges || []);
    } catch (e) {
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [handle]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Fetch all badges for detail view
  useEffect(() => {
    fetch('/api/badges', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(d => { if (d.badges) setAllBadgesList(d.badges); })
      .catch(() => {});
  }, []);

  const toggleShowcase = async (cardId, type = 'physical') => {
    if (!token || !isOwnProfile) return;
    const allShowcase = [...(profile.digitalShowcase || []), ...(profile.physicalShowcase || [])];
    const isInShowcase = allShowcase.some(c => c.id === cardId || c.card_id === cardId);
    try {
      if (isInShowcase) {
        await authFetch(`/api/profile/showcase/${cardId}`, { method: 'DELETE' });
      } else {
        await authFetch('/api/profile/showcase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId, type }),
        });
      }
      loadProfile();
    } catch (e) {
      console.error('Showcase toggle failed:', e);
    }
  };

  const toggleFeaturedBadge = (key) => {
    setFeaturedKeys(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      if (prev.length >= 3) return prev; // profiles feature at most 3 badges
      return [...prev, key];
    });
  };

  const saveFeaturedBadges = async () => {
    setSavingBadges(true);
    try {
      await authFetch('/api/profile/badges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badges: featuredKeys }),
      });
      setBadgeModalOpen(false);
      loadProfile();
    } catch (e) {
      console.error('Save badges failed:', e);
    } finally {
      setSavingBadges(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--muted)' }}>
        <div className="scout-spin" style={{ width: 24, height: 24, margin: '0 auto 12px' }} />
        Loading profile...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>👤</div>
        <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 20, marginBottom: 6 }}>
          {error || 'Profile not found'}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          The user @{handle} doesn&apos;t exist or hasn&apos;t set up their profile yet.
        </div>
      </div>
    );
  }

  const allBadges = (profile.badges || []).sort((a, b) =>
    (BADGE_TIER_ORDER[a.tier] ?? 4) - (BADGE_TIER_ORDER[b.tier] ?? 4)
  );
  const featured = (featuredKeys.length > 0
    ? featuredKeys.map(k => allBadges.find(b => b.key === k || b.name === k)).filter(Boolean)
    : allBadges).slice(0, 3);

  const physicalShowcase = profile.physicalShowcase || [];

  const portfolioCards = profile.portfolioCards || [];
  const listings = profile.listings || [];
  const stats = profile.stats || {};
  const highestTier = getHighestTier(allBadges);
  const joinDate = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <>
      {/* ═══ HERO BANNER ═══ */}
      <div className="p-hero">
        <div className="p-hero-bg" />
        <div className="p-hero-content">
          <div className={`p-avatar-ring ${highestTier ? `ring-${highestTier}` : ''}`}>
            <div className="p-avatar" style={profile.avatar_url ? {
              backgroundImage: `url(${profile.avatar_url})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
              fontSize: 0,
            } : {}}>
              {!profile.avatar_url && (profile.handle || '?')[0].toUpperCase()}
            </div>
            {isOwnProfile && (
              <label className="p-avatar-edit" title="Change photo">
                📷
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  // Convert to base64 data URL for simplicity
                  const reader = new FileReader();
                  reader.onload = async () => {
                    try {
                      const res = await authFetch('/api/profile/avatar', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ avatar: reader.result }),
                      });
                      if (res.ok) { const d = await res.json(); loadProfile(); }
                    } catch (err) { console.error('Avatar upload failed:', err); }
                  };
                  reader.readAsDataURL(file);
                }} />
              </label>
            )}
          </div>
          <div className="p-identity">
            <h1 className="p-handle">@{profile.handle}</h1>
            {profile.bio && <p className="p-bio">{profile.bio}</p>}
            <div className="p-meta">
              <span className="p-join">Joined {joinDate}</span>
              {allBadges.length > 0 && (
                <span className="p-badge-count">{allBadges.length} badge{allBadges.length !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ FEATURED BADGES ═══ */}
      {(featured.length > 0 || isOwnProfile) && (
        <div className="p-badges-section">
          <div className="p-section-header">
            <h2 className="p-section-title">Featured Badges</h2>
            {isOwnProfile && allBadges.length > 0 && (
              <button className="p-customize-btn" onClick={() => setBadgeModalOpen(true)}>
                Customize
              </button>
            )}
          </div>
          {featured.length > 0 ? (
            <div className="p-featured-badges">
              {featured.map((b, i) => (
                <div key={b.key || i} className={`p-badge badge-${b.tier}`} title={b.description}
                  onClick={() => setSelectedBadge(b)} style={{ cursor: 'pointer' }}>
                  <span className="p-badge-emoji">{b.emoji}</span>
                  <div className="p-badge-info">
                    <span className="p-badge-name">{b.name}</span>
                    <span className="p-badge-tier">{b.tier}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : isOwnProfile && (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: 13 }}>
              Earn badges by trading, opening packs, and being active!
            </div>
          )}
        </div>
      )}

      {/* ═══ STATS ROW ═══ */}
      <div className="p-stats">
        <div className="p-stat-card">
          <div className="p-stat-val">{stats.physical ?? 0}</div>
          <div className="p-stat-label">Cards</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-val">{stats.trades ?? 0}</div>
          <div className="p-stat-label">Trades</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-val">{listings.length}</div>
          <div className="p-stat-label">For Sale</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-val gold">{fmtP(stats.totalValue)}</div>
          <div className="p-stat-label">Collection Value</div>
        </div>
        <div className="p-stat-card" title="Value of scan/cert-verified cards only">
          <div className="p-stat-val gold">{fmtP(stats.verifiedValue)}</div>
          <div className="p-stat-label">✓ Verified Value</div>
        </div>
      </div>

      {/* ═══ PUBLIC SHOWCASE — 3 Digital + 3 Physical ═══ */}
      <div className="p-section">
        <h2 className="p-section-title">Showcase</h2>

        {/* Showcase Cards */}
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 10 }}>
            Pinned Grails · {physicalShowcase.length}/5
          </div>
          {physicalShowcase.length > 0 ? (
            <div className="p-showcase-grid">
              {physicalShowcase.map((card, i) => {
                const price = Number(card.catalog_price || 0);
                const tierClass = getTierClass(price);
                return (
                  <div key={card.id || i} className={`p-showcase-card ${tierClass}`}
                    onClick={() => setSelectedCard(toCardDetail(card))}>
                    {isOwnProfile && (
                      <button className="pin-btn pinned"
                        onClick={(e) => { e.stopPropagation(); toggleShowcase(card.card_id || card.id); }}
                        title="Remove from showcase">📌</button>
                    )}
                    <div className="p-card-img" style={{
                      background: card.thumbnail ? `url(${card.thumbnail}) center/contain no-repeat var(--panel-2)` : 'linear-gradient(135deg, #2a2a2a, #555)',
                    }} />
                    <div className="p-card-info">
                      <div className="p-card-name">{card.player}</div>
                      <div className="p-card-meta">{card.grader} {card.grade} · {card.card_set || card.set}</div>
                      <div className="p-card-price">{fmtP(price)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--dim)', fontSize: 13, background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--line)' }}>
              {isOwnProfile ? 'Add cards to your portfolio, then pin your best ones here' : 'No cards showcased yet'}
            </div>
          )}
        </div>
      </div>

      {/* ═══ ACTIVE LISTINGS (always public) ═══ */}
      {listings.length > 0 && (
        <div className="p-section">
          <h2 className="p-section-title">For Sale</h2>
          <div className="p-showcase-grid">
            {listings.map((listing, i) => {
              const price = Number(listing.price || listing.catalog_price || 0);
              return (
                <div key={listing.id || i} className="p-showcase-card"
                  onClick={() => setSelectedCard(toCardDetail(listing))}>
                  <div className="p-card-img" style={{
                    background: listing.thumbnail ? `url(${listing.thumbnail}) center/contain no-repeat var(--panel-2)` : 'linear-gradient(135deg, #2a2a2a, #555)',
                  }} />
                  <div className="p-card-info">
                    <div className="p-card-name">{listing.player}</div>
                    <div className="p-card-meta">{listing.grader} {listing.grade}</div>
                    <div className="p-card-price" style={{ color: 'var(--up)' }}>{fmtP(price)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ OWNER-ONLY: FULL PORTFOLIO (searchable, tabbed) ═══ */}
      {isOwnProfile && portfolioCards.length > 0 && (
        <div className="p-section">
          <h2 className="p-section-title">My Collection</h2>

          {/* Search bar */}
          <div style={{ position: 'relative', marginBottom: 14, maxWidth: 400 }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" value={portfolioSearch} onChange={e => setPortfolioSearch(e.target.value)}
              placeholder="Search your cards..."
              style={{ width: '100%', padding: '9px 12px 9px 32px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 13, outline: 'none' }} />
          </div>

          {(() => {
            const q = portfolioSearch.toLowerCase();
            const filtered = q ? portfolioCards.filter(p => (p.player || '').toLowerCase().includes(q) || (p.card_set || '').toLowerCase().includes(q) || (p.sport || '').toLowerCase().includes(q)) : portfolioCards;
            return filtered.length > 0 ? (
              <div className="grid" style={{ gap: 10 }}>
                {filtered.map((card, i) => {
                  const price = Number(card.catalog_price || 0);
                  const isShowcased = physicalShowcase.some(s => (s.card_id || s.id) === (card.card_id || card.id));
                  return (
                    <div key={card.portfolio_id || card.id || i} className="card" onClick={() => setSelectedCard(toCardDetail(card))}
                      style={{ cursor: 'pointer', position: 'relative' }}>
                      <button className={`pin-btn ${isShowcased ? 'pinned' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleShowcase(card.card_id || card.id, 'physical'); }}
                        title={isShowcased ? 'Remove from showcase' : 'Pin to showcase (max 5)'}>📌</button>
                      <div className="slab" style={{
                        background: card.thumbnail ? `url(${card.thumbnail}) center/contain no-repeat var(--panel-2)` : 'linear-gradient(135deg, #2a2a2a, #555)',
                        height: 130,
                      }} />
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{card.player}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 10 }}>{card.grader} {card.grade} · {card.card_set || card.set}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', marginTop: 3 }}>{fmtP(price)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <div style={{ textAlign: 'center', padding: 30, color: 'var(--dim)', fontSize: 13 }}>
              {portfolioCards.length === 0 ? 'No cards yet. Add them from the Portfolio page.' : 'No matching cards'}
            </div>;
          })()}
        </div>
      )}

      {/* ═══ BADGE PICKER MODAL ═══ */}
      {badgeModalOpen && (
        <div className="p-modal-overlay" onClick={() => setBadgeModalOpen(false)}>
          <div className="p-modal" onClick={e => e.stopPropagation()}>
            <div className="p-modal-header">
              <h3>Customize Featured Badges</h3>
              <button className="p-modal-close" onClick={() => setBadgeModalOpen(false)}>✕</button>
            </div>
            <div className="p-modal-hint">
              Select up to 3 badges to feature on your profile. These will be displayed prominently.
            </div>
            <div className="p-badge-picker">
              {allBadges.map((b, i) => {
                const isSelected = featuredKeys.includes(b.key);
                return (
                  <div
                    key={b.key || i}
                    className={`p-badge-pick badge-${b.tier} ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleFeaturedBadge(b.key)}
                  >
                    <div className="p-pick-check">{isSelected ? '✓' : ''}</div>
                    <span className="p-badge-emoji">{b.emoji}</span>
                    <div className="p-pick-info">
                      <div className="p-pick-name">{b.name}</div>
                      <div className="p-pick-desc">{b.description}</div>
                    </div>
                    <span className={`p-pick-tier tier-${b.tier}`}>{b.tier}</span>
                  </div>
                );
              })}
            </div>
            <div className="p-modal-footer">
              <span className="p-pick-count">{featuredKeys.length} of 3 selected</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="p-btn-secondary" onClick={() => { setFeaturedKeys([]); }}>
                  Clear All
                </button>
                <button className="p-btn-primary" onClick={saveFeaturedBadges} disabled={savingBadges}>
                  {savingBadges ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ALL BADGES ═══ */}
      {allBadgesList.length > 0 && (
        <div style={{ marginTop: 32, marginBottom: 32 }}>
          <h2 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 20, marginBottom: 4 }}>All Badges</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
            {allBadges.length} of {allBadgesList.length} earned
          </p>
          {/* Categories derive from the badge catalog itself — a hardcoded list
              silently hid categories (collector/community/ripper/trader), so every
              earned badge fell in a hidden bucket and the grid rendered all-grey. */}
          {(() => {
            const PREFERRED = ['collection', 'portfolio', 'auctions', 'trading', 'sales', 'community', 'special'];
            const cats = [...new Set(allBadgesList.map(b => b.category || 'general'))]
              .sort((a, b) => {
                const ai = PREFERRED.indexOf(a), bi = PREFERRED.indexOf(b);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
              });
            return cats;
          })().map(cat => {
            const catBadges = allBadgesList.filter(b => (b.category || 'general') === cat);
            if (catBadges.length === 0) return null;
            const catLabel = cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : 'General';
            const earnedCount = catBadges.filter(b => allBadges.some(eb => eb.key === b.key)).length;
            // Sort earned first
            const sorted = [...catBadges].sort((a, b) => {
              const ae = allBadges.some(eb => eb.key === a.key) ? 0 : 1;
              const be = allBadges.some(eb => eb.key === b.key) ? 0 : 1;
              return ae - be;
            });
            return (
              <div key={cat || 'general'} style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{catLabel}</span>
                  <span style={{ color: earnedCount > 0 ? 'var(--gold)' : 'var(--dim)' }}>{earnedCount}/{catBadges.length}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {sorted.map(b => {
                    const earned = allBadges.some(eb => eb.key === b.key || eb.name === b.name);
                    const tierColor = { diamond: '#B9F2FF', gold: '#E8B339', silver: '#C0C0C0', bronze: '#CD7F32' }[b.tier] || 'var(--dim)';
                    return (
                      <div key={b.key} onClick={() => setSelectedBadge({ ...b, earned })}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          borderRadius: 10, cursor: 'pointer', transition: '.15s',
                          background: earned ? 'var(--panel)' : 'rgba(255,255,255,.02)',
                          border: `1px solid ${earned ? tierColor + '40' : 'rgba(255,255,255,.04)'}`,
                          opacity: earned ? 1 : 0.35,
                          filter: earned ? 'none' : 'grayscale(1)',
                          boxShadow: earned ? `0 0 12px ${tierColor}15` : 'none',
                        }}>
                        <span style={{ fontSize: 22 }}>{b.emoji}</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {b.name}
                            {earned && <span style={{ fontSize: 10, color: 'var(--up)' }}>✓</span>}
                          </div>
                          <div style={{ fontSize: 10, color: earned ? tierColor : 'var(--dim)', textTransform: 'capitalize' }}>{b.tier}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ BADGE DETAIL MODAL ═══ */}
      {selectedBadge && (
        <div className="overlay on" onClick={e => e.target === e.currentTarget && setSelectedBadge(null)}>
          <div style={{
            background: 'var(--panel)', borderRadius: 16, padding: 32, width: '90%', maxWidth: 360,
            border: `1px solid ${{ diamond: '#B9F2FF', gold: '#E8B339', silver: '#C0C0C0', bronze: '#CD7F32' }[selectedBadge.tier] || 'var(--line)'}`,
            margin: 'auto', textAlign: 'center', position: 'relative',
            boxShadow: `0 0 40px ${{ diamond: 'rgba(185,242,255,.15)', gold: 'rgba(22,199,132,.15)', silver: 'rgba(192,192,192,.1)', bronze: 'rgba(205,127,50,.1)' }[selectedBadge.tier] || 'none'}`,
          }}>
            <button onClick={() => setSelectedBadge(null)} style={{
              position: 'absolute', top: 12, right: 12, width: 32, height: 32,
              borderRadius: 8, background: 'var(--panel-2)', border: 'none', color: 'var(--muted)',
              cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}>✕</button>
            <div style={{ fontSize: 56, marginBottom: 12 }}>{selectedBadge.emoji}</div>
            <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 22, marginBottom: 6 }}>{selectedBadge.name}</h3>
            <div style={{
              display: 'inline-block', padding: '3px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              fontFamily: 'var(--mono)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 14,
              background: { diamond: 'rgba(185,242,255,.12)', gold: 'rgba(22,199,132,.12)', silver: 'rgba(192,192,192,.1)', bronze: 'rgba(205,127,50,.1)' }[selectedBadge.tier],
              color: { diamond: '#B9F2FF', gold: '#E8B339', silver: '#C0C0C0', bronze: '#CD7F32' }[selectedBadge.tier],
            }}>{selectedBadge.tier}</div>
            <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.5, marginBottom: 16 }}>
              {selectedBadge.description || 'A special achievement badge.'}
            </p>
            {selectedBadge.category && (
              <div style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
                Category: {selectedBadge.category}
              </div>
            )}
            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: selectedBadge.earned !== false ? 'var(--up)' : 'var(--dim)' }}>
              {selectedBadge.earned !== false ? '✓ Earned' : 'Locked'}
            </div>
          </div>
        </div>
      )}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
