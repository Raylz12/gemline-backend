'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const SPORT_FILTERS = ['All', 'Basketball', 'Baseball', 'Football', 'Pokemon', 'Hockey', 'Soccer'];
const SPORT_EMOJIS = { Basketball: '🏀', Baseball: '⚾', Football: '🏈', Pokemon: '🃏', Hockey: '🏒', Soccer: '⚽' };

function StoreCard({ store }) {
  const initial = (store.store_name || store.handle || 'S')[0].toUpperCase();
  const listingCount = Number(store.listing_count) || 0;
  const followerCount = Number(store.follower_count) || 0;

  return (
    <Link href={`/store/${store.handle}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14,
        padding: 20, cursor: 'pointer', transition: 'border-color .15s, transform .15s',
        display: 'flex', flexDirection: 'column', gap: 14, height: '100%',
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = 'none'; }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, flexShrink: 0,
            background: store.avatar_url ? 'transparent' : 'linear-gradient(135deg, #16c784, #0d9463)',
            display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800, color: '#000',
            overflow: 'hidden',
          }}>
            {store.avatar_url
              ? <img src={store.avatar_url} alt={store.store_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 15, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {store.store_name || store.handle}
              </div>
              {store.store_verified && (
                <span style={{ fontSize: 10, color: 'var(--gold)', background: 'rgba(22,199,132,.12)', border: '1px solid rgba(22,199,132,.3)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>✓ Verified</span>
              )}
            </div>
            {store.store_location && (
              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>📍 {store.store_location}</div>
            )}
          </div>
        </div>

        {/* Description */}
        {store.store_description && (
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: 0,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {store.store_description}
          </p>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, marginTop: 'auto' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16, color: 'var(--gold)' }}>{listingCount.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 1 }}>Listings</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16, color: 'var(--txt)' }}>{followerCount}</div>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 1 }}>Followers</div>
          </div>
          {store.rating && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16, color: 'var(--up)' }}>★ {Number(store.rating).toFixed(1)}</div>
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 1 }}>Rating</div>
            </div>
          )}
        </div>

        <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--gold)', color: '#000', fontWeight: 700, fontSize: 12, textAlign: 'center' }}>
          Visit Store →
        </div>
      </div>
    </Link>
  );
}

function StoreSkeleton() {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: 20 }}>
      {[52, 12, 8, 8, 32].map((h, i) => (
        <div key={i} style={{ height: h, background: 'var(--panel-2)', borderRadius: 6, marginBottom: 12, opacity: 0.5 }} />
      ))}
    </div>
  );
}

export default function StoresPage() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: 48 });
    if (sport !== 'All') params.set('sport', sport);
    fetch(`/api/stores?${params}`)
      .then(r => r.json())
      .then(d => { setStores(d.stores || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sport]);

  const filtered = search
    ? stores.filter(s => (s.store_name || s.handle).toLowerCase().includes(search.toLowerCase()) || (s.store_location || '').toLowerCase().includes(search.toLowerCase()))
    : stores;

  return (
    <>
      <div className="eyebrow">Marketplace</div>
      <h1 className="page">Verified Stores</h1>
      <p className="sub">Shop directly from real card dealers and collectors.</p>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '20px 0' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)' }}>
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search stores..."
            style={{ width: '100%', paddingLeft: 32, padding: '9px 12px 9px 32px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--txt)', fontSize: 13, outline: 'none' }} />
        </div>
        <div className="seg" style={{ flexShrink: 0 }}>
          {SPORT_FILTERS.map(s => (
            <button key={s} className={sport === s ? 'on' : ''} onClick={() => setSport(s)}>
              {SPORT_EMOJIS[s] || ''} {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {[...Array(8)].map((_, i) => <StoreSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏪</div>
          <div style={{ fontFamily: 'var(--disp)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No stores yet</div>
          <p style={{ color: 'var(--muted)', marginBottom: 20 }}>Be the first verified dealer on Gemline.</p>
          <Link href="/sell" style={{ padding: '10px 24px', background: 'var(--gold)', color: '#000', borderRadius: 9, fontWeight: 700, textDecoration: 'none' }}>
            Apply to Sell →
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {filtered.map(s => <StoreCard key={s.id} store={s} />)}
        </div>
      )}
    </>
  );
}
