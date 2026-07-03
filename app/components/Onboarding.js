'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthContext';
import { toast } from '../lib/toast';

// Post-signup onboarding — two quick steps that seed the new account:
//   1. pick favorite sports → saved locally, drives the suggested players
//   2. pick players to watch → top card of each goes on the watchlist, which
//      immediately powers price alerts + new-listing notifications.
// Fully skippable; never shown twice (ClientLayout gates on localStorage).

const SPORTS = [
  ['Baseball', '⚾'], ['Basketball', '🏀'], ['Football', '🏈'], ['Hockey', '🏒'],
  ['Soccer', '⚽'], ['Pokemon', '⚡'], ['Tennis', '🎾'], ['Wrestling', '🤼'],
];

export default function Onboarding({ onClose }) {
  const { authFetch } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [sports, setSports] = useState(new Set());
  const [players, setPlayers] = useState(null); // [{player, sport, cardId, price, thumbnail, grader, grade}]
  const [picked, setPicked] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (set, setter, key, cap) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else if (!cap || next.size < cap) next.add(key);
    setter(next);
  };

  // Step 2 data: most-traded cards in the chosen sports, deduped by player.
  const loadPlayers = async (chosen) => {
    setPlayers(null);
    try {
      const lists = await Promise.all([...chosen].slice(0, 4).map(s =>
        fetch(`/api/market/feed?sport=${encodeURIComponent(s)}&sort=sales&limit=30`)
          .then(r => r.json()).then(d => d.feed || []).catch(() => [])));
      const seen = new Set();
      const out = [];
      // Interleave sports so one sport doesn't dominate the grid.
      for (let i = 0; i < 30 && out.length < 12; i++) {
        for (const list of lists) {
          const c = list[i];
          if (!c || seen.has(c.player) || out.length >= 12) continue;
          seen.add(c.player);
          out.push({
            player: c.player, sport: c.sport, cardId: c.cardId || c.id,
            price: Number(c.marketPrice) || 0, thumbnail: c.thumbnail || null,
            grader: c.grader || 'RAW', grade: c.grade || '',
          });
        }
      }
      setPlayers(out);
    } catch { setPlayers([]); }
  };

  const next = () => {
    if (step === 0) {
      if (sports.size === 0) { toast('Pick at least one to continue — or skip', true); return; }
      try { localStorage.setItem('gemline_fav_sports', JSON.stringify([...sports])); } catch {}
      loadPlayers(sports);
      setStep(1);
    }
  };

  const finish = async () => {
    setSaving(true);
    const chosen = (players || []).filter(p => picked.has(p.player) && p.cardId);
    let added = 0;
    // Sequential on purpose — watchlist POSTs share a 10/min write limiter.
    for (const p of chosen.slice(0, 8)) {
      try {
        const res = await authFetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: p.cardId }),
        });
        if (res.ok) added++;
      } catch { /* keep going */ }
    }
    setSaving(false);
    if (added > 0) toast(`Watching ${added} card${added > 1 ? 's' : ''} — you'll get price + listing alerts`);
    onClose();
    if (added > 0) router.push('/portfolio?tab=watchlist');
  };

  const chip = (on) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10,
    cursor: 'pointer', fontSize: 13.5, fontWeight: 600, userSelect: 'none',
    border: '1px solid ' + (on ? 'var(--gold)' : 'var(--line)'),
    background: on ? 'rgba(232,179,57,.1)' : 'var(--panel-2, #1a1d28)',
    color: on ? 'var(--gold)' : 'var(--txt)', transition: '.12s',
  });

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <button className="modal-close" onClick={onClose}>×</button>
        {step === 0 && (
          <>
            <h3 style={{ fontFamily: 'var(--disp)', fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Welcome to GEMLINE 🎉</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>What do you collect? We&apos;ll tune your feed around it.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
              {SPORTS.map(([s, emoji]) => (
                <div key={s} style={chip(sports.has(s))} onClick={() => toggle(sports, setSports, s)}>
                  <span>{emoji}</span> {s}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center' }}>
              <button onClick={next} style={{ flex: 1, padding: '11px 16px', borderRadius: 9, fontSize: 13.5, fontWeight: 800, border: 'none', background: 'var(--gold)', color: '#000', cursor: 'pointer' }}>
                Continue {sports.size > 0 ? `(${sports.size})` : ''}
              </button>
              <button onClick={onClose} style={{ padding: '11px 14px', borderRadius: 9, fontSize: 12.5, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>Skip for now</button>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h3 style={{ fontFamily: 'var(--disp)', fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Watch a few players</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>We&apos;ll alert you on price moves and new listings. Pick up to 8.</p>
            {players === null ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Finding the most-traded cards…</div>
            ) : players.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Couldn&apos;t load suggestions — explore the market instead.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, maxHeight: 340, overflowY: 'auto' }}>
                {players.map(p => {
                  const on = picked.has(p.player);
                  return (
                    <div key={p.player} style={{ ...chip(on), padding: '8px 10px', gap: 10 }} onClick={() => toggle(picked, setPicked, p.player, 8)}>
                      <div style={{
                        width: 30, height: 40, borderRadius: 4, flexShrink: 0,
                        background: p.thumbnail ? `url(${p.thumbnail}) center/cover` : 'linear-gradient(135deg,#1a1f35,#2a3050)',
                      }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.player}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                          {`${p.grader} ${p.grade}`.trim()}{p.price > 0 ? ` · $${p.price.toLocaleString()}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center' }}>
              <button onClick={finish} disabled={saving} style={{ flex: 1, padding: '11px 16px', borderRadius: 9, fontSize: 13.5, fontWeight: 800, border: 'none', background: 'var(--gold)', color: '#000', cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Setting up…' : picked.size > 0 ? `Watch ${picked.size} player${picked.size > 1 ? 's' : ''} →` : 'Finish'}
              </button>
              <button onClick={onClose} disabled={saving} style={{ padding: '11px 14px', borderRadius: 9, fontSize: 12.5, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>Skip</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
