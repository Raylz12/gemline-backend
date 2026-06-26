'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import { useCardStore } from '../components/CardStore';
import { SPORT_THEME } from '../lib/data';
import CardDetail from '../components/CardDetail';

const PACK_TYPES = [
  { key: 'standard', name: 'Standard Pack', cost: 15, cards: 6, desc: '6 RANDOM CARDS', icon: 'G', guaranteedHits: 0 },
  { key: 'premium', name: 'Premium Pack', cost: 30, cards: 6, desc: '6 CARDS · GUARANTEED HIT', icon: '★', guaranteedHits: 1 },
  { key: 'elite', name: 'Elite Pack', cost: 75, cards: 9, desc: '9 CARDS · 2+ HITS', icon: '◆', guaranteedHits: 2 },
];

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + n.toFixed(2);
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

export default function PacksPage() {
  const { user, token, authFetch } = useAuth();
  const { allCards, wallet, setWallet, watch, toggleWatch } = useCardStore();
  const [packType, setPackType] = useState(0);
  const [phase, setPhase] = useState('pick'); // pick | ripping | reveal
  const [packCards, setPackCards] = useState([]);
  const [flipped, setFlipped] = useState(new Set());
  const [hitText, setHitText] = useState('');
  const [showConfetti, setShowConfetti] = useState(false);
  const [collection, setCollection] = useState([]);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [error, setError] = useState('');

  // Load collection
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

    if (!user) {
      setError('Sign in to rip packs');
      return;
    }

    // Call API to deduct credits and get cards
    try {
      const res = await authFetch('/api/packs/rip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packType: pack.key }),
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

      // Map returned cards
      const selected = (data.cards || []).map(c => ({
        ...c,
        theme: SPORT_THEME[c.sport] || ['#2a2a2a', '#555'],
        ini: (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase(),
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

      // Refresh collection
      authFetch('/api/packs/collection')
        .then(r => r.ok ? r.json() : { pulls: [] })
        .then(d => setCollection(d.pulls || []))
        .catch(() => {});
    } catch (e) {
      setError(e.message || 'Network error');
    }
  }, [user, token, authFetch, packType, setWallet]);

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

  return (
    <>
      <Confetti active={showConfetti} />
      <div className="eyebrow">Pack Rip</div>
      <h1 className="page">Open a pack</h1>
      <p className="sub">
        Spend credits to rip packs and build your digital collection. Land a big hit and show it off on your profile.
        {user && <span style={{ color: 'var(--gold)', marginLeft: 8 }}>◈ {wallet.credits} credits</span>}
      </p>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 16px', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="pack-stage">
        {phase === 'pick' && (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 24 }}>
              {PACK_TYPES.map((p, i) => (
                <div key={i}
                  onClick={() => setPackType(i)}
                  style={{
                    padding: '14px 20px', borderRadius: 12, cursor: 'pointer',
                    border: `1px solid ${i === packType ? 'var(--gold)' : 'var(--line)'}`,
                    background: i === packType ? 'var(--gold-soft)' : 'var(--panel)',
                    textAlign: 'center', minWidth: 130,
                  }}>
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{p.icon}</div>
                  <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{p.desc}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)', marginTop: 6 }}>◈ {p.cost} credits</div>
                </div>
              ))}
            </div>

            <div className="pack-wrap" onClick={rip} style={{ cursor: 'pointer' }}>
              <div className="pack-foil">
                <div className="pl">{PACK_TYPES[packType].icon}</div>
                <div className="pt">{PACK_TYPES[packType].name}</div>
                <div className="ps">{PACK_TYPES[packType].desc}</div>
                <div className="riplabel">{user ? 'TAP TO RIP' : 'SIGN IN TO RIP'}</div>
              </div>
            </div>
          </>
        )}

        {phase === 'ripping' && (
          <div className="pack-wrap ripping">
            <div className="pack-foil">
              <div className="pl">{PACK_TYPES[packType].icon}</div>
              <div className="pt">Opening...</div>
            </div>
          </div>
        )}

        {phase === 'reveal' && (
          <>
            <div className={`hit-banner ${hitText ? 'on' : ''}`}>{hitText}</div>
            <div className="pack-reveal on">
              {packCards.map((c, idx) => {
                const isFlipped = flipped.has(idx);
                const isHit = c.market >= 1500;
                const theme = c.theme || ['#2a2a2a', '#555'];
                return (
                  <div key={idx} className={`pcard ${isFlipped ? 'flip' : ''} ${isFlipped && isHit ? 'hit' : ''}`}
                    onClick={() => !isFlipped ? flipCard(idx) : setSelectedCard(c)}>
                    <div className="pcard-inner">
                      {/* Logo back — shows BEFORE flip */}
                      <div className="face pf-back" style={{ flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontFamily: 'var(--disp)', fontSize: 28, fontWeight: 800, letterSpacing: 2, color: 'var(--gold)' }}>GEM<span style={{ color: '#fff' }}>LINE</span></span>
                        <span style={{ fontSize: 8, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,.3)' }}>The Card Exchange</span>
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,.2)', marginTop: 8 }}>TAP TO REVEAL</span>
                      </div>
                      {/* Card front — reveals AFTER flip */}
                      <div className="face pf-front" style={{ '--cardbg': `linear-gradient(135deg,${theme[0]},${theme[1]})` }}>
                        {c.thumbnail && (
                          <img src={c.thumbnail} alt="" style={{
                            position: 'absolute', inset: 0, width: '100%', height: '100%',
                            objectFit: 'contain', zIndex: 1, borderRadius: 9,
                          }} />
                        )}
                        {isHit && <div className="foil2" />}
                        {/* Pin button — top right corner */}
                        <button
                          onClick={e => { e.stopPropagation(); toggleWatch(c.id); }}
                          style={{
                            position: 'absolute', top: 6, right: 6, zIndex: 10,
                            width: 28, height: 28, borderRadius: 6,
                            background: watch.has(String(c.id)) ? 'var(--gold)' : 'rgba(0,0,0,.55)',
                            border: '1px solid rgba(255,255,255,.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', backdropFilter: 'blur(4px)',
                          }}>
                          <svg width="13" height="13" viewBox="0 0 24 24"
                            fill={watch.has(String(c.id)) ? '#000' : 'none'}
                            stroke={watch.has(String(c.id)) ? '#000' : '#fff'} strokeWidth="2">
                            <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.7 0-3 .9-4 2-1-1.1-2.3-2-4-2A5.5 5.5 0 0 0 3 8.5c0 2.3 1.5 4 3 5.5l6 6Z" />
                          </svg>
                        </button>
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
              <button className="btn-ghost" onClick={() => { setPhase('pick'); setShowConfetti(false); setHitText(''); }}>
                Rip another
              </button>
            </div>
          </>
        )}
      </div>

      {/* Pack tier examples for non-logged-in users */}
      {!user && (
        <div style={{ marginTop: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>What's inside?</div>
          <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 20, marginBottom: 20 }}>Three tiers of packs, real cards inside</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
            {/* Standard example */}
            <div className="panel" style={{ overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(135deg, #1a1d28, #252838)', padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>G</div>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 16 }}>Standard Pack</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>6 random cards · ◈ 15 credits</div>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 12, marginBottom: 8, color: 'var(--muted)' }}>Example pull:</div>
                {[
                  { n: 'Jaylen Brown', g: 'PSA 9', p: '$34', cls: '' },
                  { n: 'Bobby Witt Jr', g: 'RAW', p: '$12', cls: '' },
                  { n: 'Chet Holmgren', g: 'SGC 10', p: '$18', cls: '' },
                ].map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                    <span>{c.n} <span style={{ color: 'var(--dim)', fontSize: 11 }}>{c.g}</span></span>
                    <span className="mono">{c.p}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Premium example */}
            <div className="panel" style={{ overflow: 'hidden', border: '1px solid rgba(232,179,57,.3)' }}>
              <div style={{ background: 'linear-gradient(135deg, #2a1f0a, #3d2e10)', padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, color: 'var(--gold)', marginBottom: 6 }}>★</div>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 16 }}>Premium Pack</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)' }}>Guaranteed $50+ hit · ◈ 30 credits</div>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 12, marginBottom: 8, color: 'var(--muted)' }}>Example pull:</div>
                {[
                  { n: 'Luka Dončić', g: 'PSA 10', p: '$94', cls: 'tier-uncommon' },
                  { n: 'Justin Herbert', g: 'BGS 9.5', p: '$67', cls: '' },
                  { n: 'Victor Wembanyama', g: 'PSA 9', p: '$185', cls: 'tier-rare', hit: true },
                ].map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                    <span>{c.hit && '⚡ '}{c.n} <span style={{ color: 'var(--dim)', fontSize: 11 }}>{c.g}</span></span>
                    <span className="mono" style={c.hit ? { color: 'var(--gold)', fontWeight: 700 } : {}}>{c.p}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Elite example */}
            <div className="panel" style={{ overflow: 'hidden', border: '1px solid rgba(185,242,255,.3)' }}>
              <div style={{ background: 'linear-gradient(135deg, #0a1a2a, #162840)', padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, color: '#B9F2FF', marginBottom: 6 }}>◆</div>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 16, color: '#B9F2FF' }}>Elite Pack</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#B9F2FF' }}>2+ hits, 9 cards · ◈ 75 credits</div>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 12, marginBottom: 8, color: 'var(--muted)' }}>Example pull:</div>
                {[
                  { n: 'LeBron James', g: 'PSA 10', p: '$1,240', hit: true, big: true },
                  { n: 'Shohei Ohtani', g: 'BGS 9.5', p: '$312', hit: true },
                  { n: 'Patrick Mahomes', g: 'PSA 10', p: '$156', cls: '' },
                ].map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                    <span>{c.big ? '🔥 ' : c.hit ? '⚡ ' : ''}{c.n} <span style={{ color: 'var(--dim)', fontSize: 11 }}>{c.g}</span></span>
                    <span className="mono" style={c.big ? { color: '#FF5C6C', fontWeight: 700 } : c.hit ? { color: 'var(--gold)', fontWeight: 700 } : {}}>{c.p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Profile showcase preview */}
          <div className="panel" style={{ padding: 20, maxWidth: 500, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, var(--gold), #d4a12a)', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 800, color: '#000' }}>R</div>
              <div>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15 }}>@rhett</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>12 pulls · 3 hits · 2 showcased</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Showcase</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { n: 'Wemby', c: '#7b4dd6', hit: true },
                { n: 'Ohtani', c: '#c04373' },
                { n: 'Luka', c: '#3a6ea5' },
                { n: 'Griffey', c: '#2f8f5b' },
              ].map((c, i) => (
                <div key={i} style={{
                  background: `linear-gradient(135deg, ${c.c}, ${c.c}88)`,
                  borderRadius: 8, height: 70, display: 'grid', placeItems: 'center',
                  fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.7)',
                  border: c.hit ? '1px solid var(--gold)' : '1px solid var(--line)',
                  boxShadow: c.hit ? '0 0 12px rgba(232,179,57,.3)' : 'none',
                }}>{c.n}</div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: 'var(--dim)' }}>
              Your hits appear on your public profile with tier effects
            </div>
          </div>
        </div>
      )}

      {/* Collection section */}
      {user && (
        <div style={{ marginTop: 48 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>My Collection</div>
          <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Cards from Packs</h3>
          <p className="sub" style={{ marginBottom: 16 }}>Your digital collection from pack rips. Hits glow with a foil effect.</p>

          {loadingCollection ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>Loading collection...</div>
          ) : collection.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <p style={{ fontSize: 15, marginBottom: 4 }}>No pulls yet</p>
              <p style={{ fontSize: 13 }}>Rip a pack above to start your collection</p>
            </div>
          ) : (
            <div className="grid" style={{ gap: 12 }}>
              {collection.map((pull, i) => {
                const isHit = (pull.market || pull.catalog_price || 0) >= 1500;
                return (
                  <div key={pull.id || i} className={`card ${isHit ? 'hit' : ''}`}
                    onClick={() => setSelectedCard(pull)}
                    style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
                    {isHit && <div className="foil2" style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }} />}
                    <div className="slab" style={{
                      background: pull.thumbnail || pull.ebay_thumb
                        ? `url(${pull.thumbnail || pull.ebay_thumb}) center/contain no-repeat`
                        : `linear-gradient(135deg, ${(SPORT_THEME[pull.sport] || ['#2a2a2a', '#555'])[0]}, ${(SPORT_THEME[pull.sport] || ['#2a2a2a', '#555'])[1]})`,
                      height: 140,
                    }} />
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{pull.player}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11 }}>{pull.grader} {pull.grade} · {pull.card_set || pull.set}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)', marginTop: 4 }}>
                        {fmtP(pull.market || pull.catalog_price)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>
                        {pull.pack_type} · {new Date(pull.pulled_at).toLocaleDateString()}
                      </div>
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
