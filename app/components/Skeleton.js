'use client';

// Reusable shimmer skeleton for loading states
export function SkeletonCard({ count = 12 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      gap: 12,
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card" style={{
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
        }}>
          <div className="skeleton-img" style={{ aspectRatio: '3/4', background: 'var(--panel-2)' }} />
          <div style={{ padding: '8px 10px' }}>
            <div className="skeleton-line" style={{ height: 11, width: '80%', marginBottom: 6 }} />
            <div className="skeleton-line" style={{ height: 9, width: '55%', marginBottom: 6 }} />
            <div className="skeleton-line" style={{ height: 14, width: '45%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ count = 6 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 12, borderRadius: 8,
          background: 'var(--panel)', border: '1px solid var(--line)',
        }}>
          <div className="skeleton-line" style={{ width: 44, height: 60, borderRadius: 6, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton-line" style={{ height: 12, width: '60%', marginBottom: 6 }} />
            <div className="skeleton-line" style={{ height: 10, width: '40%' }} />
          </div>
          <div className="skeleton-line" style={{ width: 60, height: 16 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonProfile() {
  return (
    <div style={{ padding: '0 0 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <div className="skeleton-line" style={{ width: 72, height: 72, borderRadius: '50%' }} />
        <div style={{ flex: 1 }}>
          <div className="skeleton-line" style={{ height: 20, width: '30%', marginBottom: 8 }} />
          <div className="skeleton-line" style={{ height: 12, width: '50%' }} />
        </div>
      </div>
      <SkeletonCard count={6} />
    </div>
  );
}

export function SkeletonInline({ width = '100%', height = 14, borderRadius = 4, style = {} }) {
  return (
    <div className="skeleton-line" style={{ width, height, borderRadius, ...style }} />
  );
}
