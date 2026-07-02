'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../components/AuthContext';
import { fmt } from '../../lib/data';
import { IconStore, IconPackage } from '../../components/Icons';

const SPORT_COLOR = { Basketball: '#f59e0b', Baseball: '#2563eb', Football: '#7c3aed', Pokemon: '#eab308', Hockey: '#0ea5e9', Soccer: '#16a34a' };

function ListingCard({ listing }) {
  return (
    <div style={{
      background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10,
      overflow: 'hidden', transition: 'border-color .15s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
    >
      <div style={{ height: 120, background: 'linear-gradient(135deg,#1a1f35,#2a3050)', display: 'grid', placeItems: 'center', position: 'relative' }}>
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 800, fontSize: 26, letterSpacing: '.02em', color: (SPORT_COLOR[listing.sport] || '#16c784') + 'cc' }}>
          {(listing.player || '?').split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase()}
        </span>
        <span style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 9, fontFamily: 'var(--mono)', letterSpacing: '.08em', color: 'rgba(255,255,255,.4)', textTransform: 'uppercase' }}>{listing.sport}</span>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{listing.player}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{listing.grader} {listing.grade} {' '}{listing.year}</div>
        <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: 'var(--gold)', marginTop: 6 }}>{fmt(listing.ask_cents / 100)}</div>
      </div>
    </div>
  );
}

export default function StorePage() {
  const { handle } = useParams();
  const { user, authFetch } = useAuth();
  const [store, setStore] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [tab, setTab] = useState('listings');

  useEffect(() => {
    fetch(`/api/store/${handle}`)
      .then(r => r.json())
      .then(d => {
        setStore(d.store);
        setListings(d.listings || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [handle]);

  const toggleFollow = async () => {
    if (!user) return;
    const method = following ? 'DELETE' : 'POST';
    await authFetch(`/api/users/${store.id}/follow`, { method });
    setFollowing(!following);
  };

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading store...</div>
  );

  if (!store) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--gold-soft)', color: 'var(--gold)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}><IconStore size={30} /></div>
      <div style={{ fontFamily: 'var(--disp)', fontSize: 22, fontWeight: 700 }}>Store not found</div>
      <Link href="/stores" style={{ color: 'var(--gold)', marginTop: 12, display: 'inline-block' }}>← Browse all stores</Link>
    </div>
  );

  const initial = (store.store_name || store.handle || 'S')[0].toUpperCase();

  return (
    <>
      {/* Store header */}
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            width: 72, height: 72, borderRadius: 16, flexShrink: 0,
            background: 'linear-gradient(135deg, #16c784, #0d9463)',
            display: 'grid', placeItems: 'center', fontSize: 30, fontWeight: 800, color: '#000',
          }}>{initial}</div>

          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: 'var(--disp)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                {store.store_name || store.handle}
              </h1>
              {store.store_verified && (
                <span style={{ fontSize: 11, color: 'var(--gold)', background: 'rgba(22,199,132,.12)', border: '1px solid rgba(22,199,132,.3)', borderRadius: 5, padding: '2px 7px' }}>✓ Verified Store</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>@{store.handle}</div>
            {store.store_location && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>📍 {store.store_location}</div>}
            {store.store_description && <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10, lineHeight: 1.55, maxWidth: 500 }}>{store.store_description}</p>}

            <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
              {[
                ['Listings', Number(store.listing_count) || 0],
                ['Followers', Number(store.follower_count) || 0],
                ['Total Sales', store.total_sales_cents ? fmt(store.total_sales_cents / 100) : '—'],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16, color: 'var(--gold)' }}>{val}</div>
                  <div style={{ fontSize: 10, color: 'var(--dim)' }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            {user && user.handle !== handle && (
              <button onClick={toggleFollow} style={{
                padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: following ? 'var(--panel-2)' : 'var(--gold)',
                color: following ? 'var(--muted)' : '#000',
                border: '1px solid var(--line)',
              }}>{following ? 'Following' : 'Follow Store'}</button>
            )}
            {store.store_website && (
              <a href={store.store_website} target="_blank" rel="noopener noreferrer" style={{
                padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: 'none', color: 'var(--muted)', border: '1px solid var(--line)', textDecoration: 'none', textAlign: 'center',
              }}>Website ↗</a>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="seg" style={{ marginBottom: 20 }}>
        <button className={tab === 'listings' ? 'on' : ''} onClick={() => setTab('listings')}>
          Listings <span style={{ marginLeft: 4, background: 'var(--panel-2)', padding: '1px 6px', borderRadius: 10, fontSize: 10 }}>{listings.length}</span>
        </button>
        <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>About</button>
      </div>

      {tab === 'listings' && (
        listings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)' }}>
            <div style={{ color: 'var(--dim)', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><IconPackage size={32} /></div>
            <div style={{ fontWeight: 600 }}>No active listings</div>
            <p style={{ fontSize: 13, marginTop: 6 }}>This store hasn't listed any cards yet.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {listings.map(l => <ListingCard key={l.id} listing={l} />)}
          </div>
        )
      )}

      {tab === 'about' && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' }}>
            {store.store_description || 'No description provided.'}
          </div>
          {store.store_website && (
            <div style={{ marginTop: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--dim)' }}>Website: </span>
              <a href={store.store_website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)', fontSize: 12 }}>{store.store_website}</a>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--dim)' }}>
            Member since {new Date(store.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </div>
        </div>
      )}
    </>
  );
}
