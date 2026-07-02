'use client';
import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Marketplace',
    blurb: 'Browse, bid, and buy from sellers across the exchange.',
    links: [
      { href: '/market', label: 'Market' },
      { href: '/live', label: 'Live' },
      { href: '/stores', label: 'Stores' },
    ],
  },
  {
    title: 'Tools',
    blurb: 'Track your value and spot the edge with live data.',
    links: [
      { href: '/analytics', label: 'Analytics' },
      { href: '/heatmap', label: 'Heatmap' },
      { href: '/arbitrage', label: 'Arbitrage' },
      { href: '/portfolio', label: 'Portfolio' },
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
            GEMLINE is a trading card exchange. Prices sourced from Card Hedge.
            Trading collectibles carries risk.
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
      <div className="ft-base">© {new Date().getFullYear()} GEMLINE — The Card Exchange. Prices powered by Card Hedge.</div>
    </footer>
  );
}
