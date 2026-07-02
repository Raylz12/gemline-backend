'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fmt } from '../lib/data';
import { toast } from '../lib/toast';

const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other'];

function trackingUrl(carrier, num) {
  const c = (carrier || '').toLowerCase();
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(num)}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${encodeURIComponent(num)}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(num)}`;
  if (c.includes('dhl')) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodeURIComponent(num)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${carrier} tracking ${num}`)}`;
}

function OrderThumb({ o }) {
  return o.thumbnail ? (
    <img src={o.thumbnail} alt="" style={{ width: 42, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
         onError={e => { e.target.style.display = 'none'; }} />
  ) : (
    <div style={{ width: 42, height: 56, borderRadius: 6, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', flexShrink: 0, fontFamily: 'var(--disp)', fontWeight: 800, fontSize: 13, color: 'var(--dim)' }}>
      {(o.player || '?').split(' ').map(w => w[0]).join('').slice(0, 3)}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    created: { label: 'PENDING', bg: 'var(--panel-2)', color: 'var(--muted)' },
    escrow_held: { label: 'IN ESCROW', bg: 'var(--gold-soft)', color: 'var(--gold)' },
    awaiting_shipment: { label: 'AWAITING SHIPMENT', bg: 'var(--gold-soft)', color: 'var(--gold)' },
    shipped: { label: 'SHIPPED', bg: 'rgba(96,165,250,.12)', color: '#60a5fa' },
    delivered: { label: 'DELIVERED', bg: 'rgba(96,165,250,.12)', color: '#60a5fa' },
    inspection: { label: 'INSPECTION', bg: 'rgba(96,165,250,.12)', color: '#60a5fa' },
    settled: { label: 'COMPLETED', bg: 'var(--up-soft)', color: 'var(--up)' },
    disputed: { label: 'DISPUTED', bg: 'var(--down-soft)', color: 'var(--down)' },
    refunded: { label: 'REFUNDED', bg: 'var(--down-soft)', color: 'var(--down)' },
    cancelled: { label: 'CANCELLED', bg: 'var(--panel-2)', color: 'var(--dim)' },
  };
  const s = map[status] || { label: (status || '').replace(/_/g, ' ').toUpperCase(), bg: 'var(--panel-2)', color: 'var(--muted)' };
  return (
    <span style={{ fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '.08em', padding: '3px 8px', borderRadius: 5, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function ShipForm({ order, onDone, authFetch }) {
  const [carrier, setCarrier] = useState('USPS');
  const [tracking, setTracking] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!tracking.trim()) { toast('Enter a tracking number', true); return; }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/orders/${order.id}/ship`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier, tracking_number: tracking.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Ship failed');
      toast('Marked shipped — buyer notified with tracking ✓');
      onDone();
    } catch (e) { toast(e.message, true); }
    finally { setSubmitting(false); }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', width: '100%', marginTop: 8, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
      <select value={carrier} onChange={e => setCarrier(e.target.value)}
        style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12, background: 'var(--panel-2)', color: 'var(--ink)', border: '1px solid var(--line-2)' }}>
        {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Tracking number"
        style={{ flex: 1, minWidth: 160, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--mono)', background: 'var(--panel-2)', color: 'var(--ink)', border: '1px solid var(--line-2)' }} />
      <button onClick={submit} disabled={submitting}
        style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--gold)', color: '#141006', border: 'none', cursor: submitting ? 'wait' : 'pointer' }}>
        {submitting ? '…' : 'Mark Shipped'}
      </button>
    </div>
  );
}

export default function OrdersContent() {
  const { token, authFetch } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('purchases');
  const [shipFormId, setShipFormId] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    authFetch('/api/orders')
      .then(r => r.ok ? r.json() : { purchases: [], sales: [] })
      .then(d => { setPurchases(d.purchases || []); setSales(d.sales || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, authFetch]);

  useEffect(() => { load(); }, [load]);

  const confirmReceipt = async (order) => {
    setConfirming(order.id);
    try {
      const res = await authFetch(`/api/orders/${order.id}/confirm-receipt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Confirm failed');
      toast('Receipt confirmed — order complete ✓');
      load();
    } catch (e) { toast(e.message, true); }
    finally { setConfirming(null); }
  };

  const needShip = sales.filter(o => ['created', 'escrow_held', 'awaiting_shipment'].includes(o.status)).length;
  const needConfirm = purchases.filter(o => ['shipped', 'delivered', 'inspection'].includes(o.status)).length;
  const rows = view === 'purchases' ? purchases : sales;

  if (!token) {
    return <div style={{ padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>Log in to see your orders.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { id: 'purchases', label: `Purchases${needConfirm > 0 ? ` (${needConfirm} arriving)` : ''}` },
          { id: 'sales', label: `Sales${needShip > 0 ? ` (${needShip} to ship)` : ''}` },
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
        <div style={{ padding: 30, color: 'var(--muted)', fontSize: 13 }}>Loading orders…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '28px 20px', textAlign: 'center', background: 'var(--panel)', border: '1px dashed var(--line-2)', borderRadius: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
            {view === 'purchases' ? 'No purchases yet' : 'No sales yet'}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 380, margin: '0 auto' }}>
            {view === 'purchases'
              ? 'When you buy a card or win an auction, the order shows up here with shipping and tracking.'
              : 'When your listings sell, orders land here — mark them shipped with tracking to get paid.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(o => {
            const isSale = view === 'sales';
            const canShip = isSale && ['created', 'escrow_held', 'awaiting_shipment'].includes(o.status);
            const canConfirm = !isSale && ['shipped', 'delivered', 'inspection'].includes(o.status);
            return (
              <div key={o.id} style={{ padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <OrderThumb o={o} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{o.player}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {o.grader} {o.grade} · {o.set}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>
                      {isSale ? `sold to @${o.buyerHandle}` : `from @${o.sellerHandle}`} · {new Date(o.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: 'var(--gold)' }}>{fmt(o.amount)}</div>
                    {isSale && o.fee > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>net {fmt(o.amount - o.fee)}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <StatusPill status={o.status} />
                    {canShip && (
                      <button onClick={() => setShipFormId(shipFormId === o.id ? null : o.id)}
                        style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--gold)', color: '#141006', border: 'none', cursor: 'pointer' }}>
                        {shipFormId === o.id ? 'Cancel' : 'Ship'}
                      </button>
                    )}
                    {canConfirm && (
                      <button onClick={() => confirmReceipt(o)} disabled={confirming === o.id}
                        style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--up)', color: '#04140c', border: 'none', cursor: confirming === o.id ? 'wait' : 'pointer' }}>
                        {confirming === o.id ? '…' : 'Confirm Receipt'}
                      </button>
                    )}
                  </div>
                </div>

                {o.trackingNumber && (
                  <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px dashed var(--line)', display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--muted)' }}>📦 {o.carrier}</span>
                    <a href={trackingUrl(o.carrier, o.trackingNumber)} target="_blank" rel="noopener noreferrer"
                       style={{ fontFamily: 'var(--mono)', color: '#60a5fa', textDecoration: 'none' }}>
                      {o.trackingNumber} ↗
                    </a>
                    {o.shippedAt && <span style={{ color: 'var(--dim)', fontSize: 11 }}>shipped {new Date(o.shippedAt).toLocaleDateString()}</span>}
                    {o.deliveredAt && <span style={{ color: 'var(--up)', fontSize: 11 }}>delivered {new Date(o.deliveredAt).toLocaleDateString()}</span>}
                  </div>
                )}

                {canShip && shipFormId === o.id && (
                  <ShipForm order={o} authFetch={authFetch} onDone={() => { setShipFormId(null); load(); }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
