'use client';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';

// Cloudflare Turnstile bot protection — fully gated on the env var. When the
// key is unset the widget never renders and no token is sent (server no-ops too).
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

function useTurnstile(containerRef, enabled) {
  const [tsToken, setTsToken] = useState('');
  useEffect(() => {
    if (!enabled || !TURNSTILE_SITE_KEY || !containerRef.current) return;
    let widgetId = null;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'auto',
        callback: (token) => setTsToken(token),
        'expired-callback': () => setTsToken(''),
      });
    };
    if (window.turnstile) render();
    else {
      let s = document.querySelector('script[data-turnstile]');
      if (!s) {
        s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        s.async = true;
        s.setAttribute('data-turnstile', '1');
        document.head.appendChild(s);
      }
      s.addEventListener('load', render);
    }
    return () => {
      cancelled = true;
      try { if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId); } catch {}
    };
  }, [enabled, containerRef]);
  return tsToken;
}

export default function AuthModal({ onClose }) {
  const { login, signup } = useAuth();
  const [tab, setTab] = useState('login');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const tsRef = useRef(null);
  const tsToken = useTurnstile(tsRef, !!TURNSTILE_SITE_KEY);

  const sendForgot = async () => {
    setError('');
    if (!email) { setError('Enter your email above first, then tap “Forgot password”'); return; }
    setForgotBusy(true);
    try {
      await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setForgotSent(true);
    } catch {
      setError('Network error — try again');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (TURNSTILE_SITE_KEY && !tsToken) { setError('Please complete the verification challenge'); return; }
    setLoading(true);
    try {
      const extra = TURNSTILE_SITE_KEY ? { turnstileToken: tsToken } : {};
      if (tab === 'login') {
        await login(email, password, extra);
      } else {
        await signup(handle, email, password, extra);
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
            {tab === 'login' ? 'Sign in to your GEMLINE account' : 'Join the show — free in 30 seconds'}
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
                minLength={tab === 'signup' ? 8 : undefined}
                required
              />
              {tab === 'signup' && (
                <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>At least 8 characters</div>
              )}
              {tab === 'login' && (
                <div style={{ marginTop: 6, textAlign: 'right' }}>
                  {forgotSent ? (
                    <span style={{ fontSize: 11.5, color: 'var(--up)' }}>If that email has an account, a reset link is on the way ✉️</span>
                  ) : (
                    <button type="button" onClick={sendForgot} disabled={forgotBusy}
                      style={{ fontSize: 11.5, color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {forgotBusy ? 'Sending…' : 'Forgot password?'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {TURNSTILE_SITE_KEY && <div ref={tsRef} style={{ marginBottom: 12 }} />}

            {error && (
              <div style={{ color: 'var(--down)', fontSize: 13, marginBottom: 10 }}>{error}</div>
            )}

            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : tab === 'login' ? 'Sign In' : 'Create Account'}
            </button>

            {tab === 'signup' && (
              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 10, lineHeight: 1.5, textAlign: 'center' }}>
                By creating an account you agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener" style={{ color: 'var(--gold)' }}>Terms of Service</a> and{' '}
                <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'var(--gold)' }}>Privacy Policy</a>.
              </div>
            )}
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
