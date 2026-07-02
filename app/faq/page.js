export const metadata = {
  title: 'FAQ — GEMLINE',
  description: 'Frequently asked questions about pricing, buying, selling, and trading on GEMLINE.',
  alternates: { canonical: '/faq' },
};

const FAQS = [
  {
    q: 'Where do prices come from?',
    a: 'Market prices are sourced from Card Hedge and refreshed continuously. Low/high ranges reflect recent sales data; they are estimates, not guarantees.',
  },
  {
    q: 'How do I sell a card?',
    a: 'Go to Portfolio → Sell, search the catalog for your card, set a price, and list it. Buyers can purchase outright or send offers if you allow them.',
  },
  {
    q: 'What fees does GEMLINE charge?',
    a: 'A marketplace fee applies on completed sales. Net figures shown on the Arbitrage desk already account for a 10% fee on the sell side.',
  },
  {
    q: 'What is the Arbitrage desk?',
    a: 'It surfaces cards trading below their fair-market value, showing the net edge after fees and the recent sales volume so you can judge exit liquidity before you act.',
  },
  {
    q: 'How do live auctions work?',
    a: 'Sellers list a card with a starting bid and duration. Buyers bid in real time on the Live floor; the highest bid at close wins.',
  },
];

export default function FaqPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="eyebrow">Help</div>
      <h1 className="page">Frequently Asked Questions</h1>
      <p className="sub">The basics of pricing, buying, selling, and trading.</p>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {FAQS.map((f, i) => (
          <div key={i} style={{ padding: '16px 18px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{f.q}</div>
            <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.65 }}>{f.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
