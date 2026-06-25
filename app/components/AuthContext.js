'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [state, setState] = useState(null);

  useEffect(() => {
    const t = localStorage.getItem('gemline_token');
    if (t) {
      setToken(t);
      loadState(t);
    }
  }, []);

  const loadState = useCallback(async (t) => {
    try {
      const res = await fetch('/api/state', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = await res.json();
        setState(data);
        setUser(data.me);
      }
    } catch (e) {
      console.warn('Failed to load state', e);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('gemline_token', data.token);
    setToken(data.token);
    setUser(data.user);
    await loadState(data.token);
    return data;
  }, [loadState]);

  const signup = useCallback(async (handle, email, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed');
    localStorage.setItem('gemline_token', data.token);
    setToken(data.token);
    setUser(data.user);
    await loadState(data.token);
    return data;
  }, [loadState]);

  const logout = useCallback(() => {
    localStorage.removeItem('gemline_token');
    setToken(null);
    setUser(null);
    setState(null);
  }, []);

  const authFetch = useCallback(async (url, opts = {}) => {
    const headers = { ...opts.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { ...opts, headers });
    return res;
  }, [token]);

  const refreshState = useCallback(() => {
    if (token) loadState(token);
  }, [token, loadState]);

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
