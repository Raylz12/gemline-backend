'use client';
import { useState } from 'react';
import { useAuth } from './AuthContext';
import { CREDIT_PACKS } from '../lib/data';
import { toast } from '../lib/toast';

export default function CreditsModal({ onClose }) {
  const { user, token } = useAuth();
  const [loading, setLoading] = useState(false);

  const buyPack = async (p) => {
    if (!user || !token) {
      toast('Sign in to purchase credits');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Math.round(p.price * 100), credits: p.cr + p.bonus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast('Payment setup failed');
      }
    } catch (e) {
      toast('Payment error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <button className="modal-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div style={{ padding: '32px' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>GEMLINE CREDITS</div>
          <h2 style={{ fontFamily: 'var(--disp)', fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Buy credits</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24, lineHeight: 1.5 }}>
            Credits power boosts. Buy with card, spend to push your listings to the front of the line.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {CREDIT_PACKS.map((p, i) => (
              <div key={i} onClick={() => !loading && buyPack(p)} style={{
                padding: '20px 16px', borderRadius: 14, cursor: loading ? 'wait' : 'pointer',
                background: 'var(--panel-2)', border: p.best ? '2px solid var(--gold)' : '1px solid var(--line-2)',
                transition: '.15s', position: 'relative',
              }}>
                {p.best && <span style={{
                  position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--gold)', color: 'var(--ink)', fontFamily: 'var(--mono)',
                  fontSize: 9, fontWeight: 700, padding: '3px 10px', borderRadius: 6, letterSpacing: '.1em',
                }}>BEST VALUE</span>}
                <div style={{ fontFamily: 'var(--disp)', fontSize: 28, fontWeight: 800, color: 'var(--txt)' }}>
                  {(p.cr + p.bonus).toLocaleString()} <span style={{ fontSize: 14, color: 'var(--muted)' }}>cr</span>
                </div>
                {p.bonus > 0 ? (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--up)', marginTop: 4 }}>+{p.bonus} bonus</div>
                ) : (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>base rate</div>
                )}
                <div style={{ fontFamily: 'var(--disp)', fontSize: 18, fontWeight: 700, marginTop: 10 }}>${p.price}</div>
              </div>
            ))}
          </div>
          {!user && (
            <p style={{ color: 'var(--gold)', fontSize: 13, marginTop: 16, textAlign: 'center' }}>
              Sign in to purchase credits
            </p>
          )}
          <p style={{ color: 'var(--dim)', fontSize: 11, marginTop: 16, textAlign: 'center', fontStyle: 'italic' }}>
            Payments processed securely via Stripe. Credits are added to your wallet on successful payment.
          </p>
        </div>
      </div>
    </div>
  );
}
