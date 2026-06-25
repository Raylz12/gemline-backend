'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const HERO_CARDS = [
  { grader: 'PSA 10', set: 'Topps Chrome', name: 'Cooper Flagg', variant: '2025 Basketball', price: '$268', bg: '#1a1040', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1766714753053x119226404538868900/resize' },
  { grader: 'PSA 10', set: 'Topps Chrome', name: 'V. Wembanyama', variant: '2023 Basketball', price: '$483', bg: '#0d1a2e', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780201684415x613734703719177000/resize' },
  { grader: 'PSA 10', set: 'Bowman', name: 'Shohei Ohtani', variant: '2018 Baseball RC', price: '$760', bg: '#1a0d0d', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721089050927x363050362695842370/crop_image' },
  { grader: 'PSA 10', set: 'Pokémon', name: 'Mega Gengar EX', variant: '2026 Ascended Heroes', price: '$343', bg: '#1a0d2a', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1771045490872x640532286138891500/resize' },
  { grader: 'PSA 10', set: 'Topps Chrome', name: 'Jaxson Dart', variant: '2025 Football', price: '$96', bg: '#0d1a1a', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776173374828x379438362063353500/resize' },
  { grader: 'PSA 10', set: 'Pokémon', name: 'Articuno', variant: '2025 Journey Together', price: '$310', bg: '#0d1a2a', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1743308840944x685090135713223800/crop_image' },
];

const FEATURES = [
  { icon: '🛒', title: 'Marketplace', desc: 'Buy now, make offers, or bid — every listing scored against live comps.', target: '/market' },
  { icon: '📈', title: 'Arbitrage engine', desc: 'Price spreads, gainers, losers, volume movers — real-time data.', target: '/analytics' },
  { icon: '🗺️', title: 'Live heatmap', desc: 'See the entire market at a glance. Green rising, red falling.', target: '/analytics' },
  { icon: '🔄', title: 'Peer trading', desc: 'Trade cards directly. Fair-value meter shows who\'s winning.', target: '/community' },
  { icon: '🎴', title: 'Pack rips', desc: 'Rip virtual packs, collect hits, show them off on your profile.', target: '/live' },
  { icon: '🔍', title: 'AI Scout', desc: 'Ask anything — the AI searches the entire catalog for matches.', target: '/market' },
];

export default function Landing() {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const [idx, setIdx] = useState(0);
  const [tiltX, setTiltX] = useState(0);
  const [tiltY, setTiltY] = useState(0);
  const [glareX, setGlareX] = useState(50);
  const [glareY, setGlareY] = useState(50);
  const touchStart = useRef(null);
  const autoTimer = useRef(null);

  const card = HERO_CARDS[idx];

  // Auto-cycle every 4 seconds
  useEffect(() => {
    autoTimer.current = setInterval(() => setIdx(i => (i + 1) % HERO_CARDS.length), 4000);
    return () => clearInterval(autoTimer.current);
  }, []);

  const goTo = useCallback((next) => {
    clearInterval(autoTimer.current);
    setIdx(next);
    autoTimer.current = setInterval(() => setIdx(i => (i + 1) % HERO_CARDS.length), 4000);
  }, []);

  // Touch swipe
  const onTouchStart = (e) => { touchStart.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStart.current === null) return;
    const diff = touchStart.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      goTo(diff > 0 ? (idx + 1) % HERO_CARDS.length : (idx - 1 + HERO_CARDS.length) % HERO_CARDS.length);
    }
    touchStart.current = null;
  };

  // Mouse tilt for holographic effect (desktop)
  const onPointerMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setTiltX((y - 0.5) * -25);
    setTiltY((x - 0.5) * 25);
    setGlareX(x * 100);
    setGlareY(y * 100);
  };
  const onPointerLeave = () => { setTiltX(0); setTiltY(0); setGlareX(50); setGlareY(50); };

  const enter = (target) => {
    setGone(true);
    setTimeout(() => { router.push(target || '/market'); }, 650);
  };

  // Intersection observer for reveal animations
  useEffect(() => {
    const els = document.querySelectorAll('#landing .reveal');
    const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) x.target.classList.add('in'); }), { threshold: 0.12 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div id="landing" className={gone ? 'gone' : ''}>
      <div className="lp-in">
        <div className="lp-nav">
          <div className="brand">
            <div className="logo">G</div>
            <div><div className="wordmark">GEM<span>LINE</span></div><div className="tagline">THE CARD EXCHANGE</div></div>
          </div>
          <button className="lp-enter-link" onClick={() => enter('/market')}>
            Enter the exchange
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>

        <section className="lp-hero">
          <div className="lp-copy">
            <span className="lp-badge"><span className="d"></span>Tens of thousands of cards · every grade · every sport</span>
            <h1 className="lp-h1">Buy · Sell · Trade.<br /><span className="accent">The Card Exchange.</span></h1>
            <p className="lp-sub">Every major sport, Pokémon, and more — priced live with real market data. AI-powered search, real-time arbitrage, virtual pack rips, and a full exchange built for collectors.</p>
            <div className="lp-cta">
              <button className="btn-xl primary" onClick={() => enter('/market')}>
                Enter the exchange
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
              <button className="btn-xl ghost" onClick={() => enter('/arbitrage')}>See the arbitrage engine</button>
            </div>
          </div>

          {/* Glassmorphism NFT Card Carousel */}
          <div className="nft-stage"
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}>
            
            {/* Ambient glow behind card */}
            <div className="nft-glow" style={{ background: card.bg }} />
            
            <div className="nft-card"
              style={{
                transform: `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
              }}>
              <div className="nft-glass">
                {/* Slab image */}
                <div className="nft-slab">
                  <img
                    key={idx}
                    src={card.image}
                    alt={card.name}
                    className="nft-card-img"
                    onError={e => { e.target.style.opacity = '0'; }}
                  />
                </div>
                
                {/* Glass info bar at bottom */}
                <div className="nft-info-bar">
                  <div className="nft-info-left">
                    <div className="nft-card-name">{card.name}</div>
                    <div className="nft-card-variant">{card.grader} · {card.variant}</div>
                  </div>
                  <div className="nft-info-price">{card.price}</div>
                </div>
                
                {/* Holographic overlays */}
                <div className="nft-holo" style={{
                  background: `radial-gradient(circle at ${glareX}% ${glareY}%, 
                    rgba(255,255,255,.2) 0%, 
                    rgba(232,179,57,.1) 25%, 
                    rgba(100,200,255,.08) 50%, 
                    rgba(200,100,255,.08) 75%, 
                    transparent 100%)`,
                }} />
                <div className="nft-glare" style={{
                  background: `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,.3) 0%, transparent 55%)`,
                }} />
                <div className="nft-rainbow" />
              </div>
            </div>
            
            {/* Dots + hint */}
            <div className="nft-dots">
              {HERO_CARDS.map((_, i) => (
                <button key={i} className={`nft-dot ${i === idx ? 'on' : ''}`} onClick={() => goTo(i)} />
              ))}
            </div>
            <p className="nft-hint">← Swipe to browse →</p>
          </div>
        </section>

        <section className="lp-features">
          <div className="lp-sec-head reveal">
            <div className="eyebrow">One exchange, every tool</div>
            <h2>Built like a trading desk</h2>
          </div>
          <div className="lp-feat-grid">
            {FEATURES.map((f, i) => (
              <div key={i} className="lp-feat reveal" onClick={() => enter(f.target)}>
                <div className="ic"><span style={{ fontSize: 20 }}>{f.icon}</span></div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Profile Showcase */}
        <section className="lp-profile reveal" style={{ margin: '0 auto 40px', maxWidth: 900 }}>
          <div className="lp-sec-head reveal" style={{ marginBottom: 24 }}>
            <div className="eyebrow">Your collector profile</div>
            <h2>Show off your collection</h2>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
            {/* Profile Card */}
            <div className="lp-profile-card" style={{
              background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16,
              padding: '24px 20px', textAlign: 'center',
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px',
                background: 'linear-gradient(135deg, var(--gold), #c89b2a)',
                display: 'grid', placeItems: 'center', fontSize: 28, fontWeight: 800,
                fontFamily: 'var(--disp)', color: '#000',
              }}>R</div>
              <div style={{ fontFamily: 'var(--disp)', fontSize: 20, fontWeight: 700 }}>@rhett</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Collector since 2026</div>
              
              {/* Badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', margin: '16px 0' }}>
                {[
                  { name: 'Early Adopter', icon: '⭐', tier: 'gold' },
                  { name: 'Whale', icon: '🐋', tier: 'gold' },
                  { name: 'First Trade', icon: '🤝', tier: 'bronze' },
                  { name: 'Pack Addict', icon: '🎰', tier: 'silver' },
                  { name: 'OG', icon: '💎', tier: 'diamond' },
                ].map((b, i) => (
                  <span key={i} style={{
                    fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
                    padding: '4px 8px', borderRadius: 6, letterSpacing: '.03em',
                    background: b.tier === 'diamond' ? 'rgba(185,242,255,.12)' : 
                               b.tier === 'gold' ? 'rgba(232,179,57,.12)' :
                               b.tier === 'silver' ? 'rgba(192,192,192,.12)' : 'rgba(205,127,50,.12)',
                    color: b.tier === 'diamond' ? '#B9F2FF' :
                           b.tier === 'gold' ? '#E8B339' :
                           b.tier === 'silver' ? '#C0C0C0' : '#CD7F32',
                    border: `1px solid ${b.tier === 'diamond' ? 'rgba(185,242,255,.2)' :
                             b.tier === 'gold' ? 'rgba(232,179,57,.2)' :
                             b.tier === 'silver' ? 'rgba(192,192,192,.2)' : 'rgba(205,127,50,.2)'}`,
                  }}>
                    {b.icon} {b.name}
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 20, fontSize: 12, color: 'var(--muted)' }}>
                <div><span style={{ fontWeight: 700, color: 'var(--txt)', fontSize: 16, fontFamily: 'var(--mono)' }}>47</span><br/>Cards</div>
                <div><span style={{ fontWeight: 700, color: 'var(--txt)', fontSize: 16, fontFamily: 'var(--mono)' }}>$12.4K</span><br/>Value</div>
                <div><span style={{ fontWeight: 700, color: 'var(--txt)', fontSize: 16, fontFamily: 'var(--mono)' }}>8</span><br/>Trades</div>
              </div>
            </div>

            {/* Card Collections */}
            <div>
              {/* Physical Cards Section */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>🏆</span>
                  <h3 style={{ fontFamily: 'var(--disp)', fontSize: 16, fontWeight: 700, margin: 0 }}>Physical Collection</h3>
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', padding: '2px 8px', background: 'var(--panel)', borderRadius: 4 }}>12 cards</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    { name: 'Wembanyama', tier: 'mythic', img: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780201684415x613734703719177000/resize' },
                    { name: 'Ohtani', tier: 'legendary', img: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721089050927x363050362695842370/crop_image' },
                    { name: 'Flagg', tier: 'epic', img: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1766714753053x119226404538868900/resize' },
                    { name: 'Gengar EX', tier: 'rare', img: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1771045490872x640532286138891500/resize' },
                  ].map((c, i) => (
                    <div key={i} className={`tier-${c.tier}`} style={{
                      borderRadius: 10, overflow: 'hidden', position: 'relative',
                      background: 'var(--panel)', border: '1px solid var(--line)',
                      aspectRatio: '2.5/3.5',
                    }}>
                      <img src={c.img} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }} />
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 6px',
                        background: 'linear-gradient(transparent, rgba(0,0,0,.8))',
                        fontSize: 9, fontWeight: 700, fontFamily: 'var(--mono)', color: '#fff',
                      }}>{c.name}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Digital / Pack Pulls Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>🎴</span>
                  <h3 style={{ fontFamily: 'var(--disp)', fontSize: 16, fontWeight: 700, margin: 0 }}>Virtual Pulls</h3>
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', padding: '2px 8px', background: 'var(--panel)', borderRadius: 4 }}>6 hits</span>
                  <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--violet, #9b7bff)', padding: '2px 8px', background: 'rgba(155,123,255,.1)', borderRadius: 4 }}>FROM PACKS</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    { name: 'Articuno', tier: 'epic', img: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1743308840944x685090135713223800/crop_image' },
                    { name: 'Dart', tier: 'rare', img: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776173374828x379438362063353500/resize' },
                    { name: 'LeBron', tier: 'uncommon', img: 'https://i.ebayimg.com/images/g/oaYAAeSwd2NqNhxN/s-l500.webp' },
                    { name: 'Griffey', tier: 'common', img: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720253347400x475058474277705100/crop_image' },
                  ].map((c, i) => (
                    <div key={i} className={`tier-${c.tier}`} style={{
                      borderRadius: 10, overflow: 'hidden', position: 'relative',
                      background: 'var(--panel)', border: '1px solid var(--line)',
                      aspectRatio: '2.5/3.5',
                    }}>
                      <img src={c.img} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }} />
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 6px',
                        background: 'linear-gradient(transparent, rgba(0,0,0,.8))',
                        fontSize: 9, fontWeight: 700, fontFamily: 'var(--mono)', color: '#fff',
                      }}>{c.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-signup reveal" style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--panel)', borderRadius: 18, border: '1px solid var(--line)', margin: '0 auto 40px', maxWidth: 700 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔥</div>
          <h2 style={{ fontFamily: 'var(--disp)', fontSize: 28, fontWeight: 800 }}>Join the exchange</h2>
          <p style={{ color: 'var(--muted)', maxWidth: 440, margin: '8px auto 24px', fontSize: 14, lineHeight: 1.6 }}>
            Create a free account to build your portfolio, propose trades, and list cards for sale. Takes 30 seconds.
          </p>
          <button className="btn-xl primary" onClick={() => enter('/market')}>
            Create your free account
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--dim)' }}>No credit card required · Tens of thousands of cards priced live</div>
        </section>

        <section className="lp-closer reveal">
          <h2>See the spread. Trade the edge.</h2>
          <p>Step onto the floor and watch the whole card market move in real time.</p>
          <button className="btn-xl primary" onClick={() => enter('/market')}>
            Enter the exchange
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </section>
        <div className="lp-foot">GEMLINE — The Card Exchange. Prices powered by Card Hedge.</div>
      </div>
    </div>
  );
}
