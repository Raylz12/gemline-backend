'use client';
import { useState } from 'react';
import { useAuth } from './AuthContext';
import { toast } from '../lib/toast';

// Report anything — listings, users, community posts. POSTs to /api/report;
// the server dedupes repeat reports from the same person against one target.

const REASONS = [
  ['counterfeit', 'Counterfeit or fake card'],
  ['scam', 'Scam or fraud attempt'],
  ['spam', 'Spam'],
  ['harassment', 'Harassment or abuse'],
  ['inappropriate', 'Inappropriate content'],
  ['stolen_photos', 'Stolen photos'],
  ['price_manipulation', 'Price manipulation'],
  ['other', 'Something else'],
];

export default function ReportModal({ targetType, targetId, targetLabel, onClose }) {
  const { authFetch } = useAuth();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!reason) { toast('Pick a reason', true); return; }
    setSending(true);
    try {
      const res = await authFetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId: String(targetId), reason, details }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Report failed');
      toast(data.already ? 'Already reported, our team has it' : 'Report sent. Thanks for keeping GEMLINE clean.');
      onClose();
    } catch (e) { toast(e.message, true); }
    finally { setSending(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 440 }}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3 style={{ fontFamily: 'var(--disp)', fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>Report {targetType}</h3>
        {targetLabel && <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px' }}>{targetLabel}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '12px 0' }}>
          {REASONS.map(([key, label]) => (
            <label key={key} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid ' + (reason === key ? 'var(--gold)' : 'var(--line)'),
              background: reason === key ? 'rgba(232,179,57,.08)' : 'transparent', fontSize: 13,
            }}>
              <input type="radio" name="report-reason" checked={reason === key} onChange={() => setReason(key)} style={{ accentColor: 'var(--gold)' }} />
              {label}
            </label>
          ))}
        </div>
        <textarea
          value={details} onChange={e => setDetails(e.target.value)} maxLength={1000} rows={3}
          placeholder="Anything else we should know? (optional)"
          style={{ width: '100%', background: 'var(--panel-2, #1a1d28)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px', color: 'var(--txt)', fontSize: 13, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={submit} disabled={sending || !reason} style={{
            flex: 1, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none',
            background: reason ? 'var(--gold)' : 'var(--panel-2, #1a1d28)', color: reason ? '#000' : 'var(--muted)',
            cursor: sending || !reason ? 'default' : 'pointer',
          }}>{sending ? 'Sending…' : 'Submit report'}</button>
          <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 8, fontSize: 13, background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
