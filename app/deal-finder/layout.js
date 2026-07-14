// Metadata wrapper for the (client-component) Deal Finder page — sets the
// dynamic OG image rendered at /og/deal-finder.
export const metadata = {
  title: 'Deal Finder: Cards Priced Below Fair Value | GEMLINE',
  description: 'Find cards priced below fair market value with fees already counted, plus a grading calculator that shows when a raw card is worth sending in.',
  alternates: { canonical: 'https://gemlinecards.com/deal-finder' },
  openGraph: {
    title: 'GEMLINE Deal Finder: Cards Priced Below Fair Value',
    description: 'Cards priced below fair value, fees already counted. Live across the whole market, refreshed all day.',
    url: 'https://gemlinecards.com/deal-finder',
    siteName: 'GEMLINE', type: 'website',
    images: [{ url: 'https://gemlinecards.com/og/deal-finder', width: 1200, height: 630, alt: 'GEMLINE Deal Finder' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GEMLINE Deal Finder: Cards Priced Below Fair Value',
    description: 'Cards priced below fair value, fees already counted. Live across the whole market.',
    images: ['https://gemlinecards.com/og/deal-finder'],
  },
};

export default function DealFinderLayout({ children }) {
  return children;
}
