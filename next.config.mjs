/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compress all responses for smaller payloads
  compress: true,

  // Granular image domains
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '942284f33c575895b4be9de571ca6e40.cdn.bubble.io' },
      { protocol: 'https', hostname: 'i.ebayimg.com' },
      { protocol: 'https', hostname: 'cdn.nba.com' },
      { protocol: 'https', hostname: 'a.espncdn.com' },
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
      { protocol: 'https', hostname: 'cdn.wnba.com' },
      { protocol: 'https', hostname: '*.cardhedger.com' },
      { protocol: 'https', hostname: '*.cdninstagram.com' },
    ],
    // Prefer modern formats
    formats: ['image/avif', 'image/webp'],
    // Cache optimized images longer
    minimumCacheTTL: 86400,
  },

  async headers() {
    return [
      {
        // Security headers on all routes
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // camera=(self): the portfolio card scanner uses getUserMedia on our own origin
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
      {
        // Short cache for API responses — no-store for auth, short for public
        source: '/api/(.*)',
        headers: [
          { key: 'Vary', value: 'Accept-Encoding, Authorization' },
        ],
      },
    ];
  },

  // Turbopack config (used by default in Next.js 16+)
  turbopack: {},

  async rewrites() {
    return [];
  },

  // Deal Finder merged into the unified /market surface. Old standalone route
  // permanently redirects to the Deals tab so shared links never 404.
  async redirects() {
    return [
      { source: '/arbitrage', destination: '/market?tab=deals', permanent: true },
      { source: '/arbitrage/:path*', destination: '/market?tab=deals', permanent: true },
    ];
  },
};
export default nextConfig;
