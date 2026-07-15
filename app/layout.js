import './globals.css';
import { AuthProvider } from './components/AuthContext';
import { CardStoreProvider } from './components/CardStore';
import ClientLayout from './components/ClientLayout';
import ErrorBoundary from './components/ErrorBoundary';

export const metadata = {
  metadataBase: new URL('https://gemlinecards.com'),
  title: 'GEMLINE | The Card Show, Online',
  description: 'Buy, sell, and trade sports cards and Pokémon with collectors who get it. Live pricing, real trades, and AI-powered search across 500K+ cards.',
  robots: { index: true, follow: true },
  manifest: '/manifest.webmanifest',
  applicationName: 'GEMLINE',
  appleWebApp: { capable: true, title: 'GEMLINE', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  alternates: { canonical: './' },   // resolves per-page against metadataBase, do not hardcode the homepage
  openGraph: {
    title: 'GEMLINE | The Card Show, Online',
    description: 'Buy, sell, and trade sports cards and Pokémon with collectors who get it. Live pricing, real trades, and AI-powered search across 500K+ cards.',
    url: 'https://gemlinecards.com',
    siteName: 'GEMLINE',
    images: [{ url: 'https://gemlinecards.com/og-image.png', width: 1200, height: 630, alt: 'GEMLINE | The Card Show, Online' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GEMLINE | The Card Show, Online',
    description: 'Buy, sell, and trade sports cards and Pokémon with collectors who get it. Live pricing, real trades, and AI-powered search across 500K+ cards.',
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
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800;900&family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
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
