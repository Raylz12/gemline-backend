// Metadata wrapper for the (client-component) market page — sets the
// dynamic OG image rendered at /og/market.
export const metadata = {
  title: 'Marketplace — Every Card, Priced Live | GEMLINE',
  description: 'Browse 287,000+ trading cards with live market prices. Buy, sell, and trade sports cards and Pokémon with escrow protection on GEMLINE.',
  alternates: { canonical: 'https://gemlinecards.com/market' },
  openGraph: {
    title: 'GEMLINE Marketplace — Every Card, Priced Live',
    description: 'Browse 287,000+ trading cards with live market prices. Buy, sell, and trade with escrow protection.',
    url: 'https://gemlinecards.com/market',
    siteName: 'GEMLINE', type: 'website',
    images: [{ url: 'https://gemlinecards.com/og/market', width: 1200, height: 630, alt: 'GEMLINE Marketplace' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GEMLINE Marketplace — Every Card, Priced Live',
    description: 'Browse 287,000+ trading cards with live market prices.',
    images: ['https://gemlinecards.com/og/market'],
  },
};

export default function MarketLayout({ children }) {
  return children;
}
