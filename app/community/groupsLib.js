'use client';

// Shared bits for community Groups (directory section + group page).
// Avatars are emoji on a color badge, no uploads. By collectors, for collectors.

export function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export const PRESET_EMOJI = ['🃏', '🏀', '⚾', '🏈', '🏒', '⚽', '🔥', '💎', '🏆', '⭐', '🚀', '🦖'];
export const PRESET_COLORS = ['#16c784', '#E8B339', '#4A9EDE', '#B65CDB', '#E05C5C', '#E88A39', '#3DD6C3', '#8A93A6'];

export function GroupAvatar({ group, size = 44, radius = 12 }) {
  const color = group?.color || '#16c784';
  return (
    <div aria-hidden="true" style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      background: `${color}1f`, border: `1px solid ${color}59`,
      display: 'grid', placeItems: 'center', fontSize: Math.round(size * 0.5), lineHeight: 1,
    }}>
      <span className="emoji">{group?.avatar || '🃏'}</span>
    </div>
  );
}

export function PrivacyBadge({ privacy }) {
  const priv = privacy === 'private';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10,
      fontFamily: 'var(--mono)', letterSpacing: '.06em', textTransform: 'uppercase',
      color: priv ? 'var(--gold)' : 'var(--muted)', background: 'var(--panel-2)',
      border: '1px solid var(--line)', borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap',
    }}>
      {priv ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
        </svg>
      )}
      {priv ? 'Private' : 'Public'}
    </span>
  );
}

export function RoleChip({ role }) {
  if (!role) return null;
  const colors = {
    owner: { c: 'var(--gold)', label: 'Owner' },
    admin: { c: 'var(--blue, #4A9EDE)', label: 'Admin' },
    member: { c: 'var(--muted)', label: 'Member' },
  };
  const m = colors[role] || colors.member;
  return (
    <span style={{
      fontSize: 9, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.08em',
      color: m.c, border: `1px solid ${role === 'member' ? 'var(--line)' : 'currentColor'}`,
      borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

export function memberLabel(n) {
  const x = Number(n) || 0;
  return `${x.toLocaleString()} ${x === 1 ? 'member' : 'members'}`;
}
