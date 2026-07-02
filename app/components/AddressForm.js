'use client';
// Shared shipping-address form + display block.
// Used by SettingsModal (address book) and PaymentModal (checkout collect/confirm).
import { useState } from 'react';

export const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const ZIP_RE = /^\d{5}(-\d{4})?$/;

export function validateAddressClient(a) {
  if (!String(a.name || '').trim()) return 'Full name is required';
  if (!String(a.street1 || '').trim()) return 'Street address is required';
  if (!String(a.city || '').trim()) return 'City is required';
  if (!String(a.state || '').trim()) return 'State is required';
  if (!US_STATES.includes(String(a.state).toUpperCase())) return 'Select a valid US state';
  if (!ZIP_RE.test(String(a.zip || '').trim())) return 'Enter a valid ZIP code (12345 or 12345-6789)';
  return null;
}

export function formatAddress(a) {
  if (!a) return '';
  return [
    a.name,
    a.street1,
    a.street2,
    `${a.city}, ${a.state} ${a.zip}`,
    a.country && a.country !== 'US' ? a.country : null,
    a.phone ? `Phone: ${a.phone}` : null,
  ].filter(Boolean).join('\n');
}

// Compact one-address display block with optional copy button.
export function AddressBlock({ address, copyable = false, style = {} }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatAddress(address));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', ...style }}>
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--txt, #e8eaed)', whiteSpace: 'pre-line', flex: 1, minWidth: 0 }} data-testid="address-block">
        <div style={{ fontWeight: 700 }}>{address.name}</div>
        <div>{address.street1}</div>
        {address.street2 && <div>{address.street2}</div>}
        <div>{address.city}, {address.state} {address.zip}</div>
        {address.phone && <div style={{ color: 'var(--muted, #9ca3af)' }}>{address.phone}</div>}
      </div>
      {copyable && (
        <button onClick={copy} type="button" title="Copy address"
          style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, background: copied ? 'var(--up-soft, rgba(52,216,138,.14))' : 'var(--panel-2, #141a28)', color: copied ? 'var(--up, #34d88a)' : 'var(--muted, #9ca3af)', border: '1px solid var(--line-2, #263042)', cursor: 'pointer' }}>
          {copied ? '✓ Copied' : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy
            </>
          )}
        </button>
      )}
    </div>
  );
}

// Controlled address form. onSubmit(fields) must return a promise; errors from
// the server can be surfaced via throwing.
export default function AddressForm({ initial = {}, onSubmit, onCancel, submitLabel = 'Save address', busyLabel = 'Saving…' }) {
  const [f, setF] = useState({
    name: initial.name || '', street1: initial.street1 || '', street2: initial.street2 || '',
    city: initial.city || '', state: initial.state || '', zip: initial.zip || '', phone: initial.phone || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }));

  const inputStyle = {
    width: '100%', padding: '9px 12px', background: 'var(--ink, #0b0f19)',
    border: '1px solid var(--line-2, #263042)', borderRadius: 8,
    color: 'var(--txt, #e8eaed)', fontSize: 13, outline: 'none',
  };
  const labelStyle = { fontSize: 10.5, fontFamily: 'var(--mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted, #9ca3af)', marginBottom: 4, display: 'block' };

  const submit = async (e) => {
    e?.preventDefault?.();
    const v = { ...f, state: f.state.toUpperCase().trim(), zip: f.zip.trim(), country: 'US' };
    const bad = validateAddressClient(v);
    if (bad) { setErr(bad); return; }
    setErr('');
    setBusy(true);
    try {
      await onSubmit(v);
    } catch (e2) {
      setErr(e2?.message || 'Could not save address');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10 }} data-testid="address-form">
      <div>
        <label style={labelStyle}>Full name *</label>
        <input style={inputStyle} value={f.name} onChange={set('name')} placeholder="Jane Collector" autoComplete="name" />
      </div>
      <div>
        <label style={labelStyle}>Street address *</label>
        <input style={inputStyle} value={f.street1} onChange={set('street1')} placeholder="123 Main St" autoComplete="address-line1" />
      </div>
      <div>
        <label style={labelStyle}>Apt / Suite (optional)</label>
        <input style={inputStyle} value={f.street2} onChange={set('street2')} placeholder="Apt 4B" autoComplete="address-line2" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px 110px', gap: 8 }}>
        <div>
          <label style={labelStyle}>City *</label>
          <input style={inputStyle} value={f.city} onChange={set('city')} placeholder="Austin" autoComplete="address-level2" />
        </div>
        <div>
          <label style={labelStyle}>State *</label>
          <select style={{ ...inputStyle, padding: '9px 6px' }} value={f.state} onChange={set('state')} autoComplete="address-level1">
            <option value="">--</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>ZIP *</label>
          <input style={inputStyle} value={f.zip} onChange={set('zip')} placeholder="78701" inputMode="numeric" autoComplete="postal-code" />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Phone (optional)</label>
        <input style={inputStyle} value={f.phone} onChange={set('phone')} placeholder="(555) 555-5555" autoComplete="tel" />
      </div>
      {err && <div style={{ color: 'var(--down, #ff5c6c)', fontSize: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}
            style={{ padding: '9px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: 'var(--panel-2, #141a28)', color: 'var(--muted, #9ca3af)', border: '1px solid var(--line-2, #263042)', cursor: 'pointer' }}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy}
          style={{ flex: 1, padding: '9px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, background: 'var(--gold, #16c784)', color: '#04120b', border: 'none', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
