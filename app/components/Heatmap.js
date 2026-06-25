'use client';
import { useState, useMemo, useRef, useEffect } from 'react';

/* ── Proper squarify treemap algorithm (from reference) ── */
function squarify(items, x, y, w, h) {
  const arr = items.map((it, i) => ({ i, v: it.weight })).filter(o => o.v > 0).sort((a, b) => b.v - a.v);
  const total = arr.reduce((s, o) => s + o.v, 0) || 1;
  const scale = (w * h) / total;
  let pool = arr.map(o => ({ i: o.i, a: o.v * scale }));
  const out = [];
  let cx = x, cy = y, cw = w, ch = h;

  const worst = (row, len) => {
    const s = row.reduce((t, o) => t + o.a, 0);
    const mx = Math.max(...row.map(o => o.a));
    const mn = Math.min(...row.map(o => o.a));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };

  while (pool.length) {
    const len = Math.min(cw, ch);
    let row = [pool[0]], idx = 1;
    while (idx < pool.length) {
      const test = row.concat(pool[idx]);
      if (worst(test, len) <= worst(row, len)) { row = test; idx++; } else break;
    }
    const s = row.reduce((t, o) => t + o.a, 0);
    if (cw >= ch) {
      const colW = s / ch; let oy = cy;
      for (const o of row) { const hh = o.a / colW; out.push({ i: o.i, x: cx, y: oy, w: colW, h: hh }); oy += hh; }
      cx += colW; cw -= colW;
    } else {
      const rowH = s / cw; let ox = cx;
      for (const o of row) { const ww = o.a / rowH; out.push({ i: o.i, x: ox, y: cy, w: ww, h: rowH }); ox += ww; }
      cy += rowH; ch -= rowH;
    }
    pool = pool.slice(row.length);
  }
  return out;
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function chColor(ch) {
  const x = Math.max(-12, Math.min(12, ch));
  const st = [[255, 92, 108], [42, 49, 66], [52, 216, 138]];
  const t = (x + 12) / 24;
  const seg = t < 0.5 ? 0 : 1;
  const lt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = st[seg], b = st[seg + 1];
  return `rgb(${lerp(a[0], b[0], lt)},${lerp(a[1], b[1], lt)},${lerp(a[2], b[2], lt)})`;
}

export default function Heatmap({ cards, onSelect }) {
  const boxRef = useRef(null);
  const [dims, setDims] = useState({ w: 840, h: 564 });
  const [sportFilter, setSportFilter] = useState('All');

  useEffect(() => {
    const measure = () => {
      if (boxRef.current) {
        const r = boxRef.current.getBoundingClientRect();
        if (r.width > 0) setDims({ w: r.width, h: r.height || 564 });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const sports = useMemo(() => {
    const set = new Set(cards.filter(c => c.market > 0).map(c => c.sport));
    return ['All', ...Array.from(set).sort()];
  }, [cards]);

  const { tiles, groups } = useMemo(() => {
    let pool = cards.filter(c => c.market > 0 && (c.gain7d !== 0 || c.sales7d > 0));
    if (sportFilter !== 'All') pool = pool.filter(c => c.sport === sportFilter);

    // Rank by absolute gain + volume, take top 100 for performance
    pool.sort((a, b) => {
      const scoreA = Math.abs(a.gain7d || 0) * 10 + (a.sales7d || 0);
      const scoreB = Math.abs(b.gain7d || 0) * 10 + (b.sales7d || 0);
      return scoreB - scoreA;
    });
    pool = pool.slice(0, 100);

    // Group by sport
    const groupMap = {};
    pool.forEach(c => {
      if (!groupMap[c.sport]) groupMap[c.sport] = [];
      groupMap[c.sport].push(c);
    });

    const gArr = Object.entries(groupMap).map(([sport, cards]) => ({
      sport, cards,
      weight: cards.reduce((s, c) => s + (c.market || 0), 0),
    }));

    // Layout sport groups
    const gl = squarify(gArr, 0, 0, dims.w, dims.h);
    const allTiles = [];
    const groupLabels = [];

    gl.forEach(g => {
      const grp = gArr[g.i];
      const lh = g.h > 26 ? 14 : 0;

      if (g.w > 54 && g.h > 22) {
        groupLabels.push({ label: grp.sport, x: g.x + 5, y: g.y + 3 });
      }

      const ix = g.x + 1, iy = g.y + lh;
      const iw = Math.max(1, g.w - 2), ih = Math.max(1, g.h - lh - 1);

      // Map cards within group
      const cardItems = grp.cards.map(c => ({ weight: c.market || 1 }));
      const cl = squarify(cardItems, ix, iy, iw, ih);

      cl.forEach(t => {
        const c = grp.cards[t.i];
        const fs = Math.max(9, Math.min(17, Math.sqrt(t.w * t.h) / 6.5));
        const big = t.w > 44 && t.h > 32;
        allTiles.push({ card: c, x: t.x, y: t.y, w: t.w, h: t.h, fs, big, gain: c.gain7d || 0 });
      });
    });

    return { tiles: allTiles, groups: groupLabels };
  }, [cards, sportFilter, dims]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 12px', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="scout-chips" style={{ margin: 0 }}>
            {sports.slice(0, 8).map(s => (
              <button key={s} className={`scout-chip ${sportFilter === s ? 'on' : ''}`} onClick={() => setSportFilter(s)}>{s}</button>
            ))}
          </div>
          <span className="count mono">{tiles.length} slabs · {sports.length - 1} categories</span>
        </div>
        <div className="hm-legend"><span>-12%</span><div className="hm-scale" /><span>+12%</span></div>
      </div>

      <div id="heatmapBox" ref={boxRef}>
        {/* Group labels */}
        {groups.map((g, i) => (
          <div key={'g' + i} className="hm-grp" style={{ left: g.x, top: g.y }}>{g.label}</div>
        ))}

        {/* Card tiles */}
        {tiles.map((t, i) => (
          <div key={i} className="hm-tile"
            title={`${t.card.player} ${t.gain >= 0 ? '+' : ''}${t.gain.toFixed(1)}%`}
            onClick={() => onSelect?.(t.card)}
            style={{
              left: t.x, top: t.y, width: t.w, height: t.h,
              background: chColor(t.gain),
            }}>
            {t.big && <>
              <span className="hm-sym" style={{ fontSize: t.fs }}>
                {(t.card.player || '').split(' ').pop().toUpperCase().slice(0, 6)}
              </span>
              <span className="hm-ch" style={{ fontSize: Math.max(8, t.fs * 0.6) }}>
                {t.gain >= 0 ? '+' : ''}{t.gain.toFixed(1)}%
              </span>
            </>}
          </div>
        ))}
      </div>
    </div>
  );
}
