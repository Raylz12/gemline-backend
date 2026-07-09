'use client';
// Saved searches — save the current market search (query + filters) under a
// name, then re-run or delete it from a compact dropdown. Logged-in only.
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';

export default function SavedSearches({ filters, searchQuery, onApply }) {
  const { token, authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [searches, setSearches] = useState([]);
  const [msg, setMsg] = useState('');
  const wrapRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/saved-searches');
      if (res.ok) {
        const d = await res.json();
        setSearches(d.searches || []);
      }
    } catch {}
  }, [authFetch]);

  useEffect(() => { if (token) load(); }, [token, load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setNaming(false); } };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!token) return null;

  const defaultName = () => {
    const bits = [];
    const q = (searchQuery || filters.q || '').trim();
    if (q) bits.push(`“${q}”`);
    if (filters.sport && filters.sport !== 'All') bits.push(filters.sport);
    if (filters.brand) bits.push(filters.brand);
    if (filters.grade && filters.grade !== 'All') bits.push(filters.grade);
    if ((filters.cardType || 'all') !== 'all') bits.push(filters.cardType);
    if ((filters.priceRange || 'all') !== 'all') bits.push(filters.priceRange);
    return bits.join(' · ').slice(0, 60) || 'My search';
  };

  const save = async () => {
    const nm = name.trim() || defaultName();
    setSaving(true);
    setMsg('');
    try {
      const params = { ...filters, q: (searchQuery || filters.q || '') };
      const res = await authFetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm, params }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || 'Failed to save'); }
      else {
        setSearches(s => [d.search, ...s]);
        setNaming(false);
        setName('');
        setMsg('Saved ✓');
        setTimeout(() => setMsg(''), 2000);
      }
    } catch { setMsg('Failed to save'); }
    setSaving(false);
  };

  const remove = async (id) => {
    setSearches(s => s.filter(x => x.id !== id));
    try { await authFetch(`/api/saved-searches/${id}`, { method: 'DELETE' }); } catch {}
  };

  const run = (s) => {
    onApply?.(s.params || {});
    setOpen(false);
  };

  const btnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
    borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--txt)',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button style={btnStyle} onClick={() => { setNaming(n => !n); setOpen(false); setName(''); }} title="Save this search">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
        Save search
      </button>
      <button style={btnStyle} onClick={() => { setOpen(o => !o); setNaming(false); }}>
        Saved{searches.length > 0 ? ` (${searches.length})` : ''}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: open ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {msg && <span style={{ fontSize: 11, color: msg.includes('✓') ? 'var(--up)' : 'var(--down)' }}>{msg}</span>}

      {naming && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 50, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: 12, width: 280, boxShadow: '0 8px 24px rgba(0,0,0,.45)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Name this search</div>
          <input
            autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false); }}
            placeholder={defaultName()}
            maxLength={60}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: 'var(--ink)', border: '1px solid var(--line)', color: 'var(--txt)', fontSize: 13, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={{ ...btnStyle, padding: '5px 10px', fontSize: 11 }} onClick={() => setNaming(false)}>Cancel</button>
            <button disabled={saving} onClick={save}
              style={{ ...btnStyle, padding: '5px 12px', fontSize: 11, background: 'var(--gold)', color: 'var(--ink)', border: 'none' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 50, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: 6, width: 300, maxHeight: 320, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.45)' }}>
          {searches.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 12, color: 'var(--muted)' }}>
              No saved searches yet. Set your filters, then hit “Save search”.
            </div>
          ) : searches.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', borderRadius: 8 }}>
              <button onClick={() => run(s)}
                style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title="Run this search">
                {s.name}
              </button>
              <button onClick={() => remove(s.id)} title="Delete"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dim)', padding: 4, lineHeight: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
