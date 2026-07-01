import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '40px 20px',
    }}>
      <div style={{
        fontFamily: 'var(--mono)',
        fontSize: 72,
        fontWeight: 900,
        letterSpacing: '-.04em',
        color: 'var(--gold)',
        lineHeight: 1,
        marginBottom: 16,
        textShadow: '0 0 40px rgba(232,179,57,.3)',
      }}>404</div>
      <h1 style={{
        fontFamily: 'var(--disp)',
        fontSize: 24,
        fontWeight: 800,
        color: 'var(--txt)',
        margin: '0 0 8px',
      }}>Card not in the vault</h1>
      <p style={{
        color: 'var(--muted)',
        fontSize: 14,
        maxWidth: 320,
        margin: '0 0 28px',
        lineHeight: 1.6,
      }}>
        This page doesn't exist or was moved. Try searching the marketplace.
      </p>
      <Link href="/market" style={{
        padding: '10px 24px',
        borderRadius: 8,
        background: 'var(--gold)',
        color: '#000',
        fontFamily: 'var(--mono)',
        fontWeight: 700,
        fontSize: 13,
        textDecoration: 'none',
        letterSpacing: '.04em',
      }}>
        Browse Market
      </Link>
    </div>
  );
}
