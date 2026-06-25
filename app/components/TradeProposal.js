'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fmt } from '../lib/data';

export default function TradeProposal({ targetUser, targetCards, onClose, onProposed }) {
  const { token, authFetch } = useAuth();
  const [myCards, setMyCards] = useState([]);
  const [selectedMine, setSelectedMine] = useState(new Set());
  const [selectedTheirs, setSelectedTheirs] = useState(new Set());
  const [cashOffer, setCashOffer] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Load my portfolio
  useEffect(() => {
    if (!token) return;
    authFetch('/api/portfolio')
      .then(r => r.ok ? r.json() : [])
      .then(data => setMyCards(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token, authFetch]);

  const toggleMine = (cardId) => {
    setSelectedMine(prev => {
      const n = new Set(prev);
      n.has(cardId) ? n.delete(cardId) : n.add(cardId);
      return n;
    });
  };

  const toggleTheirs = (cardId) => {
    setSelectedTheirs(prev => {
      const n = new Set(prev);
      n.has(cardId) ? n.delete(cardId) : n.add(cardId);
      return n;
    });
  };

  const myTotal = myCards.filter(c => selectedMine.has(c.cardId || c.id)).reduce((s, c) => s + (c.marketValue || Number(c.catalog_price) || 0), 0);
  const theirTotal = targetCards.filter(c => selectedTheirs.has(c.id)).reduce((s, c) => s + (c.price || 0), 0);
  const cash = Number(cashOffer) || 0;

  const handleSubmit = useCallback(async () => {
    if (selectedMine.size === 0 && selectedTheirs.size === 0) {
      setError('Select at least one card');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch('/api/trades/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toUserId: targetUser.id,
          offeredCardIds: Array.from(selectedMine),
          requestedCardIds: Array.from(selectedTheirs),
          cashOffer: Math.round(cash * 100),
          message: message || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to propose trade');
      } else {
        onProposed?.();
      }
    } catch {
      setError('Failed to send proposal');
    } finally {
      setSubmitting(false);
    }
  }, [selectedMine, selectedTheirs, cash, message, targetUser, authFetch, onProposed]);

  return (
    <div className="overlay on" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal trade-proposal-modal">
        <button className="modal-close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
        
        <h2 style={{ fontFamily: 'var(--disp)', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          Propose Trade
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
          Trade with @{targetUser.handle}
        </p>

        <div className="trade-proposal-columns">
          {/* Your cards */}
          <div className="trade-proposal-side">
            <div className="trade-proposal-side-header">
              <span>Your Cards</span>
              <span className="mono" style={{ color: 'var(--gold)', fontSize: 12 }}>{fmt(myTotal)}</span>
            </div>
            <div className="trade-proposal-cards">
              {myCards.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 12, padding: 16, textAlign: 'center' }}>
                  No cards in your portfolio
                </div>
              ) : myCards.map(card => {
                const cid = card.cardId || card.id;
                const selected = selectedMine.has(cid);
                return (
                  <div
                    key={cid}
                    className={`trade-card-item ${selected ? 'selected' : ''}`}
                    onClick={() => toggleMine(cid)}
                  >
                    <div className="trade-card-thumb" style={{
                      background: card.imageUrl || card.thumbnail
                        ? `url(${card.imageUrl || card.thumbnail}) center/cover`
                        : 'linear-gradient(135deg, var(--panel-2), var(--line))',
                    }} />
                    <div className="trade-card-info">
                      <div className="trade-card-name">{card.player}</div>
                      <div className="trade-card-detail">{card.grader || 'RAW'} {card.grade || ''}</div>
                    </div>
                    <div className="trade-card-price">{fmt(card.marketValue || Number(card.catalog_price) || 0)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Swap icon */}
          <div className="trade-proposal-swap">⇄</div>

          {/* Their cards */}
          <div className="trade-proposal-side">
            <div className="trade-proposal-side-header">
              <span>Their Cards</span>
              <span className="mono" style={{ color: 'var(--gold)', fontSize: 12 }}>{fmt(theirTotal)}</span>
            </div>
            <div className="trade-proposal-cards">
              {targetCards.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 12, padding: 16, textAlign: 'center' }}>
                  No cards in their portfolio
                </div>
              ) : targetCards.map(card => {
                const selected = selectedTheirs.has(card.id);
                return (
                  <div
                    key={card.id}
                    className={`trade-card-item ${selected ? 'selected' : ''}`}
                    onClick={() => toggleTheirs(card.id)}
                  >
                    <div className="trade-card-thumb" style={{
                      background: card.thumbnail
                        ? `url(${card.thumbnail}) center/cover`
                        : 'linear-gradient(135deg, var(--panel-2), var(--line))',
                    }} />
                    <div className="trade-card-info">
                      <div className="trade-card-name">{card.player}</div>
                      <div className="trade-card-detail">{card.grader || 'RAW'} {card.grade || ''}</div>
                    </div>
                    <div className="trade-card-price">{fmt(card.price || 0)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Cash offer + message */}
        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', letterSpacing: '.08em' }}>CASH OFFER ($)</label>
            <input
              type="number"
              placeholder="0"
              value={cashOffer}
              onChange={e => setCashOffer(e.target.value)}
              min="0"
              style={{
                width: '100%', marginTop: 4, background: 'var(--panel)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '8px 12px', color: 'var(--txt)', fontSize: 13, outline: 'none',
              }}
            />
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', letterSpacing: '.08em' }}>MESSAGE (OPTIONAL)</label>
            <input
              type="text"
              placeholder="Add a note..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={200}
              style={{
                width: '100%', marginTop: 4, background: 'var(--panel)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '8px 12px', color: 'var(--txt)', fontSize: 13, outline: 'none',
              }}
            />
          </div>
        </div>

        {error && <div style={{ color: 'var(--down)', fontSize: 13, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', fontSize: 13, color: 'var(--muted)', borderRadius: 8, border: '1px solid var(--line)' }}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting || (selectedMine.size === 0 && selectedTheirs.size === 0)}
            style={{ padding: '10px 24px', fontSize: 13, opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? 'Sending...' : 'Propose Trade'}
          </button>
        </div>
      </div>
    </div>
  );
}
