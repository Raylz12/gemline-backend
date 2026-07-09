// Shared renderer for legal pages (/terms, /privacy, /seller-agreement).
// Server component — no client JS. Sections are { h, p: [strings], list: [strings] }.

export default function LegalDoc({ eyebrow = 'Legal', title, sub, effective, sections }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="page">{title}</h1>
      <p className="sub">{sub}</p>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 6 }}>
        Effective date: {effective}
      </p>

      <div style={{ marginTop: 24, display: 'grid', gap: 22 }}>
        {sections.map((s, i) => (
          <section key={i}>
            <h2 style={{ fontSize: 16.5, fontWeight: 700, marginBottom: 8 }}>
              {i + 1}. {s.h}
            </h2>
            {(s.p || []).map((para, j) => (
              <p key={j} style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--muted)', marginBottom: 8 }}>
                {para}
              </p>
            ))}
            {s.list && (
              <ul style={{ margin: '4px 0 8px', paddingLeft: 20, display: 'grid', gap: 6 }}>
                {s.list.map((item, j) => (
                  <li key={j} style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' }}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <p style={{ marginTop: 32, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        Questions about this document? Reach us through the <a href="/contact" style={{ color: 'var(--gold)' }}>contact page</a>.
        Related: <a href="/terms" style={{ color: 'var(--gold)' }}>Terms of Service</a> ·{' '}
        <a href="/privacy" style={{ color: 'var(--gold)' }}>Privacy Policy</a> ·{' '}
        <a href="/seller-agreement" style={{ color: 'var(--gold)' }}>Seller Agreement</a> ·{' '}
        <a href="/fees" style={{ color: 'var(--gold)' }}>Fees &amp; Payouts</a>
      </p>
    </div>
  );
}
