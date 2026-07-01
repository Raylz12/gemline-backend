'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const SPORTS = [
  { label: 'Basketball', emoji: '🏀', sport: 'Basketball' },
  { label: 'Baseball', emoji: '⚾', sport: 'Baseball' },
  { label: 'Football', emoji: '🏈', sport: 'Football' },
  { label: 'Pokemon', emoji: '🃏', sport: 'Pokemon' },
  { label: 'Hockey', emoji: '🏒', sport: 'Hockey' },
  { label: 'Soccer', emoji: '⚽', sport: 'Soccer' },
];

function fmt(n) {
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + Number(n).toFixed(2);
}

function LiveStatBar() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch('/api/stats/live').then(r => r.json()).then(setStats).catch(() => {});
    const t = setInterval(() => {
      fetch('/api/stats/live').then(r => r.json()).then(setStats).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, []);
  const items = [
    ['287,000+', 'Cards'],
    [stats?.active_listings ?? '—', 'Active Listings'],
    [stats?.trades_this_week ?? '—', 'Trades This Week'],
    [stats?.total_users ?? '—', 'Collectors'],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, background: 'rgba(22,199,132,.06)', border: '1px solid rgba(22,199,132,.15)', borderRadius: 10, overflow: 'hidden', marginTop: 24 }}>
      {items.map(([val, label], i) => (
        <div key={i} style={{ flex: '1 1 120px', padding: '12px 16px', borderRight: i < items.length - 1 ? '1px solid rgba(22,199,132,.1)' : 'none', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: 18, color: 'var(--gold)' }}>{val?.toLocaleString?.() ?? val}</div>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function LiveMovers() {
  const [movers, setMovers] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  useEffect(() => {
    const load = () => fetch('/api/market/movers?limit=5').then(r => r.json()).then(d => { setMovers(d.movers || []); setLastUpdated(new Date()); }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  const sportEmoji = (s) => ({ Basketball: '🏀', Baseball: '⚾', Football: '🏈', Pokemon: '🃏', Hockey: '🏒', Soccer: '⚽' }[s] || '🃏');
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15 }}>Today\'s Biggest Movers</div>
        {lastUpdated && <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>Updated {lastUpdated.toLocaleTimeString()}</div>}
      </div>
      {movers.length === 0 ? (
        <div style={{ color: 'var(--dim)', fontSize: 12, padding: '12px 0' }}>Loading market data...</div>
      ) : movers.map((m, i) => {
        const pct = m.pct_change;
        const isUp = pct >= 0;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < movers.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <span style={{ fontSize: 20 }}>{sportEmoji(m.sport)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.player}</div>
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 1 }}>{m.grader} {m.grade}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color: 'var(--gold)' }}>{fmt(m.catalog_price)}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: isUp ? 'var(--up)' : 'var(--down)', marginTop: 1 }}>
                {isUp ? '+' : ''}{pct != null ? pct.toFixed(1) + '%' : 'N/A'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CommunityPreview() {
  const [posts, setPosts] = useState([]);
  useEffect(() => {
    fetch('/api/posts/feed?limit=3').then(r => r.json()).then(d => setPosts(d.posts || [])).catch(() => {});
  }, []);
  const TYPE_COLOR = { pull: 'var(--gold)', trade: '#60a5fa', sale: 'var(--up)' };
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15, marginBottom: 14 }}>From the Community</div>
      {posts.length === 0 ? (
        <div style={{ color: 'var(--dim)', fontSize: 12, padding: '12px 0' }}>Be the first to post a pull! 🃏</div>
      ) : posts.map((p, i) => (
        <div key={p.id} style={{ padding: '10px 0', borderBottom: i < posts.length - 1 ? '1px solid var(--line)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#16c784, #0d9463)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: '#000', flexShrink: 0 }}>
              {(p.handle || 'G')[0].toUpperCase()}
            </div>
            <span style={{ fontWeight: 600, fontSize: 12 }}>@{p.handle}</span>
            <span style={{ fontSize: 10, color: TYPE_COLOR[p.type] || 'var(--dim)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>{p.type}</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.body}</p>
        </div>
      ))}
      <Link href="/community" style={{ display: 'block', marginTop: 14, fontSize: 12, color: 'var(--gold)', textDecoration: 'none', fontWeight: 600 }}>Join the conversation →</Link>
    </div>
  );
}

function StoreSpotlight() {
  const [stores, setStores] = useState([]);
  useEffect(() => {
    fetch('/api/stores?limit=4').then(r => r.json()).then(d => setStores(d.stores || [])).catch(() => {});
  }, []);
  if (stores.length === 0) return null;
  return (
    <section style={{ margin: '40px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="eyebrow">Verified Dealers</div>
          <h2 style={{ fontFamily: 'var(--disp)', fontSize: 22, fontWeight: 800, margin: 0 }}>Shop from Real Stores</h2>
        </div>
        <Link href="/stores" style={{ fontSize: 13, color: 'var(--gold)', textDecoration: 'none', fontWeight: 600 }}>Browse all stores →</Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {stores.map(s => (
          <Link key={s.id} href={`/store/${s.handle}`} style={{ textDecoration: 'none' }}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', transition: 'border-color .15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{s.store_name || s.handle}</div>
              {s.store_location && <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 6 }}>📍 {s.store_location}</div>}
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{Number(s.listing_count) || 0} listings</div>
              {s.store_verified && <div style={{ fontSize: 10, color: 'var(--gold)', marginTop: 4 }}>✓ Verified</div>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

const HERO_CARDS = [
  { grader: 'PSA 10', set: 'Topps Chrome', name: 'Cooper Flagg', variant: '2025 Basketball', price: '$268', bg: '#1a1040', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1766714753053x119226404538868900/resize' },
  { grader: 'PSA 10', set: 'Topps Chrome', name: 'V. Wembanyama', variant: '2023 Basketball', price: '$483', bg: '#0d1a2e', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780201684415x613734703719177000/resize' },
  { grader: 'PSA 10', set: 'Bowman', name: 'Shohei Ohtani', variant: '2018 Baseball RC', price: '$760', bg: '#1a0d0d', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721089050927x363050362695842370/crop_image' },
  { grader: 'PSA 10', set: 'Pokémon', name: 'Mega Gengar EX', variant: '2026 Ascended Heroes', price: '$343', bg: '#1a0d2a', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1771045490872x640532286138891500/resize' },
  { grader: 'PSA 10', set: 'Topps Chrome', name: 'Jaxson Dart', variant: '2025 Football', price: '$96', bg: '#0d1a1a', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776173374828x379438362063353500/resize' },
  { grader: 'PSA 10', set: 'Pokémon', name: 'Articuno', variant: '2025 Journey Together', price: '$310', bg: '#0d1a2a', image: 'https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1743308840944x685090135713223800/crop_image' },
];

const FEATURES = [
  { icon: '01', title: 'Marketplace', desc: 'Buy now, make offers, or bid — every listing scored against live comps.', target: '/market' },
  { icon: '02', title: 'Arbitrage engine', desc: 'Price spreads, gainers, losers, volume movers — real-time data.', target: '/analytics' },
  { icon: '03', title: 'Live heatmap', desc: 'See the entire market at a glance. Green rising, red falling.', target: '/analytics' },
  { icon: '04', title: 'Peer trading', desc: 'Trade cards directly. Fair-value meter shows who\'s winning.', target: '/community' },
  { icon: '05', title: 'Pack rips', desc: 'Rip virtual packs, collect hits, show them off on your profile.', target: '/live' },
  { icon: '06', title: 'AI Scout', desc: 'Ask anything — the AI searches the entire catalog for matches.', target: '/market' },
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
            <div><div className="wordmark">GEM<span>LINE</span></div><div className="tagline">BY COLLECTORS, FOR COLLECTORS</div></div>
          </div>
          <button className="lp-enter-link" onClick={() => enter('/market')}>
            Enter the exchange
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>

        <section className="lp-hero">
          <div className="lp-copy">
            <span className="lp-badge"><span className="d"></span>Tens of thousands of cards · every grade · every sport</span>
            <h1 className="lp-h1">The Card Show,<br /><span className="accent">Online.</span></h1>
            <p className="lp-sub">Bring cards from anywhere — your collection, eBay grabs, your local shop. List, trade, and connect with collectors who actually get it. By collectors, for collectors.</p>
            <div className="lp-cta">
              <button className="btn-xl primary" onClick={() => enter('/market')}>
                Enter the exchange
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
              <button className="btn-xl ghost" onClick={() => enter('/sell')}>List Your Cards</button>
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
                    rgba(22,199,132,.1) 25%, 
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
                  { name: 'Early Adopter', icon: '', tier: 'gold' },
                  { name: 'Whale', icon: '🐋', tier: 'gold' },
                  { name: 'First Trade', icon: '', tier: 'bronze' },
                  { name: 'Pack Addict', icon: '🎰', tier: 'silver' },
                  { name: 'OG', icon: '', tier: 'diamond' },
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
                  <span style={{ fontSize: 16 }}></span>
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

        {/* ── Live Stat Bar ── */}
        <LiveStatBar />

        {/* ── Live Market Data + Community ── */}
        <section style={{ margin: '48px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div className="eyebrow">Live Market</div>
              <h2 style={{ fontFamily: 'var(--disp)', fontSize: 22, fontWeight: 800, margin: 0 }}>What\'s Moving Right Now</h2>
            </div>
          </div>
          <div className="lp-live-grid">
            <LiveMovers />
            <CommunityPreview />
          </div>
        </section>

        {/* ── Store Spotlight ── */}
        <StoreSpotlight />

        {/* ── How It Works ── */}
        <section style={{ margin: '48px 0' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div className="eyebrow">The Swap Meet</div>
            <h2 style={{ fontFamily: 'var(--disp)', fontSize: 24, fontWeight: 800 }}>Simple as a card show</h2>
            <p style={{ color: 'var(--muted)', maxWidth: 480, margin: '8px auto 0', fontSize: 14 }}>Bring cards from anywhere — your collection, eBay grabs, your LCS, or the mail. List, trade, and get paid.</p>
          </div>
          <div className="lp-hiw-grid">
            {[
              { step: '01', icon: '📦', title: 'Bring Your Cards', desc: 'From any source — your collection, eBay, local shop, card shows. If you own it, list it here.' },
              { step: '02', icon: '🔄', title: 'List or Trade', desc: 'Set your price, make a trade offer, or drop it in a live auction. You\'re in control.' },
              { step: '03', icon: '💰', title: 'Get Paid', desc: 'Secure payments via Stripe. Funds released when the buyer confirms. Real cards, real money.' },
            ].map(({ step, icon, title, desc }) => (
              <div key={step} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '24px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginBottom: 6, letterSpacing: '.1em' }}>STEP {step}</div>
                <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{title}</div>
                <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Sport Quick Links ── */}
        <section style={{ margin: '32px 0' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {SPORTS.map(({ label, emoji, sport }) => (
              <Link key={sport} href={`/market?sport=${sport}`} style={{ textDecoration: 'none' }}>
                <div style={{ padding: '10px 18px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 24, fontSize: 13, fontWeight: 600, color: 'var(--txt)', cursor: 'pointer', transition: 'border-color .15s, color .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--txt)'; }}
                >
                  {emoji} {label}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="lp-signup reveal" style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--panel)', borderRadius: 18, border: '1px solid var(--line)', margin: '0 auto 40px', maxWidth: 700 }}>
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
