'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../components/AuthContext';
import { fmt } from '../lib/data';

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
          background: 'linear-gradient(135deg, var(--gold), #d4a12a)',
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
  { key: 'first_pull', name: 'First Pull', desc: 'Open your first pack', icon: '', tier: 'bronze' },
  { key: 'collector_10', name: 'Collector', desc: 'Add 10 cards to your portfolio', icon: '', tier: 'bronze' },
  { key: 'first_trade', name: 'First Trade', desc: 'Complete your first trade', icon: '', tier: 'bronze' },
  { key: 'first_sale', name: 'Seller', desc: 'Sell your first card', icon: '', tier: 'bronze' },
  { key: 'pack_addict', name: 'Pack Addict', desc: 'Open 25 packs', icon: '🎰', tier: 'silver' },
  { key: 'collector_50', name: 'Hoarder', desc: 'Own 50+ cards', icon: '🗄️', tier: 'silver' },
  { key: 'big_hit', name: 'Big Hit', desc: 'Pull a card worth $200+', icon: '', tier: 'gold' },
  { key: 'collector_100', name: 'Vault Keeper', desc: 'Own 100+ cards in your vault', icon: '🏦', tier: 'gold' },
  { key: 'pack_whale', name: 'Whale', desc: 'Spend 5,000+ credits on packs', icon: '🐋', tier: 'gold' },
  { key: 'early_adopter', name: 'Early Adopter', desc: 'Join during the first month', icon: '', tier: 'gold' },
  { key: 'legendary_pull', name: 'Legendary', desc: 'Pull a mythic-tier card', icon: '', tier: 'diamond' },
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
const DEMO_POSTS = [
  { id: 1, user: '@CardRipper', avatar: 'C', time: '2m ago', type: 'pull',
    text: 'Just ripped a pack and pulled a PSA 10 Cooper Flagg! ',
    card: { name: 'Cooper Flagg', grade: 'PSA 10', value: '$268', img: null, sport: '🏀' },
    likes: 14, comments: 3 },
  { id: 2, user: '@PackShark6903', avatar: 'P', time: '18m ago', type: 'trade',
    text: 'Looking to trade my BGS 9.5 Wembanyama for a PSA 10 LeBron rookie. DM me!',
    likes: 7, comments: 5 },
  { id: 3, user: '@SlabKing', avatar: 'S', time: '1h ago', type: 'sale',
    text: 'Just sold my PSA 8 Ken Griffey Jr. \x2789 Upper Deck for $87 — finally got the price I wanted',
    likes: 22, comments: 8 },
  { id: 4, user: '@VaultCollector', avatar: 'V', time: '3h ago', type: 'pull',
    text: 'Opened 3 hobby boxes today. Biggest hit: 1/1 logoman Jalen Brunson 🤯',
    card: { name: 'Jalen Brunson', grade: 'RAW', value: '1/1', img: null, sport: '🏀' },
    likes: 41, comments: 17 },
  { id: 5, user: '@PokeMasterJ', avatar: 'P', time: '5h ago', type: 'pull',
    text: 'Hit a CGC 10 Pristine Charizard from the new Mega Evolution set 🐉',
    card: { name: 'Charizard', grade: 'CGC 10 PRISTINE', value: '$340+', img: null, sport: '🃏' },
    likes: 88, comments: 29 },
];

const TYPE_META = {
  pull: { label: 'Pack Pull', color: 'var(--gold)', icon: '' },
  trade: { label: 'Trade Offer', color: 'var(--blue)', icon: '' },
  sale: { label: 'Sale', color: 'var(--up)', icon: '' },
};

function FeedPost({ post }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const meta = TYPE_META[post.type] || TYPE_META.pull;
  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px',
      marginBottom: 12, transition: '.15s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg,var(--gold),#b8851f)',
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16, color: '#000',
        }}>{post.avatar}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{post.user}</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 1 }}>{post.time}</div>
        </div>
        <div style={{
          fontSize: 10, fontWeight: 600, fontFamily: 'var(--mono)',
          color: meta.color, background: 'rgba(0,0,0,.3)', border: `1px solid ${meta.color}33`,
          padding: '3px 9px', borderRadius: 20, letterSpacing: '.08em',
        }}>{meta.icon} {meta.label}</div>
      </div>

      {/* Post text */}
      <p style={{ fontSize: 13, lineHeight: 1.55, marginBottom: post.card ? 12 : 14, color: 'var(--txt)' }}>
        {post.text}
      </p>

      {/* Card attachment */}
      {post.card && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--panel-2)', border: '1px solid var(--line)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 14,
        }}>
          <div style={{
            width: 36, height: 48, borderRadius: 5, background: 'linear-gradient(135deg,#1a1f35,#2a3050)',
            display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0,
          }}>{post.card.sport}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{post.card.name}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {post.card.grade} · <span style={{ color: 'var(--gold)' }}>{post.card.value}</span>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => { setLiked(!liked); setLikeCount(n => liked ? n - 1 : n + 1); }}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
            fontFamily: 'var(--mono)', fontSize: 12, color: liked ? 'var(--gold)' : 'var(--muted)', cursor: 'pointer' }}>
          <span style={{ fontSize: 14 }}>{liked ? '' : '🤍'}</span> {likeCount}
        </button>
        <button style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
          <span style={{ fontSize: 14 }}>💬</span> {post.comments}
        </button>
        <button style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', marginLeft: 'auto' }}>
          <span style={{ fontSize: 14 }}>↗</span> Share
        </button>
      </div>
    </div>
  );
}

function CommunityFeed({ user }) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <div style={{ marginBottom: 28 }}>
      {/* Post Composer */}
      <div style={{
        background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12,
        padding: '14px 16px', marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg,var(--gold),#b8851f)',
            display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, color: '#000',
          }}>{user ? (user.handle || 'U')[0].toUpperCase() : 'G'}</div>
          <div style={{ flex: 1 }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onFocus={() => setComposing(true)}
              placeholder="Share a pull, trade, or find..."
              style={{
                width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)',
                borderRadius: 9, padding: '10px 12px', color: 'var(--txt)', fontSize: 13,
                resize: 'none', minHeight: composing ? 80 : 40, outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.5, transition: 'min-height .2s',
              }}
            />
            {composing && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setComposing(false); setDraft(''); }} style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 12, background: 'none',
                  border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer',
                }}>Cancel</button>
                <button style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: 'var(--gold)', border: 'none', color: '#000', cursor: 'pointer',
                }}>Post</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feed posts */}
      {DEMO_POSTS.map(p => <FeedPost key={p.id} post={p} />)}
      <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 11 }}>
        ↑ Showing demo activity · Sign in to see your real feed
      </div>
    </div>
  );
}
/* ─── /Community Feed ─── */

export default function CommunityPage() {
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

  const TRENDING_CARDS = [
    { name: 'Cooper Flagg', sport: '🏀', change: '+49%', grade: 'PSA 10' },
    { name: 'Meowth', sport: '🃏', change: '+288', sub: 'sales/wk', grade: 'PSA 10' },
    { name: 'Ken Griffey Jr.', sport: '⚾', change: '+2400%', grade: 'Raw' },
    { name: 'Victor Wembanyama', sport: '🏀', change: '299 sales', grade: 'Raw' },
  ];

  return (
    <>
      <div className="eyebrow">Social</div>
      <h1 className="page">Community</h1>
      <p className="sub">Pack pulls, trades, and collectors all in one place.</p>

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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
          {/* Main feed */}
          <CommunityFeed user={user} />

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Trending now */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Trending Now</div>
              {TRENDING_CARDS.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < TRENDING_CARDS.length-1 ? '1px solid var(--line)' : 'none' }}>
                  <span style={{ fontSize: 20 }}>{c.sport}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)' }}>{c.grade}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--up)', fontWeight: 600 }}>{c.change}</span>
                </div>
              ))}
            </div>

            {/* Suggested users */}
            {suggested.slice(0, 4).length > 0 && (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Who to Follow</div>
                {suggested.slice(0, 4).map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,var(--gold),#b8851f)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, color: '#000', flexShrink: 0 }}>
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

            {/* Community stats */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>This Week</div>
              {[['Pack pulls shared', '142'], ['Trades proposed', '38'], ['Cards sold', '97'], ['New members', '24']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{k}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--gold)' }}>{v}</span>
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
