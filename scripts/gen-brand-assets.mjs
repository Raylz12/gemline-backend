// Generate brand assets: og-image.png (1200x630), icons (favicon/PWA/apple).
// Run: node scripts/gen-brand-assets.mjs   (uses sharp from node_modules)
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
mkdirSync(pub, { recursive: true });

const INK = '#0a0d15', PANEL = '#11151f', LINE = '#222839', GREEN = '#16c784', TXT = '#eef1f6', MUTED = '#8b93a7';

// ── OG image 1200×630 ────────────────────────────────────────────────
const ticker = [
  ['JORDAN ’86 FLEER PSA 10', '+4.2%', GREEN],
  ['WEMBY PRIZM PSA 10', '+7.8%', GREEN],
  ['CHARIZARD HOLO', '-1.3%', '#ef4466'],
];
const tickerRow = (x, [name, pct, col]) =>
  `<text x="${x}" y="586" font-family="IBM Plex Mono, DejaVu Sans Mono" font-size="17" fill="${MUTED}" letter-spacing="0.5">${name} <tspan fill="${col}" font-weight="600">${pct}</tspan></text>`;

const og = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1220"/><stop offset="0.55" stop-color="${INK}"/><stop offset="1" stop-color="#0a1512"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0.16"/><stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="chart" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0.28"/><stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="240" fill="url(#glow)"/>
  ${Array.from({ length: 13 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="630" stroke="${LINE}" stroke-opacity="0.35" stroke-width="1"/>`).join('')}
  ${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="1200" y2="${i * 100}" stroke="${LINE}" stroke-opacity="0.35" stroke-width="1"/>`).join('')}

  <!-- chart sweep (kept right/below the copy) -->
  <path d="M0,540 L150,528 L300,533 L450,505 L600,512 L750,462 L860,472 L960,400 L1060,415 L1150,320 L1200,300 L1200,630 L0,630 Z" fill="url(#chart)"/>
  <path d="M0,540 L150,528 L300,533 L450,505 L600,512 L750,462 L860,472 L960,400 L1060,415 L1150,320 L1200,300" stroke="${GREEN}" stroke-width="3" fill="none" stroke-linejoin="round"/>
  <circle cx="1150" cy="320" r="6" fill="${GREEN}"/>

  <!-- logo mark -->
  <rect x="84" y="118" width="64" height="64" rx="12" fill="${GREEN}"/>
  <text x="116" y="166" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="46" fill="#000">G</text>

  <text x="84" y="300" font-family="Barlow Condensed" font-weight="800" font-size="128" fill="${TXT}" letter-spacing="2">GEMLINE</text>
  <text x="84" y="360" font-family="Barlow Condensed" font-weight="600" font-size="40" fill="${GREEN}" letter-spacing="10">THE CARD EXCHANGE</text>
  <text x="84" y="430" font-family="Barlow" font-size="27" fill="${MUTED}">Live prices, listings &amp; market intelligence for 374,000+ cards.</text>
  <text x="84" y="468" font-family="Barlow" font-size="27" fill="${MUTED}">Buy. Sell. Trade. Track your collection like a portfolio.</text>

  <rect x="0" y="556" width="1200" height="74" fill="${PANEL}" fill-opacity="0.92"/>
  <line x1="0" y1="556" x2="1200" y2="556" stroke="${LINE}"/>
  ${ticker.map((t, i) => tickerRow(70 + i * 400, t)).join('')}
</svg>`;
await sharp(Buffer.from(og)).png().toFile(path.join(pub, 'og-image.png'));

// ── icon mark (G tile) at arbitrary size ─────────────────────────────
const mark = (s, pad = 0) => {
  const r = Math.round(s * 0.22), fs = Math.round(s * 0.62), inner = s - pad * 2;
  return `<svg width="${s}" height="${s}" xmlns="http://www.w3.org/2000/svg">
  ${pad ? `<rect width="${s}" height="${s}" fill="${INK}"/>` : ''}
  <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${r}" fill="${GREEN}"/>
  <text x="${s / 2}" y="${s / 2 + fs * 0.36}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="${fs}" fill="#000">G</text>
</svg>`;
};

for (const [file, size, pad] of [
  ['icon-192.png', 192, 0], ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 72], ['apple-touch-icon.png', 180, 0],
  ['favicon-32.png', 32, 0], ['favicon-16.png', 16, 0],
]) {
  await sharp(Buffer.from(mark(size, pad))).png().toFile(path.join(pub, file));
}
// favicon.ico = 32px png bytes (browsers accept png-in-ico name at /favicon.ico via route, but simplest: ship real .ico)
const png32 = await sharp(Buffer.from(mark(32))).png().toBuffer();
// minimal ICO wrapper around one PNG (valid per ICO spec for Vista+)
const ico = Buffer.concat([
  Buffer.from([0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0]),
  (() => { const b = Buffer.alloc(8); b.writeUInt32LE(png32.length, 0); b.writeUInt32LE(22, 4); return b; })(),
  png32,
]);
writeFileSync(path.join(pub, 'favicon.ico'), ico);
console.log('assets written to public/');
