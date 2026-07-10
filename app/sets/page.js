// "Walk the aisles" — browsable index of every set in the catalog.
// Server-rendered for SEO; filters/search via plain GET params so every
// filtered view is a crawlable, shareable URL.
import Link from 'next/link';
import { db } from '../lib/serverDb';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 48;
const usd = (n) => {
  const v = Number(n) || 0;
  return v >= 1000 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
};

export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const sport = (sp.sport || '').slice(0, 40);
  const title = sport
    ? `${sport} Card Sets — Checklists & Values | GEMLINE`
    : 'Card Sets — Every Checklist & Price Guide | GEMLINE';
  const description = 'Walk the aisles: browse every trading card set by sport and year — full checklists, card counts, and live market values on GEMLINE.';
  return {
    title, description,
    alternates: { canonical: 'https://gemlinecards.com/sets' },
    openGraph: { title, description, url: 'https://gemlinecards.com/sets', siteName: 'GEMLINE', type: 'website', images: [{ url: 'https://gemlinecards.com/og/market', width: 1200, height: 630 }] },
  };
}

export default async function SetsIndex({ searchParams }) {
  const sp = await searchParams;
  const q = (sp.q || '').slice(0, 80).trim();
  const sport = (sp.sport || '').slice(0, 40).trim();
  const year = (sp.year || '').slice(0, 8).trim();
  const page = Math.max(1, parseInt(sp.page) || 1);

  const conds = [`card_count > 0`, `sport !~ '^[0-9]+x[0-9]+$'`];
  const params = [];
  if (q) { params.push(`%${q}%`); conds.push(`name ILIKE $${params.length}`); }
  if (sport) { params.push(sport); conds.push(`sport = $${params.length}`); }
  if (year) { params.push(year); conds.push(`year = $${params.length}`); }
  const where = `WHERE ${conds.join(' AND ')}`;

  const [{ rows: sets }, { rows: [{ count }] }, { rows: sportRows }, { rows: yearRows }] = await Promise.all([
    db().query(`SELECT slug, name, sport, year, card_count, family_count, price_min, price_max, sales_30d, thumbnail
                FROM card_sets ${where}
                ORDER BY sales_30d DESC NULLS LAST, card_count DESC
                LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params),
    db().query(`SELECT count(*) FROM card_sets ${where}`, params),
    db().query(`SELECT sport, count(*)::int AS c FROM card_sets
                WHERE sport IS NOT NULL AND sport <> '' AND sport !~ '^[0-9]+x[0-9]+$'
                GROUP BY sport ORDER BY c DESC LIMIT 8`),
    db().query(`SELECT DISTINCT year FROM card_sets
                WHERE year ~ '^(19|20)[0-9]{2}' ORDER BY year DESC LIMIT 60`),
  ]);

  const total = Number(count) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (over) => {
    const u = new URLSearchParams();
    const merged = { q, sport, year, page: undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `/sets?${s}` : '/sets';
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14, fontFamily: 'var(--mono)' }}>
        <Link href="/" style={{ color: 'var(--dim)' }}>GEMLINE</Link>{' / '}<span style={{ color: 'var(--muted)' }}>Sets</span>
      </div>
      <div className="eyebrow">Walk the aisles</div>
      <h1 className="page" style={{ fontSize: 30, lineHeight: 1.15, marginBottom: 6 }}>Card Sets</h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        {total.toLocaleString()} sets — every checklist, every year, priced live.
      </p>

      {/* Search + year — plain GET form, works without JS */}
      <form action="/sets" method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input name="q" defaultValue={q} placeholder="Search sets — e.g. Prizm, Topps Chrome…"
          style={{ flex: '1 1 220px', minWidth: 0, padding: '10px 14px', fontSize: 13, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--txt)' }} />
        <select name="year" defaultValue={year}
          style={{ padding: '10px 12px', fontSize: 13, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--txt)' }}>
          <option value="">All years</option>
          {yearRows.map(y => <option key={y.year} value={y.year}>{y.year}</option>)}
        </select>
        {sport && <input type="hidden" name="sport" value={sport} />}
        <button type="submit" className="buy" style={{ padding: '10px 18px', fontSize: 13, borderRadius: 9 }}>Search</button>
      </form>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        <Link href={qs({ sport: '' })} style={{ padding: '6px 13px', fontSize: 12, fontWeight: 600, borderRadius: 999, textDecoration: 'none', border: '1px solid', borderColor: !sport ? 'rgba(22,199,132,.5)' : 'var(--line)', color: !sport ? 'var(--gold)' : 'var(--muted)', background: !sport ? 'var(--gold-soft)' : 'var(--panel)' }}>All</Link>
        {sportRows.map(s => (
          <Link key={s.sport} href={qs({ sport: s.sport })}
            style={{ padding: '6px 13px', fontSize: 12, fontWeight: 600, borderRadius: 999, textDecoration: 'none', border: '1px solid', borderColor: sport === s.sport ? 'rgba(22,199,132,.5)' : 'var(--line)', color: sport === s.sport ? 'var(--gold)' : 'var(--muted)', background: sport === s.sport ? 'var(--gold-soft)' : 'var(--panel)' }}>
            {s.sport} <span style={{ opacity: .55, fontFamily: 'var(--mono)', fontSize: 10 }}>{s.c}</span>
          </Link>
        ))}
      </div>

      {sets.length === 0 ? (
        <p style={{ color: 'var(--muted)', padding: '40px 0', textAlign: 'center' }}>No sets match — try a different search.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {sets.map(s => (
            <Link key={s.slug} href={`/sets/${s.slug}`}
              style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, textDecoration: 'none', color: 'var(--txt)' }}>
              <span style={{ width: 44, height: 60, borderRadius: 6, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {s.thumbnail
                  ? <img src={s.thumbnail} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.45)' }}>{(s.year || '?').slice(0, 4)}</span>}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {[s.sport, `${Number(s.family_count).toLocaleString()} cards`].filter(Boolean).join(' · ')}
                </span>
                {Number(s.price_max) > 0 && (
                  <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', marginTop: 3 }}>
                    {usd(s.price_min)} – {usd(s.price_max)}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 26, fontFamily: 'var(--mono)', fontSize: 12 }}>
          {page > 1 && <Link href={qs({ page: page - 1 })} style={{ color: 'var(--gold)', padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 8, textDecoration: 'none' }}>← Prev</Link>}
          <span style={{ color: 'var(--dim)' }}>Page {page} of {pages.toLocaleString()}</span>
          {page < pages && <Link href={qs({ page: page + 1 })} style={{ color: 'var(--gold)', padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 8, textDecoration: 'none' }}>Next →</Link>}
        </div>
      )}
    </div>
  );
}
