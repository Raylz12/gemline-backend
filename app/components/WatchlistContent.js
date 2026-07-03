'use client';
// Watchlist tab (portfolio page) — server-backed watches with price-move +
// new-listing alerts. Rows link to the public card page.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthContext';
import { useCardStore } from './CardStore';
import { toast } from '../lib/toast';

const usd = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) < 100 ? 2 : 0, maximumFractionDigits: Number(n) < 100 ? 2 : 0 })}`;

function Thumb({ item }) {
  return item.thumbnail ? (
    <img src={item.thumbnail} alt="" loading="lazy" style={{ width: 42, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
         onError={e => { e.target.style.display = 'none'; }} />
  ) : (
    <div style={{ width: 42, height: 56, borderRadius: 6, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', flexShrink: 0, fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 13, color: 'var(--dim)' }}>
      {(item.player || '?').split(' ').map(w => w[0]).join('').slice(0, 3)}
    </div>
  );
}

export default function WatchlistContent() {
  const { authFetch } = useAuth();
  const { watch, toggleWatch } = useCardStore();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    authFetch('/api/watchlist')
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const remove = async (cardId) => {
    setItems(prev => prev.filter(i => i.cardId !== cardId));
    if (watch.has(String(cardId))) toggleWatch(cardId); // store handles the API call + set removal
    else {
      try {
        await authFetch('/api/watchlist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId, watch: false }),
        });
      } catch {}
    }
    toast('Removed from watchlist');
  };

  const setAlert = async (cardId, pct) => {
    setItems(prev => prev.map(i => i.cardId === cardId ? { ...i, alertPct: pct } : i));
    try {
      await authFetch(`/api/watchlist/${cardId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertPct: pct }),
      });
    } catch {}
  };

  if (loading) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading watchlist…</div>;

  if (!items.length) return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Nothing on watch yet</div>
      <div style={{ color: 'var(--muted)', fontSize: 14, maxWidth: 420, margin: '0 auto 20px' }}>
        Tap the heart on any card to watch it. You&rsquo;ll get an alert when the price moves or a new listing hits the market.
      </div>
      <Link href="/market" className="btn btn-primary" style={{ display: 'inline-block' }}>Browse the market</Link>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.1em', color: 'var(--muted)' }}>
          WATCHING {items.length} CARD{items.length === 1 ? '' : 'S'} · DAILY PRICE ALERTS + INSTANT LISTING ALERTS
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(item => {
          const delta = item.refPrice > 0 && item.price > 0 ? ((item.price - item.refPrice) / item.refPrice) * 100 : null;
          const deltaCol = delta == null ? 'var(--dim)' : delta >= 0 ? 'var(--up)' : 'var(--down)';
          return (
            <div key={item.cardId} className="watch-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10 }}>
              <Link href={`/card/${item.cardId}`} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                <Thumb item={item} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.player}
                    {item.grader && item.grade ? <span className="mchip mchip-grade" style={{ marginLeft: 8 }}>{item.grader} {item.grade}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[item.year, item.cardSet, item.number ? `#${item.number}` : null].filter(Boolean).join(' ')}
                  </div>
                  {item.liveListings > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--gold)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                      {item.liveListings} LIVE LISTING{item.liveListings === 1 ? '' : 'S'}
                    </div>
                  )}
                </div>
              </Link>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 14 }}>{usd(item.price)}</div>
                <div style={{ fontSize: 11, color: deltaCol, fontFamily: 'var(--mono)' }}>
                  {delta == null ? 'since watch —' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% since watch`}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                <select value={item.alertPct} onChange={e => setAlert(item.cardId, Number(e.target.value))}
                        title="Alert when price moves this much"
                        style={{ background: 'var(--panel-2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 11, padding: '3px 4px', fontFamily: 'var(--mono)' }}>
                  {[2, 5, 10, 20].map(p => <option key={p} value={p}>±{p}%</option>)}
                </select>
                <button onClick={() => remove(item.cardId)} title="Remove"
                        style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--mono)', padding: 2 }}>
                  REMOVE
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
