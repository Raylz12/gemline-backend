'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../components/AuthContext';
import AuthModal from '../../../components/AuthModal';
import useDarkPage from '../../../lib/useDarkPage';
import { GroupAvatar, PrivacyBadge, RoleChip, PRESET_EMOJI, PRESET_COLORS, timeAgo, memberLabel } from '../../groupsLib';

const inputStyle = {
  width: '100%', background: 'var(--panel-2, #1a1d28)', border: '1px solid var(--line)',
  borderRadius: 8, padding: '9px 11px', color: 'var(--txt)', fontSize: 13, outline: 'none',
};
const labelStyle = { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 };
const canMod = (role) => role === 'owner' || role === 'admin';

function SettingsModal({ group, authFetch, onClose, onSaved, onDeleted }) {
  const isOwner = group.myRole === 'owner';
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [avatar, setAvatar] = useState(group.avatar);
  const [color, setColor] = useState(group.color);
  const [privacy, setPrivacy] = useState(group.privacy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const body = { description: description.trim(), avatar, color };
      if (isOwner) { body.name = name.trim(); body.privacy = privacy; }
      const res = await authFetch(`/api/groups/${group.slug}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || 'Failed to save');
      else onSaved(d.group);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true); setError('');
    try {
      const res = await authFetch(`/api/groups/${group.slug}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to delete'); setDeleting(false); }
      else onDeleted();
    } catch (e) { setError(e.message); setDeleting(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(4,8,14,.72)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} className="panel" style={{ width: '100%', maxWidth: 440, padding: 20, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 18 }}>Group settings</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isOwner && (
            <div>
              <label style={labelStyle}>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={50} style={inputStyle} />
            </div>
          )}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={3} style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit' }} />
          </div>
          <div>
            <label style={labelStyle}>Badge</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <GroupAvatar group={{ avatar, color }} size={52} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                  {PRESET_EMOJI.map(e => (
                    <button key={e} onClick={() => setAvatar(e)} style={{
                      width: 30, height: 30, borderRadius: 8, fontSize: 15, cursor: 'pointer', display: 'grid', placeItems: 'center',
                      background: avatar === e ? 'var(--panel-2)' : 'none',
                      border: `1px solid ${avatar === e ? 'var(--gold)' : 'var(--line)'}`,
                    }}><span className="emoji">{e}</span></button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => setColor(c)} aria-label={`Use color ${c}`} style={{
                      width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', background: c,
                      border: color === c ? '2px solid var(--txt)' : '2px solid transparent',
                    }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          {isOwner && (
            <div>
              <label style={labelStyle}>Privacy</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[['public', 'Public', 'Anyone can join instantly'], ['private', 'Private', 'You approve who gets in']].map(([key, title, sub]) => (
                  <button key={key} onClick={() => setPrivacy(key)} style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    background: privacy === key ? 'var(--panel-2)' : 'none',
                    border: `1px solid ${privacy === key ? 'var(--gold)' : 'var(--line)'}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>{title}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <div style={{ color: 'var(--down)', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, fontSize: 12, background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ padding: '9px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--gold)', border: 'none', color: '#000', cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
          {isOwner && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} style={{ background: 'none', border: '1px solid var(--down)', color: 'var(--down)', borderRadius: 8, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>Delete this group</button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--down)' }}>Delete for everyone? Posts and members go with it.</span>
                  <button onClick={remove} disabled={deleting} style={{ background: 'var(--down)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{deleting ? 'Deleting…' : 'Yes, delete'}</button>
                  <button onClick={() => setConfirmDelete(false)} style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', borderRadius: 8, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>Keep it</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupPost({ post, myRole, meId, onDelete }) {
  const handle = post.user?.handle || 'user';
  const canDelete = post.user?.id === meId || canMod(myRole);
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Link href={`/user/${handle}`} aria-label={`@${handle} profile`} style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: post.user?.avatarUrl ? `url(${post.user.avatarUrl}) center/cover` : 'linear-gradient(135deg,#16c784,#0d9463)',
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, color: '#000', textDecoration: 'none',
        }}>{post.user?.avatarUrl ? '' : handle[0].toUpperCase()}</Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/user/${handle}`} style={{ fontWeight: 600, fontSize: 13, color: 'var(--txt)', textDecoration: 'none' }}>@{handle}</Link>
          <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{timeAgo(post.createdAt)}</div>
        </div>
        {canDelete && (
          <button onClick={() => onDelete(post)} title="Delete post" style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 13, padding: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--txt)', whiteSpace: 'pre-wrap', margin: 0 }}>{post.body}</p>
    </div>
  );
}

export default function GroupPage() {
  useDarkPage();
  const { slug } = useParams();
  const router = useRouter();
  const { user, token, authFetch } = useAuth();
  const [group, setGroup] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('posts');
  const [members, setMembers] = useState(null);
  const [requests, setRequests] = useState(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const requireAuth = useCallback(() => setShowAuth(true), []);

  const load = useCallback(async () => {
    try {
      const url = `/api/groups/${slug}`;
      const res = token ? await authFetch(url) : await fetch(url);
      if (res.status === 404) { setNotFound(true); return; }
      const d = await res.json();
      if (res.ok) { setGroup(d.group); setPosts(d.posts || []); }
    } catch (_) {}
    finally { setLoading(false); }
  }, [slug, token, authFetch]);

  useEffect(() => { load(); }, [load]);

  const loadMembers = useCallback(async () => {
    try {
      const url = `/api/groups/${slug}/members`;
      const res = token ? await authFetch(url) : await fetch(url);
      const d = await res.json();
      setMembers(d.members || []);
    } catch { setMembers([]); }
  }, [slug, token, authFetch]);

  const loadRequests = useCallback(async () => {
    try {
      const res = await authFetch(`/api/groups/${slug}/requests`);
      const d = await res.json();
      setRequests(d.requests || []);
    } catch { setRequests([]); }
  }, [slug, authFetch]);

  useEffect(() => {
    if (tab === 'members' && members === null) loadMembers();
    if (tab === 'requests' && requests === null) loadRequests();
  }, [tab, members, requests, loadMembers, loadRequests]);

  const joinOrLeave = async () => {
    if (!token) { requireAuth(); return; }
    if (busy || !group) return;
    setBusy(true);
    const prev = group;
    try {
      if (group.myRole) {
        if (group.myRole === 'owner') { setBusy(false); return; }
        setGroup(g => ({ ...g, myRole: null, memberCount: Math.max(0, g.memberCount - 1) }));
        const res = await authFetch(`/api/groups/${slug}/leave`, { method: 'POST' });
        if (!res.ok) setGroup(prev);
        else if (prev.privacy === 'private') { setGroup(g => ({ ...g, canSee: false })); setPosts([]); setMembers(null); }
      } else if (group.requested) {
        setGroup(g => ({ ...g, requested: false }));
        const res = await authFetch(`/api/groups/${slug}/leave`, { method: 'POST' });
        if (!res.ok) setGroup(prev);
      } else {
        const isPublic = group.privacy === 'public';
        setGroup(g => isPublic ? { ...g, myRole: 'member', memberCount: g.memberCount + 1, canSee: true } : { ...g, requested: true });
        const res = await authFetch(`/api/groups/${slug}/join`, { method: 'POST' });
        const d = await res.json();
        if (!res.ok) setGroup(prev);
        else if (isPublic) load();
      }
    } catch { setGroup(prev); }
    finally { setBusy(false); }
  };

  const submitPost = async () => {
    if (!token) { requireAuth(); return; }
    if (!draft.trim() || posting) return;
    setPosting(true); setPostError('');
    try {
      const res = await authFetch(`/api/groups/${slug}/posts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const d = await res.json();
      if (!res.ok) setPostError(d.error || 'Failed to post');
      else { setPosts(p => [d.post, ...p]); setDraft(''); }
    } catch (e) { setPostError(e.message); }
    finally { setPosting(false); }
  };

  const deletePost = async (post) => {
    const prev = posts;
    setPosts(p => p.filter(x => x.id !== post.id));
    try {
      const res = await authFetch(`/api/groups/${slug}/posts/${post.id}`, { method: 'DELETE' });
      if (!res.ok) setPosts(prev);
    } catch { setPosts(prev); }
  };

  const resolveRequest = async (reqId, action) => {
    setRequests(rs => (rs || []).filter(x => x.id !== reqId));
    if (action === 'approve') setGroup(g => ({ ...g, memberCount: g.memberCount + 1, pendingCount: Math.max(0, (g.pendingCount || 1) - 1) }));
    else setGroup(g => ({ ...g, pendingCount: Math.max(0, (g.pendingCount || 1) - 1) }));
    try {
      await authFetch(`/api/groups/${slug}/requests/${reqId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      setMembers(null);
    } catch (_) {}
  };

  const changeRole = async (member, role) => {
    try {
      const res = await authFetch(`/api/groups/${slug}/members/${member.user.id}/role`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
      });
      if (res.ok) {
        if (role === 'owner') { setGroup(g => ({ ...g, myRole: 'admin' })); }
        loadMembers();
      }
    } catch (_) {}
  };

  const removeMember = async (member) => {
    const prev = members;
    setMembers(ms => (ms || []).filter(m => m.user.id !== member.user.id));
    setGroup(g => ({ ...g, memberCount: Math.max(0, g.memberCount - 1) }));
    try {
      const res = await authFetch(`/api/groups/${slug}/members/${member.user.id}`, { method: 'DELETE' });
      if (!res.ok) { setMembers(prev); setGroup(g => ({ ...g, memberCount: g.memberCount + 1 })); }
    } catch { setMembers(prev); setGroup(g => ({ ...g, memberCount: g.memberCount + 1 })); }
  };

  if (loading) {
    return (
      <>
        <div className="skeleton" style={{ height: 120, borderRadius: 14, marginTop: 20 }} />
        <div className="skeleton" style={{ height: 90, borderRadius: 12, marginTop: 14 }} />
        <div className="skeleton" style={{ height: 90, borderRadius: 12, marginTop: 10 }} />
      </>
    );
  }

  if (notFound || !group) {
    return (
      <div style={{ textAlign: 'center', padding: '70px 20px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}><span className="emoji">🕳️</span></div>
        <h1 style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 24, marginBottom: 8 }}>This group does not exist</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>It may have been deleted, or the link is off by a letter.</p>
        <Link href="/community" style={{ padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--gold)', color: '#000', textDecoration: 'none' }}>Back to Community</Link>
      </div>
    );
  }

  const isMember = !!group.myRole;
  const isModerator = canMod(group.myRole);
  const joinLabel = group.myRole
    ? (group.myRole === 'owner' ? null : 'Leave')
    : group.requested ? 'Cancel request'
    : group.privacy === 'private' ? 'Request to join' : 'Join';

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Link href="/community" style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none', fontFamily: 'var(--mono)' }}>← Community</Link>
      </div>

      {/* Header */}
      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <GroupAvatar group={group} size={62} radius={16} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 24, margin: 0, lineHeight: 1.2 }}>{group.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, flexWrap: 'wrap' }}>
              <PrivacyBadge privacy={group.privacy} />
              <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{memberLabel(group.memberCount)}</span>
              {group.myRole && <RoleChip role={group.myRole} />}
            </div>
            {group.description && <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginTop: 10, marginBottom: 0, maxWidth: 560 }}>{group.description}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isModerator && (
              <button onClick={() => setShowSettings(true)} style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)', cursor: 'pointer' }}>Settings</button>
            )}
            {joinLabel && (
              <button onClick={joinOrLeave} disabled={busy} style={{
                padding: '9px 18px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
                background: isMember || group.requested ? 'var(--panel-2)' : 'var(--gold)',
                border: isMember || group.requested ? '1px solid var(--line)' : 'none',
                color: isMember || group.requested ? 'var(--muted)' : '#000',
              }}>{joinLabel}</button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === 'posts' ? 'on' : ''} onClick={() => setTab('posts')}>Posts</button>
        <button className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>
          Members <span style={{ marginLeft: 4, background: 'var(--panel-2)', padding: '1px 6px', borderRadius: 10, fontSize: 10 }}>{group.memberCount}</span>
        </button>
        {isModerator && (
          <button className={tab === 'requests' ? 'on' : ''} onClick={() => setTab('requests')}>
            Requests {group.pendingCount > 0 && <span style={{ marginLeft: 4, background: 'var(--gold)', color: '#000', padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{group.pendingCount}</span>}
          </button>
        )}
      </div>

      {/* Private teaser for outsiders */}
      {!group.canSee ? (
        <div className="panel" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" style={{ display: 'inline' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 19, marginBottom: 6 }}>This group is private</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 340, margin: '0 auto 18px', lineHeight: 1.55 }}>
            {group.requested
              ? 'Your request is in. An owner or admin will wave you through soon.'
              : 'Posts and the member list open up once you are in. Request to join and an owner or admin will review it.'}
          </div>
          {!group.requested && (
            <button onClick={joinOrLeave} disabled={busy} style={{ padding: '11px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--gold)', color: '#000', border: 'none', cursor: 'pointer' }}>Request to join</button>
          )}
        </div>
      ) : tab === 'posts' ? (
        <div style={{ maxWidth: 680 }}>
          {isMember ? (
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '13px 15px', marginBottom: 14 }}>
              <textarea value={draft} onChange={e => setDraft(e.target.value)} maxLength={500}
                placeholder={`Post to ${group.name}...`}
                style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 9, padding: '10px 12px', color: 'var(--txt)', fontSize: 13, resize: 'none', minHeight: 64, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} />
              {postError && <div style={{ color: 'var(--down)', fontSize: 12, marginTop: 6 }}>{postError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={submitPost} disabled={posting || !draft.trim()} style={{
                  padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--gold)', border: 'none', color: '#000',
                  cursor: posting || !draft.trim() ? 'not-allowed' : 'pointer', opacity: posting || !draft.trim() ? 0.6 : 1,
                }}>{posting ? 'Posting…' : 'Post'}</button>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--panel)', border: '1px dashed var(--line)', borderRadius: 12, padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1, minWidth: 180 }}>Join the group to post with this crew.</span>
              <button onClick={joinOrLeave} disabled={busy || group.requested} style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: group.requested ? 'var(--panel-2)' : 'var(--gold)',
                border: group.requested ? '1px solid var(--line)' : 'none',
                color: group.requested ? 'var(--muted)' : '#000', cursor: 'pointer',
              }}>{group.requested ? 'Requested' : group.privacy === 'private' ? 'Request to join' : 'Join'}</button>
            </div>
          )}
          {posts.length === 0 ? (
            <div className="panel" style={{ padding: '42px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}><span className="emoji">{group.avatar}</span></div>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 17, marginBottom: 6 }}>Quiet in here</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 320, margin: '0 auto', lineHeight: 1.55 }}>
                {isMember ? 'No posts yet. Break the ice with a pickup, a question, or a hot take.' : 'No posts yet. Join and get the conversation going.'}
              </div>
            </div>
          ) : (
            posts.map(p => <GroupPost key={p.id} post={p} myRole={group.myRole} meId={user?.id} onDelete={deletePost} />)
          )}
        </div>
      ) : tab === 'members' ? (
        <div style={{ maxWidth: 680 }}>
          {members === null ? (
            <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          ) : members.length === 0 ? (
            <div className="panel" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No members visible.</div>
          ) : (
            <div className="panel" style={{ padding: '6px 16px' }}>
              {members.map((m, i) => (
                <div key={m.user.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: i < members.length - 1 ? '1px solid var(--line)' : 'none', flexWrap: 'wrap' }}>
                  <Link href={`/user/${m.user.handle}`} aria-label={`@${m.user.handle} profile`} style={{
                    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                    background: m.user.avatarUrl ? `url(${m.user.avatarUrl}) center/cover` : 'linear-gradient(135deg,#16c784,#0d9463)',
                    display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, color: '#000', textDecoration: 'none',
                  }}>{m.user.avatarUrl ? '' : (m.user.handle || 'U')[0].toUpperCase()}</Link>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <Link href={`/user/${m.user.handle}`} style={{ fontWeight: 600, fontSize: 13, color: 'var(--txt)', textDecoration: 'none' }}>@{m.user.handle}</Link>
                    <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>joined {timeAgo(m.joinedAt)}</div>
                  </div>
                  <RoleChip role={m.role} />
                  {group.myRole === 'owner' && m.user.id !== user?.id && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {m.role === 'member' && <button onClick={() => changeRole(m, 'admin')} style={miniBtn}>Make admin</button>}
                      {m.role === 'admin' && <button onClick={() => changeRole(m, 'member')} style={miniBtn}>Remove admin</button>}
                      {m.role !== 'owner' && <button onClick={() => changeRole(m, 'owner')} style={miniBtn}>Transfer ownership</button>}
                      {m.role !== 'owner' && <button onClick={() => removeMember(m)} style={{ ...miniBtn, color: 'var(--down)', borderColor: 'var(--down)' }}>Remove</button>}
                    </div>
                  )}
                  {group.myRole === 'admin' && m.role === 'member' && m.user.id !== user?.id && (
                    <button onClick={() => removeMember(m)} style={{ ...miniBtn, color: 'var(--down)', borderColor: 'var(--down)' }}>Remove</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ maxWidth: 680 }}>
          {requests === null ? (
            <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          ) : requests.length === 0 ? (
            <div className="panel" style={{ padding: '42px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}><span className="emoji">📭</span></div>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 17, marginBottom: 6 }}>No pending requests</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>When collectors ask to join, they show up here.</div>
            </div>
          ) : (
            <div className="panel" style={{ padding: '6px 16px' }}>
              {requests.map((rq, i) => (
                <div key={rq.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: i < requests.length - 1 ? '1px solid var(--line)' : 'none', flexWrap: 'wrap' }}>
                  <Link href={`/user/${rq.user.handle}`} aria-label={`@${rq.user.handle} profile`} style={{
                    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                    background: rq.user.avatarUrl ? `url(${rq.user.avatarUrl}) center/cover` : 'linear-gradient(135deg,#16c784,#0d9463)',
                    display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, color: '#000', textDecoration: 'none',
                  }}>{rq.user.avatarUrl ? '' : (rq.user.handle || 'U')[0].toUpperCase()}</Link>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <Link href={`/user/${rq.user.handle}`} style={{ fontWeight: 600, fontSize: 13, color: 'var(--txt)', textDecoration: 'none' }}>@{rq.user.handle}</Link>
                    <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>asked {timeAgo(rq.createdAt)}</div>
                  </div>
                  <button onClick={() => resolveRequest(rq.id, 'approve')} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--gold)', border: 'none', color: '#000', cursor: 'pointer' }}>Approve</button>
                  <button onClick={() => resolveRequest(rq.id, 'deny')} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>Deny</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showSettings && (
        <SettingsModal
          group={group}
          authFetch={authFetch}
          onClose={() => setShowSettings(false)}
          onSaved={(g) => { setGroup(prev => ({ ...prev, ...g })); setShowSettings(false); }}
          onDeleted={() => router.push('/community')}
        />
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}

const miniBtn = {
  padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
  background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer',
};
