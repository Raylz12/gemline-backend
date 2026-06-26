'use client';
import { useState } from 'react';

const SUGGESTIONS = [
  '2025 Topps Chrome Cooper Flagg',
  'Wembanyama Prizm Silver PSA 10',
  'Charizard 151 Holo',
  'Ohtani 2018 Topps Chrome Rookie',
  'Patrick Mahomes Mosaic',
  'Pikachu VMAX Alt Art',
];

export default function Scout({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);

  const search = async (q) => {
    const searchQuery = q || query;
    if (!searchQuery.trim()) return;
    setLoading(true);
    setSummary(null);
    setResults([]);
    try {
      const r = await fetch('/api/scout/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
      });
      const data = await r.json();
      setResults(data.results || []);
      setSummary(data.summary || null);
    } catch (e) {
      console.error('Scout search failed:', e);
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="scout-bar">
        <input
          placeholder="Describe any card... '2018 Topps Chrome Ohtani RC PSA 10'"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <button onClick={() => search()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg>
          Scout
        </button>
      </div>

      <div className="scout-chips">
        {SUGGESTIONS.map(s => (
          <button key={s} className="scout-chip" onClick={() => { setQuery(s); search(s); }}>{s}</button>
        ))}
      </div>

      {loading && (
        <div className="scout-loading">
          <div className="scout-spin" />
          Scouting the market...
        </div>
      )}

      {summary && (
        <div className="scout-summary">
          <span className="scout-ai-badge">AI</span>
          {summary}
        </div>
      )}

      <div className="scout-results">
        {results.map((card, i) => (
          <div key={i} className="scout-res" onClick={() => onSelect?.(card)}>
            <div className="mini" style={{
              background: card.image
                ? `url(${card.image.startsWith('//') ? 'https:' + card.image : card.image}) center/cover`
                : 'linear-gradient(135deg, #2a2a2a, #555)',
            }} />
            <div>
              <div className="nm">{card.player || card.description}</div>
              <div className="why">
                {card.set} · {card.variant || 'Base'}{card.number ? ` · #${card.number}` : ''}
                {card.rookie && ' · Rookie'}
                {card.confidence ? ` · ${(card.confidence * 100).toFixed(0)}% match` : ''}
              </div>
            </div>
            <div className="pr">
              {card.prices && card.prices.length > 0 ? (
                <div>
                  {card.prices.slice(0, 3).map((p, j) => (
                    <div key={j} style={{ fontSize: j === 0 ? 14 : 11, color: j === 0 ? 'var(--txt)' : 'var(--muted)' }}>
                      {p.grade}: ${Number(p.price).toLocaleString()}
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ color: 'var(--dim)' }}>—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
