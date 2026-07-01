'use client';
import { useCardStore } from './CardStore';
import { useState, useEffect } from 'react';

export default function StatBar() {
  const { totalCards } = useCardStore();
  const [liveStats, setLiveStats] = useState(null);

  useEffect(() => {
    fetch('/api/stats/live')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setLiveStats(d))
      .catch(() => {});
  }, []);

  const stats = [
    {
      k: 'Active Listings',
      v: liveStats?.activeListings != null ? liveStats.activeListings.toLocaleString() : '—',
      d: liveStats?.activeListings != null ? 'Live marketplace' : 'Loading…',
      cls: 'up',
      glow: 'rgba(52,216,138,.12)',
    },
    {
      k: 'Cards in Catalog',
      v: totalCards ? totalCards.toLocaleString() : (liveStats?.totalCards ? liveStats.totalCards.toLocaleString() : '—'),
      d: 'Priced by Card Hedge',
      cls: 'gold',
      glow: 'rgba(91,141,239,.12)',
    },
    {
      k: 'Users',
      v: liveStats?.users != null ? liveStats.users.toLocaleString() : '—',
      d: liveStats?.users != null ? 'Collectors & traders' : 'Loading…',
      cls: 'up',
      glow: 'rgba(22,199,132,.13)',
    },
    {
      k: 'Pack Pulls',
      v: liveStats?.totalPulls != null ? liveStats.totalPulls.toLocaleString() : '—',
      d: liveStats?.totalPulls != null ? 'Total cards pulled' : 'Loading…',
      cls: 'down',
      glow: 'rgba(155,123,255,.12)',
    },
  ];

  return (
    <div className="statbar">
      {stats.map((s, i) => (
        <div key={i} className="stat" style={{ '--glow': s.glow }}>
          <div className="k">{s.k}</div>
          <div className="v mono">{s.v}</div>
          <div className={`d ${s.cls}`}>{s.d}</div>
        </div>
      ))}
    </div>
  );
}
