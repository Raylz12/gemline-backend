'use client';
import { useCardStore } from './CardStore';

export default function StatBar() {
  const { totalCards } = useCardStore();
  const stats = [
    { k: '24h Volume', v: '—', d: 'Coming soon', cls: 'up', glow: 'rgba(232,179,57,.13)' },
    { k: 'Active Listings', v: '—', d: 'Marketplace launching', cls: 'up', glow: 'rgba(52,216,138,.12)' },
    { k: 'Cards in Catalog', v: totalCards ? totalCards.toLocaleString() : '—', d: 'Priced by Card Hedge', cls: 'gold', glow: 'rgba(91,141,239,.12)' },
    { k: 'Live Auctions', v: '—', d: 'Coming soon', cls: 'down', glow: 'rgba(255,92,108,.12)' },
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
