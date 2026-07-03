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
    blurb: 'Know what your cards are worth — live data, every grade.',
    links: [
      { href: '/analytics', label: 'Price Guide' },
      { href: '/arbitrage', label: 'Deals' },
      { href: '/portfolio', label: 'My Collection' },
      { href: '/community', label: 'Community' },
    ],
  },
  {
    title: 'Company',
    blurb: 'Who we are and how to reach us.',
    links: [
      { href: '/about', label: 'About' },
      { href: '/faq', label: 'FAQ' },
      { href: '/contact', label: 'Contact' },
    ],
  },
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
            GEMLINE is the card show, online — by collectors, for collectors.
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
      <div className="ft-base">© {new Date().getFullYear()} GEMLINE — The Card Show, Online. Prices powered by Card Hedge.</div>
    </footer>
  );
}
