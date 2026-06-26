'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const CHIPS = [
  'undervalued basketball rookies under $500',
  'Wembanyama Prizm Silver PSA 10',
  'Charizard 151 Holo',
  'hot baseball cards trending up 10%+',
  'Patrick Mahomes Mosaic',
  'Pikachu VMAX Alt Art',
  'Cooper Flagg 2025 Topps',
  'cheap football rookies under $20',
];

function fmtP(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + Number(n).toFixed(2);
}

export default function ScoutOverlay({ onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const search = async (q) => {
    const sq = q || query;
    if (!sq.trim()) return;
    setLoading(true);
    setSummary('');
    setResults([]);
    try {
      const r = await fetch('/api/scout/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sq }),
      });
      const data = await r.json();
      setResults(data.results || []);
      setSummary(data.summary || '');
    } catch {}
    setLoading(false);
  };

  return (
    <div className="scout-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="scout-sheet">
        <button className="modal-close" onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, zIndex: 5 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <div className="sheet-pad">
          <div className="eyebrow">AI Scout</div>
          <h2 className="sheet-h">Ask the market</h2>
          <p className="sheet-sub">
            Describe what you're hunting for in plain English. The scout searches Card Hedge's 3.5M+ card database with AI matching.
          </p>
          <div className="scout-bar">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="undervalued basketball rookies under $1500 with a 12%+ spread"
              autoFocus
            />
            <button onClick={() => search()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3z"/>
              </svg>
              Scout
            </button>
          </div>

          <div className="scout-chips">
            {CHIPS.map(c => (
              <button key={c} className="scout-chip" onClick={() => { setQuery(c); search(c); }}>{c}</button>
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
              <div key={i} className="scout-res" onClick={() => {
                onClose();
                // Navigate to marketplace with search
                router.push('/?q=' + encodeURIComponent(card.player || card.description || ''));
              }}>
                <div className="mini" style={{
                  background: card.image
                    ? `url(${card.image.startsWith('//') ? 'https:' + card.image : card.image}) center/cover`
                    : 'linear-gradient(135deg, #2a2a2a, #555)',
                }} />
                <div>
                  <div className="nm">{card.player || card.description}</div>
                  <div className="why">
                    {card.set} · {card.variant || 'Base'}
                    {card.number ? ` · #${card.number}` : ''}
                    {card.rookie && ' · RC'}
                    {card.confidence ? ` · ${(card.confidence * 100).toFixed(0)}% match` : ''}
                    {card['30 Day Sales'] ? ` · ${card['30 Day Sales']} sales/30d` : ''}
                  </div>
                </div>
                <div className="pr">
                  {card.prices && card.prices.length > 0 ? (
                    <div>
                      {card.prices.slice(0, 3).map((p, j) => (
                        <div key={j} style={{ fontSize: j === 0 ? 14 : 11, color: j === 0 ? 'var(--txt)' : 'var(--muted)' }}>
                          {p.grade}: {fmtP(Number(p.price))}
                        </div>
                      ))}
                    </div>
                  ) : <span style={{ color: 'var(--dim)' }}>—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
