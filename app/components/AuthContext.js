'use client';
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [state, setState] = useState(null);
  // Keep a ref so authFetch always sees the latest token without re-creating the callback
  const tokenRef = useRef(null);

  useEffect(() => {
    const t = typeof window !== 'undefined' && localStorage.getItem('gemline_token');
    if (t) {
      tokenRef.current = t;
      setToken(t);
      loadState(t);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadState = useCallback(async (t) => {
    try {
      const res = await fetch('/api/state', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        // Token expired or invalid — clear it
        localStorage.removeItem('gemline_token');
        tokenRef.current = null;
        setToken(null);
        setUser(null);
        setState(null);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setState(data);
        setUser(data.me);
      }
    } catch (e) {
      // Network error — keep token, user stays logged in
      console.warn('Failed to load state (network):', e.message);
    }
  }, []);

  const login = useCallback(async (email, password, extra = {}) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('gemline_token', data.token);
    tokenRef.current = data.token;
    setToken(data.token);
    setUser(data.user);
    await loadState(data.token);
    return data;
  }, [loadState]);

  const signup = useCallback(async (handle, email, password, extra = {}) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, email, password, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed');
    localStorage.setItem('gemline_token', data.token);
    // Brand-new account — ClientLayout shows the preferences onboarding once.
    try { localStorage.setItem('gemline_onboard', 'pending'); } catch {}
    tokenRef.current = data.token;
    setToken(data.token);
    setUser(data.user);
    await loadState(data.token);
    return data;
  }, [loadState]);

  const logout = useCallback(() => {
    localStorage.removeItem('gemline_token');
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setState(null);
  }, []);

  // authFetch uses the ref so it's always stable and never stale
  const authFetch = useCallback(async (url, opts = {}) => {
    const headers = { ...opts.headers };
    if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401 && tokenRef.current) {
      // Don't nuke the session on a single stray 401 (deploy swap, one flaky
      // endpoint) — confirm the token is actually dead against /api/state
      // before logging the user out. Transient 401s were logging people out.
      try {
        const check = await fetch('/api/state', { headers: { Authorization: `Bearer ${tokenRef.current}` } });
        if (check.status === 401) logout();
      } catch { /* network blip — keep the session */ }
    }
    return res;
  }, [logout]);

  const refreshState = useCallback(() => {
    if (tokenRef.current) loadState(tokenRef.current);
  }, [loadState]);

  return (
    <AuthContext.Provider value={{ token, user, state, login, signup, logout, authFetch, refreshState }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
