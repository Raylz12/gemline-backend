// Shared SVG icon set — replaces emoji in UI chrome for a professional look.
// All icons are 24x24 stroke-based, sized via the `size` prop.
const base = (size, extra = {}) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': true, ...extra,
});

export const IconTrendUp = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
);
export const IconTrendDown = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M3 7l6 6 4-4 8 8" /><path d="M21 10v7h-7" /></svg>
);
export const IconGrid = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
);
export const IconZap = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>
);
export const IconVolume = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><rect x="4" y="12" width="4" height="8" rx="1" /><rect x="10" y="7" width="4" height="13" rx="1" /><rect x="16" y="3" width="4" height="17" rx="1" /></svg>
);
export const IconGem = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M6 3h12l4 6-10 12L2 9l4-6z" /><path d="M2 9h20M9 3l3 6 3-6M12 21l-3-12M12 21l3-12" strokeWidth="1.2" /></svg>
);
export const IconStore = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M3 9l1.5-5h15L21 9" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /><path d="M5 12v8h14v-8" /><path d="M9 20v-5h6v5" /></svg>
);
export const IconPackage = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>
);
export const IconSwap = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M17 3l4 4-4 4M21 7H8M7 21l-4-4 4-4M3 17h13" /></svg>
);
export const IconDollar = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v10M15 9.5c0-1.1-1.3-2-3-2s-3 .9-3 2 1 1.8 3 2.2 3 1.1 3 2.3-1.3 2-3 2-3-.9-3-2" strokeWidth="1.6" /></svg>
);
export const IconShip = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><rect x="1" y="6" width="14" height="11" rx="1" /><path d="M15 10h4l3 3v4h-7" /><circle cx="6" cy="19" r="1.8" /><circle cx="18" cy="19" r="1.8" /></svg>
);
export const IconSearch = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
);
export const IconCards = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><rect x="3" y="5" width="11" height="16" rx="2" /><path d="M17 3.5l4.2 1.2-3.6 13.6" /></svg>
);
export const IconGlobe = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 4 5.7 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.7-4-9s1.5-6.4 4-9z" strokeWidth="1.4" /></svg>
);
export const IconCheck = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M20 6L9 17l-5-5" /></svg>
);
export const IconGavel = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M14 4l6 6M12 6l6 6M4 22h8M16 8l-9 9a2.1 2.1 0 0 1-3-3l9-9a2.1 2.1 0 0 1 3 3z" /></svg>
);
export const IconTrophy = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4z" /><path d="M7 6H4a1 1 0 0 0-1 1c0 2.2 1.8 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2.2-1.8 4-4 4" strokeWidth="1.6" /></svg>
);
export const IconUsers = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /><circle cx="17.5" cy="9" r="2.6" strokeWidth="1.6" /><path d="M16.5 14.6c2.4.3 4.3 1.8 5 4.4" strokeWidth="1.6" /></svg>
);
export const IconUser = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1-3.7 4-5.7 7.5-5.7s6.5 2 7.5 5.7" /></svg>
);
export const IconLink = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
);
export const IconSettings = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);
export const IconLogout = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
);
export const IconBell = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);
export const IconShield = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
);
export const IconAlert = ({ size = 16, ...p }) => (
  <svg {...base(size)} {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
);
