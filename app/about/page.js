export const metadata = {
  title: 'About — GEMLINE',
  description: 'GEMLINE is a trading card exchange with real-time pricing, an arbitrage engine, and a live auction floor.',
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="eyebrow">Company</div>
      <h1 className="page">About GEMLINE</h1>
      <p className="sub">The card market, priced in real time.</p>

      <div style={{ marginTop: 24, fontSize: 15, lineHeight: 1.7, color: 'var(--muted)' }}>
        <p style={{ marginBottom: 16 }}>
          GEMLINE is a trading card exchange for sports cards and Pokémon. We bring
          real-time market data to a hobby that has run on guesswork for decades —
          live pricing across hundreds of thousands of cards, an arbitrage desk that
          surfaces mispriced slabs, and a live auction floor where the whole market
          moves in front of you.
        </p>
        <p style={{ marginBottom: 16 }}>
          Prices are sourced from Card Hedge and refreshed continuously. Track your
          collection in your portfolio, list cards for sale, propose trades, and bid
          on live auctions — all in one place.
        </p>
        <p>
          Trading collectibles carries risk. Prices are estimates, not guarantees.
        </p>
      </div>
    </div>
  );
}
