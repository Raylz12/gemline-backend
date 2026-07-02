'use client';
// PaymentModal — Stripe Payment Element checkout for GEMLINE buys.
//
// Flow: parent opens this with a `payment` payload from POST /api/listings/:id/buy
// (or GET /api/orders/:id/payment for resumed checkouts). The buyer confirms the
// manual-capture PaymentIntent in the Payment Element; on success we ping
// /api/orders/:id/payment/complete so the order finalizes immediately (the
// webhook is the source of truth, this just avoids a UI wait). Closing without
// paying cancels the pending order and frees the listing.
//
// NOTE: requires NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to be set in Vercel env.
// Without it the modal shows a clear "payments not configured" message and the
// buy stays in pending_payment until the key is added (or the sweep expires it).
import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from '../lib/toast';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
// Load once at module scope (Stripe recommends not re-creating on every render).
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

const money = (cents) => `$${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CheckoutForm({ payment, onPaid, onClose, authFetch }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErr(null);
    // Confirm without a redirect where possible; redirect only if the payment
    // method requires it (return_url handles that minority path).
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/portfolio?tab=orders&paid=${payment.orderId}`,
      },
      redirect: 'if_required',
    });
    if (error) {
      setErr(error.message || 'Payment failed. Please try another card.');
      setSubmitting(false);
      return;
    }
    // Manual-capture PIs land on 'requires_capture' after authorization; treat
    // that (and 'succeeded'/'processing') as paid. Tell the backend to finalize.
    const st = paymentIntent?.status;
    if (['requires_capture', 'succeeded', 'processing'].includes(st)) {
      try {
        await authFetch(`/api/orders/${payment.orderId}/payment/complete`, { method: 'POST' });
      } catch { /* webhook will finalize regardless */ }
      toast('Payment confirmed 🎉');
      onPaid?.();
    } else {
      setErr(`Payment status: ${st || 'unknown'}. If you were charged, your order will update shortly.`);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement options={{ layout: 'tabs' }} />
      {err && <div style={{ color: 'var(--down, #ef4444)', fontSize: 13, marginTop: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          style={{ flex: '0 0 auto', padding: '12px 18px', borderRadius: 8, border: '1px solid var(--line-2, #333)', background: 'transparent', color: 'var(--muted, #9ca3af)', fontWeight: 600, cursor: 'pointer' }}
        >Cancel</button>
        <button
          type="submit"
          disabled={!stripe || submitting}
          style={{ flex: 1, padding: '12px 18px', borderRadius: 8, border: 'none', background: 'var(--gold, #16c784)', color: '#04120b', fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1 }}
        >{submitting ? 'Processing…' : `Pay ${money(payment.amount)}`}</button>
      </div>
    </form>
  );
}

export default function PaymentModal({ payment, onPaid, onClose, authFetch, cancelOnClose = true }) {
  const [closing, setClosing] = useState(false);
  const clientSecret = payment?.clientSecret || null;

  // Dark Payment Element theme matching the .cd-dark intelligence panel.
  const options = useMemo(() => ({
    clientSecret,
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#16c784',
        colorBackground: '#0f1420',
        colorText: '#e8eaed',
        colorTextSecondary: '#9ca3af',
        colorDanger: '#ef4444',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        borderRadius: '8px',
      },
      rules: {
        '.Input': { backgroundColor: '#141a28', border: '1px solid #263042' },
        '.Input:focus': { border: '1px solid #16c784', boxShadow: '0 0 0 1px #16c784' },
        '.Tab': { backgroundColor: '#141a28', border: '1px solid #263042' },
        '.Tab--selected': { borderColor: '#16c784' },
      },
    },
  }), [clientSecret]);

  // Cancel the pending order if the buyer dismisses without paying. For flows
  // with a long payment window (auction wins / accepted offers resumed from the
  // Orders tab) we just close and leave the order pending (cancelOnClose=false).
  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    if (cancelOnClose && payment?.orderId) {
      try { await authFetch(`/api/orders/${payment.orderId}/payment/cancel`, { method: 'POST' }); } catch {}
    }
    onClose?.();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line

  return (
    <div
      onClick={handleClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(4,7,14,.72)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, background: '#0b0f19', border: '1px solid #1e2636', borderRadius: 14, padding: 24, boxShadow: '0 24px 80px rgba(0,0,0,.6)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <h3 style={{ margin: 0, color: '#f5f6f8', fontSize: 18, fontWeight: 700 }}>Complete payment</h3>
          <span style={{ color: '#16c784', fontFamily: 'ui-monospace, monospace', fontSize: 16, fontWeight: 700 }}>{money(payment?.amount || 0)}</span>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 18 }}>
          Held in escrow until you confirm the card arrived as described. Includes GEMLINE fee {money(payment?.fee || 0)}.
        </div>

        {!PUBLISHABLE_KEY ? (
          <div style={{ color: '#f0b429', fontSize: 13, lineHeight: 1.6, background: '#1a1508', border: '1px solid #3a2f10', borderRadius: 8, padding: 14 }}>
            Payments aren’t configured yet (missing publishable key). Your order is reserved — an admin will enable checkout shortly.
          </div>
        ) : !clientSecret ? (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>Preparing secure checkout…</div>
        ) : (
          <Elements stripe={stripePromise} options={options}>
            <CheckoutForm payment={payment} onPaid={onPaid} onClose={handleClose} authFetch={authFetch} />
          </Elements>
        )}
      </div>
    </div>
  );
}
