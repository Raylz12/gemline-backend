'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../components/AuthContext';
import { fmt } from '../lib/data';
import useDarkPage from '../lib/useDarkPage';

function UserCard({ user, currentUserId, onToggleFollow, followingSet }) {
  const isFollowing = followingSet.has(user.id);
  const isSelf = currentUserId === user.id;
  const initial = (user.handle || 'U')[0].toUpperCase();

  return (
    <div className="community-user-card">
      <Link href={`/profile/${user.handle}`} className="community-user-info">
        <div className="community-avatar">{initial}</div>
        <div className="community-user-meta">
          <div className="community-handle">@{user.handle}</div>
          <div className="community-stats-row">
            <span>{Number(user.card_count) || 0} cards</span>
            <span className="community-dot">·</span>
            <span>{Number(user.follower_count) || 0} followers</span>
          </div>
          {Number(user.total_value) > 0 && (
            <div className="community-value">{fmt(Number(user.total_value))} portfolio</div>
          )}
        </div>
      </Link>
      {!isSelf && currentUserId && (
        <button
          className={`community-follow-btn ${isFollowing ? 'following' : ''}`}
          onClick={(e) => { e.preventDefault(); onToggleFollow(user.id, isFollowing); }}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  );
}

function ProfileCard({ user, token, authFetch }) {
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState(user.handle || '');
  const [bio, setBio] = useState(user.bio || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const res = await authFetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: handle.trim(), bio: bio.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || 'Failed to save'); }
      else { setMsg('✓ Saved'); setEditing(false); }
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  const initial = (user.handle || 'U')[0].toUpperCase();

  return (
    <div className="panel" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16, marginBottom: 20 }}>
      <Link href={`/profile/${user.handle}`} style={{ flexShrink: 0 }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg,#16c784,#10b377)',
          display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800, color: '#000',
        }}>{initial}</div>
      </Link>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!editing ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <Link href={`/profile/${user.handle}`} style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 16, color: 'var(--txt)', textDecoration: 'none' }}>@{user.handle}</Link>
              <button onClick={() => setEditing(true)} style={{
                fontSize: 11, color: 'var(--gold)', background: 'none', border: '1px solid var(--gold)',
                borderRadius: 6, padding: '2px 8px', cursor: 'pointer',
              }}>Edit Profile</button>
            </div>
            {user.bio && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{user.bio}</div>}
            {!user.bio && <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>Add a bio to tell others about your collection</div>}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Handle</label>
              <input value={handle} onChange={e => setHandle(e.target.value)} maxLength={20}
                style={{
                  width: '100%', background: 'var(--panel-2, #1a1d28)', border: '1px solid var(--line)',
                  borderRadius: 8, padding: '8px 10px', color: 'var(--txt)', fontSize: 13, marginTop: 4,
                }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Bio</label>
              <textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={160} rows={2}
                placeholder="Tell others about your collection..."
                style={{
                  width: '100%', background: 'var(--panel-2, #1a1d28)', border: '1px solid var(--line)',
                  borderRadius: 8, padding: '8px 10px', color: 'var(--txt)', fontSize: 13, resize: 'none', marginTop: 4,
                }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={save} disabled={saving} style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: 'var(--gold)', color: '#000', border: 'none', cursor: saving ? 'wait' : 'pointer',
              }}>{saving ? 'Saving...' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setHandle(user.handle); setBio(user.bio || ''); }} style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 12, background: 'var(--panel-2, #1a1d28)',
                border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer',
              }}>Cancel</button>
              {msg && <span style={{ fontSize: 11, color: msg.startsWith('✓') ? 'var(--up)' : 'var(--down)' }}>{msg}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const ALL_ACHIEVEMENTS = [
  { key: 'collector_10', name: 'Collector', desc: 'Add 10 cards to your portfolio', icon: '', tier: 'bronze' },
  { key: 'first_trade', name: 'First Trade', desc: 'Complete your first trade', icon: '', tier: 'bronze' },
  { key: 'first_sale', name: 'Seller', desc: 'Sell your first card', icon: '', tier: 'bronze' },
  { key: 'first_bid', name: 'In the Game', desc: 'Place your first auction bid', icon: '⚡', tier: 'bronze' },
  { key: 'collector_50', name: 'Hoarder', desc: 'Own 50+ cards', icon: '🗄️', tier: 'silver' },
  { key: 'auction_winner', name: 'Gavel Down', desc: 'Win your first auction', icon: '🏆', tier: 'silver' },
  { key: 'big_sale', name: 'Big Sale', desc: 'Sell a card for $200+', icon: '', tier: 'gold' },
  { key: 'collector_100', name: 'Vault Keeper', desc: 'Own 100+ cards in your vault', icon: '🏦', tier: 'gold' },
  { key: 'early_adopter', name: 'Early Adopter', desc: 'Join during the first month', icon: '', tier: 'gold' },
  { key: 'og', name: 'OG', desc: 'One of the original GEMLINE members', icon: '', tier: 'diamond' },
];

const TIER_COLORS = {
  bronze: { bg: 'rgba(205,127,50,.1)', border: 'rgba(205,127,50,.25)', text: '#CD7F32' },
  silver: { bg: 'rgba(192,192,192,.1)', border: 'rgba(192,192,192,.25)', text: '#C0C0C0' },
  gold: { bg: 'rgba(232,179,57,.1)', border: 'rgba(232,179,57,.25)', text: '#E8B339' },
  diamond: { bg: 'rgba(185,242,255,.1)', border: 'rgba(185,242,255,.25)', text: '#B9F2FF' },
};

function AchievementsChecklist({ token }) {
  const [earned, setEarned] = useState(new Set());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch('/api/user/badges', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json())
      .then(d => {
        const keys = (d.badges || []).map(b => b.badge_key || b.key);
        setEarned(new Set(keys));
      })
      .catch(() => {});
  }, [token]);

  const earnedCount = ALL_ACHIEVEMENTS.filter(a => earned.has(a.key)).length;
  const pct = Math.round((earnedCount / ALL_ACHIEVEMENTS.length) * 100);

  return (
    <div className="panel" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15 }}>Achievements</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--gold)' }}>{earnedCount}/{ALL_ACHIEVEMENTS.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 80, height: 6, background: 'var(--panel-2, #1a1d28)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold)', borderRadius: 3, transition: 'width .3s' }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pct}%</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '.2s', color: 'var(--muted)' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>
      
      {open && (
        <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
          {ALL_ACHIEVEMENTS.map(a => {
            const done = earned.has(a.key);
            const tc = TIER_COLORS[a.tier];
            return (
              <div key={a.key} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderRadius: 10, background: done ? tc.bg : 'var(--panel-2, #1a1d28)',
                border: `1px solid ${done ? tc.border : 'var(--line)'}`,
                opacity: done ? 1 : 0.5,
              }}>
                <span style={{ fontSize: 20, filter: done ? 'none' : 'grayscale(1)' }}>{a.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 13,
                    color: done ? tc.text : 'var(--muted)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {a.name}
                    <span style={{
                      fontSize: 8, fontFamily: 'var(--mono)', padding: '1px 5px', borderRadius: 3,
                      background: tc.bg, color: tc.text, textTransform: 'uppercase', letterSpacing: '.05em',
                    }}>{a.tier}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>{a.desc}</div>
                </div>
                {done ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={tc.text} strokeWidth="2.5">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--line)',
                  }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


/* ─── Community Activity Feed ─── */

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const TYPE_META = {
  pull:    { label: 'Pull', color: 'var(--gold)', icon: '🎴' },
  trade:   { label: 'Trade',     color: 'var(--blue)', icon: '🔄' },
  sale:    { label: 'Sale',      color: 'var(--up)',   icon: '💰' },
  general: { label: 'Post',      color: 'var(--muted)','icon': '💬' },
};

const SPORT_EMOJI = { basketball: '🏀', baseball: '⚾', football: '🏈', hockey: '🏒', soccer: '⚽', pokemon: '🃏', 'trading card': '🃏' };
function sportEmoji(sport) { return SPORT_EMOJI[(sport||'').toLowerCase()] || '🃏'; }

function FeedPost({ post, authFetch, token, onLiked }) {
  const [liked, setLiked] = useState(post.userLiked || false);
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [liking, setLiking] = useState(false);
  const meta = TYPE_META[post.type] || TYPE_META.general;
  const handle = post.user?.handle || 'user';
  const initial = handle[0]?.toUpperCase() || 'U';

  const toggleLike = async () => {
    if (!token || liking) return;
    setLiking(true);
    try {
      const res = await authFetch(`/api/posts/${post.id}/like`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setLiked(data.liked);
        setLikeCount(data.likes);
        if (onLiked) onLiked(post.id, data.liked);
      }
    } catch (_) {}
    finally { setLiking(false); }
  };

  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px',
      marginBottom: 12, transition: '.15s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
          background: post.user?.avatarUrl ? `url(${post.user.avatarUrl}) center/cover` : 'linear-gradient(135deg,#16c784, #0d9463)',
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16, color: '#000',
        }}>{post.user?.avatarUrl ? '' : initial}</div>
        <div style={{ flex: 1 }}>
          <Link href={`/profile/${handle}`} style={{ fontWeight: 600, fontSize: 13, color: 'var(--txt)', textDecoration: 'none' }}>
            @{handle}
          </Link>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 1 }}>{timeAgo(post.createdAt)}</div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 600, fontFamily: 'var(--mono)',
          color: meta.color, background: 'var(--panel-2)', border: `1px solid ${meta.color}33`,
          padding: '3px 9px', borderRadius: 20, letterSpacing: '.08em',
        }}>{meta.icon} {meta.label}</div>
      </div>

      {/* Post body */}
      <p style={{ fontSize: 13, lineHeight: 1.55, marginBottom: post.card ? 12 : 14, color: 'var(--txt)' }}>
        {post.body}
      </p>

      {/* Card attachment */}
      {post.card && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--panel-2)', border: '1px solid var(--line)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 14,
        }}>
          <div style={{
            width: 36, height: 48, borderRadius: 5, flexShrink: 0,
            background: post.card.thumbnail ? `url(${post.card.thumbnail}) center/cover` : 'linear-gradient(135deg,#1a1f35,#2a3050)',
            display: 'grid', placeItems: 'center', fontSize: 20,
          }}>{post.card.thumbnail ? '' : sportEmoji(post.card.sport)}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{post.card.player}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {[post.card.grader, post.card.grade].filter(Boolean).join(' ')}
              {post.card.value > 0 && <> · <span style={{ color: 'var(--gold)' }}>${post.card.value.toFixed(0)}</span></>}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={toggleLike}
          disabled={!token}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
            fontFamily: 'var(--mono)', fontSize: 12, color: liked ? 'var(--gold)' : 'var(--muted)',
            cursor: token ? 'pointer' : 'default', opacity: liking ? 0.6 : 1 }}>
          <span style={{ fontSize: 14 }}>{liked ? '❤️' : '♡'}</span> {likeCount}
        </button>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5,
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {!token && <span style={{ fontSize: 10, opacity: 0.5 }}>Sign in to like</span>}
        </span>
      </div>
    </div>
  );
}

function CommunityFeed({ user, authFetch, token }) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [postType, setPostType] = useState('general');
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');

  const loadFeed = useCallback(async (p = 1) => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    try {
      const res = await fetch(`/api/posts/feed?page=${p}`);
      if (res.ok) {
        const data = await res.json();
        if (p === 1) setPosts(data.posts || []);
        else setPosts(prev => [...prev, ...(data.posts || [])]);
        setHasMore(data.hasMore || false);
        setPage(p);
      }
    } catch (_) {}
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  useEffect(() => { loadFeed(1); }, [loadFeed]);

  const submitPost = async () => {
    if (!draft.trim() || !token) return;
    setPosting(true); setPostError('');
    try {
      const res = await authFetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim(), type: postType }),
      });
      const data = await res.json();
      if (!res.ok) { setPostError(data.error || 'Failed to post'); }
      else {
        setPosts(prev => [data.post, ...prev]);
        setDraft(''); setComposing(false); setPostType('general');
      }
    } catch (e) { setPostError(e.message); }
    finally { setPosting(false); }
  };

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Post Composer */}
      <div className="cf-composer" style={{
        background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12,
        padding: '14px 16px', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg,#16c784, #0d9463)',
            display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, color: '#000',
          }}>{user ? (user.handle || 'U')[0].toUpperCase() : 'G'}</div>
          <div style={{ flex: 1 }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onFocus={() => { if (user) setComposing(true); }}
              placeholder={user ? 'Share a pull, trade, or find...' : 'Sign in to post to the community...'}
              disabled={!user}
              style={{
                width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)',
                borderRadius: 9, padding: '10px 12px', color: 'var(--txt)', fontSize: 13,
                resize: 'none', minHeight: composing ? 80 : 40, outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.5, transition: 'min-height .2s',
                opacity: user ? 1 : 0.5, cursor: user ? 'text' : 'not-allowed',
              }}
            />
            {composing && user && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  {['general','pull','trade','sale'].map(t => (
                    <button key={t} onClick={() => setPostType(t)} style={{
                      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: postType === t ? 'var(--gold)' : 'var(--panel-2)',
                      border: `1px solid ${postType === t ? 'var(--gold)' : 'var(--line)'}`,
                      color: postType === t ? '#000' : 'var(--muted)', cursor: 'pointer',
                    }}>{TYPE_META[t]?.icon} {t.charAt(0).toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
                {postError && <div style={{ color: 'var(--down)', fontSize: 12, marginBottom: 6 }}>{postError}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setComposing(false); setDraft(''); setPostError(''); }} style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 12, background: 'none',
                    border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={submitPost} disabled={posting || !draft.trim()} style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: 'var(--gold)', border: 'none', color: '#000',
                    cursor: posting || !draft.trim() ? 'not-allowed' : 'pointer',
                    opacity: posting || !draft.trim() ? 0.6 : 1,
                  }}>{posting ? 'Posting…' : 'Post'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="cf-empty">
          <div className="cf-empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 20, marginBottom: 6, color: 'var(--txt)' }}>The feed starts with you</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 300, margin: '0 auto 18px', lineHeight: 1.5 }}>
            Be the first to post your latest pickup — a new slab, a trade win, or a card you&apos;re hunting.
          </div>
          <button
            onClick={() => {
              const ta = document.querySelector('.cf-composer textarea');
              if (ta) { ta.focus(); ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            }}
            style={{ padding: '11px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--gold)', color: '#04140c', border: 'none', cursor: 'pointer' }}>
            Post your latest pickup
          </button>
        </div>
      ) : (
        <>
          {posts.map(p => (
            <FeedPost key={p.id} post={p} authFetch={authFetch} token={token} />
          ))}
          {hasMore && (
            <button onClick={() => loadFeed(page + 1)} disabled={loadingMore} style={{
              width: '100%', padding: '12px', borderRadius: 10, background: 'var(--panel)',
              border: '1px solid var(--line)', color: 'var(--muted)', cursor: loadingMore ? 'wait' : 'pointer',
              fontFamily: 'var(--mono)', fontSize: 12, marginTop: 4,
            }}>{loadingMore ? 'Loading…' : 'Load more posts'}</button>
          )}
        </>
      )}
    </div>
  );
}
/* ─── /Community Feed ─── */

export default function CommunityPage() {
  useDarkPage(); // real social feed — dark panels, not a light marketing page
  const { user, token, authFetch } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [suggested, setSuggested] = useState([]);
  const [myFollowing, setMyFollowing] = useState([]);
  const [myFollowers, setMyFollowers] = useState([]);
  const [followingSet, setFollowingSet] = useState(new Set());
  const [tab, setTab] = useState('feed');

  // Load suggested users
  useEffect(() => {
    fetch('/api/users/suggested').then(r => r.json()).then(d => setSuggested(d.users || [])).catch(() => {});
  }, []);

  // Load following/followers if logged in
  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/users/${user.id}/following`).then(r => r.json()).then(d => {
      setMyFollowing(d.users || []);
      setFollowingSet(new Set((d.users || []).map(u => u.id)));
    }).catch(() => {});
    fetch(`/api/users/${user.id}/followers`).then(r => r.json()).then(d => setMyFollowers(d.users || [])).catch(() => {});
  }, [user]);

  // Search users
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 1) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data.users || []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const toggleFollow = useCallback(async (userId, isFollowing) => {
    if (!token) return;
    try {
      if (isFollowing) {
        await authFetch(`/api/users/${userId}/follow`, { method: 'DELETE' });
        setFollowingSet(prev => { const n = new Set(prev); n.delete(userId); return n; });
        setMyFollowing(prev => prev.filter(u => u.id !== userId));
      } else {
        await authFetch(`/api/users/${userId}/follow`, { method: 'POST' });
        setFollowingSet(prev => new Set([...prev, userId]));
      }
    } catch (e) { console.error('Follow toggle failed:', e); }
  }, [token, authFetch]);

  const raw = searchQuery ? searchResults : (tab === 'discover' ? suggested : tab === 'following' ? myFollowing : myFollowers);
  const displayUsers = user ? raw.filter(u => u.id !== user.id) : raw;

  // Live trending from the market heatmap (top validated gainers)
  const [trending, setTrending] = useState([]);
  const [liveStats, setLiveStats] = useState(null);
  useEffect(() => {
    fetch('/api/market/heatmap').then(r => r.json()).then(d => {
      const rows = (d.cards || []).filter(c => Number(c.gain_7d) > 0).slice(0, 4);
      setTrending(rows);
    }).catch(() => {});
    fetch('/api/stats/live').then(r => r.json()).then(setLiveStats).catch(() => {});
  }, []);

  return (
    <>
      <div className="eyebrow">Social</div>
      <h1 className="page">Community</h1>
      <p className="sub">Pulls, trades, and collectors all in one place. Show off your hits and follow the collectors you rate.</p>

      {/* Search bar */}
      <div style={{ marginTop: 20, marginBottom: 20 }}>
        <div style={{ position: 'relative', maxWidth: 440 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)' }}>
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" />
          </svg>
          <input
            type="text"
            placeholder="Search users by handle..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '11px 14px 11px 36px', color: 'var(--txt)',
              fontSize: 13, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      {!searchQuery && (
        <div className="seg" style={{ marginBottom: 20 }}>
          <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>Feed</button>
          <button className={tab === 'discover' ? 'on' : ''} onClick={() => setTab('discover')}>Discover</button>
          {user && (
            <>
              <button className={tab === 'following' ? 'on' : ''} onClick={() => setTab('following')}>
                Following <span style={{ marginLeft:4, background:'var(--panel-2)', padding:'1px 6px', borderRadius:10, fontSize:10 }}>{myFollowing.length}</span>
              </button>
              <button className={tab === 'followers' ? 'on' : ''} onClick={() => setTab('followers')}>
                Followers <span style={{ marginLeft:4, background:'var(--panel-2)', padding:'1px 6px', borderRadius:10, fontSize:10 }}>{myFollowers.length}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 2-column layout for feed, 1-col for others */}
      {searching && <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>Searching...</div>}
      {searchQuery && !searching && searchResults.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: 40, textAlign: 'center' }}>No users found for &ldquo;{searchQuery}&rdquo;</div>
      )}

      {tab === 'feed' && !searchQuery && (
        <div className="community-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
          {/* Main feed */}
          <CommunityFeed user={user} authFetch={authFetch} token={token} />

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 96 }}>
            {/* Trending now — live market data */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                Trending Now
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--up)', boxShadow: '0 0 6px var(--up)', display: 'inline-block' }} />
              </div>
              {trending.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--dim)', padding: '8px 0' }}>Loading market data…</div>
              ) : trending.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < trending.length-1 ? '1px solid var(--line)' : 'none' }}>
                  <span style={{ width: 28, height: 38, borderRadius: 4, flexShrink: 0, overflow: 'hidden', background: 'var(--panel-2)', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, color: 'var(--muted)', border: '1px solid var(--line)' }}>
                    {c.thumbnail ? <img src={c.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (c.player || '?').split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.player}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{c.grader || 'RAW'} {c.grade}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--up)', fontWeight: 600 }}>+{Number(c.gain_7d).toFixed(0)}%</span>
                </div>
              ))}
            </div>

            {/* Suggested users */}
            {suggested.slice(0, 4).length > 0 && (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Who to Follow</div>
                {suggested.slice(0, 4).map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#16c784, #0d9463)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, color: '#000', flexShrink: 0 }}>
                      {(u.handle || 'U')[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>@{u.handle}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{Number(u.card_count) || 0} cards</div>
                    </div>
                    <button onClick={() => toggleFollow(u.id, followingSet.has(u.id))} style={{
                      padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: followingSet.has(u.id) ? 'var(--panel-2)' : 'var(--gold)',
                      color: followingSet.has(u.id) ? 'var(--muted)' : '#000',
                      border: '1px solid var(--line)',
                    }}>{followingSet.has(u.id) ? 'Following' : 'Follow'}</button>
                  </div>
                ))}
              </div>
            )}

            {/* Community stats — live */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>The Exchange</div>
              {[
                ['Cards priced live', '750K+'],
                ['Active listings', liveStats?.active_listings ?? '—'],
                ['Trades this week', liveStats?.trades_this_week ?? '—'],
                ['Collectors', liveStats?.total_users ?? '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{k}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--gold)' }}>{v?.toLocaleString?.() ?? v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab !== 'feed' && (
        <div className="community-grid">
          {displayUsers.map(u => (
            <UserCard key={u.id} user={u} currentUserId={user?.id} onToggleFollow={toggleFollow} followingSet={followingSet} />
          ))}
          {!searchQuery && tab === 'discover' && suggested.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: 40, textAlign: 'center', gridColumn: '1/-1' }}>
              No users yet. Be the first to build a portfolio!
            </div>
          )}
        </div>
      )}
    </>
  );
}
