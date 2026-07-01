'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthContext';
import Landing from './Landing';
import Ticker from './Ticker';
import Header from './Header';
import MobileNav from './MobileNav';
import AuthModal from './AuthModal';
import NetworkStatus from './NetworkStatus';

export default function ClientLayout({ children }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [showAuthGate, setShowAuthGate] = useState(false);

  // Landing page shown at root '/', all other pages show normal layout
  const isLanding = pathname === '/';

  return (
    <>
      {isLanding && <Landing />}
      {!isLanding && <Ticker />}
      {!isLanding && <Header />}
      <main>
        {isLanding ? null : children}
      </main>
      {!isLanding && <MobileNav />}
      {!isLanding && <footer>
        <div className="foot">
          <div>
            <div className="fb">
              <div className="logo">G</div>
              <div className="wordmark">GEM<span>LINE</span></div>
            </div>
            <p className="dis" style={{ marginTop: 14 }}>
              GEMLINE is a trading card exchange. Prices sourced from Card Hedge. Trading collectibles carries risk.
            </p>
          </div>
          <div className="links">
            <a href="/market">Market</a><a href="/sell">Sell</a><a href="/stores">Stores</a><a href="/analytics">Analytics</a><a href="/packs">Mystery Pulls</a><a href="/community">Community</a><a href="/live">Live</a>
          </div>
        </div>
      </footer>}
      <NetworkStatus />
    </>
  );
}
