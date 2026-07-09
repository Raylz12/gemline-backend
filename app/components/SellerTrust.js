'use client';
// Seller trust signals — completed sales, ship speed, dispute record.
// Renders nothing until stats load AND the seller has ≥1 completed sale
// (backend enforces the same gating). Module-level cache dedupes fetches
// when the same seller appears in several listing rows.
import { useState, useEffect } from 'react';

const cache = new Map(); // sellerId -> Promise<stats>

function fetchStats(sellerId) {
  if (!cache.has(sellerId)) {
    cache.set(sellerId, fetch(`/api/sellers/${sellerId}/stats`)
      .then(r => r.json())
      .catch(() => ({ hasStats: false })));
  }
  return cache.get(sellerId);
}

export default function SellerTrust({ sellerId, compact = false }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!sellerId) return;
    let alive = true;
    fetchStats(sellerId).then(s => { if (alive) setStats(s); });
    return () => { alive = false; };
  }, [sellerId]);

  if (!stats?.hasStats) return null;

  const items = [];
  items.push({ icon: '✓', label: `${stats.completedSales} completed sale${stats.completedSales !== 1 ? 's' : ''}`, color: 'var(--up)' });
  if (stats.avgShipLabel) items.push({ icon: '📦', label: stats.avgShipLabel, color: 'var(--txt)' });
  if (stats.disputeFree) items.push({ icon: '🛡', label: 'Dispute-free', color: 'var(--gold)' });
  else if (stats.disputeRate != null) items.push({ icon: '⚖', label: `${stats.disputeRate}% dispute rate`, color: 'var(--muted)' });

  if (compact) {
    return (
      <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
        {items.map((it, i) => (
          <span key={i} style={{ color: it.color }} title="Seller track record">{it.icon} {it.label}</span>
        ))}
      </span>
    );
  }

  return (
    <div data-testid="seller-trust" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
      {items.map((it, i) => (
        <span key={i} title="Seller track record" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
          borderRadius: 7, fontSize: 11, fontWeight: 600,
          background: 'var(--panel)', border: '1px solid var(--line)', color: it.color,
        }}>
          <span className="emoji" style={{ fontSize: 11 }}>{it.icon}</span> {it.label}
        </span>
      ))}
    </div>
  );
}
