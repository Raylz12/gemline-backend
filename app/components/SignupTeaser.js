'use client';
import { useState } from 'react';
import AuthModal from './AuthModal';

export default function SignupTeaser({ title, subtitle, icon = '🔓' }) {
  const [showAuth, setShowAuth] = useState(false);

  return (
    <>
      <div style={{
        textAlign: 'center', padding: '48px 24px', marginTop: 24,
        background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16,
        maxWidth: 480, margin: '24px auto',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
        <h3 style={{ fontFamily: 'var(--disp)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
          {title || 'Create a free account to get started'}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20, maxWidth: 360, margin: '0 auto 20px' }}>
          {subtitle || 'Sign up in 30 seconds. No credit card required.'}
        </p>
        <button onClick={() => setShowAuth(true)} style={{
          padding: '12px 28px', borderRadius: 10, fontSize: 14, fontWeight: 700,
          background: 'var(--gold)', color: '#000', border: 'none', cursor: 'pointer',
        }}>
          Create Free Account
        </button>
        <p style={{ fontSize: 11, color: 'var(--dim)', marginTop: 10 }}>
          Already have an account? <span onClick={() => setShowAuth(true)} style={{ color: 'var(--gold)', cursor: 'pointer' }}>Sign in</span>
        </p>
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  );
}
