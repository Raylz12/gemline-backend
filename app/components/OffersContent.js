'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fmt } from '../lib/data';
import { toast } from '../lib/toast';

function OfferThumb({ o }) {
  return o.thumbnail ? (
    <img src={o.thumbnail} alt="" style={{ width: 42, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
         onError={e => { e.target.style.display = 'none'; }} />
  ) : (
    <div style={{ width: 42, height: 56, borderRadius: 6, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', flexShrink: 0, fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 13, color: 'var(--dim)' }}>
      {(o.player || '?').split(' ').map(w => w[0]).join('').slice(0, 3)}
    </div>
  );
}

function StatusPill({ status, listingStatus }) {
  const map = {
    pending: { label: 'PENDING', bg: 'var(--gold-soft)', color: 'var(--gold)' },
    accepted: { label: 'ACCEPTED', bg: 'var(--up-soft)', color: 'var(--up)' },
    declined: { label: 'DECLINED', bg: 'var(--down-soft)', color: 'var(--down)' },
  };
  const s = map[status] || { label: (status || '').toUpperCase(), bg: 'var(--panel-2)', color: 'var(--muted)' };
  const stale = status === 'pending' && listingStatus !== 'active';
  return (
    <span style={{ fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '.08em', padding: '3px 8px', borderRadius: 5, background: stale ? 'var(--panel-2)' : s.bg, color: stale ? 'var(--dim)' : s.color }}>
      {stale ? 'LISTING CLOSED' : s.label}
    </span>
  );
}

export default function OffersContent() {
  const { token, authFetch } = useAuth();
  const [received, setReceived] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('received');
  const [acting, setActing] = useState(null); // offer id being accepted/declined

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    authFetch('/api/offers')
      .then(r => r.ok ? r.json() : { received: [], sent: [] })
      .then(d => { setReceived(d.received || []); setSent(d.sent || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, authFetch]);

  useEffect(() => { load(); }, [load]);

  const act = async (offer, action) => {
    setActing(offer.id);
    try {
      const res = await authFetch(`/api/offers/${offer.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `${action} failed`);
      toast(action === 'accept' ? `Offer accepted — ${fmt(offer.amount)} in escrow ✓` : 'Offer declined');
      load();
    } catch (e) { toast(e.message, true); }
    finally { setActing(null); }
  };

  const pendingReceived = received.filter(o => o.status === 'pending' && o.listingStatus === 'active').length;
  const rows = view === 'received' ? received : sent;

  if (!token) {
    return <div style={{ padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>Log in to see offers on your listings.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { id: 'received', label: `Received${pendingReceived > 0 ? ` (${pendingReceived} pending)` : ''}` },
          { id: 'sent', label: 'Sent' },
        ].map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: view === t.id ? 'var(--gold-soft)' : 'var(--panel-2)',
              color: view === t.id ? 'var(--gold)' : 'var(--muted)',
              border: `1px solid ${view === t.id ? 'var(--gold)' : 'var(--line)'}`,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 30, color: 'var(--muted)', fontSize: 13 }}>Loading offers…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '28px 20px', textAlign: 'center', background: 'var(--panel)', border: '1px dashed var(--line-2)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
            {view === 'received' ? 'No offers yet' : 'No offers sent'}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 380, margin: '0 auto' }}>
            {view === 'received'
              ? 'When buyers make offers on your listings, they show up here to accept or decline.'
              : 'Find a card you want and hit Offer on any listing — sellers respond here.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(o => {
            const isPendingActive = o.status === 'pending' && o.listingStatus === 'active';
            const pctOfList = o.listingPrice > 0 ? Math.round((o.amount / o.listingPrice) * 100) : null;
            return (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, flexWrap: 'wrap' }}>
                <OfferThumb o={o} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{o.player}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mchip mchip-grade">{`${o.grader || 'RAW'} ${o.grade || ''}`.trim()}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.set}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>
                    {view === 'received' ? `from @${o.buyerHandle}` : `to @${o.sellerHandle}`}
                    <span style={{ margin: '0 6px', opacity: .5 }}>{new Date(o.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: 'var(--gold)' }}>{fmt(o.amount)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    {pctOfList !== null ? `${pctOfList}% of ask ${fmt(o.listingPrice)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <StatusPill status={o.status} listingStatus={o.listingStatus} />
                  {view === 'received' && isPendingActive && (
                    <>
                      <button onClick={() => act(o, 'accept')} disabled={acting === o.id}
                        style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--up)', color: '#04140c', cursor: acting === o.id ? 'wait' : 'pointer', border: 'none' }}>
                        {acting === o.id ? '…' : 'Accept'}
                      </button>
                      <button onClick={() => act(o, 'decline')} disabled={acting === o.id}
                        style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--line-2)', cursor: 'pointer' }}>
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
