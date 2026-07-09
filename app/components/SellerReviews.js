'use client';
// Seller/store reviews — avg + count summary and review list. Renders nothing
// when the seller has no reviews yet (matches zero-stats gating elsewhere).
import { useState, useEffect } from 'react';

export function Stars({ value, size = 13 }) {
  return (
    <span style={{ fontSize: size, letterSpacing: 1, color: 'var(--gold)' }} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} style={{ opacity: i <= Math.round(value) ? 1 : 0.25 }}>★</span>
      ))}
    </span>
  );
}

export default function SellerReviews({ sellerId, compact = false, emptyText = null }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!sellerId) return;
    fetch(`/api/sellers/${sellerId}/reviews`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, [sellerId]);

  if (!data || data.count === 0) {
    if (emptyText && data && !compact) {
      return <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>{emptyText}</div>;
    }
    return null;
  }

  if (compact) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Stars value={data.avg} />
        <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
          {data.avg} ({data.count} review{data.count !== 1 ? 's' : ''})
        </span>
      </span>
    );
  }

  return (
    <div data-testid="seller-reviews" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h3 style={{ fontFamily: 'var(--disp)', fontSize: 16, fontWeight: 700, margin: 0 }}>Reviews</h3>
        <Stars value={data.avg} size={15} />
        <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
          {data.avg} · {data.count} review{data.count !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {data.reviews.map(rv => (
          <div key={rv.id} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Stars value={rv.rating} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>@{rv.reviewer_handle || 'buyer'}</span>
              {rv.player && <span style={{ fontSize: 11, color: 'var(--dim)' }}>· bought {rv.player}</span>}
              <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
                {new Date(rv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            {rv.body && <div style={{ fontSize: 13, color: 'var(--txt)', marginTop: 6, lineHeight: 1.5 }}>{rv.body}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
