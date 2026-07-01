'use client';
import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('Page error:', error);
  }, [error]);

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
        fontSize: 40,
        marginBottom: 16,
        filter: 'drop-shadow(0 0 20px rgba(255,92,108,.3))',
      }}>⚠</div>
      <h1 style={{
        fontFamily: 'var(--disp)',
        fontSize: 22,
        fontWeight: 800,
        color: 'var(--txt)',
        margin: '0 0 8px',
      }}>Something went wrong</h1>
      <p style={{
        color: 'var(--muted)',
        fontSize: 14,
        maxWidth: 320,
        margin: '0 0 24px',
        lineHeight: 1.6,
      }}>
        {error?.message?.includes('fetch') ? 'Network error — check your connection and try again.' : 'An unexpected error occurred. Try refreshing.'}
      </p>
      <button
        onClick={() => reset()}
        style={{
          padding: '10px 24px',
          borderRadius: 8,
          background: 'var(--down)',
          color: '#fff',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          fontSize: 13,
          border: 'none',
          cursor: 'pointer',
          letterSpacing: '.04em',
        }}
      >
        Try again
      </button>
    </div>
  );
}
