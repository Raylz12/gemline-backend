'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '../components/AuthContext';
import AuthModal from '../components/AuthModal';
import { fmt } from '../lib/data';
import useDarkPage from '../lib/useDarkPage';
import ReportModal from '../components/ReportModal';

function UserCard({ user, currentUserId, onToggleFollow, followingSet, onRequireAuth }) {
  const isFollowing = followingSet.has(user.id);
  const isSelf = currentUserId === user.id;
  const initial = (user.handle || 'U')[0].toUpperCase();

  return (
    <div className="community-user-card">
      <Link href={`/user/${user.handle}`} className="community-user-info">
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
      {!isSelf && (
        <button
          className={`community-follow-btn ${isFollowing ? 'following' : ''}`}
          onClick={(e) => { e.preventDefault(); if (!currentUserId) { onRequireAuth?.(); return; } onToggleFollow(user.id, isFollowing); }}
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
      <Link href={`/user/${user.handle}`} style={{ flexShrink: 0 }}>
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
              <Link href={`/user/${user.handle}`} style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 16, color: 'var(--txt)', textDecoration: 'none' }}>@{user.handle}</Link>
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
  // Show-floor auto-events (server-synthesized, read-only)
  listing: { label: 'New Listing', color: 'var(--gold)', icon: '🏷️' },
  joined:  { label: 'New Collector', color: 'var(--blue)', icon: '👋' },
};

const SPORT_EMOJI = { basketball: '🏀', baseball: '⚾', football: '🏈', hockey: '🏒', soccer: '⚽', pokemon: '🃏', 'trading card': '🃏' };
function sportEmoji(sport) { return SPORT_EMOJI[(sport||'').toLowerCase()] || '🃏'; }

function CommentSection({ post, authFetch, token, onRequireAuth, onCountChange, tick }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState(null); // null = not loaded
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = token ? await authFetch(`/api/posts/${post.id}/comments`) : await fetch(`/api/posts/${post.id}/comments`);
      const d = await res.json();
      setComments(d.comments || []);
    } catch { setComments([]); }
  }, [post.id, token, authFetch]);

  const toggle = () => {
    if (!open && comments === null) load();
    setOpen(o => !o);
  };

  const submit = async () => {
    if (!token) { onRequireAuth?.(); return; }
    if (!draft.trim() || posting) return;
    setPosting(true);
    try {
      const res = await authFetch(`/api/posts/${post.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const d = await res.json();
      if (res.ok && d.comment) {
        setComments(prev => [...(prev || []), d.comment]);
        setDraft('');
        onCountChange?.(d.commentCount);
      }
    } catch (_) {}
    finally { setPosting(false); }
  };

  return (
    <div style={{ marginTop: 4 }}>
      <button onClick={toggle} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
        fontFamily: 'var(--mono)', fontSize: 12, color: open ? 'var(--gold)' : 'var(--muted)', cursor: 'pointer', minHeight: 32, padding: '4px 6px 4px 0' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg> {post._commentCount ?? post.comments ?? 0}
      </button>
      {open && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          {comments === null ? (
            <div style={{ fontSize: 12, color: 'var(--dim)' }}>Loading…</div>
          ) : comments.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>No comments yet, be the first.</div>
          ) : comments.map(c => (
            <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Link href={`/user/${c.user?.handle}`} style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg,#16c784,#0d9463)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 11, color: '#000', textDecoration: 'none' }}>
                {(c.user?.handle || 'U')[0].toUpperCase()}
              </Link>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12 }}><Link href={`/user/${c.user?.handle}`} style={{ fontWeight: 600, color: 'var(--txt)', textDecoration: 'none' }}>@{c.user?.handle}</Link>
                  <span style={{ color: 'var(--dim)', marginLeft: 6, fontFamily: 'var(--mono)', fontSize: 10 }}>{timeAgo(c.createdAt)}</span></div>
                <div style={{ fontSize: 13, color: 'var(--txt)', lineHeight: 1.45, marginTop: 1 }}>{c.body}</div>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              onFocus={() => { if (!token) onRequireAuth?.(); }}
              placeholder={token ? 'Add a comment…' : 'Sign in to comment'} maxLength={300}
              style={{ flex: 1, background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8,
                padding: '8px 10px', color: 'var(--txt)', fontSize: 13, outline: 'none' }} />
            <button onClick={submit} disabled={posting || !draft.trim()} style={{ padding: '8px 14px', borderRadius: 8,
              fontSize: 12, fontWeight: 700, background: 'var(--gold)', border: 'none', color: '#000',
              cursor: posting || !draft.trim() ? 'not-allowed' : 'pointer', opacity: posting || !draft.trim() ? 0.6 : 1 }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedPost({ post, authFetch, token, onLiked, onRequireAuth, meHandle, tick }) {
  const [showReport, setShowReport] = useState(false);
  const [liked, setLiked] = useState(post.userLiked || false);
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [commentCount, setCommentCount] = useState(post.comments || 0);
  const [liking, setLiking] = useState(false);
  const meta = TYPE_META[post.type] || TYPE_META.general;
  const handle = post.user?.handle || 'user';
  const initial = handle[0]?.toUpperCase() || 'U';

  const toggleLike = async () => {
    if (!token) { onRequireAuth?.(); return; }
    if (liking) return;
    // Optimistic
    const prevLiked = liked, prevCount = likeCount;
    setLiked(!prevLiked); setLikeCount(prevCount + (prevLiked ? -1 : 1));
    setLiking(true);
    try {
      const res = await authFetch(`/api/posts/${post.id}/like`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setLiked(data.liked); setLikeCount(data.likes);
        if (onLiked) onLiked(post.id, data.liked);
      } else { setLiked(prevLiked); setLikeCount(prevCount); }
    } catch (_) { setLiked(prevLiked); setLikeCount(prevCount); }
    finally { setLiking(false); }
  };

  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px',
      marginBottom: 12, transition: '.15s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Link href={`/user/${handle}`} aria-label={`@${handle} profile`} style={{
          width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
          background: post.user?.avatarUrl ? `url(${post.user.avatarUrl}) center/cover` : 'linear-gradient(135deg,#16c784, #0d9463)',
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16, color: '#000', textDecoration: 'none',
        }}>{post.user?.avatarUrl ? '' : initial}</Link>
        <div style={{ flex: 1 }}>
          <Link href={`/user/${handle}`} style={{ fontWeight: 600, fontSize: 13, color: 'var(--txt)', textDecoration: 'none' }}>
            @{handle}
          </Link>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 1 }}>{timeAgo(post.createdAt)}</div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 600, fontFamily: 'var(--mono)',
          color: meta.color, background: 'var(--panel-2)', border: `1px solid ${meta.color}33`,
          padding: '3px 9px', borderRadius: 20, letterSpacing: '.08em',
        }}><span className="emoji">{meta.icon}</span> {meta.label}</div>
      </div>

      {/* Body */}
      <p style={{ fontSize: 13, lineHeight: 1.55, marginBottom: post.card ? 12 : 14, color: 'var(--txt)' }}>
        {post.body}
      </p>

      {/* Card attachment */}
      {post.card && (
        <Link href={`/card/${post.card.id}`} style={{
          display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit',
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
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="mchip mchip-grade">{[post.card.grader, post.card.grade].filter(Boolean).join(' ') || 'RAW'}</span>
              {post.card.value > 0 && <span style={{ color: 'var(--gold)' }}>${post.card.value.toFixed(0)}</span>}
            </div>
          </div>
        </Link>
      )}

      {/* Actions — auto-events are read-only (synthetic ids) */}
      {!post.activity && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={toggleLike}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            fontFamily: 'var(--mono)', fontSize: 12, color: liked ? 'var(--gold)' : 'var(--muted)',
            cursor: 'pointer', opacity: liking ? 0.6 : 1, minHeight: 32, padding: '4px 6px 4px 0',
            transition: 'transform .12s', transform: liked ? 'scale(1.02)' : 'none' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.7 0-3 .9-4 2-1-1.1-2.3-2-4-2A5.5 5.5 0 0 0 3 8.5c0 2.3 1.5 4 3 5.5l6 6Z" />
          </svg> {likeCount}
        </button>
        <div style={{ flex: 1 }}>
          <CommentSection post={{ ...post, _commentCount: commentCount }} authFetch={authFetch} token={token}
            onRequireAuth={onRequireAuth} onCountChange={setCommentCount} tick={tick} />
        </div>
        {token && meHandle !== handle && (
          <button
            onClick={() => setShowReport(true)}
            title="Report this post"
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', padding: '4px 6px', minHeight: 32 }}>
            ⚑
          </button>
        )}
      </div>
      )}
      {showReport && (
        <ReportModal targetType="post" targetId={post.id} targetLabel={`@${handle}: “${(post.body || '').slice(0, 60)}…”`} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}

const FEED_TABS = [
  { key: 'foryou', label: 'For You' },
  { key: 'following', label: 'Following' },
  { key: 'latest', label: 'Latest' },
];

function CommunityFeed({ user, authFetch, token, onRequireAuth }) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [postType, setPostType] = useState('general');
  const [attachCard, setAttachCard] = useState(null);
  const [cardSearch, setCardSearch] = useState('');
  const [cardResults, setCardResults] = useState([]);
  const [feedTab, setFeedTab] = useState('foryou');
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [newCount, setNewCount] = useState(0);
  const [tick, setTick] = useState(0); // drives relative-timestamp refresh
  const sentinel = useRef(null);
  const newestTs = useRef(null);

  // Relative timestamps refresh every 30s
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(t); }, []);

  const loadFeed = useCallback(async (p = 1, tab = feedTab) => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    try {
      const url = `/api/posts/feed?page=${p}&tab=${tab}`;
      const res = token ? await authFetch(url) : await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const incoming = data.posts || [];
        if (p === 1) {
          setPosts(incoming);
          setNewCount(0);
          const realPosts = incoming.filter(x => !x.activity);
          newestTs.current = realPosts.length ? realPosts[0].createdAt : new Date().toISOString();
        } else setPosts(prev => [...prev, ...incoming]);
        setHasMore(data.hasMore || false);
        setPage(p);
      }
    } catch (_) {}
    finally { setLoading(false); setLoadingMore(false); }
  }, [token, authFetch, feedTab]);

  useEffect(() => { loadFeed(1, feedTab); }, [feedTab]);

  // Infinite scroll
  useEffect(() => {
    if (!sentinel.current || !hasMore || loading) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loadingMore) loadFeed(page + 1, feedTab);
    }, { rootMargin: '400px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [hasMore, loading, loadingMore, page, feedTab, loadFeed]);

  // "New posts" poll every 45s (only on For You / Latest)
  useEffect(() => {
    if (feedTab === 'following') return;
    const check = async () => {
      if (!newestTs.current) return;
      try {
        const res = await fetch(`/api/posts/since?ts=${encodeURIComponent(newestTs.current)}`);
        const d = await res.json();
        if (d.count > 0) setNewCount(d.count);
      } catch (_) {}
    };
    const t = setInterval(check, 45000);
    return () => clearInterval(t);
  }, [feedTab]);

  // Card typeahead for composer attachment
  useEffect(() => {
    if (!cardSearch || cardSearch.length < 2) { setCardResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(cardSearch)}`);
        const d = await res.json();
        setCardResults((d.results || d.families || []).slice(0, 5));
      } catch { setCardResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [cardSearch]);

  const submitPost = async () => {
    if (!draft.trim() || !token) return;
    setPosting(true); setPostError('');
    try {
      const res = await authFetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim(), type: postType, cardId: attachCard?.id || null }),
      });
      const data = await res.json();
      if (!res.ok) { setPostError(data.error || 'Failed to post'); }
      else {
        const newPost = {
          ...data.post,
          createdAt: data.post.created_at || data.post.createdAt || new Date().toISOString(),
          likes: 0, comments: 0, userLiked: false,
          card: attachCard ? { id: attachCard.id, player: attachCard.player,
            grader: attachCard.grader, grade: attachCard.grade,
            value: Number(attachCard.catalog_price) || 0, sport: attachCard.sport,
            thumbnail: attachCard.ebay_thumb || attachCard.image_url || null } : null,
        };
        setPosts(prev => [newPost, ...prev]);
        newestTs.current = newPost.createdAt;
        setDraft(''); setComposing(false); setPostType('general'); setAttachCard(null); setCardSearch('');
      }
    } catch (e) { setPostError(e.message); }
    finally { setPosting(false); }
  };

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Composer */}
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
              onFocus={(e) => { if (user) { setComposing(true); } else { e.target.blur(); onRequireAuth?.(); } }}
              onClick={() => { if (!user) onRequireAuth?.(); }}
              readOnly={!user}
              placeholder={user ? 'Share a pull, trade, or find...' : 'Sign in to post, join the conversation...'}
              style={{
                width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)',
                borderRadius: 9, padding: '10px 12px', color: 'var(--txt)', fontSize: 13,
                resize: 'none', minHeight: composing ? 80 : 40, outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.5, transition: 'min-height .2s',
                opacity: user ? 1 : 0.75, cursor: user ? 'text' : 'pointer',
              }}
            />
            {composing && user && (
              <div style={{ marginTop: 8 }}>
                {/* Attached card chip */}
                {attachCard && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{attachCard.player}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{attachCard.card_set || attachCard.year}</span>
                    <button onClick={() => setAttachCard(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  </div>
                )}
                {/* Card search */}
                {!attachCard && (
                  <div style={{ position: 'relative', marginBottom: 8 }}>
                    <input value={cardSearch} onChange={e => setCardSearch(e.target.value)}
                      placeholder="🃏 Attach a card (search player/set)…"
                      style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', color: 'var(--txt)', fontSize: 12, outline: 'none' }} />
                    {cardResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
                        {cardResults.map(c => (
                          <button key={c.id} onClick={() => { setAttachCard(c); setCardResults([]); setCardSearch(''); }}
                            style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', color: 'var(--txt)' }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{c.player}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{c.card_set || c.year}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  {['general','pull','trade','sale'].map(t => (
                    <button key={t} onClick={() => setPostType(t)} style={{
                      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: postType === t ? 'var(--gold)' : 'var(--panel-2)',
                      border: `1px solid ${postType === t ? 'var(--gold)' : 'var(--line)'}`,
                      color: postType === t ? '#000' : 'var(--muted)', cursor: 'pointer',
                    }}><span className="emoji">{TYPE_META[t]?.icon}</span> {t.charAt(0).toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
                {postError && <div style={{ color: 'var(--down)', fontSize: 12, marginBottom: 6 }}>{postError}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setComposing(false); setDraft(''); setPostError(''); setAttachCard(null); setCardSearch(''); }} style={{
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

      {/* Feed sub-tabs */}
      <div className="seg" style={{ marginBottom: 12 }}>
        {FEED_TABS.map(t => (
          <button key={t.key} className={feedTab === t.key ? 'on' : ''}
            onClick={() => { if (t.key === 'following' && !user) { onRequireAuth?.(); return; } setFeedTab(t.key); }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* New posts pill */}
      {newCount > 0 && (
        <button onClick={() => loadFeed(1, feedTab)} style={{
          display: 'block', margin: '0 auto 12px', padding: '8px 18px', borderRadius: 20,
          background: 'var(--gold)', color: '#04140c', border: 'none', fontWeight: 700, fontSize: 12,
          cursor: 'pointer', boxShadow: '0 4px 16px rgba(22,199,132,.35)',
        }}>↑ {newCount} new post{newCount > 1 ? 's' : ''}</button>
      )}

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
          <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 20, marginBottom: 6, color: 'var(--txt)' }}>
            {feedTab === 'following' ? 'Follow collectors to fill this feed' : 'The feed starts with you'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 300, margin: '0 auto 18px', lineHeight: 1.5 }}>
            {feedTab === 'following'
              ? 'When people you follow post pulls, trades, and finds, they show up here.'
              : 'Be the first to post your latest pickup, a new slab, a trade win, or a card you\u2019re hunting.'}
          </div>
          {feedTab !== 'following' && (
            <button
              onClick={() => {
                const ta = document.querySelector('.cf-composer textarea');
                if (ta) { ta.focus(); ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
              }}
              style={{ padding: '11px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--gold)', color: '#04140c', border: 'none', cursor: 'pointer' }}>
              Post your latest pickup
            </button>
          )}
        </div>
      ) : (
        <>
          {posts.map(p => (
            <FeedPost key={p.id} post={p} authFetch={authFetch} token={token} onRequireAuth={onRequireAuth} meHandle={user?.handle} tick={tick} />
          ))}
          <div ref={sentinel} style={{ height: 1 }} />
          {loadingMore && <div style={{ textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, padding: 12 }}>Loading…</div>}
          {!hasMore && posts.length > 4 && (
            <div style={{ textAlign: 'center', color: 'var(--dim)', fontSize: 12, padding: '16px 0' }}>You&apos;re all caught up.</div>
          )}
        </>
      )}
    </div>
  );
}
/* ─── /Community Feed ─── */

export default function CommunityPage() {
  useDarkPage(); // real social feed, dark panels, not a light marketing page
  const { user, token, authFetch } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [suggested, setSuggested] = useState([]);
  const [myFollowing, setMyFollowing] = useState([]);
  const [myFollowers, setMyFollowers] = useState([]);
  const [followingSet, setFollowingSet] = useState(new Set());
  const [tab, setTab] = useState('feed');
  const [showAuth, setShowAuth] = useState(false);
  const requireAuth = useCallback(() => setShowAuth(true), []);

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
    if (!token) { setShowAuth(true); return; }
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

  // Live trending from the market heatmap (top validated gainers). Re-polls
  // every 5 min so repeat visits see the rotated set; shows "updated Xm ago".
  const [trending, setTrending] = useState([]);
  const [trendingAt, setTrendingAt] = useState(null);
  const [liveStats, setLiveStats] = useState(null);
  const [, setTrendTick] = useState(0);
  useEffect(() => {
    const load = () => fetch('/api/market/heatmap?sort=movers').then(r => r.json()).then(d => {
      const rows = (d.cards || []).filter(c => Number(c.gain_7d) > 0).slice(0, 5);
      setTrending(rows);
      setTrendingAt(d.updatedAt || new Date().toISOString());
    }).catch(() => {});
    load();
    const poll = setInterval(load, 5 * 60 * 1000);
    const tick = setInterval(() => setTrendTick(x => x + 1), 30000);
    fetch('/api/stats/live').then(r => r.json()).then(setLiveStats).catch(() => {});
    return () => { clearInterval(poll); clearInterval(tick); };
  }, []);

  return (
    <>
      <div className="eyebrow">Social</div>
      <h1 className="page">Community</h1>
      <p className="sub">Pulls, trades, and collectors all in one place. Show off your hits and follow the collectors you rate.</p>

      {/* Community is READABLE signed-out — the gate moved to actions
          (posting, likes, follows) which each prompt AuthModal. */}

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
          <CommunityFeed user={user} authFetch={authFetch} token={token} onRequireAuth={requireAuth} />

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 96 }}>
            {/* Trending now — live market data */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                Trending Now
                <span className="lp-live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--up)', boxShadow: '0 0 6px var(--up)', display: 'inline-block' }} />
              </div>
              {trendingAt && <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)', marginBottom: 10 }}>updated {timeAgo(trendingAt)}</div>}
              {trending.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--dim)', padding: '8px 0' }}>Loading market data…</div>
              ) : trending.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < trending.length-1 ? '1px solid var(--line)' : 'none' }}>
                  <span style={{ width: 28, height: 38, borderRadius: 4, flexShrink: 0, overflow: 'hidden', background: 'var(--panel-2)', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, color: 'var(--muted)', border: '1px solid var(--line)' }}>
                    {c.thumbnail ? <img src={c.thumbnail} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (c.player || '?').split(' ').map(w => w[0]).join('').slice(0, 2)}
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
                    <Link href={`/user/${u.handle}`} aria-label={`@${u.handle} profile`} style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#16c784, #0d9463)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, color: '#000', flexShrink: 0, textDecoration: 'none' }}>
                      {(u.handle || 'U')[0].toUpperCase()}
                    </Link>
                    <Link href={`/user/${u.handle}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>@{u.handle}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{Number(u.card_count) || 0} cards</div>
                    </Link>
                    <button onClick={() => (token ? toggleFollow(u.id, followingSet.has(u.id)) : requireAuth())} style={{
                      padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: followingSet.has(u.id) ? 'var(--panel-2)' : 'var(--gold)',
                      color: followingSet.has(u.id) ? 'var(--muted)' : '#000',
                      border: '1px solid var(--line)',
                    }}>{followingSet.has(u.id) ? 'Following' : 'Follow'}</button>
                  </div>
                ))}
              </div>
            )}

            {/* Show-floor stats — only stats that always look alive. Counts with
                embarrassing floors (listings < 25, collectors < 100) stay hidden
                until the numbers are social proof instead of anti-social-proof. */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>The Show Floor</div>
              {[
                ['Cards priced live', liveStats?.totalCards ?? '—'],
                ['Prices refreshed', 'Daily'],
                ...(Number(liveStats?.activeListings) >= 25 ? [['Active listings', liveStats.activeListings]] : []),
                ...(Number(liveStats?.users) >= 100 ? [['Collectors', liveStats.users]] : []),
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
            <UserCard key={u.id} user={u} currentUserId={user?.id} onToggleFollow={toggleFollow} followingSet={followingSet} onRequireAuth={requireAuth} />
          ))}
          {!searchQuery && tab === 'discover' && suggested.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: 40, textAlign: 'center', gridColumn: '1/-1' }}>
              No users yet. Be the first to build a portfolio!
            </div>
          )}
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
