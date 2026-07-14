'use client';
import Link from 'next/link';

const COLUMNS = [
  {
    title: 'The Floor',
    blurb: 'Buy, sell, bid, and trade with collectors who get it.',
    links: [
      { href: '/market', label: 'Market' },
      { href: '/live', label: 'Live Auctions' },
      { href: '/sell', label: 'Sell a Card' },
      { href: '/trades', label: 'Trades' },
      { href: '/stores', label: 'Stores' },
    ],
  },
  {
    title: 'Toolkit',
    blurb: 'Know what your cards are worth. Live data, every grade.',
    links: [
      { href: '/market', label: 'Price Guide' },
      { href: '/market?tab=deals', label: 'Deal Finder' },
      { href: '/market?tab=grading', label: 'Worth Grading' },
      { href: '/analytics', label: 'Market Movers' },
      { href: '/portfolio', label: 'My Collection' },
      { href: '/community', label: 'Community' },
    ],
  },
  {
    title: 'Company',
    blurb: 'Who we are and how to reach us.',
    links: [
      { href: '/about', label: 'About' },
      { href: '/fees', label: 'Fees & Payouts' },
      { href: '/faq', label: 'FAQ' },
      { href: '/contact', label: 'Contact' },
    ],
  },
];

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/seller-agreement', label: 'Seller Agreement' },
];

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="ft-inner">
        <div className="ft-brand">
          <div className="ft-brand-row">
            <div className="logo">G</div>
            <div className="wordmark">GEM<span>LINE</span></div>
          </div>
          <p className="ft-dis">
            GEMLINE is the card show, online, by collectors, for collectors.
            Prices sourced from Card Hedge. Collectibles carry risk; prices are
            estimates, not guarantees.
          </p>
        </div>
        <div className="ft-cols">
          {COLUMNS.map(col => (
            <div key={col.title} className="ft-col">
              <div className="ft-col-title">{col.title}</div>
              <div className="ft-col-blurb">{col.blurb}</div>
              <nav className="ft-col-links">
                {col.links.map(l => (
                  <Link key={l.href} href={l.href}>{l.label}</Link>
                ))}
              </nav>
            </div>
          ))}
        </div>
      </div>
      <div className="ft-base">
        <span>© {new Date().getFullYear()} GEMLINE | The Card Show, Online. Prices powered by Card Hedge.</span>
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 14, marginLeft: 14 }}>
          {LEGAL_LINKS.map(l => (
            <Link key={l.href} href={l.href} style={{ color: 'inherit' }}>{l.label}</Link>
          ))}
        </span>
      </div>
    </footer>
  );
}
