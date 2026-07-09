'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthContext';
import { toast } from '../lib/toast';
import AddressForm, { AddressBlock } from './AddressForm';
import { IconUser, IconLink, IconAlert, IconBell, IconShield, IconCheck, IconDollar } from './Icons';

function SectionLabel({ icon: Icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>
      {Icon && <Icon size={13} />}
      {children}
    </div>
  );
}

const IconTruck = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
  </svg>
);
const IconStar = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>
  </svg>
);

const BADGE_TIER_ORDER = { diamond: 0, gold: 1, emerald: 2, silver: 3, bronze: 4 };

// ── Invite collectors (referrals) ─────────────────────────────────
function InviteSection({ authFetch }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    authFetch('/api/referrals/me')
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {});
  }, [authFetch]);

  if (!data?.url) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { toast('Copy failed — long-press the link instead', true); }
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Share your link — when a collector signs up through it, they count as your referral.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input readOnly value={data.url} onFocus={e => e.target.select()}
          style={{ flex: 1, padding: '9px 11px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--mono)', background: 'var(--panel-2)', color: 'var(--txt)', border: '1px solid var(--line)' }} />
        <button onClick={copy}
          style={{ padding: '9px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: copied ? 'var(--up)' : 'var(--gold)', color: '#141006', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
        <strong style={{ color: 'var(--gold)', fontFamily: 'var(--mono)' }}>{data.count}</strong> collector{data.count !== 1 ? 's' : ''} joined through your link
      </div>
    </div>
  );
}

// ── Shipping address book section ─────────────────────────────────────────────
function BlockedSection({ authFetch }) {
  const [blocked, setBlocked] = useState(null);
  const load = useCallback(() => {
    authFetch('/api/users/blocked')
      .then(r => r.json())
      .then(d => setBlocked(d.blocked || []))
      .catch(() => setBlocked([]));
  }, [authFetch]);
  useEffect(load, [load]);

  const unblock = async (b) => {
    try {
      const res = await authFetch(`/api/users/${b.userId}/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block: false }),
      });
      if (!res.ok) throw new Error('Failed');
      toast(`Unblocked @${b.handle}`);
      load();
    } catch (e) { toast('Unblock failed', true); }
  };

  if (blocked === null) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>;
  if (blocked.length === 0) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>You haven’t blocked anyone. Blocked users can’t offer on your listings, trade with you, or appear in your feed.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {blocked.map(b => (
        <div key={b.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--panel-2, #1a1d28)', border: '1px solid var(--line)', borderRadius: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>@{b.handle || 'deleted user'}</span>
          <span style={{ fontSize: 10.5, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{new Date(b.at).toLocaleDateString()}</span>
          <button onClick={() => unblock(b)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)' }}>Unblock</button>
        </div>
      ))}
    </div>
  );
}

function ShippingSection({ authFetch }) {
  const [addresses, setAddresses] = useState(null); // null = loading
  const [formMode, setFormMode] = useState(null);   // null | 'add' | address obj (edit)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/user/addresses');
      const d = await res.json();
      setAddresses(d.addresses || []);
    } catch { setAddresses([]); }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const save = async (fields) => {
    const isEdit = formMode && formMode !== 'add';
    const res = await authFetch(isEdit ? `/api/user/addresses/${formMode.id}` : '/api/user/addresses', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Could not save address');
    toast('Address saved ✓');
    setFormMode(null);
    load();
  };

  const remove = async (id) => {
    try {
      const res = await authFetch(`/api/user/addresses/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Delete failed'); }
      toast('Address removed');
      load();
    } catch (e) { toast(e.message, true); }
  };

  const makeDefault = async (a) => {
    try {
      const res = await authFetch(`/api/user/addresses/${a.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...a, is_default: true }),
      });
      if (!res.ok) throw new Error('Failed');
      load();
    } catch (e) { toast('Could not set default', true); }
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
        Where sellers ship your cards. Your default address is attached to new orders at checkout.
      </div>
      {addresses === null ? (
        <div style={{ fontSize: 12, color: 'var(--dim)', padding: '8px 0' }}>Loading addresses…</div>
      ) : formMode ? (
        <AddressForm
          initial={formMode === 'add' ? {} : formMode}
          onSubmit={save}
          onCancel={() => setFormMode(null)}
          submitLabel={formMode === 'add' ? 'Add address' : 'Save changes'}
        />
      ) : (
        <>
          {addresses.length === 0 ? (
            <div style={{ padding: '14px 12px', background: 'var(--ink)', border: '1px dashed var(--line-2)', borderRadius: 10, fontSize: 12.5, color: 'var(--dim)', marginBottom: 12, textAlign: 'center' }}>
              No shipping address yet — add one so sellers know where to send your cards.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              {addresses.map(a => (
                <div key={a.id} style={{ padding: '12px 14px', background: 'var(--ink)', border: `1px solid ${a.is_default ? 'var(--gold)' : 'var(--line)'}`, borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    {a.is_default ? (
                      <span style={{ fontSize: 9.5, fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '.08em', color: 'var(--gold)', background: 'var(--gold-soft)', padding: '2px 7px', borderRadius: 5 }}>DEFAULT</span>
                    ) : (
                      <button onClick={() => makeDefault(a)} style={{ fontSize: 10, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                        Set as default
                      </button>
                    )}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={() => setFormMode(a)} style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Edit</button>
                      <button onClick={() => remove(a.id)} style={{ fontSize: 11, color: 'var(--down)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>
                    </div>
                  </div>
                  <AddressBlock address={a} />
                </div>
              ))}
            </div>
          )}
          <button className="btn-ghost" style={{ fontSize: 12, padding: '8px 14px' }} onClick={() => setFormMode('add')}>
            + Add address
          </button>
        </>
      )}
    </div>
  );
}

// ── Security: change password ─────────────────────────────────────────────────
function SecuritySection({ authFetch }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const inputStyle = { width: '100%', padding: '9px 12px', background: 'var(--ink)', border: '1px solid var(--line-2)', borderRadius: 8, color: 'var(--txt)', fontSize: 13, outline: 'none' };

  const submit = async () => {
    setErr('');
    if (!cur) { setErr('Enter your current password'); return; }
    if (next.length < 8) { setErr('New password must be at least 8 characters'); return; }
    if (next !== confirm) { setErr('New passwords do not match'); return; }
    setBusy(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Password change failed');
      toast('Password updated ✓');
      setOpen(false); setCur(''); setNext(''); setConfirm('');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      {!open ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '8px 14px' }} onClick={() => setOpen(true)}>
            Change Password
          </button>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '8px 14px', color: 'var(--down)', borderColor: 'var(--down)', opacity: 0.5, cursor: 'not-allowed' }} disabled>
            Delete Account
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <input type="password" placeholder="Current password" value={cur} onChange={e => setCur(e.target.value)} style={inputStyle} autoComplete="current-password" />
          <input type="password" placeholder="New password (min 8 characters)" value={next} onChange={e => setNext(e.target.value)} style={inputStyle} autoComplete="new-password" />
          <input type="password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle} autoComplete="new-password" />
          {err && <div style={{ color: 'var(--down)', fontSize: 12 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setOpen(false); setErr(''); }} disabled={busy}
              style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--line-2)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={submit} disabled={busy}
              style={{ flex: 1, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--gold)', color: '#04120b', border: 'none', cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Showcase: featured cards (≤5) + featured badges (≤3) ─────────────────────
function ShowcaseSection({ user, authFetch }) {
  const [data, setData] = useState(null); // { cards, showcaseCardIds, badges, featuredBadges }
  const [pickedCards, setPickedCards] = useState([]);
  const [pickedBadges, setPickedBadges] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!user?.handle) return;
    fetch(`/api/users/${encodeURIComponent(user.handle)}/portfolio`)
      .then(r => r.json())
      .then(d => {
        if (!d?.user) return;
        setData(d);
        setPickedCards(d.showcaseCardIds || []);
        setPickedBadges(d.featuredBadges || []);
      })
      .catch(() => {});
  }, [user?.handle]);

  if (!data) {
    return <div className="panel" style={{ padding: 16, fontSize: 12, color: 'var(--dim)' }}>Loading your collection…</div>;
  }

  const cards = data.cards || [];
  const badges = [...(data.badges || [])].sort((a, b) => (BADGE_TIER_ORDER[a.tier] ?? 9) - (BADGE_TIER_ORDER[b.tier] ?? 9));

  const toggleCard = (id) => {
    setDirty(true);
    setPickedCards(prev => prev.includes(id) ? prev.filter(x => x !== id) : (prev.length >= 5 ? prev : [...prev, id]));
  };
  const toggleBadge = (key) => {
    setDirty(true);
    setPickedBadges(prev => prev.includes(key) ? prev.filter(x => x !== key) : (prev.length >= 3 ? prev : [...prev, key]));
  };

  const save = async () => {
    setSaving(true);
    try {
      const [r1, r2] = await Promise.all([
        authFetch('/api/profile/showcase/set', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardIds: pickedCards }),
        }),
        authFetch('/api/profile/badges', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ badges: pickedBadges }),
        }),
      ]);
      if (!r1.ok || !r2.ok) throw new Error('Save failed');
      toast('Showcase updated ✓');
      setDirty(false);
    } catch (e) { toast(e.message || 'Save failed', true); }
    finally { setSaving(false); }
  };

  const rowStyle = (on) => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
    background: on ? 'var(--gold-soft)' : 'var(--ink)', border: `1px solid ${on ? 'var(--gold)' : 'var(--line)'}`,
    cursor: 'pointer', userSelect: 'none',
  });
  const checkStyle = (on) => ({
    width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'grid', placeItems: 'center',
    background: on ? 'var(--gold)' : 'transparent', border: `1.5px solid ${on ? 'var(--gold)' : 'var(--line-2)'}`,
    color: '#04120b', fontSize: 11, fontWeight: 800,
  });

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
        Pick what visitors see on your public profile. Empty picks default to your top cards and rarest badges.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Featured cards</div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: pickedCards.length >= 5 ? 'var(--gold)' : 'var(--muted)' }} data-testid="card-pick-count">
          {pickedCards.length} of 5 selected
        </span>
      </div>
      {cards.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>Add cards to your portfolio to feature them here.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto', marginBottom: 16 }}>
          {cards.slice(0, 100).map(c => {
            const on = pickedCards.includes(c.id);
            return (
              <div key={c.portfolioId || c.id} style={rowStyle(on)} onClick={() => toggleCard(c.id)}>
                <span style={checkStyle(on)}>{on ? '✓' : ''}</span>
                {c.thumbnail
                  ? <img src={c.thumbnail} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} style={{ width: 26, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  : <div style={{ width: 26, height: 36, borderRadius: 4, background: 'var(--panel-2)', flexShrink: 0 }} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.player}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {`${c.grader || 'RAW'} ${c.grade || ''}`.trim()} — {c.set}
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--gold)', flexShrink: 0 }}>
                  {c.price > 0 ? `$${Number(c.price).toLocaleString()}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Featured badges</div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: pickedBadges.length >= 3 ? 'var(--gold)' : 'var(--muted)' }} data-testid="badge-pick-count">
          {pickedBadges.length} of 3 selected
        </span>
      </div>
      {badges.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>No badges earned yet — trade, sell, and collect to earn them.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6, maxHeight: 180, overflowY: 'auto', marginBottom: 14 }}>
          {badges.map(b => {
            const on = pickedBadges.includes(b.key);
            return (
              <div key={b.key} style={rowStyle(on)} onClick={() => toggleBadge(b.key)}>
                <span style={checkStyle(on)}>{on ? '✓' : ''}</span>
                <span style={{ fontSize: 16 }}>{b.emoji}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{b.name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'capitalize' }}>{b.tier}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dirty && (
        <button onClick={save} disabled={saving}
          style={{ width: '100%', padding: '10px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, background: 'var(--gold)', color: '#04120b', border: 'none', cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Saving…' : 'Save showcase'}
        </button>
      )}
    </div>
  );
}

export default function SettingsModal({ onClose }) {
  const router = useRouter();
  const { user, logout, authFetch } = useAuth();
  const [connecting, setConnecting] = useState(false);
  const [stripeStatus, setStripeStatus] = useState(null);
  const [stripeError, setStripeError] = useState('');

  // Profile
  const [profile, setProfile] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [bio, setBio] = useState('');
  const [bioDirty, setBioDirty] = useState(false);
  const [bioSaving, setBioSaving] = useState(false);

  // Notification toggles (visual only)
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [priceAlerts, setPriceAlerts] = useState(true);
  const [tradeOffers, setTradeOffers] = useState(true);

  // Fetch profile + Stripe status on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/user/profile');
        if (res.ok) {
          const p = await res.json();
          setProfile(p);
          setBio(p.bio || '');
        }
      } catch {}
    })();
    (async () => {
      try {
        const res = await authFetch('/api/connect/status');
        if (res.ok) {
          const data = await res.json();
          setStripeStatus(data.connected ? 'connected' : 'not_connected');
        } else {
          setStripeStatus('not_connected');
        }
      } catch {
        setStripeStatus('not_connected');
      }
    })();
  }, [authFetch]);

  const handleStripeConnect = async () => {
    setConnecting(true);
    setStripeError('');
    try {
      const res = await authFetch('/api/connect/onboard', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        if (data.error.toLowerCase().includes('connect') || data.error.toLowerCase().includes('sign up') || data.error.toLowerCase().includes('not enabled')) {
          setStripeError('To accept payments, Stripe Connect needs to be enabled on the GEMLINE Stripe account. Contact support@gemlinecards.com');
        } else {
          setStripeError(data.error);
        }
      }
    } catch (e) {
      setStripeError('To accept payments, Stripe Connect needs to be enabled on the GEMLINE Stripe account. Contact support@gemlinecards.com');
    } finally {
      setConnecting(false);
    }
  };

  const handleNameChange = async () => {
    setNameError('');
    const trimmed = newName.trim();
    if (trimmed.length < 3 || trimmed.length > 20) { setNameError('Must be 3-20 characters'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) { setNameError('Only letters, numbers, and underscores'); return; }
    setNameSaving(true);
    try {
      const res = await authFetch('/api/user/display-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setNameError(data.error || 'Failed'); return; }
      setProfile(prev => ({ ...prev, handle: trimmed, display_name_changed: true }));
      setEditingName(false);
    } catch (e) {
      setNameError(e.message);
    } finally {
      setNameSaving(false);
    }
  };

  const saveBio = async () => {
    setBioSaving(true);
    try {
      const res = await authFetch('/api/profile/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio: bio.slice(0, 160) }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast('Bio saved ✓');
      setBioDirty(false);
    } catch (e) { toast(e.message, true); }
    finally { setBioSaving(false); }
  };

  const handleSignOut = () => {
    logout();
    onClose();
  };

  const sectionWrap = { marginBottom: 24 };
  const memberSince = profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box dark-sheet" style={{ maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="modal-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="sheet-pad">
          <div className="sheet-h">Settings</div>
          <div className="sheet-sub">Manage your GEMLINE account</div>

          {/* PROFILE */}
          <div style={sectionWrap}>
            <SectionLabel icon={IconUser}>Profile</SectionLabel>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div className="avatar" style={{ width: 48, height: 48, fontSize: 18, ...(profile?.avatar_url ? { backgroundImage: `url(${profile.avatar_url})`, backgroundSize: 'cover', backgroundPosition: 'center', color: 'transparent' } : {}) }}>
                  {!profile?.avatar_url && (profile?.handle || user?.handle || user?.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{profile?.handle || user?.handle || 'User'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{profile?.email || user?.email || ''}</div>
                  {memberSince && <div style={{ fontSize: 11, color: 'var(--dim)' }}>Member since {memberSince}</div>}
                </div>
              </div>

              {/* View Profile Button */}
              <div style={{ marginBottom: 12 }}>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '10px 14px', width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
                  onClick={() => { onClose(); router.push(`/user/${profile?.handle || user?.handle}`); }}>
                  <IconUser size={14} /> View My Profile
                </button>
              </div>

              {/* Bio */}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Bio</div>
                <textarea value={bio} maxLength={160} rows={2}
                  onChange={e => { setBio(e.target.value); setBioDirty(true); }}
                  placeholder="Tell collectors about yourself (160 chars)"
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
                {bioDirty && (
                  <button onClick={saveBio} disabled={bioSaving}
                    style={{ marginTop: 6, padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--gold)', color: '#000', border: 'none', cursor: 'pointer' }}>
                    {bioSaving ? '…' : 'Save Bio'}
                  </button>
                )}
              </div>

              {/* Display Name */}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Display Name</div>
                {profile?.display_name_changed ? (
                  <div style={{ fontSize: 12, color: 'var(--dim)', fontStyle: 'italic' }}>Display name can only be changed once</div>
                ) : editingName ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: 'column' }}>
                    <input
                      type="text" value={newName} onChange={e => setNewName(e.target.value)}
                      placeholder="3-20 chars, letters/numbers/_"
                      maxLength={20}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 13, outline: 'none' }}
                    />
                    {nameError && <div style={{ fontSize: 11, color: 'var(--down)' }}>{nameError}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={handleNameChange} disabled={nameSaving}
                        style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--gold)', color: '#000' }}>
                        {nameSaving ? '...' : 'Save'}
                      </button>
                      <button onClick={() => { setEditingName(false); setNameError(''); }}
                        style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, background: 'var(--panel-2)', color: 'var(--muted)' }}>
                        Cancel
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: 5 }}><IconAlert size={12} /> You can only change your display name once</div>
                  </div>
                ) : (
                  <button onClick={() => { setEditingName(true); setNewName(profile?.handle || user?.handle || ''); }}
                    className="btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }}>
                    Change Display Name
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* SHIPPING ADDRESS */}
          <div style={sectionWrap}>
            <SectionLabel icon={IconTruck}>Shipping Address</SectionLabel>
            <ShippingSection authFetch={authFetch} />
          </div>

          {/* PAYMENTS */}
          <div style={sectionWrap}>
            <SectionLabel icon={IconDollar}>Payments</SectionLabel>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                Connect your Stripe account to sell cards and receive payouts.
              </div>
              {stripeStatus === 'connected' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--up-soft)', borderRadius: 8, color: 'var(--up)', fontWeight: 600, fontSize: 13 }}>
                  <IconCheck size={16} /> Connected — payouts enabled
                </div>
              ) : (
                <>
                  <button className="btn-primary" onClick={handleStripeConnect} disabled={connecting} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    {connecting ? 'Connecting…' : (<><IconLink size={14} /> Connect with Stripe</>)}
                  </button>
                  {stripeError && (
                    <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--down-soft)', borderRadius: 8, color: 'var(--down)', fontSize: 12, lineHeight: 1.5 }}>
                      {stripeError}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* SHOWCASE */}
          <div style={sectionWrap}>
            <SectionLabel icon={IconStar}>Profile Showcase</SectionLabel>
            <ShowcaseSection user={profile || user} authFetch={authFetch} />
          </div>

          {/* SECURITY */}
          <div style={sectionWrap}>
            <SectionLabel icon={IconShield}>Security</SectionLabel>
            <SecuritySection authFetch={authFetch} />
          </div>

          <div style={sectionWrap}>
            <SectionLabel icon={IconShield}>Blocked Users</SectionLabel>
            <BlockedSection authFetch={authFetch} />
          </div>

          {/* NOTIFICATIONS */}
          <div style={sectionWrap}>
            <SectionLabel icon={IconBell}>Notifications</SectionLabel>
            <div className="panel" style={{ padding: 16 }}>
              <ToggleRow label="Email alerts" desc="New listings, price drops" on={emailAlerts} toggle={() => setEmailAlerts(!emailAlerts)} />
              <ToggleRow label="Price alerts" desc="Cards on your watchlist" on={priceAlerts} toggle={() => setPriceAlerts(!priceAlerts)} />
              <ToggleRow label="Trade offers" desc="Incoming trade proposals" on={tradeOffers} toggle={() => setTradeOffers(!tradeOffers)} last />
            </div>
          </div>

          {/* INVITE COLLECTORS */}
          <div style={sectionWrap}>
            <SectionLabel icon={IconLink}>Invite Collectors</SectionLabel>
            <InviteSection authFetch={authFetch} />
          </div>

          {/* ABOUT */}
          <div style={sectionWrap}>
            <SectionLabel>About</SectionLabel>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                <div><strong style={{ color: 'var(--txt)' }}>GEMLINE</strong> v1.0.0</div>
                <div>Powered by <strong style={{ color: 'var(--gold)' }}>Card Hedge</strong></div>
                <div style={{ marginTop: 6 }}>
                  <a href="mailto:support@gemlinecards.com" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>
                    support@gemlinecards.com
                  </a>
                </div>
              </div>
            </div>
          </div>

          <button
            className="btn-ghost"
            onClick={handleSignOut}
            style={{ width: '100%', color: 'var(--down)', borderColor: 'var(--down)' }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, on, toggle, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0',
      borderBottom: last ? 'none' : '1px solid var(--line)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{desc}</div>
      </div>
      <button onClick={toggle} style={{
        width: 40, height: 22, borderRadius: 11, padding: 2,
        background: on ? 'var(--up)' : 'var(--line-2)',
        transition: '.2s', display: 'flex', alignItems: 'center',
        justifyContent: on ? 'flex-end' : 'flex-start',
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: 9,
          background: '#fff', transition: '.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        }} />
      </button>
    </div>
  );
}
