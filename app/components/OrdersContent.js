'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fmt } from '../lib/data';
import { toast } from '../lib/toast';
import PaymentModal from './PaymentModal';
import { AddressBlock } from './AddressForm';

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
    pending_payment: { label: 'PAYMENT DUE', bg: 'rgba(240,180,41,.14)', color: '#f0b429' },
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

// Seller-facing "ship to" panel — buyer name + full address with a copy
// button so the seller can hand-write or buy a label elsewhere.
// Label purchase (EasyPost/Shippo) is a future integration.
function ShipTo({ order }) {
  const addr = order.shippingAddress;
  return (
    <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--panel-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
        Ship to — @{order.buyerHandle}
      </div>
      {addr ? (
        <AddressBlock address={addr} copyable />
      ) : (
        <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.5 }}>
          Address not collected (legacy order) — message the buyer @{order.buyerHandle} for their shipping address.
        </div>
      )}
    </div>
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

// Horizontal order progress: Placed → Paid → Shipped → Delivered → Complete.
// Timestamps come from the order event log; terminal states show a note.
const TL_STEPS = [
  { key: 'placed', label: 'Placed', states: ['created', 'pending_payment'] },
  { key: 'paid', label: 'Paid', states: ['escrow_held', 'awaiting_shipment'] },
  { key: 'shipped', label: 'Shipped', states: ['shipped', 'at_auth_hub', 'authenticating', 'auth_passed'] },
  { key: 'delivered', label: 'Delivered', states: ['delivered', 'inspection'] },
  { key: 'complete', label: 'Complete', states: ['settled'] },
];
const stepIndexOf = (status) => TL_STEPS.findIndex(s => s.states.includes(status));

function OrderTimeline({ o }) {
  if (['cancelled', 'refunded'].includes(o.status)) {
    return (
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
        {o.status === 'cancelled' ? 'ORDER CANCELLED — PAYMENT HOLD RELEASED' : 'ORDER REFUNDED'}
      </div>
    );
  }
  const tl = Array.isArray(o.timeline) ? o.timeline : [];
  const timeFor = (step) => {
    const ev = tl.filter(e => step.states.includes(e.state)).pop();
    if (step.key === 'placed') return ev?.at || o.createdAt;
    return ev?.at || null;
  };
  const cur = o.status === 'disputed'
    ? 3 // dispute happens post-delivery — show progress up to Delivered
    : stepIndexOf(o.status);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)', overflowX: 'auto' }}>
      {TL_STEPS.map((s, i) => {
        const done = i <= cur;
        const at = timeFor(s);
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'flex-start', flex: i < TL_STEPS.length - 1 ? 1 : 'none', minWidth: 0 }}>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', margin: '0 auto', background: done ? 'var(--up)' : 'var(--panel-2)', border: `2px solid ${done ? 'var(--up)' : 'var(--line-2)'}` }} />
              <div style={{ fontSize: 9, fontFamily: 'var(--mono)', letterSpacing: '.06em', marginTop: 4, color: done ? 'var(--txt)' : 'var(--dim)', textTransform: 'uppercase' }}>{s.label}</div>
              {done && at && <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 1 }}>{new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>}
            </div>
            {i < TL_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < cur ? 'var(--up)' : 'var(--line)', margin: '5px 4px 0', minWidth: 12 }} />
            )}
          </div>
        );
      })}
      {o.status === 'disputed' && (
        <span style={{ marginLeft: 10, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--down)', whiteSpace: 'nowrap' }}>⚠ DISPUTED — UNDER REVIEW</span>
      )}
    </div>
  );
}

// Buyer↔seller message thread, expanded per order.
function MessageThread({ order, authFetch, onRead }) {
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    authFetch(`/api/orders/${order.id}/messages`)
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(d => { setMessages(d.messages || []); onRead?.(); })
      .catch(() => setMessages([]));
  }, [order.id, authFetch, onRead]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const res = await authFetch(`/api/orders/${order.id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Send failed');
      setDraft('');
      load();
    } catch (e) { toast(e.message, true); }
    finally { setSending(false); }
  };

  return (
    <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--panel-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '.1em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>
        Messages
      </div>
      {messages === null ? (
        <div style={{ fontSize: 12, color: 'var(--dim)', padding: '6px 0' }}>Loading…</div>
      ) : messages.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--dim)', padding: '6px 0' }}>No messages yet — say hi or ask about shipping.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto', marginBottom: 8 }}>
          {messages.map(m => (
            <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              <div style={{ padding: '7px 11px', borderRadius: 10, fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: m.mine ? 'var(--gold-soft)' : 'var(--panel)', border: `1px solid ${m.mine ? 'var(--gold)' : 'var(--line-2)'}`, color: 'var(--txt)' }}>
                {m.body}
              </div>
              <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 2, textAlign: m.mine ? 'right' : 'left' }}>
                {m.mine ? 'you' : `@${m.senderHandle}`} · {new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000}
          placeholder="Write a message…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ flex: 1, padding: '9px 11px', borderRadius: 8, fontSize: 13, background: 'var(--panel)', color: 'var(--txt)', border: '1px solid var(--line-2)' }} />
        <button onClick={send} disabled={sending || !draft.trim()}
          style={{ padding: '9px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: 'var(--gold)', color: '#141006', border: 'none', cursor: sending ? 'wait' : 'pointer', opacity: draft.trim() ? 1 : .5 }}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
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
  const [payModal, setPayModal] = useState(null);
  const [paying, setPaying] = useState(null);
  const [msgOpenId, setMsgOpenId] = useState(null);
  const [acting, setActing] = useState(null);
  const [readIds, setReadIds] = useState(new Set()); // threads opened this session

  // Fetch the client_secret for a pending order and open the Payment Element.
  const completePayment = async (order) => {
    setPaying(order.id);
    try {
      const res = await authFetch(`/api/orders/${order.id}/payment`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load payment');
      if (!d.requiresPayment) { toast('This order is already paid.'); load(); return; }
      setPayModal({ ...d.payment, orderId: order.id });
    } catch (e) { toast(e.message, true); }
    finally { setPaying(null); }
  };

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    authFetch('/api/orders')
      .then(r => r.ok ? r.json() : { purchases: [], sales: [] })
      .then(d => { setPurchases(d.purchases || []); setSales(d.sales || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, authFetch]);

  useEffect(() => { load(); }, [load]);

  const orderAction = async (order, path, body, okMsg, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setActing(order.id);
    try {
      const res = await authFetch(`/api/orders/${order.id}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Action failed');
      toast(okMsg);
      load();
    } catch (e) { toast(e.message, true); }
    finally { setActing(null); }
  };

  const requestCancel = (order, isSale) => {
    const reason = window.prompt(isSale
      ? 'Cancel this sale? The buyer\u2019s payment hold is released immediately. Optional note for the buyer:'
      : 'Why do you want to cancel? The seller will review your request:');
    if (reason === null) return;
    orderAction(order, 'cancel-request', { reason },
      isSale ? 'Order cancelled — buyer\u2019s hold released' : 'Cancel request sent to the seller');
  };

  const openDispute = (order) => {
    const reason = window.prompt('What\u2019s wrong with this order? (e.g. not as described, damaged, never arrived)');
    if (!reason || !reason.trim()) return;
    orderAction(order, 'dispute', { reason }, 'Dispute opened — payout paused while GEMLINE reviews');
  };

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
  const needPay = purchases.filter(o => o.status === 'pending_payment').length;
  const rows = view === 'purchases' ? purchases : sales;

  if (!token) {
    return <div style={{ padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>Log in to see your orders.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { id: 'purchases', label: `Purchases${needPay > 0 ? ` (${needPay} to pay)` : needConfirm > 0 ? ` (${needConfirm} arriving)` : ''}` },
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
            const canPay = !isSale && o.status === 'pending_payment';
            return (
              <div key={o.id} style={{ padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <OrderThumb o={o} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{o.player}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="mchip mchip-grade">{`${o.grader || 'RAW'} ${o.grade || ''}`.trim()}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.set}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>
                      {isSale ? `sold to @${o.buyerHandle}` : `from @${o.sellerHandle}`}
                      <span style={{ margin: '0 6px', opacity: .5 }}>{new Date(o.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: 'var(--gold)' }}>{fmt(o.amount)}</div>
                    {isSale && o.fee > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>net {fmt(o.amount - o.fee)}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <StatusPill status={o.status} />
                    <button onClick={() => setMsgOpenId(msgOpenId === o.id ? null : o.id)}
                      style={{ position: 'relative', padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--line-2)', cursor: 'pointer' }}>
                      Message{o.messageCount > 0 ? ` (${o.messageCount})` : ''}
                      {o.unreadMessages > 0 && !readIds.has(o.id) && (
                        <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--down)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{o.unreadMessages}</span>
                      )}
                    </button>
                    {canPay && (
                      <button onClick={() => completePayment(o)} disabled={paying === o.id}
                        style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: '#f0b429', color: '#141006', border: 'none', cursor: paying === o.id ? 'wait' : 'pointer' }}>
                        {paying === o.id ? '…' : 'Complete Payment'}
                      </button>
                    )}
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

                {/* Cancel + dispute controls */}
                <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                  {['escrow_held', 'awaiting_shipment'].includes(o.status) && !o.cancelRequestedBy && (
                    <button onClick={() => requestCancel(o, isSale)} disabled={acting === o.id}
                      style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--mono)', padding: 0, textDecoration: 'underline' }}>
                      {isSale ? 'CANCEL SALE' : 'REQUEST CANCELLATION'}
                    </button>
                  )}
                  {!isSale && ['shipped', 'delivered', 'inspection'].includes(o.status) && (
                    <button onClick={() => openDispute(o)} disabled={acting === o.id}
                      style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--mono)', padding: 0, textDecoration: 'underline' }}>
                      REPORT A PROBLEM
                    </button>
                  )}
                </div>

                {o.cancelRequestedBy && !['cancelled', 'refunded'].includes(o.status) && (
                  <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(240,180,41,.08)', border: '1px solid rgba(240,180,41,.3)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180, fontSize: 12, color: '#f0b429' }}>
                      {isSale ? 'Buyer requested cancellation' : 'Cancellation requested — waiting on the seller'}
                      {o.cancelReason && <span style={{ color: 'var(--muted)' }}> — “{o.cancelReason}”</span>}
                    </div>
                    {isSale && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => orderAction(o, 'cancel-respond', { approve: true }, 'Cancelled — buyer\u2019s hold released')} disabled={acting === o.id}
                          style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'var(--down)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                          Approve &amp; Refund
                        </button>
                        <button onClick={() => orderAction(o, 'cancel-respond', { approve: false }, 'Declined — order proceeds')} disabled={acting === o.id}
                          style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--line-2)', cursor: 'pointer' }}>
                          Keep Order
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <OrderTimeline o={o} />

                {msgOpenId === o.id && (
                  <MessageThread order={o} authFetch={authFetch} onRead={() => setReadIds(prev => new Set(prev).add(o.id))} />
                )}

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

                {isSale && ['created', 'escrow_held', 'awaiting_shipment'].includes(o.status) && (
                  <ShipTo order={o} />
                )}

                {canShip && shipFormId === o.id && (
                  <ShipForm order={o} authFetch={authFetch} onDone={() => { setShipFormId(null); load(); }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {payModal && (
        <PaymentModal
          payment={payModal}
          authFetch={authFetch}
          cancelOnClose={false}
          onPaid={() => { setPayModal(null); load(); }}
          onClose={() => { setPayModal(null); load(); }}
        />
      )}
    </div>
  );
}
