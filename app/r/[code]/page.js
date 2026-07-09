'use client';
// Referral landing — /r/[code] stashes the code (localStorage + cookie) and
// bounces to the homepage. Signup reads it and attributes the referral.
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ReferralLanding() {
  const { code } = useParams();
  const router = useRouter();

  useEffect(() => {
    const c = String(code || '').toLowerCase().slice(0, 40);
    if (/^[a-z0-9-]{3,40}$/.test(c)) {
      try { localStorage.setItem('gemline_ref', c); } catch {}
      try { document.cookie = `gemline_ref=${c}; path=/; max-age=${30 * 24 * 3600}; SameSite=Lax`; } catch {}
    }
    router.replace('/');
  }, [code, router]);

  return (
    <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 14 }}>
      Taking you to the floor…
    </div>
  );
}
