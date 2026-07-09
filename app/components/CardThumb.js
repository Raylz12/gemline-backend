'use client';
// Reusable card thumbnail with graceful fallback. Handles the ~64% of catalog
// rows that have NULL/empty ebay_thumb (bbfb import) plus dead CDN links —
// never shows a broken-image icon or collapses layout. Falls back to a styled
// gradient placeholder with the player's initials.
import { useState } from 'react';
import { SPORT_THEME } from '../lib/data';

function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 4)
    .toUpperCase() || '?';
}

export default function CardThumb({
  src,
  name = '',
  sport,
  theme,
  size = 40,
  width,
  height,
  radius = 6,
  style = {},
  className = '',
  imgStyle = {},
  fit = 'contain',
}) {
  const [errored, setErrored] = useState(false);
  const w = width || size;
  const h = height || size;
  // Font size scales with the smallest numeric dimension (width may be '100%').
  const nums = [w, h].filter(v => typeof v === 'number');
  const iniSize = Math.max(9, Math.round((nums.length ? Math.min(...nums) : 40) * 0.3));
  const g = theme || SPORT_THEME[sport] || ['#242a3d', '#141824'];
  const show = src && !errored;

  const box = {
    width: w,
    height: h,
    borderRadius: radius,
    flexShrink: 0,
    overflow: 'hidden',
    position: 'relative',
    background: `linear-gradient(135deg,${g[0]},${g[1]})`,
    display: 'grid',
    placeItems: 'center',
    ...style,
  };

  return (
    <div className={className} style={box}>
      {show ? (
        <img
          src={src}
          alt={name || ''}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          style={{ width: '100%', height: '100%', objectFit: fit, display: 'block', ...imgStyle }}
        />
      ) : (
        <span style={{
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          fontSize: iniSize,
          color: 'rgba(255,255,255,.82)',
          letterSpacing: '.04em',
          userSelect: 'none',
        }}>{initials(name)}</span>
      )}
    </div>
  );
}
