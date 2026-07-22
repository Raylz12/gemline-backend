// Server-rendered public card page — one indexable URL per catalog card.
// Lightweight by design: raw HTML carries title/meta/OG/JSON-LD for crawlers
// and links back into the app for humans. Cached via ISR for 24h.
import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../lib/serverDb';
import { rewriteImg } from '../../../lib/img.js';

export const revalidate = 86400; // 24h ISR
export const dynamicParams = true;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getCard = cache(async (id) => {
  if (!UUID_RE.test(id)) return null;
  const { rows: [card] } = await db().query(
    `SELECT c.id, c.player, c.year, c.card_set, c.variant, c.number, c.sport, c.grader, c.grade,
            c.catalog_price, c.ch_price_lo, c.ch_price_hi, c.sales_7d, c.sales_30d, c.gain_7d,
            c.rookie, c.psa_pop_10, c.psa_pop_total,
            COALESCE(c.r2_thumb, c.ebay_thumb) AS ebay_thumb, c.image_url,
            cs.slug AS set_slug
     FROM cards c LEFT JOIN card_sets cs ON cs.name = c.card_set
     WHERE c.id = $1`, [id]
  );
  return card || null;
});

const getListings = cache(async (id) => {
  if (!UUID_RE.test(id)) return [];
  const { rows } = await db().query(
    `SELECT id, price, kind FROM listings
     WHERE card_id = $1 AND status = 'active' ORDER BY price ASC LIMIT 5`, [id]
  );
  return rows;
});

function cardName(c) {
  const setName = (c.card_set || '').trim();
  const yearPrefix = c.year && !setName.startsWith(String(c.year)) ? `${c.year} ` : '';
  const grade = c.grader && c.grade ? ` ${c.grader} ${c.grade}` : '';
  const num = c.number ? ` #${c.number}` : '';
  const variant = c.variant && c.variant !== 'Base' ? ` ${c.variant}` : '';
  return `${yearPrefix}${setName}${variant} ${c.player}${num}${grade}`.replace(/\s+/g, ' ').trim();
}

const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generateMetadata({ params }) {
  const { id } = await params;
  const card = await getCard(id);
  if (!card) return { title: 'Card Not Found | GEMLINE' };
  const name = cardName(card);
  const price = Number(card.catalog_price) > 0 ? Number(card.catalog_price) : null;
  const title = `${name} Price & Market Value | GEMLINE`;
  const description = price
    ? `${name} current market value: ${usd(price)}. ${Number(card.sales_30d) > 0 ? `${card.sales_30d} sales in the last 30 days. ` : ''}Live price tracking, listings, and market data on GEMLINE.`
    : `${name}, live price tracking, listings, and market data on GEMLINE, the card show online.`;
  // Dynamic dark-brand OG composition (player/set/grade/price) — rendered
  // by app/og/card/[id]/route.js with next/og.
  const img = `https://gemlinecards.com/og/card/${card.id}`;
  return {
    title,
    description,
    alternates: { canonical: `https://gemlinecards.com/card/${card.id}` },
    openGraph: {
      title, description,
      url: `https://gemlinecards.com/card/${card.id}`,
      siteName: 'GEMLINE', type: 'website',
      images: [{ url: img, width: 1200, height: 630, alt: name }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [img] },
  };
}

export default async function CardPage({ params }) {
  const { id } = await params;
  const card = await getCard(id);
  if (!card) notFound();
  const listings = await getListings(id);

  const { rows: related } = await db().query(
    `SELECT id, player, card_set, year, grader, grade, catalog_price
     FROM cards WHERE player = $1 AND id != $2 AND catalog_price > 0
     ORDER BY sales_30d DESC NULLS LAST LIMIT 10`, [card.player, id]
  );

  const name = cardName(card);
  const price = Number(card.catalog_price) > 0 ? Number(card.catalog_price) : null;
  const gain = card.gain_7d != null ? Number(card.gain_7d) : null;
  const lowestAsk = listings.length ? Number(listings[0].price) / 100 : null;
  const img = rewriteImg(card.ebay_thumb) || card.image_url || null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    sku: card.id,
    ...(img ? { image: img } : {}),
    description: `${name} graded trading card. Market value ${price ? usd(price) : 'tracked'} on GEMLINE.`,
    ...(card.grader ? { brand: { '@type': 'Brand', name: card.grader } } : {}),
    category: card.sport || 'Trading Cards',
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: (lowestAsk ?? price ?? 0).toFixed(2),
      availability: listings.length ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `https://gemlinecards.com/card/${card.id}`,
    },
  };

  const stat = (label, value, color) => (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '.1em', color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--txt)' }}>{value}</div>
    </div>
  );

  return (
    <>
      {/* \u003c-escape prevents </script> breakout via user-influenced card fields */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14, fontFamily: 'var(--mono)' }}>
          <Link href="/" style={{ color: 'var(--dim)' }}>GEMLINE</Link>
          {' / '}
          <Link href="/market" style={{ color: 'var(--dim)' }}>Market</Link>
          {card.set_slug && <>{' / '}<Link href={`/sets/${card.set_slug}`} style={{ color: 'var(--dim)' }}>{card.card_set}</Link></>}
          {' / '}<span style={{ color: 'var(--muted)' }}>{card.player}</span>
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Server component: no DOM event handlers (onError here throws
             "Event handlers cannot be passed to Client Component props" and 500s
             the whole route). Broken images degrade to alt text gracefully. */}
          {img && (
            <img src={img} alt={name}
              style={{ width: 220, maxWidth: '40vw', borderRadius: 12, border: '1px solid var(--line)', objectFit: 'cover' }} />
          )}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="eyebrow">{card.sport || 'Trading Card'}{card.rookie ? ' · Rookie' : ''}</div>
            <h1 className="page" style={{ fontSize: 30, lineHeight: 1.15, marginBottom: 8 }}>{name}</h1>
            <p className="sub" style={{ marginBottom: 18 }}>
              Live market value, sales volume, and listings for this card on GEMLINE, the card show, online.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
              {stat('Market Value', price ? usd(price) : '—', 'var(--gold)')}
              {gain != null && stat('7-Day Change', `${gain > 0 ? '+' : ''}${gain.toFixed(1)}%`, gain >= 0 ? 'var(--up)' : 'var(--down)')}
              {Number(card.sales_30d) > 0 && stat('Sales (30d)', card.sales_30d)}
              {lowestAsk != null && stat('Lowest Ask', usd(lowestAsk), 'var(--up)')}
              {Number(card.psa_pop_10) > 0 && stat('PSA 10 Pop', Number(card.psa_pop_10).toLocaleString())}
            </div>

            {/* Deep-link into the interactive app view of THIS card — a Google
                visitor can buy/offer/watch it, not just land on a generic page. */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link href={`/market?card=${card.id}`} className="buy" style={{ padding: '11px 22px', fontSize: 13, borderRadius: 9, textDecoration: 'none', display: 'inline-block' }}>
                {listings.length > 0 ? `Buy from ${usd(Number(listings[0].price) / 100)}` : 'Buy · Offer · Watch'}
              </Link>
              <Link href={`/market?card=${card.id}`} className="offer" style={{ padding: '11px 22px', fontSize: 13, borderRadius: 9, textDecoration: 'none', display: 'inline-block' }}>
                Price History &amp; Comps
              </Link>
            </div>
          </div>
        </div>

        {listings.length > 0 && (
          <div style={{ marginTop: 30 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Live Listings</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {listings.map(l => (
                <Link key={l.id} href={`/market?card=${card.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, textDecoration: 'none' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>{l.kind === 'auction' ? 'Auction' : 'Buy Now'}</span>
                  <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>{usd(Number(l.price) / 100)} →</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {related.length > 0 && (
          <div style={{ marginTop: 30 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>More {card.player} Cards</h2>
            <div style={{ display: 'grid', gap: 6 }}>
              {related.map(rc => (
                <Link key={rc.id} href={`/card/${rc.id}`}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, textDecoration: 'none', color: 'var(--txt)', fontSize: 13 }}>
                  <span>{cardName(rc)}</span>
                  <span className="mono" style={{ color: 'var(--gold)', fontWeight: 600, whiteSpace: 'nowrap' }}>{usd(rc.catalog_price)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
