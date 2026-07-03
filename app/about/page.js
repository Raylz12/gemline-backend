export const metadata = {
  title: 'About — GEMLINE',
  description: 'GEMLINE is the card show, online — a marketplace built by collectors, for collectors, with live pricing on hundreds of thousands of cards.',
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="eyebrow">Company</div>
      <h1 className="page">About GEMLINE</h1>
      <p className="sub">The card show, online.</p>

      <div style={{ marginTop: 24, fontSize: 15, lineHeight: 1.7, color: 'var(--muted)' }}>
        <p style={{ marginBottom: 16 }}>
          GEMLINE is built on a simple idea: the best part of the hobby is the card
          show — the tables, the trades, the haggling, the finds — and it deserves
          a real home online. Buy, sell, and trade sports cards and Pokémon with
          collectors who get it, with every deal backed by live market prices
          instead of guesswork.
        </p>
        <p style={{ marginBottom: 16 }}>
          We price hundreds of thousands of cards continuously, sourced from Card
          Hedge, so you always know what a card is worth before you buy it, sell
          it, or trade it straight across. Track your collection, list cards in
          seconds, propose card-for-card trades with a fair-value meter, bid on
          live auctions, and hunt deals priced below fair value — all in one place.
        </p>
        <p style={{ marginBottom: 16 }}>
          By collectors, for collectors. No suits, no ticker-tape cosplay — just
          the show floor, open 24/7.
        </p>
        <p>
          Collectibles carry risk. Prices are estimates, not guarantees.
        </p>
      </div>
    </div>
  );
}
