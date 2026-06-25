'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../components/AuthContext';
import { fmt } from '../../lib/data';
import { toast } from '../../lib/toast';
import TradeProposal from '../../components/TradeProposal';

export default function UserPortfolioPage() {
  const params = useParams();
  const handle = params.handle;
  const router = useRouter();
  const { user, token, authFetch } = useAuth();

  const [profileUser, setProfileUser] = useState(null);
  const [cards, setCards] = useState([]);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [showTrade, setShowTrade] = useState(false);

  // If viewing own profile, redirect to /portfolio
  useEffect(() => {
    if (user && user.handle && user.handle.toLowerCase() === handle?.toLowerCase()) {
      router.replace('/portfolio');
    }
  }, [user, handle, router]);

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
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [handle]);

  // Check if following
  useEffect(() => {
    if (!profileUser?.id || !token) return;
    authFetch(`/api/users/${profileUser.id}/is-following`)
      .then(r => r.json())
      .then(d => setIsFollowing(d.following || false))
      .catch(() => {});
  }, [profileUser, token, authFetch]);

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

  return (
    <>
      {/* Profile header */}
      <div className="user-profile-header">
        <div className="user-profile-avatar">{initial}</div>
        <div className="user-profile-info">
          <h1 className="user-profile-handle">@{profileUser.handle}</h1>
          <div className="user-profile-stats">
            <span><strong>{Number(profileUser.follower_count) || 0}</strong> followers</span>
            <span className="community-dot">·</span>
            <span><strong>{Number(profileUser.following_count) || 0}</strong> following</span>
            <span className="community-dot">·</span>
            <span><strong>{cards.length}</strong> cards</span>
            {totalValue > 0 && (
              <>
                <span className="community-dot">·</span>
                <span className="gold"><strong>{fmt(totalValue)}</strong> value</span>
              </>
            )}
          </div>
        </div>
        <div className="user-profile-actions">
          {token && (
            <>
              <button
                className={`community-follow-btn ${isFollowing ? 'following' : ''}`}
                onClick={toggleFollow}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
              <button className="btn-primary" onClick={() => setShowTrade(true)} style={{ fontSize: 13, padding: '8px 16px' }}>
                🔄 Propose Trade
              </button>
            </>
          )}
        </div>
      </div>

      {/* Portfolio grid */}
      <div className="eyebrow" style={{ marginTop: 30 }}>Portfolio</div>
      {cards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
          This user hasn&apos;t added any cards yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginTop: 16 }}>
          {cards.map(card => (
            <div key={card.id} style={{
              background: 'var(--panel)', borderRadius: 12,
              border: '1px solid var(--line)', overflow: 'hidden',
            }}>
              <div style={{
                height: 120,
                background: card.thumbnail
                  ? `url(${card.thumbnail}) center/contain no-repeat var(--panel-2)`
                  : 'linear-gradient(135deg, #2a2a2a, #555)',
              }} />
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.player}</div>
                <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--mono)' }}>
                  {card.grader} {card.grade}{card.set ? ` · ${card.set}` : ''}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', marginTop: 2 }}>
                  {card.price > 0 ? fmt(card.price) : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
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
