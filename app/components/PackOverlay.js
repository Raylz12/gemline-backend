'use client';
import { useState, useCallback, useEffect } from 'react';
import { useCardStore } from './CardStore';
import { useAuth } from './AuthContext';
import { SPORT_THEME } from '../lib/data';

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + Number(n).toFixed(2);
}

function Confetti({ active }) {
  useEffect(() => {
    if (!active) return;
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ['#E8B339', '#34D88A', '#5B8DEF', '#9B7BFF', '#FF5C6C', '#ffffff'];
    const cx = canvas.width / 2, cy = canvas.height * 0.42;
    const parts = [];
    for (let i = 0; i < 150; i++) {
      parts.push({
        x: cx + (Math.random() - 0.5) * 180, y: cy,
        vx: (Math.random() - 0.5) * 10, vy: Math.random() * -13 - 3,
        g: 0.42, s: Math.random() * 6 + 3,
        c: colors[i % colors.length],
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35,
        life: 1,
      });
    }
    const t0 = performance.now();
    let frame;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      parts.forEach(p => {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.008;
        if (p.life > 0 && p.y < canvas.height + 20) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.r);
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.55);
          ctx.restore();
        }
      });
      if (alive && performance.now() - t0 < 3200) frame = requestAnimationFrame(draw);
      else { ctx.clearRect(0, 0, canvas.width, canvas.height); }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  if (!active) return null;
  return <canvas id="confetti-canvas" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 99999 }} />;
}

export default function PackOverlay({ onClose }) {
  const { allCards, wallet, setWallet } = useCardStore();
  const { user, token, authFetch } = useAuth();
  const [phase, setPhase] = useState('sealed'); // sealed | ripping | reveal
  const [packCards, setPackCards] = useState([]);
  const [flipped, setFlipped] = useState(new Set());
  const [hitText, setHitText] = useState('');
  const [showConfetti, setShowConfetti] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rip = useCallback(async () => {
    setError('');
    
    if (!user || !token) {
      setError('Sign in to rip packs');
      return;
    }

    try {
      const res = await authFetch('/api/packs/rip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packType: 'standard' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to rip pack');
        return;
      }

      // Update wallet credits
      if (data.creditsRemaining !== undefined) {
        setWallet(prev => ({ ...prev, credits: data.creditsRemaining }));
      }

      const selected = (data.cards || []).map(c => ({
        ...c,
        theme: SPORT_THEME[c.sport] || ['#2a2a2a', '#555'],
      }));

      setPackCards(selected);
      setPhase('ripping');
      setFlipped(new Set());
      setHitText('');
      setShowConfetti(false);

      setTimeout(() => {
        setPhase('reveal');
        selected.forEach((card, i) => {
          setTimeout(() => {
            setFlipped(prev => {
              const next = new Set(prev);
              next.add(i);
              return next;
            });
            if (card.market >= 1500) {
              setTimeout(() => {
                setHitText(`🔥 BIG HIT — ${card.player} · $${card.market.toLocaleString()}`);
                setShowConfetti(true);
              }, 320);
            }
          }, 340 + i * 250);
        });
      }, 600);
    } catch (e) {
      setError(e.message || 'Network error');
    }
  }, [user, token, authFetch, setWallet]);

  const flipCard = (idx) => {
    if (flipped.has(idx)) return;
    const next = new Set(flipped);
    next.add(idx);
    setFlipped(next);

    const card = packCards[idx];
    if (card.market >= 1500) {
      setHitText(`🔥 BIG HIT — ${card.player} · ${fmtP(card.market)}`);
      setShowConfetti(true);
    } else if (card.market >= 200) {
      setHitText(`⚡ Nice pull! ${card.player} — ${fmtP(card.market)}`);
    }
  };

  const flipAll = () => {
    setFlipped(new Set(packCards.map((_, i) => i)));
    const best = [...packCards].sort((a, b) => b.market - a.market)[0];
    if (best.market >= 1500) {
      setHitText(`🔥 BIG HIT — ${best.player} · ${fmtP(best.market)}`);
      setShowConfetti(true);
    } else if (best.market >= 200) {
      setHitText(`⚡ Best pull: ${best.player} — ${fmtP(best.market)}`);
    }
  };

  return (
    <>
      <Confetti active={showConfetti} />
      <div className="scout-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="scout-sheet" style={{ maxWidth: 640 }}>
          <button className="modal-close" onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, zIndex: 5 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <div className="sheet-pad">
            <div className="eyebrow">Pack rip · ◈ {wallet.credits} credits</div>
            <h2 className="sheet-h">Open a pack</h2>
            <p className="sheet-sub">Costs 15 credits. Tap the pack to rip it. Six pulls with one chase slot — land a big hit and the room lights up.</p>
            {error && (
              <div style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '8px 12px', color: '#ef4444', fontSize: 12, marginBottom: 12 }}>
                {error}
              </div>
            )}

            <div className="pack-stage">
              {/* Sealed pack */}
              {phase === 'sealed' && (
                <div className="pack-wrap" onClick={rip}>
                  <div className="pack-foil">
                    <div className="pl">G</div>
                    <div className="pt">GEMLINE</div>
                    <div className="ps">PREMIER PACK · 6 CARDS</div>
                    <div className="riplabel">tap to rip</div>
                  </div>
                </div>
              )}

              {/* Ripping animation */}
              {phase === 'ripping' && (
                <div className="pack-wrap ripping">
                  <div className="pack-foil">
                    <div className="pl">G</div>
                    <div className="pt">GEMLINE</div>
                    <div className="ps">OPENING...</div>
                  </div>
                </div>
              )}

              {/* Revealed cards */}
              {phase === 'reveal' && (
                <>
                  <div className={`hit-banner ${hitText ? 'on' : ''}`}>{hitText}</div>
                  <div className="pack-reveal on">
                    {packCards.map((c, idx) => {
                      const isFlipped = flipped.has(idx);
                      const isHit = c.market >= 1500;
                      const theme = SPORT_THEME[c.sport] || ['#2a2a2a', '#555'];
                      return (
                        <div key={idx} className={`pcard ${isFlipped ? 'flip' : ''} ${isFlipped && isHit ? 'hit' : ''}`}
                          onClick={() => !isFlipped ? flipCard(idx) : null}>
                          <div className="pcard-inner">
                            <div className="face pf-back">
                              <span style={{ fontFamily: 'var(--disp)', fontSize: 28, fontWeight: 800, letterSpacing: 2, color: 'var(--gold)' }}>GEM<span style={{ color: '#fff' }}>LINE</span></span>
                              <span style={{ fontSize: 8, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--dim)', marginTop: 4 }}>The Card Exchange</span>
                            </div>
                            <div className="face pf-front" style={{ '--cardbg': `linear-gradient(135deg,${theme[0]},${theme[1]})` }}>
                              {c.thumbnail && (
                                <img src={c.thumbnail} alt="" style={{
                                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                                  objectFit: 'contain', zIndex: 1, borderRadius: 9,
                                }} />
                              )}
                              {isHit && <div className="foil2" />}
                              <div style={{ position: 'relative', zIndex: 2, background: 'rgba(0,0,0,.7)', borderRadius: 6, padding: '5px 7px', marginTop: 'auto' }}>
                                <div className="nm">{c.player}</div>
                                <div className="pr">{c.grader} {c.grade} · {fmtP(c.market)}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pack-actions">
                    {flipped.size < packCards.length && (
                      <button className="btn-ghost" onClick={flipAll}>Flip all</button>
                    )}
                    <button className="btn-ghost" onClick={() => { setPhase('sealed'); setShowConfetti(false); setHitText(''); }}>
                      Rip another
                    </button>
                    <button className="btn-primary" onClick={onClose}>Done</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
