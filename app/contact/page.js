export const metadata = {
  title: 'Contact | GEMLINE',
  description: 'Get in touch with the GEMLINE team for support, partnerships, or press.',
  alternates: { canonical: '/contact' },
};

const CHANNELS = [
  { label: 'Support', detail: 'support@gemlinecards.com', href: 'mailto:support@gemlinecards.com', blurb: 'Account, orders, and listing help.' },
  { label: 'Partnerships', detail: 'hello@gemlinecards.com', href: 'mailto:hello@gemlinecards.com', blurb: 'Stores, integrations, and data.' },
  { label: 'Community', detail: 'Join the floor', href: '/community', blurb: 'Talk cards with other collectors.' },
];

export default function ContactPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="eyebrow">Company</div>
      <h1 className="page">Contact</h1>
      <p className="sub">We read everything. Pick the channel that fits.</p>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {CHANNELS.map((c, i) => (
          <a key={i} href={c.href}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '16px 18px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, textDecoration: 'none' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--txt)' }}>{c.label}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>{c.blurb}</div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)', whiteSpace: 'nowrap' }}>{c.detail} →</div>
          </a>
        ))}
      </div>
    </div>
  );
}
