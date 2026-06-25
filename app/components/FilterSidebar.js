'use client';
import { SPORT_THEME } from '../lib/data';
import { fmtDisplay } from '../lib/data';

const SPORT_COLORS = {
  Basketball: '#7b4dd6', Football: '#2f8f5b', Baseball: '#c0473a',
  Hockey: '#3a6ea5', Soccer: '#1fb89a', 'Pokémon': '#e8b339',
  WNBA: '#d6478f', F1: '#e23b3b', UFC: '#888',
  Golf: '#4a9d5e', College: '#6a4dd6',
};

export default function FilterSidebar({ filters, setFilters, cards, sportCounts, brandCounts, totalCards, onBrandChange }) {
  // Merge known sports with any from server data
  const knownSports = Object.keys(SPORT_THEME);
  const serverSports = (sportCounts || []).map(s => s.sport).filter(s => !knownSports.includes(s));
  const sports = ['All', ...knownSports, ...serverSports];
  const grades = ['All', 'PSA', 'BGS', 'SGC', 'RAW'];
  const types = ['All', 'buy', 'auction'];

  const cardTypes = [
    { key: 'all', label: 'All Cards' },
    { key: 'rookie', label: 'Rookie Cards', icon: '🌟' },
    { key: 'base', label: 'Base Cards', icon: '📇' },
    { key: 'parallel', label: 'Parallels', icon: '✨' },
    { key: 'auto', label: 'Autographs', icon: '✍️', soon: true },
  ];

  const countMap = {};
  (sportCounts || []).forEach(s => { countMap[s.sport] = s.count; });
  const sportCount = (s) => s === 'All' ? (totalCards || cards.length) : (countMap[s] || cards.filter(c => c.sport === s).length);

  return (
    <aside className="rail">
      <h4>Sport</h4>
      <div>
        {sports.map(s => {
          const count = sportCount(s);
          if (s !== 'All' && count === 0) return null;
          return (
            <button key={s} className={`facet ${s === filters.sport ? 'on' : ''}`}
              onClick={() => setFilters(f => ({ ...f, sport: s }))}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {s !== 'All' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: SPORT_COLORS[s] || 'var(--dim)', flexShrink: 0 }} />}
                {s}
              </span>
              <span className="ct">{count >= 1000 ? (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : count}</span>
            </button>
          );
        })}
      </div>

      {brandCounts && brandCounts.length > 0 && (
        <>
          <div className="railsplit" />
          <h4>Brand / Set</h4>
          <div>
            <button className={`facet ${!filters.brand ? 'on' : ''}`}
              onClick={() => { setFilters(f => ({ ...f, brand: '' })); onBrandChange?.(''); }}>
              <span>All Brands</span>
            </button>
            {brandCounts.slice(0, 15).map(b => (
              <button key={b.brand} className={`facet ${filters.brand === b.brand ? 'on' : ''}`}
                onClick={() => { setFilters(f => ({ ...f, brand: b.brand })); onBrandChange?.(b.brand); }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{b.brand}</span>
                <span className="ct">{b.count >= 1000 ? (b.count / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : b.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="railsplit" />
      <h4>Card Type</h4>
      <div>
        {cardTypes.map(ct => (
          <button key={ct.key} className={`facet ${(filters.cardType || 'all') === ct.key ? 'on' : ''}`}
            onClick={() => !ct.soon && setFilters(f => ({ ...f, cardType: ct.key }))}
            style={ct.soon ? { opacity: 0.4, cursor: 'default' } : {}}>
            <span>{ct.icon ? `${ct.icon} ` : ''}{ct.label}</span>
            {ct.soon && <span className="ct" style={{ fontSize: 9 }}>Soon</span>}
          </button>
        ))}
      </div>

      <div className="railsplit" />
      <h4>Grade</h4>
      <div>
        {grades.map(g => (
          <button key={g} className={`facet ${g === filters.grade ? 'on' : ''}`}
            onClick={() => setFilters(f => ({ ...f, grade: g }))}>
            <span>{g === 'All' ? 'All grades' : g}</span>
          </button>
        ))}
      </div>

      <div className="railsplit" />
      <h4>Max Price</h4>
      <div className="rangewrap">
        <div className="lab"><span>$0</span><span>{fmtDisplay(filters.maxPrice)}</span></div>
        <input type="range" min="0" max="50000" step="100" value={filters.maxPrice}
          onChange={e => setFilters(f => ({ ...f, maxPrice: +e.target.value }))} />
      </div>

      <div className="railsplit" />
      <h4>Listing</h4>
      <div>
        {types.map(t => (
          <button key={t} className={`facet ${t === filters.type ? 'on' : ''}`}
            onClick={() => setFilters(f => ({ ...f, type: t }))}>
            <span>{t === 'All' ? 'All listings' : t === 'buy' ? 'Buy it now' : 'Live auction'}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
