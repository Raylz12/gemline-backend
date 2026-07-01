'use client';
import { useEffect, useState } from 'react';

export default function NetworkStatus() {
  const [offline, setOffline] = useState(false);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    const setOnline = () => {
      setOffline(false);
      // Show "Back online" briefly then fade
      setShowing(true);
      setTimeout(() => setShowing(false), 3000);
    };
    const setOff = () => {
      setOffline(true);
      setShowing(true);
    };
    window.addEventListener('offline', setOff);
    window.addEventListener('online', setOnline);
    return () => {
      window.removeEventListener('offline', setOff);
      window.removeEventListener('online', setOnline);
    };
  }, []);

  if (!showing) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 80,
      left: '50%',
      transform: 'translateX(-50%)',
      background: offline ? 'rgba(255,92,108,.95)' : 'rgba(52,216,138,.95)',
      color: offline ? '#fff' : '#000',
      padding: '10px 20px',
      borderRadius: 10,
      fontFamily: 'var(--mono)',
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: '.04em',
      zIndex: 9999,
      backdropFilter: 'blur(10px)',
      boxShadow: '0 4px 20px rgba(0,0,0,.3)',
      pointerEvents: 'none',
    }}>
      {offline ? '● No internet connection' : '● Back online'}
    </div>
  );
}
