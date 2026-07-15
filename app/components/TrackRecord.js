'use client';
// Our Track Record — receipts for the Deal Finder. Every price sync we
// snapshot the day's top-scored deals (deal_snapshots); once a snapshot is
// ≥7 days old it shows up here: the price when we flagged it vs the price
// now, plus how flagged deals moved vs the deal-band market median.
// Honest by design: no cherry-picking (every snapshot ≥7d old is shown,
// newest first) and an explicit empty state until the data matures.
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import CardThumb from './CardThumb';

const fmtP = (n) => {
  if (!n || n <= 0) return '—';
  if (n >= 1000) return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + Math.round(n);
  return '$' + Number(n).toFixed(2);
};
const pct = (n) => (n >= 0 ? '+' : '') + Number(n).toFixed(1) + '%';

function Stat({ label, value, sub, color = 'var(--txt)' }) {
  return (
    <div style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,.07)', borderRadius: 8, padding: '14px 16px', flex: 1, minWidth: 170 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--ui)', fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function TrackRecord() {
  const { authFetch } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    authFetch('/api/market/track-record')
      .then(r => r.json())
      .then(d => { if (!dead) { setData(d); setLoading(false); } })
      .catch(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [authFetch]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)' }}>LOADING TRACK RECORD…</div>;
  }

  const items = data?.items || [];
  const summary = data?.summary;
  const since = data?.trackingSince ? new Date(data.trackingSince) : null;

  if (!items.length) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ marginBottom: 12 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#34D88A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block' }}>
            <path d="M3 3v18h18" /><path d="m7 15 4-6 4 3 5-7" />
          </svg>
        </div>
        <div style={{ fontFamily: 'var(--disp)', fontSize: 20, fontWeight: 800, color: 'var(--txt)' }}>The receipts are coming</div>
        <p style={{ fontFamily: 'var(--ui)', fontSize: 14, color: 'rgba(255,255,255,.55)', maxWidth: 480, margin: '10px auto 0', lineHeight: 1.6 }}>
          Tracking started {since ? since.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'July 2026'}. Every price sync we snapshot the day&apos;s
          top-scored deals; once a snapshot is at least 7 days old, it shows up here with the price we flagged it at
          versus the price now — wins and losses alike. Results appear as the data matures.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '18px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--disp)', fontSize: 24, fontWeight: 800, color: 'var(--txt)' }}>Our Track Record</h2>
        <span style={{ fontFamily: 'var(--ui)', fontSize: 13.5, color: 'rgba(255,255,255,.55)' }}>
          Every deal we flagged at least 7 days ago — the price then vs the price now. No cherry-picking.
        </span>
      </div>

      {summary && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Stat label="FLAGGED DEALS TRACKED" value={summary.count} sub={since ? `since ${since.toLocaleDateString()}` : ''} color="#5B8DEF" />
          <Stat label="AVG MOVE OF FLAGGED DEALS" value={pct(summary.avgMovePct)} color={summary.avgMovePct >= 0 ? '#34D88A' : '#FF5C6C'} sub="market price, flag date → today" />
          {summary.avgMarketMovePct !== null && (
            <Stat label="MARKET OVER SAME PERIOD" value={pct(summary.avgMarketMovePct)} color={summary.avgMarketMovePct >= 0 ? '#34D88A' : '#FF5C6C'} sub="median of the $50–$1.5K deal band" />
          )}
          <Stat label="HELD OR GAINED" value={`${summary.winRate}%`} color="#E8B339" sub="flagged deals at or above flag price" />
        </div>
      )}

      <div style={{ marginTop: 16, border: '1px solid rgba(255,255,255,.07)', borderRadius: 8, overflow: 'hidden', background: '#0d1117' }}>
        <div style={{ display: 'flex', padding: '8px 12px', background: 'rgba(255,255,255,.03)', borderBottom: '1px solid rgba(255,255,255,.05)', fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
          <span style={{ width: 88 }}>FLAGGED</span>
          <span style={{ flex: 1, minWidth: 160 }}>CARD</span>
          <span style={{ width: 60, textAlign: 'right' }}>SCORE</span>
          <span style={{ width: 90, textAlign: 'right' }}>THEN</span>
          <span style={{ width: 90, textAlign: 'right' }}>NOW</span>
          <span style={{ width: 80, textAlign: 'right' }}>MOVE</span>
        </div>
        <div style={{ maxHeight: 560, overflowY: 'auto' }}>
          {items.map((it, i) => (
            <div key={`${it.cardId}-${it.date}`} style={{ display: 'flex', alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,.04)', background: i % 2 === 0 ? 'rgba(255,255,255,.015)' : 'transparent' }}>
              <span style={{ width: 88, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>{new Date(it.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <div style={{ flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CardThumb src={it.thumbnail} name={it.player} sport={it.sport} width={26} height={36} radius={3} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 700, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.player}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--dim)' }}>{`${it.grader || 'Raw'} ${it.grade || ''}`.trim()} · {(it.set || '').slice(0, 24)}</div>
                </div>
              </div>
              <span style={{ width: 60, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: it.score >= 90 ? '#34D88A' : it.score >= 70 ? '#E8B339' : 'var(--muted)', fontWeight: 700 }}>{it.score}</span>
              <span style={{ width: 90, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--muted)' }}>{fmtP(it.flaggedPrice)}</span>
              <span style={{ width: 90, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--txt)', fontWeight: 700 }}>{fmtP(it.currentPrice)}</span>
              <span style={{ width: 80, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 800, color: it.movePct >= 0 ? '#34D88A' : '#FF5C6C' }}>{pct(it.movePct)}</span>
            </div>
          ))}
        </div>
      </div>
      <p style={{ fontFamily: 'var(--ui)', fontSize: 11.5, color: 'rgba(255,255,255,.35)', marginTop: 10, lineHeight: 1.5 }}>
        Prices are market prices from our price sync, not guaranteed exit prices. Past performance of flagged deals doesn&apos;t promise future results — cards are collectibles, not securities.
      </p>
    </div>
  );
}
