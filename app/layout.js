import './globals.css';
import { AuthProvider } from './components/AuthContext';
import { CardStoreProvider } from './components/CardStore';
import ClientLayout from './components/ClientLayout';
import ErrorBoundary from './components/ErrorBoundary';

export const metadata = {
  metadataBase: new URL('https://gemlinecards.com'),
  title: 'GEMLINE — The Card Exchange',
  description: 'Buy, sell, and trade sports cards and Pokémon. Real-time pricing, arbitrage engine, virtual pack rips, and AI-powered search across 500K+ cards.',
  robots: { index: true, follow: true },
  alternates: { canonical: './' },   // resolves per-page against metadataBase — do not hardcode the homepage
  openGraph: {
    title: 'GEMLINE — The Card Exchange',
    description: 'Buy, sell, and trade sports cards and Pokémon. Real-time pricing, arbitrage engine, and AI-powered search across 500K+ cards.',
    url: 'https://gemlinecards.com',
    siteName: 'GEMLINE',
    images: [{ url: 'https://gemlinecards.com/og-image.png', width: 1200, height: 630, alt: 'GEMLINE — The Card Exchange' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GEMLINE — The Card Exchange',
    description: 'Buy, sell, and trade sports cards and Pokémon. Real-time pricing, arbitrage engine, and AI-powered search across 500K+ cards.',
    images: ['https://gemlinecards.com/og-image.png'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#07080d" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Barlow:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ErrorBoundary>
          <AuthProvider>
            <CardStoreProvider>
              <ClientLayout>{children}</ClientLayout>
            </CardStoreProvider>
          </AuthProvider>
        </ErrorBoundary>
        <div id="toasts"></div>
      </body>
    </html>
  );
}
