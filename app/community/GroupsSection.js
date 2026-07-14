'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GroupAvatar, PrivacyBadge, RoleChip, PRESET_EMOJI, PRESET_COLORS, memberLabel } from './groupsLib';

const inputStyle = {
  width: '100%', background: 'var(--panel-2, #1a1d28)', border: '1px solid var(--line)',
  borderRadius: 8, padding: '9px 11px', color: 'var(--txt)', fontSize: 13, outline: 'none',
};
const labelStyle = { fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 };

function CreateGroupModal({ authFetch, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState(PRESET_EMOJI[0]);
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [privacy, setPrivacy] = useState('public');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (saving) return;
    const n = name.trim();
    if (n.length < 3) { setError('Group name must be at least 3 characters'); return; }
    setSaving(true); setError('');
    try {
      const res = await authFetch('/api/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, description: description.trim(), avatar, color, privacy }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to create group'); }
      else onCreated(d.group);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(4,8,14,.72)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} className="panel" style={{ width: '100%', maxWidth: 440, padding: 20, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 18 }}>Start a group</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={50} placeholder="Vintage Hoops Club" style={inputStyle} />
            <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 3, textAlign: 'right', fontFamily: 'var(--mono)' }}>{name.length}/50</div>
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={3}
              placeholder="What is this group about? Who should join?" style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit' }} />
          </div>
          <div>
            <label style={labelStyle}>Badge</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <GroupAvatar group={{ avatar, color }} size={52} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                  {PRESET_EMOJI.map(e => (
                    <button key={e} onClick={() => setAvatar(e)} aria-label={`Use ${e}`} style={{
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
          <div>
            <label style={labelStyle}>Privacy</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['public', 'Public', 'Anyone can join instantly'],
                ['private', 'Private', 'You approve who gets in'],
              ].map(([key, title, sub]) => (
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
          {error && <div style={{ color: 'var(--down)', fontSize: 12 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, fontSize: 12, background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>Cancel</button>
            <button onClick={submit} disabled={saving || name.trim().length < 3} style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--gold)', border: 'none', color: '#000',
              cursor: saving || name.trim().length < 3 ? 'not-allowed' : 'pointer', opacity: saving || name.trim().length < 3 ? 0.6 : 1,
            }}>{saving ? 'Creating…' : 'Create group'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupCard({ group, onJoin, joining }) {
  const joined = !!group.myRole;
  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Link href={`/community/groups/${group.slug}`} style={{ textDecoration: 'none' }}>
          <GroupAvatar group={group} size={46} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/community/groups/${group.slug}`} style={{
            fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15, color: 'var(--txt)', textDecoration: 'none',
            display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{group.name}</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <PrivacyBadge privacy={group.privacy} />
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{memberLabel(group.memberCount)}</span>
            {joined && <RoleChip role={group.myRole} />}
          </div>
        </div>
      </div>
      <div style={{
        fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, minHeight: 18,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{group.description || 'No description yet. Mysterious.'}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        {joined ? (
          <Link href={`/community/groups/${group.slug}`} style={{
            flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--txt)', textDecoration: 'none',
          }}>Open</Link>
        ) : group.requested ? (
          <span style={{
            flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--muted)',
          }}>Requested</span>
        ) : (
          <button onClick={() => onJoin(group)} disabled={joining} style={{
            flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: 'var(--gold)', border: 'none', color: '#000', cursor: joining ? 'wait' : 'pointer', opacity: joining ? 0.6 : 1,
          }}>{group.privacy === 'private' ? 'Request to join' : 'Join'}</button>
        )}
        {!joined && (
          <Link href={`/community/groups/${group.slug}`} style={{
            padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: 'none', border: '1px solid var(--line)', color: 'var(--muted)', textDecoration: 'none',
          }}>View</Link>
        )}
      </div>
    </div>
  );
}

export default function GroupsSection({ user, token, authFetch, onRequireAuth }) {
  const router = useRouter();
  const [groupTab, setGroupTab] = useState('discover');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState('members');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [joiningSlug, setJoiningSlug] = useState(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort });
      if (debouncedQ) params.set('q', debouncedQ);
      if (groupTab === 'mine') params.set('tab', 'mine');
      const url = `/api/groups?${params.toString()}`;
      const res = token ? await authFetch(url) : await fetch(url);
      const d = await res.json();
      setGroups(d.groups || []);
    } catch { setGroups([]); }
    finally { setLoading(false); }
  }, [debouncedQ, sort, groupTab, token, authFetch]);

  useEffect(() => { load(); }, [load]);

  const join = async (group) => {
    if (!token) { onRequireAuth?.(); return; }
    setJoiningSlug(group.slug);
    // Optimistic for public groups
    const isPublic = group.privacy === 'public';
    setGroups(prev => prev.map(g => g.slug === group.slug
      ? (isPublic ? { ...g, myRole: 'member', memberCount: g.memberCount + 1 } : { ...g, requested: true })
      : g));
    try {
      const res = await authFetch(`/api/groups/${group.slug}/join`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) {
        setGroups(prev => prev.map(g => g.slug === group.slug ? group : g));
      } else if (d.requested) {
        setGroups(prev => prev.map(g => g.slug === group.slug ? { ...g, requested: true, myRole: null } : g));
      }
    } catch {
      setGroups(prev => prev.map(g => g.slug === group.slug ? group : g));
    } finally { setJoiningSlug(null); }
  };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div className="seg" style={{ marginBottom: 0 }}>
          <button className={groupTab === 'discover' ? 'on' : ''} onClick={() => setGroupTab('discover')}>Discover</button>
          <button className={groupTab === 'mine' ? 'on' : ''} onClick={() => { if (!user) { onRequireAuth?.(); return; } setGroupTab('mine'); }}>My Groups</button>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 180, maxWidth: 320 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)' }}>
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" />
          </svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search groups..." style={{
            width: '100%', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10,
            padding: '9px 12px 9px 32px', color: 'var(--txt)', fontSize: 13, outline: 'none',
          }} />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort groups" style={{
          background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10,
          padding: '9px 10px', color: 'var(--txt)', fontSize: 12, outline: 'none', cursor: 'pointer',
        }}>
          <option value="members">Most members</option>
          <option value="newest">Newest</option>
        </select>
        <button onClick={() => (user ? setShowCreate(true) : onRequireAuth?.())} style={{
          padding: '9px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700,
          background: 'var(--gold)', border: 'none', color: '#000', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>+ Start a group</button>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 150, borderRadius: 12 }} />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="panel" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}><span className="emoji">{groupTab === 'mine' ? '🪪' : '🏟️'}</span></div>
          <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 19, marginBottom: 6 }}>
            {groupTab === 'mine' ? 'No groups yet' : debouncedQ ? 'No groups match that search' : 'Nobody has started a group yet'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 340, margin: '0 auto 18px', lineHeight: 1.55 }}>
            {groupTab === 'mine'
              ? 'Find your people in Discover, or start a group for your set, your team, or your grail hunt.'
              : debouncedQ
                ? `Nothing called "${debouncedQ}" yet. Maybe yours is the one that starts it.`
                : 'Every card show starts with one table. Start a group for your team, your set, or your grail hunt.'}
          </div>
          <button onClick={() => (user ? setShowCreate(true) : onRequireAuth?.())} style={{
            padding: '11px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            background: 'var(--gold)', color: '#000', border: 'none', cursor: 'pointer',
          }}>Start the first group</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
          {groups.map(g => <GroupCard key={g.id} group={g} onJoin={join} joining={joiningSlug === g.slug} />)}
        </div>
      )}

      {showCreate && (
        <CreateGroupModal
          authFetch={authFetch}
          onClose={() => setShowCreate(false)}
          onCreated={(g) => { setShowCreate(false); router.push(`/community/groups/${g.slug}`); }}
        />
      )}
    </div>
  );
}
