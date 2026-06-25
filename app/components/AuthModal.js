'use client';
import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function AuthModal({ onClose }) {
  const { login, signup } = useAuth();
  const [tab, setTab] = useState('login');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await login(email, password);
      } else {
        await signup(handle, email, password);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <button className="modal-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div style={{ padding: '36px 32px' }}>
          <div className="auth-logo">
            <div className="mark">G</div>
            <div className="name">GEM<span>LINE</span></div>
          </div>

          <div className="auth-title">{tab === 'login' ? 'Welcome back' : 'Create account'}</div>
          <div className="auth-sub">
            {tab === 'login' ? 'Sign in to your GEMLINE account' : 'Join the card exchange'}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <button
              className={`chip ${tab === 'login' ? 'on' : ''}`}
              onClick={() => setTab('login')}
            >
              Log In
            </button>
            <button
              className={`chip ${tab === 'signup' ? 'on' : ''}`}
              onClick={() => setTab('signup')}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {tab === 'signup' && (
              <div className="auth-field">
                <label>Handle</label>
                <input
                  type="text"
                  placeholder="Your username"
                  value={handle}
                  onChange={e => setHandle(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="auth-field">
              <label>Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="auth-field">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div style={{ color: 'var(--down)', fontSize: 13, marginBottom: 10 }}>{error}</div>
            )}

            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : tab === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="auth-toggle">
            {tab === 'login' ? (
              <>Don&apos;t have an account? <button onClick={() => setTab('signup')} style={{ color: 'var(--gold)', fontWeight: 600 }}>Sign up</button></>
            ) : (
              <>Already have an account? <button onClick={() => setTab('login')} style={{ color: 'var(--gold)', fontWeight: 600 }}>Log in</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
