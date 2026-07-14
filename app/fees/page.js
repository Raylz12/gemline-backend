export const metadata = {
  title: 'Fees & Payouts | GEMLINE',
  description: 'Exactly what GEMLINE costs: free listings, just 5% on your first five sales (7.5% after), escrow protection on every order, and when your payout lands.',
  alternates: { canonical: '/fees' },
};

const ROWS = [
  ['Creating an account', 'Free'],
  ['Browsing, watchlists & price alerts', 'Free'],
  ['Listing a card (buy now, offers, or auction)', 'Free'],
  ['Proposing & completing trades', 'Free'],
  ['Your first 5 sales', '5% of the sale price'],
  ['Every sale after that', '7.5% of the sale price'],
  ['Buying a card', 'The listed price, no buyer surcharge from GEMLINE'],
  ['Shop / dealer accounts', '$9.99/mo to list unlimited cards'],
];

const STEPS = [
  ['Buyer pays', 'The buyer\u2019s payment is captured by Stripe and held in escrow, the seller never sees card details, and the money doesn\u2019t move yet.'],
  ['Seller ships', 'The seller ships with tracking. Both sides can message each other on the order the whole way.'],
  ['Buyer confirms', 'When the card arrives as described, the buyer confirms receipt (or the inspection window lapses).'],
  ['Payout releases', 'The sale price minus GEMLINE\u2019s fee (5% on your first five sales, 7.5% after) is released to the seller. If something\u2019s wrong, the buyer opens a dispute and the payout stays frozen while GEMLINE reviews.'],
];

export default function FeesPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="eyebrow">Help</div>
      <h1 className="page">Fees &amp; Payouts</h1>
      <p className="sub">No surprises at the table. Here&apos;s exactly what GEMLINE costs and when you get paid.</p>

      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '28px 0 10px' }}>What it costs</h2>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {ROWS.map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: i < ROWS.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 14 }}>
            <span style={{ color: 'var(--muted)' }}>{k}</span>
            <span style={{ fontWeight: 700, color: v === 'Free' ? 'var(--up)' : 'var(--gold)', textAlign: 'right', whiteSpace: v.length > 24 ? 'normal' : 'nowrap' }}>{v}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
        New to the show? <b style={{ color: 'var(--txt)' }}>Your first five sales are just 5%</b>, sell a card for{' '}
        <b style={{ color: 'var(--txt)' }}>$100</b> and you keep <b style={{ color: 'var(--up)' }}>$95</b>. From your sixth
        sale on it&apos;s 7.5% (you keep <b style={{ color: 'var(--up)' }}>$92.50</b> of that $100). The rate is locked in when
        each order is placed, and the sell flow shows your exact net payout before you list, no math required.
      </p>

      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', marginTop: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: 'var(--txt)' }}>Running a shop?</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
          Shop &amp; dealer accounts list unlimited cards for a flat <b style={{ color: 'var(--txt)' }}>$9.99/month</b>. Cancel anytime
          from your billing portal; your existing listings stay live through the end of the period. Individual collectors never pay a
          monthly fee, listing stays free.
        </p>
      </div>

      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '28px 0 10px' }}>How escrow protects both sides</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {STEPS.map(([t, d], i) => (
          <div key={t} style={{ display: 'flex', gap: 14, padding: '14px 16px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'var(--gold-soft)', color: 'var(--gold)', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13 }}>{i + 1}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{t}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{d}</div>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '28px 0 10px' }}>The fine print, plainly</h2>
      <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.7, display: 'grid', gap: 10 }}>
        <p><b style={{ color: 'var(--txt)' }}>Shipping:</b> sellers ship directly to buyers with tracking. Shipping cost is the seller&apos;s, price your cards accordingly.</p>
        <p><b style={{ color: 'var(--txt)' }}>Cancellations:</b> before shipment, either side can request cancellation. The buyer&apos;s payment hold is released in full, nobody is charged.</p>
        <p><b style={{ color: 'var(--txt)' }}>Disputes:</b> if a card arrives not as described, report a problem on the order. The payout freezes while GEMLINE reviews, and refunds go back to the original payment method.</p>
        <p><b style={{ color: 'var(--txt)' }}>Trades:</b> card-for-card trades are free. Cash sweeteners on a trade settle through the same escrow flow.</p>
        <p><b style={{ color: 'var(--txt)' }}>Payments:</b> handled end-to-end by Stripe. GEMLINE never stores card numbers.</p>
      </div>
    </div>
  );
}
