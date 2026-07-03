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
    a: 'Listing is free. When your card sells, GEMLINE keeps a 10% marketplace fee and you receive the rest — the sell flow shows your exact net payout before you list. Buyers pay the listed price.',
  },
  {
    q: 'What is the Deal Finder?',
    a: 'The Deal Finder (under Price Guide → Deals) surfaces cards listed below their fair market value, with the 10% fee already accounted for, plus recent sales volume so you can judge how liquid a card really is.',
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
