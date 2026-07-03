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
import Footer from './Footer';
import Onboarding from './Onboarding';

export default function ClientLayout({ children }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Fresh signup (AuthContext sets the pending flag) → one-time preference flow.
  useEffect(() => {
    if (!user) return;
    try {
      if (localStorage.getItem('gemline_onboard') === 'pending') setShowOnboarding(true);
    } catch {}
  }, [user]);
  const closeOnboarding = () => {
    try { localStorage.setItem('gemline_onboard', 'done'); } catch {}
    setShowOnboarding(false);
  };

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
      {/* Landing renders its own Footer inside its fixed scroll container */}
      {!isLanding && <Footer />}
      {showOnboarding && <Onboarding onClose={closeOnboarding} />}
      <NetworkStatus />
    </>
  );
}
