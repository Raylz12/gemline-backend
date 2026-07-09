// Default OG image for /market — dark-brand 1200×630. Static per deploy.
import { ImageResponse } from 'next/og';

export const revalidate = 86400;

const BG = '#0b0d12';
const GOLD = '#c9a44c';
const TXT = '#e8e6df';
const MUTED = '#8a877d';

export async function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: BG, padding: 64, justifyContent: 'space-between',
        backgroundImage: `linear-gradient(135deg, ${BG} 0%, #11141c 100%)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, background: GOLD, color: '#141006',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800,
          }}>G</div>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 6, color: GOLD, display: 'flex' }}>GEMLINE</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 88, fontWeight: 800, color: TXT, lineHeight: 1.05, display: 'flex' }}>The Marketplace</div>
          <div style={{ fontSize: 32, color: MUTED, display: 'flex' }}>Every card, priced live — 287,000+ cards with real market data.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 24, color: MUTED, display: 'flex' }}>Buy · Sell · Trade · Escrow-protected</div>
          <div style={{ fontSize: 24, color: GOLD, display: 'flex' }}>gemlinecards.com/market</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
