'use client';
import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import CardDetail from '../components/CardDetail';

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + n.toFixed(2);
}

function EdgeBar({ pct, max }) {
  const w = max > 0 ? Math.min((pct / max) * 100, 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className={`mono ${pct > 0 ? 'up' : 'down'}`} style={{ fontWeight: 700, fontSize: 13, minWidth: 50 }}>
        {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
      </span>
      <div style={{ flex: 1, height: 6, background: 'var(--panel-2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: pct > 10 ? '#22c55e' : pct > 5 ? '#eab308' : 'var(--dim)', borderRadius: 3, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

function SortHeader({ label, col, sortCol, sortDir, onSort }) {
  const active = sortCol === col;
  return (
    <div onClick={() => onSort(col)} style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
      {label}
      {active && <span style={{ fontSize: 10, color: 'var(--gold)' }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </div>
  );
}

export default function ArbitragePage() {
  const { token } = useAuth();
  const [cards, setCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [topMovers, setTopMovers] = useState([]);
  const [moversLoading, setMoversLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [sortCol, setSortCol] = useState('edge');
  const [sortDir, setSortDir] = useState('desc');

  // Subscription state
  const [subStatus, setSubStatus] = useState(null);
  const [subLoading, setSubLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Fetch arb-specific data: cards sorted by gain (most movement)
  useEffect(() => {
    fetch('/api/market/feed?limit=200&sort=gain')
      .then(r => r.json())
      .then(data => {
        const feed = data.feed || [];
        setCards(feed.map(c => ({
          id: c.cardId, player: c.player, sport: c.sport, set: c.set,
          grader: c.grader, grade: c.grade, year: c.year, variant: c.variant,
          num: c.num, market: Number(c.marketPrice) || 0,
          lo: Number(c.lo) || 0, hi: Number(c.hi) || 0,
          confidence: c.confidence, thumbnail: c.thumbnail,
          rookie: c.rookie, sales7d: Number(c.sales_7d) || 0,
          sales30d: Number(c.sales_30d) || 0, gain7d: Number(c.gain_7d) || 0,
        })));
      })
      .catch(() => {})
      .finally(() => setDataLoading(false));
  }, []);

  // Check subscription status
  useEffect(() => {
    if (!token) { setSubStatus(false); setSubLoading(false); return; }
    fetch('/api/subscription/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { subscribed: false })
      .then(d => { setSubStatus(d.subscribed); setSubLoading(false); })
      .catch(() => { setSubStatus(false); setSubLoading(false); });
  }, [token]);

  // Handle checkout redirect return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sub') === 'success') {
      setSubStatus(true);
      window.history.replaceState({}, '', '/arbitrage');
    }
  }, []);

  const handleSubscribe = async () => {
    if (!token) { alert('Please log in first'); return; }
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/subscription/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Checkout failed');
    } catch (e) { alert(e.message); }
    finally { setCheckoutLoading(false); }
  };

  // Fetch top movers from Card Hedge API
  useEffect(() => {
    fetch('/api/market/movers')
      .then(r => r.ok ? r.json() : { cards: [] })
      .then(d => { setTopMovers(d.cards || []); setMoversLoading(false); })
      .catch(() => setMoversLoading(false));
  }, []);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // Edge = spread between lo and hi as % of lo
  // Filter out ultra-expensive cards so they don't dominate
  const cardsWithEdge = useMemo(() => {
    return cards
      .filter(c => c.lo > 0 && c.hi > 0 && c.market > 0 && c.market < 5000)
      .map(c => ({
        ...c,
        edge: c.lo > 0 ? +(((c.hi - c.lo) / c.lo) * 100).toFixed(1) : 0,
        spread: c.hi - c.lo,
      }))
      .sort((a, b) => {
        // Prioritize cards with real sales data + edge
        const scoreA = a.edge + (a.sales7d || 0) * 2 + (a.sales30d || 0) * 0.5;
        const scoreB = b.edge + (b.sales7d || 0) * 2 + (b.sales30d || 0) * 0.5;
        return scoreB - scoreA;
      });
  }, [cards]);

  // Top undervalued: high edge + decent volume
  const undervalued = useMemo(() => cardsWithEdge.slice(0, 8), [cardsWithEdge]);
  const maxEdge = undervalued[0]?.edge || 1;

  // Gainers: cards with highest 7d gain
  const gainers = useMemo(() => {
    return [...cards]
      .filter(c => c.gain7d > 0 && c.market > 0)
      .sort((a, b) => b.gain7d - a.gain7d)
      .slice(0, 8);
  }, [cards]);

  // Losers: cards with biggest 7d loss
  const losers = useMemo(() => {
    return [...cards]
      .filter(c => c.gain7d < 0 && c.market > 0)
      .sort((a, b) => a.gain7d - b.gain7d)
      .slice(0, 8);
  }, [cards]);

  // Full spread board: all cards with edge > 5%, sorted by user selection
  const board = useMemo(() => {
    const filtered = cardsWithEdge.filter(c => c.edge > 5);
    const sorted = [...filtered].sort((a, b) => {
      let av, bv;
      switch (sortCol) {
        case 'edge': av = a.edge; bv = b.edge; break;
        case 'spread': av = a.spread; bv = b.spread; break;
        case 'price': av = a.market; bv = b.market; break;
        case 'sales7d': av = a.sales7d || 0; bv = b.sales7d || 0; break;
        case 'sales30d': av = a.sales30d || 0; bv = b.sales30d || 0; break;
        default: av = a.edge; bv = b.edge;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return sorted.slice(0, 25);
  }, [cardsWithEdge, sortCol, sortDir]);

  // Most traded by volume
  const mostTraded = useMemo(() => {
    return [...cards]
      .filter(c => c.sales30d > 0 && c.market > 0)
      .sort((a, b) => b.sales30d - a.sales30d)
      .slice(0, 8);
  }, [cards]);

  const isGated = !subLoading && !subStatus;

  return (
    <>
      <div className="eyebrow">Arbitrage Engine · powered by Card Hedge</div>
      <h1 className="page">See the spread before anyone else.</h1>
      <p className="sub">Real-time edge detection across the card market. We track price spreads, volume trends, and momentum to surface the best opportunities.</p>

      <div style={{ position: 'relative' }}>
        {/* Paywall overlay */}
        {isGated && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10,
            background: 'linear-gradient(180deg, transparent 0%, transparent 15%, rgba(10,13,20,0.7) 25%, rgba(10,13,20,0.95) 40%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
          }}>
            <div style={{
              pointerEvents: 'auto', textAlign: 'center', padding: '40px 32px',
              background: 'var(--panel)', border: '1px solid var(--gold)', borderRadius: 16,
              maxWidth: 420, margin: '120px auto 0',
              boxShadow: '0 0 60px rgba(232,179,57,0.15)',
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
              <h2 style={{ fontFamily: 'var(--disp)', fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
                Arbitrage Engine — $7.99/mo
              </h2>
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
                See price spreads, market movers, and buy signals before anyone else.
              </p>
              <button onClick={handleSubscribe} disabled={checkoutLoading}
                style={{
                  padding: '14px 32px', borderRadius: 10, fontSize: 15, fontWeight: 700,
                  background: 'var(--gold)', color: '#000', cursor: checkoutLoading ? 'wait' : 'pointer',
                  border: 'none', width: '100%',
                }}>
                {checkoutLoading ? 'Redirecting...' : '🚀 Start 7-Day Free Trial'}
              </button>
              <p style={{ fontSize: 11, color: 'var(--dim)', marginTop: 10 }}>
                Cancel anytime. Marketplace, sell, trade, and live features are always free.
              </p>
            </div>
          </div>
        )}

        <div className="arb-top" style={isGated ? { filter: 'blur(0px)' } : {}}>
          {/* Undervalued Radar */}
          <div className="panel">
            <div className="ph"><h3>⚡ Undervalued Radar</h3><span className="pill gold">buy signals</span></div>
            <p style={{ fontSize: 11, color: 'var(--dim)', margin: '4px 0 12px', padding: '0 16px' }}>Cards with the widest spread between market low and high. The bigger the gap, the bigger the opportunity.</p>
            <div className="radar">
              {undervalued.map((c, idx) => (
                <div key={c.id} className="radar-row"
                  onClick={() => !isGated && setSelectedCard(c)}
                  style={{
                    cursor: isGated && idx >= 3 ? 'default' : 'pointer',
                    filter: isGated && idx >= 3 ? 'blur(6px)' : 'none',
                    pointerEvents: isGated && idx >= 3 ? 'none' : 'auto',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {c.thumbnail && <img src={c.thumbnail} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'contain', background: 'var(--panel-2)' }} />}
                    <div style={{ minWidth: 0 }}>
                      <div className="nm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {c.player}
                        {c.rookie && <span className="rc-tag">RC</span>}
                      </div>
                      <small style={{ color: 'var(--dim)' }}>{c.grader} {c.grade} · {c.set}</small>
                    </div>
                  </div>
                  <div className="spread" style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    <div><span style={{ color: '#22c55e', fontSize: 11 }}>Low</span> <span className="mono" style={{ fontWeight: 600 }}>{fmtP(c.lo)}</span></div>
                    <div><span style={{ color: '#ef4444', fontSize: 11 }}>High</span> <span className="mono" style={{ fontWeight: 600 }}>{fmtP(c.hi)}</span></div>
                    <div><span style={{ color: 'var(--gold)', fontSize: 11 }}>Spread</span> <span className="mono" style={{ fontWeight: 600 }}>{fmtP(c.spread)}</span></div>
                  </div>
                  <EdgeBar pct={c.edge} max={maxEdge} />
                </div>
              ))}
            </div>
          </div>

          {/* 7-Day Gainers */}
          <div className="panel" style={isGated ? { filter: 'blur(6px)', pointerEvents: 'none' } : {}}>
            <div className="ph"><h3>📈 7-Day Gainers</h3><span className="pill">trending up</span></div>
            <div className="movers">
              {gainers.length === 0 && <div style={{ padding: 16, color: 'var(--dim)', fontSize: 13 }}>No gain data available yet. Cards need 7-day price history from Card Hedge.</div>}
              {gainers.map((c, i) => (
                <div key={c.id} className="mover" onClick={() => setSelectedCard(c)} style={{ cursor: 'pointer' }}>
                  <span className="rk">{i + 1}</span>
                  <span className="nm">{c.player} <small>{c.grader} {c.grade}</small></span>
                  <span className="px">{fmtP(c.market)}</span>
                  <span className="ch up">+{c.gain7d.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Second row: Losers + Most Traded */}
        <div className="arb-top" style={{ marginTop: 16, ...(isGated ? { filter: 'blur(6px)', pointerEvents: 'none' } : {}) }}>
          {/* 7-Day Losers */}
          <div className="panel">
            <div className="ph"><h3>📉 7-Day Losers</h3><span className="pill" style={{ background: 'rgba(239,68,68,.15)', color: '#ef4444' }}>dropping</span></div>
            <div className="movers">
              {losers.length === 0 && <div style={{ padding: 16, color: 'var(--dim)', fontSize: 13 }}>No loss data available yet.</div>}
              {losers.map((c, i) => (
                <div key={c.id} className="mover" onClick={() => setSelectedCard(c)} style={{ cursor: 'pointer' }}>
                  <span className="rk">{i + 1}</span>
                  <span className="nm">{c.player} <small>{c.grader} {c.grade}</small></span>
                  <span className="px">{fmtP(c.market)}</span>
                  <span className="ch down">{c.gain7d.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Most Traded */}
          <div className="panel">
            <div className="ph"><h3>🔥 Most Traded · 30 Days</h3><span className="pill">by volume</span></div>
            <div className="movers">
              {mostTraded.length === 0 && <div style={{ padding: 16, color: 'var(--dim)', fontSize: 13 }}>No sales data yet.</div>}
              {mostTraded.map((c, i) => (
                <div key={c.id} className="mover" onClick={() => setSelectedCard(c)} style={{ cursor: 'pointer' }}>
                  <span className="rk">{i + 1}</span>
                  <span className="nm">{c.player} <small>{c.grader} {c.grade}</small></span>
                  <span className="px">{fmtP(c.market)}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--gold)' }}>{c.sales30d.toLocaleString()} sales</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Spread Board */}
        <div style={{ marginTop: 24, ...(isGated ? { filter: 'blur(6px)', pointerEvents: 'none' } : {}) }}>
          <div className="ph" style={{ alignItems: 'flex-end' }}>
            <div>
              <h3 style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 18 }}>Price Spread Board</h3>
              <p className="sub" style={{ marginTop: 4 }}>Cards with the biggest gap between low and high market prices. Edge = (High - Low) / Low × 100.</p>
            </div>
          </div>

          {board.length === 0 ? (
            <div className="panel" style={{ padding: 24, textAlign: 'center', color: 'var(--dim)' }}>
              No spread data available. Cards need lo/hi price ranges from Card Hedge.
            </div>
          ) : (
            <div className="board" style={{ overflowX: 'auto' }}>
              <div className="board-head">
                <div style={{ minWidth: 200 }}>Card</div>
                <div>Low</div>
                <div>Market</div>
                <div>High</div>
                <SortHeader label="Spread" col="spread" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="Edge" col="edge" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="7d Sales" col="sales7d" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortHeader label="30d Sales" col="sales30d" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              </div>
              {board.map(c => (
                <div key={c.id} className="board-row" onClick={() => setSelectedCard(c)} style={{ cursor: 'pointer' }}>
                  <div className="card-c" style={{ minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.thumbnail && <img src={c.thumbnail} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'contain', background: 'var(--panel-2)' }} />}
                      <div>
                        <div className="t" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {c.player}
                          {c.rookie && <span className="rc-tag">RC</span>}
                        </div>
                        <div className="s">{c.grader} {c.grade} · {c.set}</div>
                      </div>
                    </div>
                  </div>
                  <div className="px best mono">{fmtP(c.lo)}</div>
                  <div className="px mono">{fmtP(c.market)}</div>
                  <div className="px high mono">{fmtP(c.hi)}</div>
                  <div className="px mono" style={{ color: 'var(--gold)' }}>{fmtP(c.spread)}</div>
                  <div className="edge up">+{c.edge}%</div>
                  <div className="mono" style={{ fontSize: 12 }}>{c.sales7d || '—'}</div>
                  <div className="mono" style={{ fontSize: 12 }}>{c.sales30d || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedCard && <CardDetail card={selectedCard} onClose={() => setSelectedCard(null)} />}
    </>
  );
}
