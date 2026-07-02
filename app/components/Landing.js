'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { IconPackage, IconSwap, IconDollar, IconCheck, IconZap } from './Icons';
import Footer from './Footer';

/* ── helpers ─────────────────────────────────────────────────────────────── */
function fmtPrice(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return '$' + Math.round(v).toLocaleString();
  if (v >= 100) return '$' + Math.round(v);
  return '$' + v.toFixed(2);
}
const gradeLabel = (c) => {
  const g = (c.grader || 'RAW').toUpperCase();
  return g === 'RAW' ? 'RAW' : `${g} ${c.grade || ''}`.trim();
};
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Count-up for the live card total */
function useCountUp(target, duration = 1600) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!target) return;
    if (reducedMotion()) { setVal(target); return; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

/* ── hero card stack — live trending cards ───────────────────────────────── */
function HeroStack({ cards, onOpen }) {
  const [idx, setIdx] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [glare, setGlare] = useState({ x: 50, y: 50 });
  const touchStart = useRef(null);
  const timer = useRef(null);

  const n = cards.length;
  const card = n ? cards[idx % n] : null;

  useEffect(() => {
    if (n < 2 || reducedMotion()) return;
    timer.current = setInterval(() => setIdx(i => (i + 1) % n), 4500);
    return () => clearInterval(timer.current);
  }, [n]);

  const goTo = useCallback((next) => {
    clearInterval(timer.current);
    setIdx(next);
    if (n > 1 && !reducedMotion())
      timer.current = setInterval(() => setIdx(i => (i + 1) % n), 4500);
  }, [n]);

  const onTouchStart = (e) => { touchStart.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStart.current === null || !n) return;
    const diff = touchStart.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) goTo(diff > 0 ? (idx + 1) % n : (idx - 1 + n) % n);
    touchStart.current = null;
  };
  const onPointerMove = (e) => {
    if (reducedMotion()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    setTilt({ x: (y - 0.5) * -22, y: (x - 0.5) * 22 });
    setGlare({ x: x * 100, y: y * 100 });
  };
  const onPointerLeave = () => { setTilt({ x: 0, y: 0 }); setGlare({ x: 50, y: 50 }); };

  if (!card) {
    return (
      <div className="nft-stage">
        <div className="nft-card"><div className="nft-glass lp-skel" /></div>
      </div>
    );
  }

  const up = (Number(card.gain7d) || 0) >= 0;
  const behind = n > 2 ? [cards[(idx + 1) % n], cards[(idx + 2) % n]] : [];

  return (
    <div className="nft-stage"
      onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="nft-glow" style={{ background: up ? 'rgba(22,199,132,.5)' : 'rgba(239,68,68,.4)' }} />
      {behind.map((b, i) => (
        <div key={`b${i}`} className={`nft-back b${i + 1}`} aria-hidden="true">
          {b.thumbnail && <img src={b.thumbnail} alt="" loading="lazy" />}
        </div>
      ))}
      <div className="nft-card"
        role="button" tabIndex={0} aria-label={`${card.player} — view card`}
        onClick={() => onOpen(`/card/${card.cardId}`)}
        onKeyDown={e => { if (e.key === 'Enter') onOpen(`/card/${card.cardId}`); }}
        style={{ transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}>
        <div className="nft-glass">
          <div className="nft-slab">
            <img key={card.cardId} src={card.thumbnail} alt={card.player} className="nft-card-img"
              onError={e => { e.target.style.opacity = '0'; }} />
          </div>
          <div className="nft-info-bar">
            <div className="nft-info-left">
              <div className="nft-card-name">{card.player}</div>
              <div className="nft-card-variant">{gradeLabel(card)}{'\u2002'}{card.year || ''} {card.sport || ''}</div>
            </div>
            <div className="nft-info-right">
              <div className="nft-info-price">{fmtPrice(card.marketPrice)}</div>
              <div className={`lp-delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(Number(card.gain7d) || 0).toFixed(1)}% 7D</div>
            </div>
          </div>
          <div className="nft-holo" style={{
            background: `radial-gradient(circle at ${glare.x}% ${glare.y}%,
              rgba(255,255,255,.18) 0%, rgba(22,199,132,.12) 30%, rgba(120,170,255,.07) 60%, transparent 100%)`,
          }} />
          <div className="nft-glare" style={{
            background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,.28) 0%, transparent 55%)`,
          }} />
        </div>
      </div>
      <div className="nft-dots">
        {cards.map((_, i) => (
          <button key={i} className={`nft-dot ${i === idx ? 'on' : ''}`} aria-label={`Card ${i + 1}`} onClick={() => goTo(i)} />
        ))}
      </div>
      <p className="nft-hint">Tap the card for the full breakdown</p>
    </div>
  );
}

/* ── live movers grid ────────────────────────────────────────────────────── */
function MoverTile({ c, onOpen, delay }) {
  const pct = Number(c.gain7d) || 0;
  const up = pct >= 0;
  return (
    <button className={`lp-mover reveal ${up ? 'up' : 'down'}`} style={{ transitionDelay: `${delay}ms` }}
      onClick={() => onOpen(`/card/${c.cardId}`)}>
      <div className="lp-mover-img">
        <img src={c.thumbnail} alt={c.player} loading="lazy" onError={e => { e.target.style.display = 'none'; }} />
      </div>
      <div className="lp-mover-name">{c.player}</div>
      <div className="lp-mover-grade">{gradeLabel(c)}</div>
      <div className="lp-mover-row">
        <span className="lp-mover-price">{fmtPrice(c.marketPrice)}</span>
        <span className={`lp-delta big ${up ? 'up' : 'down'}`}>{up ? '+' : ''}{pct.toFixed(1)}%</span>
      </div>
    </button>
  );
}

const FEATURES = [
  { Icon: IconZap, title: 'Live prices', desc: 'Every card scored against live comps — spreads, sales, and 7-day heat, all day.', target: '/analytics' },
  { Icon: IconSwap, title: 'Real trades', desc: 'Card-for-card deals with a fair-value meter. No guesswork, no getting fleeced.', target: '/market' },
  { Icon: IconDollar, title: 'Get paid', desc: 'List in seconds. Stripe-secured payouts land when the buyer confirms.', target: '/sell' },
];

const STEPS = [
  { Icon: IconPackage, title: 'Bring your cards', desc: 'Your binder, eBay grabs, LCS pickups — if you own it, it belongs here.' },
  { Icon: IconSwap, title: 'List or trade', desc: 'Name your price, run an auction, or swap straight up.' },
  { Icon: IconDollar, title: 'Get paid', desc: 'Funds release when the buyer confirms. Real cards, real money.' },
];

/* ── landing page ────────────────────────────────────────────────────────── */
export default function Landing() {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const [heroCards, setHeroCards] = useState([]);
  const [movers, setMovers] = useState(null); // null = loading, [] = empty
  const [totalCards, setTotalCards] = useState(0);
  const counted = useCountUp(totalCards);

  const enter = useCallback((target) => {
    setGone(true);
    setTimeout(() => { router.push(target || '/market'); }, 650);
  }, [router]);

  /* Live data — never blocks first paint; skeletons until it lands.
     One feed call (top sellers by volume) powers both hero stack and movers:
     high-volume cards = recognizable names with believable 7-day moves. */
  useEffect(() => {
    fetch('/api/market/feed?limit=100&sort=sales')
      .then(r => r.json())
      .then(d => {
        const feed = d.feed || [];
        const seen = new Set();
        const hero = feed.filter(c => {
          if (!c.thumbnail || Number(c.marketPrice) < 25 || seen.has(c.player)) return false;
          seen.add(c.player);
          return true;
        }).slice(0, 5);
        setHeroCards(hero);

        const heroIds = new Set(hero.map(c => c.cardId));
        const seen2 = new Set();
        const pool = feed.filter(c => {
          const pct = Number(c.gain7d) || 0;
          if (!c.thumbnail || Number(c.marketPrice) < 15 || pct === 0 || heroIds.has(c.cardId) || seen2.has(c.player)) return false;
          seen2.add(c.player);
          return true;
        }).sort((a, b) => Math.abs(b.gain7d) - Math.abs(a.gain7d)).slice(0, 8);
        const gainers = pool.filter(c => c.gain7d > 0).sort((a, b) => b.gain7d - a.gain7d);
        const losers = pool.filter(c => c.gain7d < 0).sort((a, b) => a.gain7d - b.gain7d);
        setMovers([...gainers, ...losers]);
      }).catch(() => setMovers([]));

    fetch('/api/stats/live')
      .then(r => r.json())
      .then(d => setTotalCards(Number(d.totalCards) || 0))
      .catch(() => {});
  }, []);

  /* Scroll-reveal — landing scrolls via #landing itself, not window */
  useEffect(() => {
    const root = document.getElementById('landing');
    const io = new IntersectionObserver(
      es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }),
      { root, threshold: 0.1 }
    );
    const watch = () => root.querySelectorAll('.reveal:not(.in)').forEach(el => io.observe(el));
    watch();
    // movers render async — re-observe when they mount
    const mo = new MutationObserver(watch);
    mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
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

        {/* 1 ── HERO — the trading floor */}
        <section className="lp-hero">
          <div className="lp-copy">
            <span className="lp-badge"><span className="d"></span>
              {counted > 0 ? `${counted.toLocaleString()} cards priced live` : 'Live market · every grade · every sport'}
            </span>
            <h1 className="lp-h1">The Card Show,<br /><span className="accent">Online.</span></h1>
            <p className="lp-sub">Buy, sell, and trade real cards with collectors who get it — every deal backed by live market prices.</p>
            <div className="lp-cta">
              <button className="btn-xl primary" onClick={() => enter('/market')}>
                Enter the exchange
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
            <div className="lp-trust">
              <span><IconZap size={13} /> Live comps 24/7</span>
              <span><IconCheck size={13} /> Stripe-secured payouts</span>
              <span><IconSwap size={13} /> Trade card-for-card</span>
            </div>
          </div>
          <HeroStack cards={heroCards} onOpen={enter} />
        </section>

        {/* 2 ── LIVE MARKET PULSE */}
        <section className="lp-pulse">
          <div className="lp-sec-head reveal">
            <div className="eyebrow"><span className="lp-live-dot" />Live market pulse</div>
            <h2>The floor is moving</h2>
          </div>
          {movers === null ? (
            <div className="lp-movers">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="lp-mover lp-skel-tile"><div className="lp-skel" /></div>)}
            </div>
          ) : movers.length > 0 ? (
            <>
              <div className="lp-movers">
                {movers.map((c, i) => <MoverTile key={c.cardId} c={c} onOpen={enter} delay={(i % 4) * 70} />)}
              </div>
              <div className="lp-pulse-more reveal">
                <button onClick={() => enter('/heatmap')}>See the full heatmap →</button>
              </div>
            </>
          ) : (
            <div className="lp-pulse-more reveal">
              <button onClick={() => enter('/market')}>Browse the live market →</button>
            </div>
          )}
        </section>

        {/* 3 ── FEATURES */}
        <section className="lp-features">
          <div className="lp-sec-head reveal">
            <div className="eyebrow">The toolkit</div>
            <h2>Collector instincts, trading-desk data</h2>
          </div>
          <div className="lp-feat-grid">
            {FEATURES.map(({ Icon, title, desc, target }, i) => (
              <div key={title} className="lp-feat reveal" style={{ transitionDelay: `${i * 80}ms` }} onClick={() => enter(target)}>
                <div className="ic"><Icon size={20} /></div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 4 ── THE SWAP MEET */}
        <section className="lp-steps-wrap">
          <div className="lp-sec-head reveal">
            <div className="eyebrow">The swap meet</div>
            <h2>Simple as a card show</h2>
          </div>
          <div className="lp-steps">
            {STEPS.map(({ Icon, title, desc }, i) => (
              <div key={title} className="lp-step reveal" style={{ transitionDelay: `${i * 80}ms` }}>
                <div className="lp-step-num">0{i + 1}</div>
                <div className="lp-step-ic"><Icon size={20} /></div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 5 ── CLOSER */}
        <section className="lp-closer reveal">
          <h2>Pull up a table.</h2>
          <p>The floor never closes. Know what your cards are worth — and trade with people who love them as much as you do.</p>
          <button className="btn-xl primary" onClick={() => enter('/market')}>
            Enter the exchange
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
          <div className="lp-fine">Free account · 30 seconds · No credit card</div>
        </section>

        <Footer />
      </div>
    </div>
  );
}
