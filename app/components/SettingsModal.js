'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthContext';

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

  // Notification toggles (visual only)
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [priceAlerts, setPriceAlerts] = useState(true);
  const [tradeOffers, setTradeOffers] = useState(true);

  // Fetch profile + Stripe status on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/user/profile');
        if (res.ok) setProfile(await res.json());
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

  const handleSignOut = () => {
    logout();
    onClose();
  };

  const sectionLabel = { fontSize: 12, color: 'var(--muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 };
  const sectionWrap = { marginBottom: 24 };
  const memberSince = profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
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
            <div style={sectionLabel}>PROFILE</div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
                  {(profile?.handle || user?.handle || user?.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{profile?.handle || user?.handle || 'User'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{profile?.email || user?.email || ''}</div>
                  {memberSince && <div style={{ fontSize: 11, color: 'var(--dim)' }}>Member since {memberSince}</div>}
                </div>
              </div>

              {/* View Profile Button */}
              <div style={{ marginBottom: 12 }}>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '8px 14px', width: '100%' }}
                  onClick={() => { onClose(); router.push(`/profile/${profile?.handle || user?.handle}`); }}>
                  👤 View My Profile
                </button>
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
                    <div style={{ fontSize: 10, color: 'var(--dim)' }}>⚠️ You can only change your display name once</div>
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

          {/* SELLER TOOLS */}
          <div style={sectionWrap}>
            <div style={sectionLabel}>SELLER TOOLS</div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                Connect your Stripe account to sell cards and receive payouts.
              </div>
              {stripeStatus === 'connected' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--up-soft)', borderRadius: 8, color: 'var(--up)', fontWeight: 600, fontSize: 13 }}>
                  <span style={{ fontSize: 18 }}>✓</span> Connected
                </div>
              ) : (
                <>
                  <button className="btn-primary" onClick={handleStripeConnect} disabled={connecting}>
                    {connecting ? 'Connecting…' : '🔗 Connect with Stripe'}
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

          {/* NOTIFICATIONS */}
          <div style={sectionWrap}>
            <div style={sectionLabel}>NOTIFICATIONS</div>
            <div className="panel" style={{ padding: 16 }}>
              <ToggleRow label="Email alerts" desc="New listings, price drops" on={emailAlerts} toggle={() => setEmailAlerts(!emailAlerts)} />
              <ToggleRow label="Price alerts" desc="Cards on your watchlist" on={priceAlerts} toggle={() => setPriceAlerts(!priceAlerts)} />
              <ToggleRow label="Trade offers" desc="Incoming trade proposals" on={tradeOffers} toggle={() => setTradeOffers(!tradeOffers)} last />
            </div>
          </div>

          {/* ACCOUNT */}
          <div style={sectionWrap}>
            <div style={sectionLabel}>ACCOUNT</div>
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '8px 14px' }}
                  onClick={() => alert('Password change coming soon')}>
                  Change Password
                </button>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '8px 14px', color: 'var(--down)', borderColor: 'var(--down)', opacity: 0.5, cursor: 'not-allowed' }} disabled>
                  Delete Account
                </button>
              </div>
            </div>
          </div>

          {/* ABOUT */}
          <div style={sectionWrap}>
            <div style={sectionLabel}>ABOUT</div>
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
