'use client';
import { useEffect } from 'react';

/* Commits a page to the dark intelligence theme (same scoped CSS-var override
   the landing uses on #landing, but applied at body level so the full page —
   background, panels, footer, goes dark instead of a half-dark mix).
   See body.page-dark in globals.css. */
export default function useDarkPage() {
  useEffect(() => {
    document.body.classList.add('page-dark');
    return () => document.body.classList.remove('page-dark');
  }, []);
}
