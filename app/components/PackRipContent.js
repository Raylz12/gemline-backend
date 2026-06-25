'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useCardStore } from './CardStore';
import { SPORT_THEME } from '../lib/data';
import CardDetail from './CardDetail';

// ─── Pack tier config ──────────────────────────────────────────────────────────
const PACK_TYPES = [
  {
    key: 'standard',
    name: 'Standard',
    cost: 15,
    cards: 6,
    desc: '6 CARDS',
    hits: 'No guaranteed hits',
    icon: '◈',
    guaranteedHits: 0,
    // Blue/silver theme
    bg: 'linear-gradient(160deg,#0d1a3a 0%,#0a1020 50%,#111827 100%)',
    shimmer: 'rgba(91,141,239,.55)',
    shimmer2: 'rgba(180,200,255,.35)',
    accent: '#5B8DEF',
    accentSoft: 'rgba(91,141,239,.15)',
    glow: 'rgba(91,141,239,.6)',
    label: 'STANDARD',
    badge: '#5B8DEF',
  },
  {
    key: 'premium',
    name: 'Premium',
    cost: 30,
    cards: 6,
    desc: '6 CARDS',
    hits: '1 guaranteed hit ($100+)',
    icon: '★',
    guaranteedHits: 1,
    // Gold/amber theme
    bg: 'linear-gradient(160deg,#251a04 0%,#1a1205 50%,#0f0d02 100%)',
    shimmer: 'rgba(232,179,57,.65)',
    shimmer2: 'rgba(255,220,100,.4)',
    accent: '#E8B339',
    accentSoft: 'rgba(232,179,57,.15)',
    glow: 'rgba(232,179,57,.7)',
    label: 'PREMIUM',
    badge: '#E8B339',
  },
  {
    key: 'elite',
    name: 'Elite',
    cost: 75,
    cards: 9,
    desc: '9 CARDS',
    hits: '2+ guaranteed hits ($200+)',
    icon: '◆',
    guaranteedHits: 2,
    // Purple/rainbow holographic theme
    bg: 'linear-gradient(160deg,#160d2a 0%,#0e0718 50%,#0a0613 100%)',
    shimmer: 'rgba(155,123,255,.65)',
    shimmer2: 'rgba(220,180,255,.4)',
    accent: '#9B7BFF',
    accentSoft: 'rgba(155,123,255,.15)',
    glow: 'rgba(155,123,255,.7)',
    label: 'ELITE',
    badge: '#9B7BFF',
  },
];

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + Number(n).toFixed(2);
}

// ─── Confetti ──────────────────────────────────────────────────────────────────
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
    for (let i = 0; i < 200; i++) {
      parts.push({
        x: cx + (Math.random() - 0.5) * 200, y: cy,
        vx: (Math.random() - 0.5) * 14, vy: Math.random() * -16 - 4,
        g: 0.38, s: Math.random() * 7 + 3,
        c: colors[i % colors.length],
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        life: 1,
      });
    }
    const t0 = performance.now();
    let frame;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      parts.forEach(p => {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.007;
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
      if (alive && performance.now() - t0 < 4000) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  if (!active) return null;
  return <canvas id="confetti-canvas" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 99999 }} />;
}

// ─── Holographic Pack Card ─────────────────────────────────────────────────────
function PackCard({ pack, selected, onClick }) {
  const isElite = pack.key === 'elite';
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        transition: 'transform .2s',
        transform: selected ? 'translateY(-8px) scale(1.04)' : 'none',
      }}
    >
      {/* Pack body */}
      <div style={{
        position: 'relative',
        width: 110,
        height: 164,
        borderRadius: 12,
        overflow: 'hidden',
        border: selected ? `2px solid ${pack.accent}` : '2px solid rgba(255,255,255,.08)',
        boxShadow: selected
          ? `0 0 28px ${pack.glow}, 0 20px 40px -12px #000`
          : '0 8px 24px -8px #000',
        background: pack.bg,
        transition: 'all .25s',
      }}>
        {/* Shimmer layer */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
          background: `linear-gradient(115deg,transparent 20%,${pack.shimmer} 45%,${pack.shimmer2} 55%,transparent 75%)`,
          backgroundSize: '250% 250%',
          animation: isElite ? 'elitefoil 2.2s linear infinite' : 'foilmove 3s linear infinite',
          mixBlendMode: 'screen',
        }} />
        {/* Rainbow overlay for elite */}
        {isElite && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
            background: 'linear-gradient(135deg,rgba(255,0,128,.15),rgba(255,165,0,.12),rgba(0,255,100,.1),rgba(0,128,255,.12),rgba(200,0,255,.12))',
            backgroundSize: '400% 400%',
            animation: 'rainbowmove 3s linear infinite',
            mixBlendMode: 'screen',
          }} />
        )}
        {/* Pack art inner content */}
        <div style={{
          position: 'relative', zIndex: 4,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: 6, padding: '12px 8px',
        }}>
          <div style={{
            fontSize: 32, fontFamily: 'var(--disp)', fontWeight: 800,
            color: pack.accent,
            textShadow: `0 0 20px ${pack.glow}, 0 0 40px ${pack.glow}`,
            filter: 'drop-shadow(0 0 8px ' + pack.glow + ')',
          }}>{pack.icon}</div>
          <div style={{
            fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 13,
            color: '#fff', letterSpacing: '.08em', textAlign: 'center',
          }}>{pack.label}</div>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,.45)',
            letterSpacing: '.12em', textAlign: 'center',
          }}>GEMLINE</div>
        </div>
        {/* Bottom gradient */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, zIndex: 5,
          background: 'linear-gradient(transparent,rgba(0,0,0,.65))',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          paddingBottom: 8,
        }}>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '.18em',
            color: pack.accent, textTransform: 'uppercase',
          }}>{pack.desc}</span>
        </div>
      </div>

      {/* Label below pack */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15,
          color: selected ? pack.accent : 'var(--txt)',
          transition: 'color .2s',
        }}>{pack.name}</div>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 11, marginTop: 2,
          color: pack.accent, fontWeight: 600,
        }}>◈ {pack.cost} credits</div>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 9.5, marginTop: 3,
          color: 'var(--muted)',
        }}>{pack.hits}</div>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: pack.accent,
          boxShadow: `0 0 8px ${pack.glow}`,
          animation: 'pulse 1.4s infinite',
        }} />
      )}
    </div>
  );
}

// ─── Ripping animation overlay ─────────────────────────────────────────────────
function RippingOverlay({ pack }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 24, padding: '40px 0',
    }}>
      <div style={{ position: 'relative', width: 110, height: 164 }}>
        {/* Top half */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
          background: pack.bg, borderRadius: '12px 12px 0 0',
          border: `2px solid ${pack.accent}`,
          boxShadow: `0 0 28px ${pack.glow}`,
          animation: 'tearTop .5s ease-out forwards',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(115deg,transparent 20%,${pack.shimmer} 45%,${pack.shimmer2} 55%,transparent 75%)`,
            backgroundSize: '250% 250%',
            animation: 'foilmove 1s linear infinite',
            mixBlendMode: 'screen',
          }} />
        </div>
        {/* Bottom half */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
          background: pack.bg, borderRadius: '0 0 12px 12px',
          border: `2px solid ${pack.accent}`,
          borderTop: 'none',
          boxShadow: `0 0 28px ${pack.glow}`,
          animation: 'tearBottom .5s ease-out forwards',
          overflow: 'hidden',
        }} />
        {/* Burst */}
        <div style={{
          position: 'absolute', top: '45%', left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 60, height: 60,
          background: `radial-gradient(circle,${pack.glow},transparent 70%)`,
          animation: 'burstPop .5s ease-out forwards',
          borderRadius: '50%', zIndex: 10,
        }} />
      </div>
      <div style={{
        fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 18,
        color: pack.accent, letterSpacing: '.08em',
        textShadow: `0 0 20px ${pack.glow}`,
        animation: 'pulse 0.6s infinite',
      }}>OPENING…</div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function PackRipContent() {
  const { user, token, authFetch } = useAuth();
  const { allCards, wallet, setWallet } = useCardStore();

  const [packType, setPackType] = useState(1); // default premium
  const [phase, setPhase] = useState('pick');   // pick | ripping | reveal
  const [packCards, setPackCards] = useState([]);
  const [flipped, setFlipped] = useState(new Set());
  const [hitText, setHitText] = useState('');
  const [showConfetti, setShowConfetti] = useState(false);
  const [collection, setCollection] = useState([]);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [error, setError] = useState('');
  const [ripping, setRipping] = useState(false);
  // Track which cards have been revealed to show glow
  const [glowing, setGlowing] = useState(new Set());

  // Auth loading: token arrives from localStorage very quickly, user from server
  const authLoading = !token && !user;

  useEffect(() => {
    if (!token) return;
    setLoadingCollection(true);
    authFetch('/api/packs/collection')
      .then(r => r.ok ? r.json() : { pulls: [] })
      .then(d => setCollection(d.pulls || []))
      .catch(() => {})
      .finally(() => setLoadingCollection(false));
  }, [token, authFetch]);

  const rip = useCallback(async () => {
    setError('');
    const pack = PACK_TYPES[packType];

    // Fix: use token (from localStorage, available synchronously) instead of user (async)
    if (!token) {
      setError('Sign in to rip packs');
      return;
    }
    if (ripping) return;
    setRipping(true);

    try {
      const res = await authFetch('/api/packs/rip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packType: pack.key }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to rip pack');
        setRipping(false);
        return;
      }
      if (data.creditsRemaining !== undefined) {
        setWallet(prev => ({ ...prev, credits: data.creditsRemaining }));
      }
      const selected = (data.cards || []).map(c => ({
        ...c,
        theme: SPORT_THEME[c.sport] || ['#2a2a2a', '#555'],
        ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase(),
      }));
      setPackCards(selected);
      setPhase('ripping');
      setFlipped(new Set());
      setGlowing(new Set());
      setHitText('');
      setShowConfetti(false);

      // After tear animation, go to reveal
      setTimeout(() => {
        setPhase('reveal');
        setRipping(false);
        // Stagger flip-in with glow effects
        // SOUND: Each card flip would play a card-slide sound
        selected.forEach((card, i) => {
          setTimeout(() => {
            setFlipped(prev => { const n = new Set(prev); n.add(i); return n; });
            // Brief glow on reveal
            setGlowing(prev => { const n = new Set(prev); n.add(i); return n; });
            setTimeout(() => {
              setGlowing(prev => { const n = new Set(prev); n.delete(i); return n; });
            }, 800);

            // Hit announcements
            // SOUND: Big hit → play dramatic sting; normal hit → play chime
            if (card.market >= 1500) {
              setTimeout(() => {
                setHitText(`🔥 BIG HIT — ${card.player} · ${fmtP(card.market)}`);
                setShowConfetti(true);
              }, 320);
            } else if (card.market >= 200) {
              setTimeout(() => {
                setHitText(prev => prev || `⚡ ${card.player} — ${fmtP(card.market)}`);
              }, 320);
            }
          }, 300 + i * 280);
        });
      }, 700);

      // Refresh collection in background
      authFetch('/api/packs/collection')
        .then(r => r.ok ? r.json() : { pulls: [] })
        .then(d => setCollection(d.pulls || []))
        .catch(() => {});
    } catch (e) {
      setError(e.message || 'Network error');
      setRipping(false);
    }
  }, [token, authFetch, packType, setWallet, ripping]);

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
    if (best && best.market >= 1500) {
      setHitText(`🔥 BIG HIT — ${best.player} · ${fmtP(best.market)}`);
      setShowConfetti(true);
    } else if (best && best.market >= 200) {
      setHitText(`⚡ Best pull: ${best.player} — ${fmtP(best.market)}`);
    }
  };

  const activePack = PACK_TYPES[packType];

  // Collection sorted by value desc, with total
  const sortedCollection = [...collection].sort((a, b) =>
    ((b.market || b.catalog_price || 0) - (a.market || a.catalog_price || 0))
  );
  const collectionTotal = sortedCollection.reduce((s, c) => s + (c.market || c.catalog_price || 0), 0);

  return (
    <>
      <Confetti active={showConfetti} />

      {/* Inline styles for pack-rip animations */}
      <style>{`
        @keyframes tearTop {
          from { transform: translateY(0) rotate(0deg); opacity: 1; }
          to   { transform: translateY(-60px) rotate(-8deg); opacity: 0; }
        }
        @keyframes tearBottom {
          from { transform: translateY(0) rotate(0deg); opacity: 1; }
          to   { transform: translateY(60px) rotate(6deg); opacity: 0; }
        }
        @keyframes burstPop {
          0%   { transform: translate(-50%,-50%) scale(0); opacity: 1; }
          60%  { transform: translate(-50%,-50%) scale(1.8); opacity: .8; }
          100% { transform: translate(-50%,-50%) scale(2.5); opacity: 0; }
        }
        @keyframes elitefoil {
          0%   { background-position: 0% 0%; }
          100% { background-position: 220% 220%; }
        }
        @keyframes rainbowmove {
          0%   { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
        @keyframes flyIn {
          from { opacity: 0; transform: translateY(32px) scale(.88); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes hitShake {
          0%,100% { transform: rotate(0deg) scale(1); }
          20%      { transform: rotate(-2.5deg) scale(1.04); }
          40%      { transform: rotate(2.5deg) scale(1.06); }
          60%      { transform: rotate(-1.5deg) scale(1.04); }
          80%      { transform: rotate(1deg) scale(1.02); }
        }
        .pcard-fly { animation: flyIn .4s ease-out both; }
        .pcard-big-hit .pf-front { animation: hitShake .5s ease-out .3s; }
        .pack-select-ring {
          outline: 3px solid var(--ring-color);
          outline-offset: 3px;
          border-radius: 12px;
        }
      `}</style>

      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 28, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <p className="sub" style={{ marginBottom: 0 }}>
            Open packs to build your digital collection.
          </p>
        </div>
        {token && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--gold-soft)', border: '1px solid rgba(232,179,57,.3)',
            borderRadius: 10, padding: '7px 14px',
          }}>
            <span style={{ fontSize: 16 }}>◈</span>
            <span style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 17, color: 'var(--gold)' }}>
              {wallet.credits?.toLocaleString() ?? '—'}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.1em' }}>
              CREDITS
            </span>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,.18)', border: '1px solid rgba(239,68,68,.5)',
          borderRadius: 12, padding: '12px 18px', color: '#ff7070',
          fontSize: 14, fontWeight: 600, marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          {error}
        </div>
      )}

      <div className="pack-stage">

        {/* ── PICK phase ─────────────────────────────────────────────────────── */}
        {phase === 'pick' && (
          <>
            {/* Pack tier selector */}
            <div style={{
              display: 'flex', gap: 28, flexWrap: 'wrap',
              justifyContent: 'center', alignItems: 'flex-end',
              marginBottom: 36,
            }}>
              {PACK_TYPES.map((p, i) => (
                <PackCard key={i} pack={p} selected={i === packType} onClick={() => setPackType(i)} />
              ))}
            </div>

            {/* RIP button */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <button
                onClick={rip}
                disabled={authLoading || ripping}
                style={{
                  position: 'relative', overflow: 'hidden',
                  padding: '16px 52px',
                  borderRadius: 14,
                  border: `2px solid ${activePack.accent}`,
                  background: authLoading || ripping
                    ? 'rgba(255,255,255,.04)'
                    : `linear-gradient(135deg,${activePack.accentSoft},rgba(0,0,0,.3))`,
                  color: authLoading || ripping ? 'var(--muted)' : activePack.accent,
                  fontFamily: 'var(--disp)',
                  fontWeight: 800,
                  fontSize: 20,
                  letterSpacing: '.06em',
                  cursor: authLoading || ripping ? 'not-allowed' : 'pointer',
                  boxShadow: authLoading || ripping
                    ? 'none'
                    : `0 0 28px ${activePack.glow}, 0 8px 32px -8px ${activePack.glow}`,
                  transition: 'all .2s',
                  minWidth: 220,
                }}
              >
                {/* Shimmer on button */}
                {!authLoading && !ripping && (
                  <span style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    background: `linear-gradient(110deg,transparent 30%,${activePack.shimmer} 50%,transparent 70%)`,
                    backgroundSize: '200% 100%',
                    animation: 'foilmove 2.5s linear infinite',
                    mixBlendMode: 'screen',
                    borderRadius: 12,
                  }} />
                )}
                <span style={{ position: 'relative', zIndex: 1 }}>
                  {authLoading ? 'Loading…' : ripping ? 'Opening…' : '🎴 RIP IT'}
                </span>
              </button>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)',
                letterSpacing: '.1em',
              }}>
                {token
                  ? `COSTS ${activePack.cost} CREDITS · ${activePack.hits.toUpperCase()}`
                  : 'SIGN IN TO RIP PACKS'
                }
              </div>
            </div>
          </>
        )}

        {/* ── RIPPING phase ──────────────────────────────────────────────────── */}
        {phase === 'ripping' && <RippingOverlay pack={activePack} />}

        {/* ── REVEAL phase ───────────────────────────────────────────────────── */}
        {phase === 'reveal' && (
          <>
            {/* Hit banner */}
            <div className={`hit-banner ${hitText ? 'on' : ''}`} style={{ marginBottom: 4 }}>
              {hitText}
            </div>

            {/* Cards grid */}
            <div className="pack-reveal on">
              {packCards.map((c, idx) => {
                const isFlipped = flipped.has(idx);
                const isHit = c.market >= 1500;
                const isMedHit = c.market >= 200 && c.market < 1500;
                const isGlowing = glowing.has(idx);
                const theme = c.theme || ['#2a2a2a', '#555'];
                return (
                  <div
                    key={idx}
                    className={`pcard pcard-fly ${isFlipped ? 'flip' : ''} ${isFlipped && isHit ? 'hit pcard-big-hit' : ''}`}
                    style={{
                      animationDelay: `${idx * 0.06}s`,
                      // Extra glow flash when card flips in
                      filter: isGlowing && isFlipped
                        ? `drop-shadow(0 0 18px ${isHit ? 'rgba(232,179,57,.9)' : activePack.accent})`
                        : isFlipped && isHit
                          ? 'drop-shadow(0 0 12px rgba(232,179,57,.7))'
                          : 'none',
                      transition: 'filter .4s ease',
                    }}
                    onClick={() => !isFlipped ? flipCard(idx) : setSelectedCard(c)}
                  >
                    <div className="pcard-inner">
                      {/* Back face */}
                      <div className="face pf-back">
                        <span style={{
                          fontFamily: 'var(--disp)', fontSize: 26, fontWeight: 800,
                          letterSpacing: 2, color: activePack.accent,
                        }}>
                          GEM<span style={{ color: '#fff' }}>LINE</span>
                        </span>
                        <span style={{
                          fontSize: 7.5, letterSpacing: 3, textTransform: 'uppercase',
                          color: 'var(--dim)', marginTop: 4,
                        }}>The Card Exchange</span>
                      </div>
                      {/* Front face */}
                      <div
                        className="face pf-front"
                        style={{ '--cardbg': `linear-gradient(135deg,${theme[0]},${theme[1]})` }}
                      >
                        {c.thumbnail && (
                          <img src={c.thumbnail} alt="" style={{
                            position: 'absolute', inset: 0, width: '100%', height: '100%',
                            objectFit: 'contain', zIndex: 1, borderRadius: 9,
                          }} />
                        )}
                        {/* Foil for hits */}
                        {(isHit || isMedHit) && <div className="foil2" />}
                        {/* Big hit gold border glow */}
                        {isHit && (
                          <div style={{
                            position: 'absolute', inset: 0, borderRadius: 9, zIndex: 5,
                            pointerEvents: 'none',
                            boxShadow: 'inset 0 0 0 2px #E8B339, 0 0 30px -4px rgba(232,179,57,.9)',
                          }} />
                        )}
                        {/* Card info */}
                        <div style={{
                          position: 'relative', zIndex: 6,
                          background: 'rgba(0,0,0,.78)',
                          borderRadius: 6, padding: '5px 7px', marginTop: 'auto',
                          backdropFilter: 'blur(4px)',
                        }}>
                          <div className="nm">{c.player}</div>
                          <div className="pr">{c.grader} {c.grade} · {fmtP(c.market)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="pack-actions" style={{ marginTop: 20 }}>
              {flipped.size < packCards.length && (
                <button className="btn-ghost" onClick={flipAll}>
                  ↩ Flip all
                </button>
              )}
              <button
                className="btn-ghost"
                style={{
                  border: `1px solid ${activePack.accent}`,
                  color: activePack.accent,
                }}
                onClick={() => {
                  setPhase('pick');
                  setShowConfetti(false);
                  setHitText('');
                  setPackCards([]);
                  setFlipped(new Set());
                }}
              >
                🎴 Rip Another
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Collection section ──────────────────────────────────────────────── */}
      {token && (
        <div style={{ marginTop: 56 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12, marginBottom: 20,
          }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>🎴 My Collection</div>
              <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 20, marginBottom: 4 }}>
                Cards from Packs
              </h3>
              <p className="sub" style={{ marginBottom: 0 }}>
                {sortedCollection.length} cards · sorted by value
              </p>
            </div>
            {collectionTotal > 0 && (
              <div style={{
                background: 'var(--gold-soft)', border: '1px solid rgba(232,179,57,.25)',
                borderRadius: 10, padding: '10px 18px', textAlign: 'right',
              }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '.12em', marginBottom: 2 }}>
                  COLLECTION VALUE
                </div>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 22, color: 'var(--gold)' }}>
                  ${collectionTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
              </div>
            )}
          </div>

          {loadingCollection ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⟳</div>
              Loading collection…
            </div>
          ) : sortedCollection.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '56px 20px',
              border: '1px dashed var(--line)', borderRadius: 14,
              color: 'var(--muted)',
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎴</div>
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>No pulls yet</p>
              <p style={{ fontSize: 13 }}>Rip a pack above to start your collection</p>
            </div>
          ) : (
            <div className="grid" style={{ gap: 14 }}>
              {sortedCollection.map((pull, i) => {
                const val = pull.market || pull.catalog_price || 0;
                const isHit = val >= 1500;
                const isMedHit = val >= 200 && val < 1500;
                const theme = SPORT_THEME[pull.sport] || ['#2a2a2a', '#555'];
                return (
                  <div
                    key={pull.id || i}
                    onClick={() => setSelectedCard(pull)}
                    style={{
                      cursor: 'pointer', position: 'relative', overflow: 'hidden',
                      borderRadius: 12,
                      border: isHit
                        ? '1px solid rgba(232,179,57,.5)'
                        : isMedHit
                          ? '1px solid rgba(91,141,239,.35)'
                          : '1px solid var(--line)',
                      background: 'var(--panel)',
                      boxShadow: isHit
                        ? '0 0 20px -4px rgba(232,179,57,.35)'
                        : 'none',
                      transition: 'transform .15s, box-shadow .15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-3px)';
                      e.currentTarget.style.boxShadow = isHit
                        ? '0 8px 28px -4px rgba(232,179,57,.45)'
                        : '0 8px 24px -8px rgba(0,0,0,.6)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = '';
                      e.currentTarget.style.boxShadow = isHit
                        ? '0 0 20px -4px rgba(232,179,57,.35)'
                        : 'none';
                    }}
                  >
                    {/* Foil overlay for hits */}
                    {isHit && (
                      <div className="foil2" style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }} />
                    )}
                    {/* Card image */}
                    <div style={{
                      background: pull.thumbnail || pull.ebay_thumb
                        ? `url(${pull.thumbnail || pull.ebay_thumb}) center/contain no-repeat`
                        : `linear-gradient(135deg,${theme[0]},${theme[1]})`,
                      height: 148,
                      position: 'relative',
                    }}>
                      {/* Value badge */}
                      {val > 0 && (
                        <div style={{
                          position: 'absolute', top: 8, right: 8, zIndex: 4,
                          background: isHit ? 'rgba(232,179,57,.92)' : 'rgba(0,0,0,.75)',
                          color: isHit ? '#000' : 'var(--gold)',
                          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
                          padding: '3px 7px', borderRadius: 6,
                        }}>
                          {fmtP(val)}
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{pull.player}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                        {pull.grader} {pull.grade} · {pull.card_set || pull.set}
                      </div>
                      {/* Tier badge */}
                      {isHit && (
                        <div style={{
                          marginTop: 6,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
                          color: '#E8B339', background: 'var(--gold-soft)',
                          padding: '2px 7px', borderRadius: 5, letterSpacing: '.1em',
                        }}>
                          🔥 BIG HIT
                        </div>
                      )}
                      {isMedHit && (
                        <div style={{
                          marginTop: 6,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
                          color: '#5B8DEF', background: 'rgba(91,141,239,.12)',
                          padding: '2px 7px', borderRadius: 5, letterSpacing: '.1em',
                        }}>
                          ⚡ HIT
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
