'use client';
// Pre-sale Q&A — public questions on a card's listings, answered by the
// seller. Visible to all visitors; asking requires login; answering is
// seller-only (inline form appears when the viewer owns the listing).
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ListingQA({ cardId, listings = [], onNeedAuth }) {
  const { token, user, authFetch } = useAuth();
  const [questions, setQuestions] = useState([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [answering, setAnswering] = useState(null); // question id
  const [answerText, setAnswerText] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    if (!cardId) return;
    fetch(`/api/cards/${cardId}/questions`)
      .then(r => r.json())
      .then(d => setQuestions(d.questions || []))
      .catch(() => {});
  }, [cardId]);

  useEffect(() => { load(); }, [load]);

  // Ask targets the lowest-priced active listing (first — API sorts by price).
  const askable = listings.find(l => l.seller_id && l.seller_id !== user?.id);

  const ask = async () => {
    if (!token) { onNeedAuth?.(); return; }
    const q = text.trim();
    if (q.length < 5) { setMsg('Ask a real question (5+ characters)'); return; }
    setPosting(true);
    setMsg('');
    try {
      const res = await authFetch(`/api/listings/${askable.id}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || 'Failed to post question');
      else { setText(''); setMsg('Question sent — the seller has been notified ✓'); load(); }
    } catch { setMsg('Failed to post question'); }
    setPosting(false);
  };

  const submitAnswer = async (qid) => {
    const a = answerText.trim();
    if (!a) return;
    setPosting(true);
    try {
      const res = await authFetch(`/api/questions/${qid}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: a }),
      });
      if (res.ok) { setAnswering(null); setAnswerText(''); load(); }
    } catch {}
    setPosting(false);
  };

  if (questions.length === 0 && !askable) return null;

  return (
    <div className="cd-block" data-testid="listing-qa">
      <h4 className="cd-h4">Questions {questions.length > 0 ? `(${questions.length})` : ''}</h4>

      {questions.length > 0 ? (
        <div style={{ display: 'grid', gap: 10, marginBottom: askable ? 12 : 0 }}>
          {questions.map(q => (
            <div key={q.id} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 13, color: 'var(--txt)' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginRight: 6 }}>Q</span>
                {q.question}
              </div>
              <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 3 }}>
                @{q.asker_handle || 'collector'} · {timeAgo(q.created_at)}
              </div>
              {q.answer ? (
                <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: '2px solid var(--gold)' }}>
                  <div style={{ fontSize: 13, color: 'var(--txt)' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--gold)', marginRight: 6 }}>A</span>
                    {q.answer}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 3 }}>
                    @{q.seller_handle || 'seller'} (seller) · {timeAgo(q.answered_at)}
                  </div>
                </div>
              ) : user?.id === q.seller_id ? (
                answering === q.id ? (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <input autoFocus value={answerText} onChange={e => setAnswerText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitAnswer(q.id); }}
                      maxLength={1000} placeholder="Your public answer…" className="cd-input" style={{ flex: 1 }} />
                    <button className="cd-mini-buy" disabled={posting} onClick={() => submitAnswer(q.id)}>Post</button>
                  </div>
                ) : (
                  <button className="cd-mini-ghost" style={{ marginTop: 8 }} onClick={() => { setAnswering(q.id); setAnswerText(''); }}>
                    Answer this
                  </button>
                )
              ) : (
                <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6 }}>Awaiting seller’s answer…</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          No questions yet — ask the seller anything before you buy.
        </div>
      )}

      {askable && (
        <div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') ask(); }}
              maxLength={500}
              placeholder={`Ask @${askable.seller_handle || 'the seller'} about this card…`}
              className="cd-input" style={{ flex: 1 }} />
            <button className="cd-mini-buy" disabled={posting} onClick={ask}>
              {posting ? '…' : 'Ask'}
            </button>
          </div>
          {msg && <div style={{ fontSize: 11, marginTop: 6, color: msg.includes('✓') ? 'var(--up)' : 'var(--down)' }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
