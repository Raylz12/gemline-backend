'use client';
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords don\u2019t match'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Reset failed'); setLoading(false); return; }
      if (data.token) {
        try { localStorage.setItem('gemline_token', data.token); } catch {}
      }
      setDone(true);
      setTimeout(() => router.push('/market'), 2500);
    } catch {
      setError('Network error, try again');
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div style={{ maxWidth: 420, margin: '60px auto', textAlign: 'center' }}>
        <h1 className="page">Reset link missing</h1>
        <p className="sub">Open the reset link from your email, or request a new one from the sign-in screen.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ maxWidth: 420, margin: '60px auto', textAlign: 'center' }}>
        <h1 className="page">Password updated ✅</h1>
        <p className="sub">You&apos;re signed in, taking you to the floor…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="eyebrow">Account</div>
      <h1 className="page">Set a new password</h1>
      <p className="sub">This reset link works once and expires an hour after it was sent.</p>

      <form onSubmit={submit} style={{ marginTop: 24, display: 'grid', gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>New password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={8}
            required
            placeholder="••••••••"
            style={{ width: '100%', padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 14 }}
          />
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>At least 8 characters</div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Confirm password</label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            minLength={8}
            required
            placeholder="••••••••"
            style={{ width: '100%', padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--txt)', fontSize: 14 }}
          />
        </div>
        {error && <div style={{ color: 'var(--down)', fontSize: 13 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '12px 16px', background: 'var(--gold)', color: '#141006', fontWeight: 700, border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Saving…' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 420, margin: '60px auto', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>}>
      <ResetForm />
    </Suspense>
  );
}
