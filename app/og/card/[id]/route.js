// Dynamic OG image per card — dark-brand 1200×630 composition rendered with
// next/og. Text-only by design: card images live on an external Bubble CDN
// that is too slow/unreliable to fetch inside ImageResponse.
// NOTE: this lives at /og/... (NOT /api/og/...) because vercel.json routes
// every /api/* request to the Express monolith.
import { ImageResponse } from 'next/og';
import { db } from '../../../lib/serverDb';

export const revalidate = 86400; // card OG changes at most daily

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BG = '#0b0d12';
const GOLD = '#c9a44c';
const TXT = '#e8e6df';
const MUTED = '#8a877d';

function Frame({ children }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: BG, padding: 64, justifyContent: 'space-between',
      backgroundImage: `linear-gradient(135deg, ${BG} 0%, #11141c 100%)`,
    }}>
      {children}
    </div>
  );
}

function Wordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, background: GOLD, color: '#141006',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, fontWeight: 800,
      }}>G</div>
      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 6, color: GOLD, display: 'flex' }}>GEMLINE</div>
      <div style={{ fontSize: 20, color: MUTED, marginLeft: 8, display: 'flex' }}>the card show, online</div>
    </div>
  );
}

export async function GET(req, { params }) {
  const { id } = await params;
  let card = null;
  if (UUID_RE.test(id)) {
    try {
      const { rows: [row] } = await db().query(
        `SELECT player, year, card_set, variant, number, sport, grader, grade, catalog_price, gain_7d
         FROM cards WHERE id = $1`, [id]);
      card = row || null;
    } catch (e) {
      console.error('[og/card] db error:', e.message);
    }
  }

  if (!card) {
    return new ImageResponse(
      (
        <Frame>
          <Wordmark />
          <div style={{ fontSize: 64, fontWeight: 800, color: TXT, display: 'flex' }}>Every card, priced live.</div>
          <div style={{ fontSize: 26, color: MUTED, display: 'flex' }}>gemlinecards.com</div>
        </Frame>
      ),
      { width: 1200, height: 630 }
    );
  }

  const setLine = [card.year, card.card_set, card.variant && card.variant !== 'Base' ? card.variant : null, card.number ? `#${String(card.number).replace(/^#/, '')}` : null]
    .filter(Boolean).join(' · ');
  const gradeLabel = card.grader && card.grade ? `${card.grader} ${card.grade}` : (card.grader || 'RAW');
  const price = Number(card.catalog_price) > 0 ? usd(card.catalog_price) : null;
  const gain = card.gain_7d != null && Number(card.gain_7d) !== 0 ? Number(card.gain_7d) : null;
  const player = String(card.player || 'Trading Card');

  return new ImageResponse(
    (
      <Frame>
        <Wordmark />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{
            fontSize: player.length > 20 ? 72 : 92, fontWeight: 800, color: TXT,
            lineHeight: 1.05, display: 'flex',
          }}>{player}</div>
          {setLine ? <div style={{ fontSize: 30, color: MUTED, display: 'flex' }}>{setLine}</div> : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 8 }}>
            <div style={{
              display: 'flex', padding: '10px 22px', borderRadius: 12,
              border: `2px solid ${GOLD}`, color: GOLD, fontSize: 30, fontWeight: 700,
            }}>{gradeLabel}</div>
            {price ? (
              <div style={{ display: 'flex', fontSize: 54, fontWeight: 800, color: GOLD }}>{price}</div>
            ) : (
              <div style={{ display: 'flex', fontSize: 30, color: MUTED }}>Price tracked live</div>
            )}
            {gain != null ? (
              <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: gain > 0 ? '#16c784' : '#ea3943' }}>
                {gain > 0 ? '▲' : '▼'} {Math.abs(gain).toFixed(1)}% 7d
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 24, color: MUTED, display: 'flex' }}>{card.sport || 'Trading Cards'} · live market price</div>
          <div style={{ fontSize: 24, color: GOLD, display: 'flex' }}>gemlinecards.com</div>
        </div>
      </Frame>
    ),
    { width: 1200, height: 630 }
  );
}
