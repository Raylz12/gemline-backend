'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fmt } from '../lib/data';
import { toast } from '../lib/toast';
import Link from 'next/link';
import { SkeletonList } from './Skeleton';

function TradeCard({ card }) {
  return (
    <div className="trade-item">
      <div className="mini" style={{
        width: 32, height: 44, borderRadius: 5, flexShrink: 0,
        background: card.thumbnail
          ? `url(${card.thumbnail}) center/cover`
          : 'linear-gradient(135deg, #2a2a2a, #555)',
      }} />
      <div className="ti">
        {card.player}
        <small>{card.grader} {card.grade} {' '}{fmt(card.market)}</small>
      </div>
    </div>
  );
}

function CashItem({ v }) {
  return <div className="trade-item cash">+ {fmt(v / 100)} cash</div>;
}

export default function TradesContent() {
  const { user, token, authFetch } = useAuth();
  const [tab, setTab] = useState('incoming');
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchProposals = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try {
      const res = await authFetch('/api/trades/proposals');
      if (res.ok) {
        const data = await res.json();
        setIncoming(data.incoming || []);
        setOutgoing(data.outgoing || []);
      }
    } catch (e) { console.warn('Failed to load proposals', e); }
    finally { setLoading(false); }
  }, [token, authFetch]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  const updateProposal = useCallback(async (id, status) => {
    try {
      const res = await authFetch(`/api/trades/proposals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast(status === 'accepted' ? 'Trade accepted!' : status === 'declined' ? 'Trade declined' : 'Trade cancelled');
        fetchProposals();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || 'Failed to update', true);
      }
    } catch { toast('Failed to update trade', true); }
  }, [authFetch, fetchProposals]);

  const list = tab === 'incoming' ? incoming : outgoing;

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--muted)' }}>
          <p style={{ fontSize: 15, marginBottom: 6 }}>Sign in to view your trades</p>
        <p style={{ fontSize: 13 }}>Propose swaps, add cash, and see fair-value scoring.</p>
      </div>
    );
  }

  return (
    <>
      <div className="trade-actions">
        <Link href="/community" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', fontSize: 13, textDecoration: 'none' }}>
          + Find someone to trade with
        </Link>
        <div className="seg">
          <button className={tab === 'incoming' ? 'on' : ''} onClick={() => setTab('incoming')}>
            Incoming <span>{incoming.filter(p => p.status === 'pending').length}</span>
          </button>
          <button className={tab === 'outgoing' ? 'on' : ''} onClick={() => setTab('outgoing')}>
            Outgoing <span>{outgoing.filter(p => p.status === 'pending').length}</span>
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonList count={3} />
      ) : (
        <div className="trade-list">
          {list.length === 0 && (
            <div className="empty">
              <div style={{ fontSize: 32, marginBottom: 12 }}>{tab === 'incoming' ? '📬' : '📤'}</div>
              <div className="big">No {tab} offers</div>
              {tab === 'incoming'
                ? 'Offers people send you will appear here. Browse the community to find traders.'
                : <span>No outgoing offers. <Link href="/community" style={{ color: 'var(--gold)' }}>Find someone to trade with →</Link></span>
              }
            </div>
          )}
          {list.map(proposal => {
            const offeredCards = proposal.offered_cards || [];
            const requestedCards = proposal.requested_cards || [];
            const offeredValue = offeredCards.reduce((s, c) => s + (c.market || 0), 0);
            const requestedValue = requestedCards.reduce((s, c) => s + (c.market || 0), 0);
            const cashCents = proposal.cash_offer || 0;
            const isPending = proposal.status === 'pending';
            const isIncoming = tab === 'incoming';
            const otherHandle = isIncoming ? proposal.from_handle : proposal.to_handle;
            const statusColors = { pending: 'var(--gold)', accepted: 'var(--up)', declined: 'var(--down)', cancelled: 'var(--muted)' };
            const giveCards = isIncoming ? requestedCards : offeredCards;
            const getCards = isIncoming ? offeredCards : requestedCards;
            const giveValue = isIncoming ? requestedValue : offeredValue;
            const getValue = isIncoming ? offeredValue : requestedValue;
            const delta = getValue - giveValue + (isIncoming ? (cashCents / 100) : -(cashCents / 100));

            return (
              <div key={proposal.id} className="trade-offer">
                <div className="toprow">
                  <div className="who">
                    <Link href={`/user/${otherHandle}`} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}>
                      <span className="av">{(otherHandle || 'U')[0].toUpperCase()}</span>
                      {isIncoming ? `${otherHandle} wants to trade` : `Offer to ${otherHandle}`}
                    </Link>
                  </div>
                  <span className="when" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: statusColors[proposal.status], fontSize: 11, fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>
                      {proposal.status}
                    </span>
                    {new Date(proposal.created_at).toLocaleDateString()}
                  </span>
                </div>
                {proposal.message && (
                  <div style={{ color: 'var(--muted)', fontSize: 12, fontStyle: 'italic', padding: '4px 0 8px' }}>
                    &ldquo;{proposal.message}&rdquo;
                  </div>
                )}
                <div className="trade-body">
                  <div className="trade-side">
                    <span className="lab">You give</span>
                    {giveCards.map((c, i) => <TradeCard key={i} card={c} />)}
                    {!isIncoming && cashCents > 0 && <CashItem v={cashCents} />}
                    {giveCards.length === 0 && !(!isIncoming && cashCents > 0) && (
                      <div style={{ color: 'var(--muted)', fontSize: 12, padding: 8 }}>Nothing</div>
                    )}
                  </div>
                  <div className="trade-arrow">⇄</div>
                  <div className="trade-side">
                    <span className="lab">You receive</span>
                    {getCards.map((c, i) => <TradeCard key={i} card={c} />)}
                    {isIncoming && cashCents > 0 && <CashItem v={cashCents} />}
                    {getCards.length === 0 && !(isIncoming && cashCents > 0) && (
                      <div style={{ color: 'var(--muted)', fontSize: 12, padding: 8 }}>Nothing</div>
                    )}
                  </div>
                </div>
                <div className="trade-delta">
                  <div className="meter">
                    <div className="lab">
                      <span>Value to you</span>
                      <span className="mono" style={{ color: delta >= 0 ? 'var(--up)' : 'var(--down)' }}>
                        {delta >= 0 ? '+' : ''}{fmt(delta)}
                      </span>
                    </div>
                  </div>
                  {isPending && (
                    <div className="trade-cta">
                      {isIncoming ? (
                        <>
                          <button className="accept" onClick={() => updateProposal(proposal.id, 'accepted')}>Accept</button>
                          <button className="decline" onClick={() => updateProposal(proposal.id, 'declined')}>Decline</button>
                        </>
                      ) : (
                        <button className="cancel" onClick={() => updateProposal(proposal.id, 'cancelled')}>Cancel offer</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
