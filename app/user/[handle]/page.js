'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../components/AuthContext';
import { fmt } from '../../lib/data';
import { toast } from '../../lib/toast';
import TradeProposal from '../../components/TradeProposal';
import ReportModal from '../../components/ReportModal';

export default function UserPortfolioPage() {
  const params = useParams();
  const handle = params.handle;
  const router = useRouter();
  const { user, token, authFetch } = useAuth();

  const [profileUser, setProfileUser] = useState(null);
  const [cards, setCards] = useState([]);
  const [totalValue, setTotalValue] = useState(0);
  const [verifiedValue, setVerifiedValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [showTrade, setShowTrade] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [badges, setBadges] = useState([]);
  const [featuredBadgeKeys, setFeaturedBadgeKeys] = useState([]);
  const [showcaseIds, setShowcaseIds] = useState([]);
  const [showAll, setShowAll] = useState(false);

  // Own profile renders too (how others see you) — self just gets no
  // follow/trade/report/block actions. /profile/[handle] redirects here.
  const isSelf = !!(user && user.handle && user.handle.toLowerCase() === handle?.toLowerCase());

  // Load user portfolio
  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    fetch(`/api/users/${encodeURIComponent(handle)}/portfolio`)
      .then(r => r.json())
      .then(data => {
        if (data.user) {
          setProfileUser(data.user);
          setCards(data.cards || []);
          setTotalValue(data.totalValue || 0);
          setVerifiedValue(data.verifiedValue || 0);
          setBadges(data.badges || []);
          setFeaturedBadgeKeys(data.featuredBadges || []);
          setShowcaseIds(data.showcaseCardIds || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [handle]);

  // Check if following + blocked
  useEffect(() => {
    if (!profileUser?.id || !token) return;
    authFetch(`/api/users/${profileUser.id}/is-following`)
      .then(r => r.json())
      .then(d => setIsFollowing(d.following || false))
      .catch(() => {});
    authFetch('/api/users/blocked')
      .then(r => r.json())
      .then(d => setIsBlocked((d.blocked || []).some(b => b.userId === profileUser.id)))
      .catch(() => {});
  }, [profileUser, token, authFetch]);

  const toggleBlock = useCallback(async () => {
    if (!token || !profileUser) return;
    if (!isBlocked && !confirm(`Block @${profileUser.handle}? They won't be able to offer on your listings, trade with you, or follow you — and their posts disappear from your feed.`)) return;
    try {
      const res = await authFetch(`/api/users/${profileUser.id}/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block: !isBlocked }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setIsBlocked(d.blocked);
      if (d.blocked) setIsFollowing(false); // blocking unfollows both ways
      toast(d.blocked ? `Blocked @${profileUser.handle}` : `Unblocked @${profileUser.handle}`);
    } catch (e) { toast(e.message, true); }
  }, [token, profileUser, isBlocked, authFetch]);

  const toggleFollow = useCallback(async () => {
    if (!token || !profileUser) return;
    try {
      if (isFollowing) {
        await authFetch(`/api/users/${profileUser.id}/follow`, { method: 'DELETE' });
        setIsFollowing(false);
        setProfileUser(prev => prev ? { ...prev, follower_count: Math.max(0, Number(prev.follower_count) - 1) } : prev);
        toast('Unfollowed');
      } else {
        await authFetch(`/api/users/${profileUser.id}/follow`, { method: 'POST' });
        setIsFollowing(true);
        setProfileUser(prev => prev ? { ...prev, follower_count: Number(prev.follower_count) + 1 } : prev);
        toast('Following!');
      }
    } catch (e) { toast('Failed', true); }
  }, [token, profileUser, isFollowing, authFetch]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>Loading portfolio...</div>
    );
  }

  if (!profileUser) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
        <p style={{ fontSize: 18, marginBottom: 8 }}>User not found</p>
        <p style={{ fontSize: 13 }}>@{handle} doesn&apos;t exist or hasn&apos;t created an account yet.</p>
      </div>
    );
  }

  const initial = (profileUser.handle || 'U')[0].toUpperCase();

  // ── Showcase: max 5 cards + max 3 badges ──
  // Cards: the user's picks; default = top 5 (verified first, then value —
  // the API already sorts cards that way). Badges: featured picks; default =
  // 3 rarest by tier (diamond > gold > emerald > silver > bronze).
  const TIER_ORDER = { diamond: 0, gold: 1, emerald: 2, silver: 3, bronze: 4 };
  const pickedCards = showcaseIds
    .map(id => cards.find(c => c.id === id))
    .filter(Boolean);
  const showcaseCards = (pickedCards.length > 0 ? pickedCards : cards).slice(0, 5);
  const sortedBadges = [...badges].sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
  const pickedBadges = featuredBadgeKeys
    .map(k => badges.find(b => b.key === k || b.name === k))
    .filter(Boolean);
  const showcaseBadges = (pickedBadges.length > 0 ? pickedBadges : sortedBadges).slice(0, 3);
  const restCards = cards.filter(c => !showcaseCards.some(s => s.id === c.id));
  const badgeTierColor = { diamond: '#B9F2FF', gold: '#E8B339', emerald: '#3ddc97', silver: '#C0C0C0', bronze: '#CD7F32' };

  const CardTile = ({ card, big = false }) => (
    <div style={{
      background: 'var(--panel)', borderRadius: 12,
      border: `1px solid ${card.verified ? 'rgba(22,199,132,.35)' : 'var(--line)'}`, overflow: 'hidden',
      cursor: 'default',
    }}>
      <div style={{
        height: big ? 150 : 120,
        position: 'relative',
        background: card.thumbnail
          ? `url(${card.thumbnail}) center/contain no-repeat var(--panel-2)`
          : 'linear-gradient(135deg, #2a2a2a, #555)',
      }}>
        {card.verified && (
          <span title="Scan/cert verified" style={{ position: 'absolute', top: 6, right: 6, fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: 'rgba(22,199,132,.16)', color: 'var(--up, #16c784)' }}>✓ VERIFIED</span>
        )}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.player}</div>
        <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {`${card.grader} ${card.grade}`.trim()}{card.set ? ` · ${card.set}` : ''}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', marginTop: 2 }}>
          {card.price > 0 ? fmt(card.price) : '—'}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Profile header */}
      <div className="user-profile-header">
        <div className="user-profile-avatar">{initial}</div>
        <div className="user-profile-info">
          <h1 className="user-profile-handle">@{profileUser.handle}</h1>
          {showcaseBadges.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 6px' }} data-testid="profile-badges">
              {showcaseBadges.map((b, i) => (
                <span key={b.key || i} title={b.description}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
                    borderRadius: 7, fontSize: 11, fontWeight: 600,
                    background: 'var(--panel)', border: `1px solid ${(badgeTierColor[b.tier] || '#666')}55`,
                    color: badgeTierColor[b.tier] || 'var(--muted)',
                  }}>
                  <span className="emoji">{b.emoji}</span> {b.name}
                </span>
              ))}
            </div>
          )}
          {profileUser.bio && (
            <div style={{ fontSize: 13, color: 'var(--muted)', margin: '2px 0 6px', maxWidth: 520 }}>{profileUser.bio}</div>
          )}
          <div className="user-profile-stats">
            {profileUser.created_at && (
              <>
                <span title="Member since">Collector since <strong>{new Date(profileUser.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</strong></span>
                <span className="community-dot">·</span>
              </>
            )}
            <span><strong>{Number(profileUser.follower_count) || 0}</strong> followers</span>
            <span className="community-dot">·</span>
            <span><strong>{Number(profileUser.following_count) || 0}</strong> following</span>
            <span className="community-dot">·</span>
            <span><strong>{cards.length}</strong> cards</span>
            {Number(profileUser.sales_count) > 0 && (
              <>
                <span className="community-dot">·</span>
                <span><strong>{profileUser.sales_count}</strong> sales</span>
              </>
            )}
            {Number(profileUser.trades_count) > 0 && (
              <>
                <span className="community-dot">·</span>
                <span><strong>{profileUser.trades_count}</strong> trades</span>
              </>
            )}
            {totalValue > 0 && (
              <>
                <span className="community-dot">·</span>
                <span className="gold"><strong>{fmt(totalValue)}</strong> value</span>
              </>
            )}
            {verifiedValue > 0 && (
              <>
                <span className="community-dot">·</span>
                <span className="gold" title="Value of scan/cert-verified cards only"><strong>{fmt(verifiedValue)}</strong> ✓ verified</span>
              </>
            )}
          </div>
        </div>
        <div className="user-profile-actions">
          {isSelf && (
            <button className="btn-primary" onClick={() => router.push('/portfolio')} style={{ fontSize: 13, padding: '8px 16px' }}>
              My Collection
            </button>
          )}
          {token && !isSelf && (
            <>
              <button
                className={`community-follow-btn ${isFollowing ? 'following' : ''}`}
                onClick={toggleFollow}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
              {cards.length > 0 && (
              <button className="btn-primary" onClick={() => setShowTrade(true)} style={{ fontSize: 13, padding: '8px 16px' }}>
                Propose Trade
              </button>
              )}
              <button onClick={() => setShowReport(true)} title="Report this user" style={{
                fontSize: 12, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)',
              }}>⚑ Report</button>
              <button onClick={toggleBlock} title={isBlocked ? 'Unblock this user' : 'Block this user'} style={{
                fontSize: 12, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                background: isBlocked ? 'rgba(239,68,68,.12)' : 'transparent',
                border: '1px solid ' + (isBlocked ? 'rgba(239,68,68,.4)' : 'var(--line)'),
                color: isBlocked ? '#ef4444' : 'var(--muted)',
              }}>{isBlocked ? 'Blocked' : 'Block'}</button>
            </>
          )}
        </div>
      </div>

      {showReport && profileUser && (
        <ReportModal targetType="user" targetId={profileUser.id} targetLabel={`@${profileUser.handle}`} onClose={() => setShowReport(false)} />
      )}

      {/* Showcase — top 5 cards (picked or highest value, verified first) */}
      <div className="eyebrow" style={{ marginTop: 30 }}>Showcase</div>
      {cards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
          This user hasn&apos;t added any cards yet.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginTop: 16 }} data-testid="showcase-grid">
            {showcaseCards.map(card => <CardTile key={card.portfolioId || card.id} card={card} big />)}
          </div>

          {/* Rest of the collection behind an expander */}
          {restCards.length > 0 && (
            <div style={{ marginTop: 18 }}>
              {!showAll ? (
                <button onClick={() => setShowAll(true)}
                  style={{ width: '100%', padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'var(--panel)', color: 'var(--muted)', border: '1px dashed var(--line-2)', cursor: 'pointer' }}
                  data-testid="view-all-btn">
                  View all ({cards.length}) ↓
                </button>
              ) : (
                <>
                  <div className="eyebrow" style={{ marginTop: 8 }}>Full collection ({cards.length})</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
                    {restCards.map(card => <CardTile key={card.portfolioId || card.id} card={card} />)}
                  </div>
                  <button onClick={() => setShowAll(false)}
                    style={{ marginTop: 14, width: '100%', padding: '9px 16px', borderRadius: 10, fontSize: 12, background: 'var(--panel)', color: 'var(--dim)', border: '1px solid var(--line)', cursor: 'pointer' }}>
                    Collapse ↑
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Trade Proposal Modal */}
      {showTrade && (
        <TradeProposal
          targetUser={profileUser}
          targetCards={cards}
          onClose={() => setShowTrade(false)}
          onProposed={() => { setShowTrade(false); toast('Trade proposal sent!'); }}
        />
      )}
    </>
  );
}
