'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../components/AuthContext';
import { toast } from '../lib/toast';

// ── Admin panel — moderation queue, users, listings, orders, feature flags ──
// Server enforces role = 'admin' on every /api/admin/* call; this page is just
// the cockpit. Non-admins get a 403 and see the "not authorized" state.

const TABS = ['Overview', 'Reports', 'Users', 'Listings', 'Orders', 'Flags'];
const fmtDate = (d) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const S = {
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', fontSize: 12.5, borderBottom: '1px solid var(--line)', verticalAlign: 'top' },
  btn: { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--panel-2, #1a1d28)', color: 'var(--txt)' },
  btnDanger: { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.12)', color: '#ef4444' },
  btnGood: { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(22,199,132,.4)', background: 'rgba(22,199,132,.12)', color: 'var(--up, #16c784)' },
  input: { background: 'var(--panel-2, #1a1d28)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', color: 'var(--txt)', fontSize: 13 },
  pill: (c) => ({ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: `${c}22`, color: c, whiteSpace: 'nowrap' }),
};
const statusColor = (s) => ({
  active: '#16c784', open: '#e8b339', sold: '#3b82f6', settled: '#16c784', shipped: '#3b82f6',
  cancelled: '#8a8f9c', refunded: '#8a8f9c', dismissed: '#8a8f9c', resolved: '#16c784',
  disputed: '#ef4444', pending_payment: '#e8b339',
}[s] || '#8a8f9c');

export default function AdminPage() {
  const { token, authFetch } = useAuth();
  const [tab, setTab] = useState('Overview');
  const [denied, setDenied] = useState(false);
  const [overview, setOverview] = useState(null);

  const api = useCallback(async (url, opts) => {
    const res = await authFetch(url, opts);
    if (res.status === 403) { setDenied(true); throw new Error('Admin only'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [authFetch]);

  useEffect(() => {
    if (!token) return;
    api('/api/admin/overview').then(setOverview).catch(() => {});
  }, [token, api]);

  if (!token) return <Empty msg="Sign in with an admin account to use the panel." />;
  if (denied) return <Empty msg="Not authorized, this area is for GEMLINE moderators." />;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 60px' }}>
      <h1 style={{ fontFamily: 'var(--disp)', fontSize: 26, fontWeight: 800, margin: '0 0 4px' }}>Admin Panel</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 18px' }}>Moderation queue, accounts, marketplace oversight and kill switches.</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            border: '1px solid ' + (tab === t ? 'var(--gold)' : 'var(--line)'),
            background: tab === t ? 'rgba(232,179,57,.14)' : 'var(--panel)',
            color: tab === t ? 'var(--gold)' : 'var(--muted)',
          }}>{t}{t === 'Reports' && overview?.reports?.open > 0 ? ` (${overview.reports.open})` : ''}</button>
        ))}
      </div>
      {tab === 'Overview' && <OverviewTab data={overview} />}
      {tab === 'Reports' && <ReportsTab api={api} onChange={() => api('/api/admin/overview').then(setOverview).catch(() => {})} />}
      {tab === 'Users' && <UsersTab api={api} />}
      {tab === 'Listings' && <ListingsTab api={api} />}
      {tab === 'Orders' && <OrdersTab api={api} />}
      {tab === 'Flags' && <FlagsTab api={api} />}
    </div>
  );
}

function Empty({ msg }) {
  return <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--muted)', fontSize: 14 }}>{msg}</div>;
}

function Stat({ label, value, sub }) {
  return (
    <div className="panel" style={{ padding: 16, minWidth: 150, flex: 1 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function OverviewTab({ data }) {
  if (!data) return <Empty msg="Loading…" />;
  const o = data.orders?.byStatus || {};
  const openOrders = (o.pending_payment || 0) + (o.escrow_held || 0) + (o.awaiting_shipment || 0) + (o.shipped || 0) + (o.delivered || 0) + (o.inspection || 0);
  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="Users" value={data.users?.total?.toLocaleString()} sub={`+${data.users?.new_7d || 0} this week · ${data.users?.suspended || 0} suspended`} />
        <Stat label="Active Listings" value={data.listings?.active?.toLocaleString()} sub={`${data.listings?.live_auctions || 0} live auctions · ${data.listings?.total?.toLocaleString()} all-time`} />
        <Stat label="Open Orders" value={openOrders} sub={`${o.settled || 0} settled · ${o.disputed || 0} disputed`} />
        <Stat label="GMV" value={usd(data.orders?.gmv)} sub="paid orders, all-time" />
        <Stat label="Open Reports" value={data.reports?.open || 0} sub={`${data.reports?.total || 0} all-time`} />
      </div>
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>Orders by status</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <span key={k} style={S.pill(statusColor(k))}>{k.replace(/_/g, ' ')} · {v}</span>
          ))}
          {Object.keys(o).length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>No orders yet</span>}
        </div>
      </div>
    </>
  );
}

function ReportsTab({ api, onChange }) {
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => {
    api(`/api/admin/reports?status=${status}`).then(d => setReports(d.reports)).catch(e => toast(e.message, true));
  }, [api, status]);
  useEffect(load, [load]);

  const resolve = async (r, st) => {
    const resolution = st === 'resolved' ? (prompt('Resolution note (what action did you take?)') || '') : '';
    if (st === 'resolved' && resolution === null) return;
    setBusy(r.id);
    try {
      await api(`/api/admin/reports/${r.id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: st, resolution }) });
      toast(st === 'resolved' ? 'Report resolved' : 'Report dismissed');
      load(); onChange?.();
    } catch (e) { toast(e.message, true); } finally { setBusy(null); }
  };
  const act = async (r) => {
    try {
      if (r.target_type === 'listing') {
        if (!confirm(`Remove this listing?\n${r.target?.label || r.target_id}`)) return;
        const reason = prompt('Reason shown to the seller:') || '';
        await api(`/api/admin/listings/${r.target_id}/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
        toast('Listing removed');
      } else if (r.target_type === 'user') {
        if (!confirm(`Suspend ${r.target?.label || 'this user'}? Their active listings will be pulled.`)) return;
        const reason = prompt('Reason shown to the user:') || '';
        await api(`/api/admin/users/${r.target_id}/suspend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suspend: true, reason }) });
        toast('User suspended');
      }
      load();
    } catch (e) { toast(e.message, true); }
  };

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 6, padding: 12, borderBottom: '1px solid var(--line)' }}>
        {['open', 'resolved', 'dismissed'].map(s => (
          <button key={s} onClick={() => setStatus(s)} style={{ ...S.btn, ...(status === s ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : {}) }}>{s}</button>
        ))}
      </div>
      {!reports ? <Empty msg="Loading…" /> : reports.length === 0 ? <Empty msg={`No ${status} reports. Clean queue. 🧹`} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={S.th}>Target</th><th style={S.th}>Reason</th><th style={S.th}>Reporter</th><th style={S.th}>When</th><th style={S.th}>Actions</th>
            </tr></thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id}>
                  <td style={S.td}>
                    <span style={S.pill(statusColor(r.status))}>{r.target_type}</span>{' '}
                    <span style={{ fontWeight: 600 }}>{r.target?.label}</span>
                    {r.details && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, maxWidth: 340 }}>&ldquo;{r.details}&rdquo;</div>}
                    {r.resolution && <div style={{ fontSize: 11.5, color: 'var(--up)', marginTop: 3 }}>→ {r.resolution}</div>}
                  </td>
                  <td style={S.td}><span style={S.pill('#e8b339')}>{r.reason.replace(/_/g, ' ')}</span></td>
                  <td style={S.td}>@{r.reporter_handle || '?'}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {status === 'open' && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(r.target_type === 'listing' || r.target_type === 'user') && !r.target?.suspended && r.target?.status !== 'cancelled' && (
                          <button style={S.btnDanger} disabled={busy === r.id} onClick={() => act(r)}>
                            {r.target_type === 'listing' ? 'Remove listing' : 'Suspend user'}
                          </button>
                        )}
                        <button style={S.btnGood} disabled={busy === r.id} onClick={() => resolve(r, 'resolved')}>Resolve</button>
                        <button style={S.btn} disabled={busy === r.id} onClick={() => resolve(r, 'dismissed')}>Dismiss</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UsersTab({ api }) {
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setQ(qLive); setPage(1); }, 350); return () => clearTimeout(t); }, [qLive]);
  const load = useCallback(() => {
    api(`/api/admin/users?q=${encodeURIComponent(q)}&page=${page}`).then(setData).catch(e => toast(e.message, true));
  }, [api, q, page]);
  useEffect(load, [load]);

  const suspend = async (u, on) => {
    if (on && !confirm(`Suspend @${u.handle}? Active listings get pulled and they can't sign in.`)) return;
    const reason = on ? (prompt('Reason shown to the user:') || '') : '';
    try {
      await api(`/api/admin/users/${u.id}/suspend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suspend: on, reason }) });
      toast(on ? `@${u.handle} suspended` : `@${u.handle} reinstated`);
      load();
    } catch (e) { toast(e.message, true); }
  };

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
        <input style={{ ...S.input, width: '100%', maxWidth: 340 }} placeholder="Search handle or email…" value={qLive} onChange={e => setQLive(e.target.value)} />
      </div>
      {!data ? <Empty msg="Loading…" /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={S.th}>User</th><th style={S.th}>Email</th><th style={S.th}>Role</th><th style={S.th}>Joined</th>
              <th style={S.th}>Listings</th><th style={S.th}>Orders</th><th style={S.th}>Reports</th><th style={S.th}></th>
            </tr></thead>
            <tbody>
              {data.users.map(u => (
                <tr key={u.id} style={u.suspended_at ? { opacity: .55 } : undefined}>
                  <td style={{ ...S.td, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <Link href={`/user/${u.handle}`} style={{ color: 'var(--txt)', textDecoration: 'none' }}>@{u.handle}</Link>
                    {u.suspended_at && <span style={{ ...S.pill('#ef4444'), marginLeft: 6 }}>SUSPENDED</span>}
                  </td>
                  <td style={{ ...S.td, color: 'var(--muted)' }}>{u.email}</td>
                  <td style={S.td}><span style={S.pill(u.role === 'admin' ? '#e8b339' : '#8a8f9c')}>{u.role}</span></td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(u.created_at)}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{u.active_listings}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{u.orders}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', color: u.open_reports > 0 ? '#ef4444' : undefined }}>{u.open_reports}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {u.role !== 'admin' && (u.suspended_at
                      ? <button style={S.btnGood} onClick={() => suspend(u, false)}>Reinstate</button>
                      : <button style={S.btnDanger} onClick={() => suspend(u, true)}>Suspend</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} hasMore={data.hasMore} setPage={setPage} />
        </div>
      )}
    </div>
  );
}

function ListingsTab({ api }) {
  const [status, setStatus] = useState('active');
  const [qLive, setQLive] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setQ(qLive); setPage(1); }, 350); return () => clearTimeout(t); }, [qLive]);
  const load = useCallback(() => {
    api(`/api/admin/listings?status=${status}&q=${encodeURIComponent(q)}&page=${page}`).then(setData).catch(e => toast(e.message, true));
  }, [api, status, q, page]);
  useEffect(load, [load]);

  const remove = async (l) => {
    if (!confirm(`Remove "${l.player}" (${usd(l.price)}) by @${l.seller_handle}?`)) return;
    const reason = prompt('Reason shown to the seller:') || '';
    try {
      await api(`/api/admin/listings/${l.id}/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      toast('Listing removed'); load();
    } catch (e) { toast(e.message, true); }
  };

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 6, padding: 12, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        {['active', 'sold', 'cancelled'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} style={{ ...S.btn, ...(status === s ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : {}) }}>{s}</button>
        ))}
        <input style={{ ...S.input, flex: 1, minWidth: 180 }} placeholder="Search player or seller…" value={qLive} onChange={e => setQLive(e.target.value)} />
      </div>
      {!data ? <Empty msg="Loading…" /> : data.listings.length === 0 ? <Empty msg="No listings match." /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={S.th}>Card</th><th style={S.th}>Price</th><th style={S.th}>Seller</th><th style={S.th}>Kind</th>
              <th style={S.th}>Listed</th><th style={S.th}>Reports</th><th style={S.th}></th>
            </tr></thead>
            <tbody>
              {data.listings.map(l => (
                <tr key={l.id}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{l.player} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{`${l.grader || ''} ${l.grade || ''}`.trim()}{l.cert_verified ? ' ✓' : ''}</span></td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{usd(l.price)}</td>
                  <td style={S.td}><Link href={`/user/${l.seller_handle}`} style={{ color: 'var(--txt)' }}>@{l.seller_handle}</Link></td>
                  <td style={S.td}><span style={S.pill(l.kind === 'auction' ? '#3b82f6' : '#8a8f9c')}>{l.kind}</span></td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(l.created_at)}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', color: l.open_reports > 0 ? '#ef4444' : undefined }}>{l.open_reports}</td>
                  <td style={S.td}>{l.status === 'active' && <button style={S.btnDanger} onClick={() => remove(l)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} hasMore={data.hasMore} setPage={setPage} />
        </div>
      )}
    </div>
  );
}

function OrdersTab({ api }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/admin/orders?status=${status}&page=${page}`).then(setData).catch(e => toast(e.message, true));
  }, [api, status, page]);
  const STATUSES = ['', 'pending_payment', 'escrow_held', 'awaiting_shipment', 'shipped', 'delivered', 'inspection', 'settled', 'disputed', 'cancelled', 'refunded'];
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ ...S.input, cursor: 'pointer' }}>
          {STATUSES.map(s => <option key={s} value={s}>{s === '' ? 'All statuses' : s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      {!data ? <Empty msg="Loading…" /> : data.orders.length === 0 ? <Empty msg="No orders match." /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={S.th}>Card</th><th style={S.th}>Amount</th><th style={S.th}>Status</th><th style={S.th}>Buyer</th><th style={S.th}>Seller</th><th style={S.th}>Created</th>
            </tr></thead>
            <tbody>
              {data.orders.map(o => (
                <tr key={o.id}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{o.player}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{usd(Number(o.amount) / 100)}</td>
                  <td style={S.td}><span style={S.pill(statusColor(o.status))}>{o.status.replace(/_/g, ' ')}</span></td>
                  <td style={S.td}>@{o.buyer_handle}</td>
                  <td style={S.td}>@{o.seller_handle}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} hasMore={data.hasMore} setPage={setPage} />
        </div>
      )}
    </div>
  );
}

function FlagsTab({ api }) {
  const [flags, setFlags] = useState(null);
  const load = useCallback(() => {
    api('/api/admin/flags').then(d => setFlags(d.flags)).catch(e => toast(e.message, true));
  }, [api]);
  useEffect(load, [load]);
  const toggle = async (f) => {
    if (f.enabled && !confirm(`Disable "${f.key}" for everyone? The feature returns a "temporarily disabled" message until re-enabled.`)) return;
    try {
      await api('/api/admin/flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: f.key, enabled: !f.enabled }) });
      toast(`${f.key} ${!f.enabled ? 'enabled' : 'disabled'}`); load();
    } catch (e) { toast(e.message, true); }
  };
  const DESC = {
    packs: 'Credit pack rips (/packs)', mystery_packs: 'Mystery pool pulls', community_posts: 'New community posts',
    trades: 'New trade proposals', auctions: 'Creating new auctions', ai_scout: 'AI Scout search',
  };
  return (
    <div className="panel" style={{ padding: 16 }}>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px' }}>
        Kill switches, flip one off and the feature is gently disabled site-wide (changes take up to 60s to propagate).
      </p>
      {!flags ? <Empty msg="Loading…" /> : flags.map(f => (
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => toggle(f)} aria-label={`Toggle ${f.key}`} style={{
            width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
            background: f.enabled ? 'var(--up, #16c784)' : 'var(--panel-2, #333)', transition: 'background .15s',
          }}>
            <span style={{ position: 'absolute', top: 3, left: f.enabled ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700 }}>{f.key}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{DESC[f.key] || f.note || '—'}</div>
          </div>
          <span style={S.pill(f.enabled ? '#16c784' : '#ef4444')}>{f.enabled ? 'ON' : 'OFF'}</span>
        </div>
      ))}
    </div>
  );
}

function Pager({ page, hasMore, setPage }) {
  if (page === 1 && !hasMore) return null;
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 12 }}>
      <button style={S.btn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
      <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center', fontFamily: 'var(--mono)' }}>page {page}</span>
      <button style={S.btn} disabled={!hasMore} onClick={() => setPage(p => p + 1)}>Next →</button>
    </div>
  );
}
