// Per-set page — set header, top cards by value, full paginated checklist
// with variant filter. Server-rendered for SEO; every card links to its
// detail page. Backed by card_sets (summary) + idx_cards_set_price.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { db } from '../../lib/serverDb';
import { rewriteImg } from '../../../lib/img.js';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const SLUG_RE = /^[a-z0-9-]{1,120}$/;
const usd = (n) => {
  const v = Number(n) || 0;
  return v >= 1000 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
};

const getSet = cache(async (slug) => {
  if (!SLUG_RE.test(slug)) return null;
  const { rows: [set] } = await db().query(`SELECT * FROM card_sets WHERE slug = $1`, [slug]);
  return set || null;
});

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const set = await getSet(slug);
  if (!set) return { title: 'Set Not Found | GEMLINE' };
  const title = `${set.name} Checklist & Card Values | GEMLINE`;
  const range = Number(set.price_max) > 0 ? ` Values from ${usd(set.price_min)} to ${usd(set.price_max)}.` : '';
  const description = `${set.name}, full checklist of ${Number(set.family_count).toLocaleString()} cards with live market prices.${range} ${set.sport || 'Trading cards'} price guide on GEMLINE.`;
  const url = `https://gemlinecards.com/sets/${set.slug}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'GEMLINE', type: 'website', images: [{ url: 'https://gemlinecards.com/og/market', width: 1200, height: 630, alt: set.name }] },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function SetPage({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const set = await getSet(slug);
  if (!set) notFound();

  const page = Math.max(1, parseInt(sp.page) || 1);
  const variant = (sp.variant || '').slice(0, 80).trim();

  // Top cards by value (family-deduped in JS from tier rows)
  const topQ = db().query(
    `SELECT id, player, variant, number, grader, grade, catalog_price,
            COALESCE(r2_thumb, ebay_thumb) AS ebay_thumb, image_url, rookie, cardhedge_id
     FROM cards WHERE card_set = $1 AND catalog_price > 0 AND catalog_price <= 5000000
     ORDER BY catalog_price DESC LIMIT 40`, [set.name]);

  // Variant chips (most common first)
  const varQ = db().query(
    `SELECT COALESCE(NULLIF(variant,''),'Base') AS v, count(*)::int AS c
     FROM cards WHERE card_set = $1 GROUP BY 1 ORDER BY c DESC LIMIT 18`, [set.name]);

  // Checklist page — family-grouped so grade tiers don't duplicate rows
  const condsP = [set.name];
  let varCond = '';
  if (variant) { condsP.push(variant === 'Base' ? '' : variant); varCond = ` AND COALESCE(variant,'') = $2`; }
  const listQ = db().query(
    `SELECT (array_agg(id ORDER BY catalog_price DESC NULLS LAST))[1] AS id,
            player, COALESCE(NULLIF(variant,''),'Base') AS variant, number,
            max(catalog_price) AS price_max,
            min(catalog_price) FILTER (WHERE catalog_price > 0) AS price_min,
            count(*)::int AS tiers, bool_or(rookie) AS rookie,
            count(*) OVER () AS _total
     FROM cards WHERE card_set = $1${varCond}
     GROUP BY player, variant, number
     ORDER BY NULLIF(regexp_replace(COALESCE(number,''), '[^0-9]', '', 'g'), '')::numeric NULLS LAST,
              number NULLS LAST, player
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, condsP);

  const [{ rows: topRaw }, { rows: variants }, { rows: checklist }] = await Promise.all([topQ, varQ, listQ]);

  // Dedupe top cards to one per family
  const seen = new Set();
  const topCards = topRaw.filter(c => {
    const key = c.cardhedge_id || `${c.player}|${c.variant}|${c.number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  const totalFamilies = checklist.length ? Number(checklist[0]._total) : 0;
  const pages = Math.max(1, Math.ceil((variant ? totalFamilies : Number(set.family_count) || totalFamilies) / PAGE_SIZE));
  const qs = (over) => {
    const u = new URLSearchParams();
    const merged = { variant, page: undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `/sets/${set.slug}?${s}` : `/sets/${set.slug}`;
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${set.name} Checklist`,
    url: `https://gemlinecards.com/sets/${set.slug}`,
    description: `Full checklist and live card values for ${set.name}.`,
    isPartOf: { '@type': 'WebSite', name: 'GEMLINE', url: 'https://gemlinecards.com' },
  };

  const stat = (label, value) => (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '.1em', color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: 'var(--txt)' }}>{value}</div>
    </div>
  );

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14, fontFamily: 'var(--mono)' }}>
          <Link href="/" style={{ color: 'var(--dim)' }}>GEMLINE</Link>{' / '}
          <Link href="/sets" style={{ color: 'var(--dim)' }}>Sets</Link>{' / '}
          <span style={{ color: 'var(--muted)' }}>{set.name}</span>
        </div>

        <div className="eyebrow">{[set.year, set.sport].filter(Boolean).join(' · ') || 'Trading Cards'}</div>
        <h1 className="page" style={{ fontSize: 28, lineHeight: 1.15, marginBottom: 8 }}>{set.name}</h1>
        <p className="sub" style={{ marginBottom: 16 }}>
          Full checklist with live market values, every card, every parallel, priced like the show floor.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 24 }}>
          {stat('Cards', Number(set.family_count).toLocaleString())}
          {Number(set.price_max) > 0 && stat('Price Range', `${usd(set.price_min)} to ${usd(set.price_max)}`)}
          {Number(set.sales_30d) > 0 && stat('Sales (30d)', Number(set.sales_30d).toLocaleString())}
        </div>

        {topCards.length > 0 && (
          <div style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Top Cards in This Set</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {topCards.map(c => (
                <Link key={c.id} href={`/card/${c.id}`}
                  style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: 10, textDecoration: 'none', color: 'var(--txt)' }}>
                  <span style={{ display: 'grid', placeItems: 'center', height: 110, borderRadius: 7, background: 'var(--panel-2)', overflow: 'hidden', marginBottom: 8 }}>
                    {(c.ebay_thumb || c.image_url)
                      ? <img src={rewriteImg(c.ebay_thumb) || c.image_url} alt={c.player} loading="lazy" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.4)' }}>{(c.player || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase()}</span>}
                  </span>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.player}</span>
                  <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--dim)', textTransform: 'uppercase', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[c.variant && c.variant !== 'Base' ? c.variant : null, c.number ? `#${c.number}` : null].filter(Boolean).join(' · ') || '\u00a0'}
                  </span>
                  <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 800, color: 'var(--gold)', marginTop: 4 }}>{usd(c.catalog_price)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
          Checklist{variant ? `, ${variant}` : ''} <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)', fontWeight: 400 }}>({(variant ? totalFamilies : Number(set.family_count)).toLocaleString()} cards)</span>
        </h2>

        {variants.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <Link href={qs({ variant: '' })} style={{ padding: '5px 12px', fontSize: 11.5, fontWeight: 600, borderRadius: 999, textDecoration: 'none', border: '1px solid', borderColor: !variant ? 'rgba(22,199,132,.5)' : 'var(--line)', color: !variant ? 'var(--gold)' : 'var(--muted)', background: !variant ? 'var(--gold-soft)' : 'var(--panel)' }}>All variants</Link>
            {variants.map(v => (
              <Link key={v.v} href={qs({ variant: v.v })}
                style={{ padding: '5px 12px', fontSize: 11.5, fontWeight: 600, borderRadius: 999, textDecoration: 'none', border: '1px solid', borderColor: variant === v.v ? 'rgba(22,199,132,.5)' : 'var(--line)', color: variant === v.v ? 'var(--gold)' : 'var(--muted)', background: variant === v.v ? 'var(--gold-soft)' : 'var(--panel)' }}>
                {v.v}
              </Link>
            ))}
          </div>
        )}

        {checklist.length === 0 ? (
          <p style={{ color: 'var(--muted)', padding: '30px 0' }}>No cards on this page.</p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {checklist.map(c => (
              <Link key={c.id} href={`/card/${c.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, textDecoration: 'none', color: 'var(--txt)', fontSize: 13 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', width: 52, flexShrink: 0 }}>{c.number ? `#${c.number}` : '—'}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {c.player}{c.rookie ? <span style={{ marginLeft: 6, fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--gold)', border: '1px solid rgba(22,199,132,.4)', borderRadius: 4, padding: '1px 4px', verticalAlign: 'middle' }}>RC</span> : null}
                </span>
                {c.variant !== 'Base' && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.variant}</span>}
                <span className="mono" style={{ fontWeight: 700, color: Number(c.price_max) > 0 ? 'var(--gold)' : 'var(--dim)', whiteSpace: 'nowrap' }}>
                  {Number(c.price_max) > 0 ? (Number(c.price_min) < Number(c.price_max) ? `${usd(c.price_min)} to ${usd(c.price_max)}` : usd(c.price_max)) : 'Price TBD'}
                </span>
              </Link>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 22, fontFamily: 'var(--mono)', fontSize: 12 }}>
            {page > 1 && <Link href={qs({ page: page - 1 })} style={{ color: 'var(--gold)', padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 8, textDecoration: 'none' }}>← Prev</Link>}
            <span style={{ color: 'var(--dim)' }}>Page {page} of {pages.toLocaleString()}</span>
            {page < pages && <Link href={qs({ page: page + 1 })} style={{ color: 'var(--gold)', padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 8, textDecoration: 'none' }}>Next →</Link>}
          </div>
        )}
      </div>
    </>
  );
}
