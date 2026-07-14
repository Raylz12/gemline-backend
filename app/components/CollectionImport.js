'use client';
// Collection CSV import wizard — "bring your binder".
// Upload CSV → map columns → fuzzy-match against the catalog → REVIEW screen
// (matched / needs-a-pick / not-found) → user confirms → commit. Nothing is
// written until the user hits Import on the review screen.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import CardThumb from './CardThumb';

const MAX_ROWS = 5000;
const CHUNK = 100;

/* Small CSV parser — quotes, escaped quotes, CRLF. Good enough for binder exports. */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

const FIELDS = [
  { key: '', label: '(ignore this column)' },
  { key: 'player', label: 'Player' },
  { key: 'set', label: 'Set / Brand' },
  { key: 'year', label: 'Year' },
  { key: 'number', label: 'Card #' },
  { key: 'variant', label: 'Variant / Parallel' },
  { key: 'grader', label: 'Grader (PSA/BGS/SGC)' },
  { key: 'grade', label: 'Grade' },
  { key: 'qty', label: 'Quantity' },
  { key: 'paid', label: 'Paid Price' },
  { key: 'certNumber', label: 'Cert #' },
  { key: 'notes', label: 'Notes' },
];

function guessField(header) {
  const h = String(header || '').toLowerCase().replace(/[^a-z0-9#]/g, '');
  if (/^(player|name|cardname|playername|athlete|card)$/.test(h)) return 'player';
  if (/^(set|cardset|brand|product|series|release)$/.test(h)) return 'set';
  if (/^(year|season)$/.test(h)) return 'year';
  if (/^(number|cardnumber|card#|#|num|no)$/.test(h)) return 'number';
  if (/^(variant|parallel|insert|color|subset|version)$/.test(h)) return 'variant';
  if (/^(grader|gradingcompany|company|service|gradedby)$/.test(h)) return 'grader';
  if (/^(grade|condition)$/.test(h)) return 'grade';
  if (/^(qty|quantity|count|copies)$/.test(h)) return 'qty';
  if (/^(paid|paidprice|cost|purchaseprice|pricepaid|buyprice|costbasis)$/.test(h)) return 'paid';
  if (/^(cert|certnumber|cert#|certificationnumber)$/.test(h)) return 'certNumber';
  if (/^(notes|note|comment|comments)$/.test(h)) return 'notes';
  return '';
}

const usd = (n) => n == null ? '' : `$${Number(n) >= 1000 ? Math.round(Number(n)).toLocaleString() : Number(n).toFixed(2)}`;
const gradeLabel = (c) => {
  const g = String(c.grader || 'RAW').toUpperCase();
  return g === 'RAW' || !g ? 'Raw' : `${g} ${c.grade || ''}`.trim();
};

export default function CollectionImport({ onClose, onDone }) {
  const { authFetch } = useAuth();
  const fileRef = useRef(null);
  const [step, setStep] = useState('upload'); // upload | map | matching | review | done
  const [error, setError] = useState('');
  const [grid, setGrid] = useState([]);       // raw parsed rows (incl header)
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState([]); // per-column field key
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState([]);       // [{input, result, include, chosen}]
  const [committing, setCommitting] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const onFile = useCallback(async (file) => {
    setError('');
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setError('File too big. 4 MB max.'); return; }
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length < 1) { setError('Could not read any rows from that file.'); return; }
    if (parsed.length - 1 > MAX_ROWS) { setError(`That's ${(parsed.length - 1).toLocaleString()} rows, cap is ${MAX_ROWS.toLocaleString()} per import. Split the file and run it twice.`); return; }
    const header = parsed[0];
    const guessed = header.map(guessField);
    const looksLikeHeader = guessed.some(Boolean);
    setGrid(parsed);
    setHasHeader(looksLikeHeader);
    setMapping(looksLikeHeader ? guessed : header.map(() => ''));
    setStep('map');
  }, []);

  const dataRows = useMemo(() => (hasHeader ? grid.slice(1) : grid), [grid, hasHeader]);

  const buildInput = useCallback((raw) => {
    const input = {};
    mapping.forEach((field, i) => { if (field && raw[i] != null && String(raw[i]).trim() !== '') input[field] = String(raw[i]).trim(); });
    // Combined "PSA 10" in the grade column → split
    if (!input.grader && input.grade && /^(psa|bgs|sgc|cgc|csg)\s+/i.test(input.grade)) {
      const m = input.grade.match(/^([a-z]+)\s+(.+)$/i);
      input.grader = m[1].toUpperCase(); input.grade = m[2];
    }
    return input;
  }, [mapping]);

  const startMatch = useCallback(async () => {
    if (!mapping.includes('player')) { setError('Map a column to Player, it\u2019s the one required field.'); return; }
    setError('');
    setStep('matching');
    setProgress(0);
    const inputs = dataRows.map(buildInput);
    const out = [];
    try {
      for (let i = 0; i < inputs.length; i += CHUNK) {
        const chunk = inputs.slice(i, i + CHUNK);
        const res = await authFetch('/api/collection/import/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        });
        if (!res.ok) throw new Error('match failed');
        const d = await res.json();
        (d.results || []).forEach((result, j) => {
          out.push({
            input: chunk[j],
            result,
            include: result.status === 'matched',
            chosen: result.status === 'matched' ? result.best : null,
          });
        });
        setProgress(Math.min(1, (i + chunk.length) / inputs.length));
      }
      setRows(out);
      setStep('review');
    } catch (e) {
      setError('Matching hit a snag, nothing was imported. Try again.');
      setStep('map');
    }
  }, [authFetch, buildInput, dataRows, mapping]);

  const commit = useCallback(async () => {
    const items = rows.filter(r => r.include && r.chosen).map(r => ({
      cardId: r.chosen.cardId,
      qty: r.input.qty || 1,
      paid: r.input.paid != null ? String(r.input.paid).replace(/[$,]/g, '') : null,
      certNumber: r.input.certNumber || null,
      notes: r.input.notes || null,
    }));
    if (!items.length) return;
    setCommitting(true);
    setError('');
    try {
      const res = await authFetch('/api/collection/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'import failed');
      setDoneCount(d.imported || items.length);
      setStep('done');
      onDone?.();
    } catch (e) {
      setError(e.message || 'Import failed, nothing may have been saved. Check your collection.');
    } finally {
      setCommitting(false);
    }
  }, [authFetch, rows, onDone]);

  const counts = useMemo(() => ({
    matched: rows.filter(r => r.result.status === 'matched').length,
    ambiguous: rows.filter(r => r.result.status === 'ambiguous').length,
    unmatched: rows.filter(r => r.result.status === 'unmatched').length,
    selected: rows.filter(r => r.include && r.chosen).length,
  }), [rows]);

  const pill = (bg, color, text) => (
    <span style={{ fontSize: 9.5, fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '.05em', padding: '2px 7px', borderRadius: 4, background: bg, color, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{text}</span>
  );

  // Skip the year prefix when the set name already starts with it ("2023 2023 Panini Prizm…")
  const candLabel = (c) => {
    const setName = String(c.set || '').trim();
    const yr = c.year && !setName.startsWith(String(c.year)) ? c.year : null;
    return `${gradeLabel(c)} · ${[yr, setName].filter(Boolean).join(' ')}${c.variant && c.variant !== 'Base' ? ` · ${c.variant}` : ''}${c.number ? ` #${c.number}` : ''}${c.price != null ? ` · ${usd(c.price)}` : ''}`;
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && step !== 'matching') onClose(); }}>
      <div className="modal-box" style={{ width: 'min(760px,95vw)' }}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div style={{ padding: '22px 22px 26px' }}>
          <div className="eyebrow">Bring your binder</div>
          <h2 style={{ fontFamily: 'var(--disp)', fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Import Collection CSV</h2>

          {step === 'upload' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 18px' }}>
                Export a CSV from a spreadsheet or another tracker and bring it here. Up to {MAX_ROWS.toLocaleString()} rows.
                We&apos;ll match every card against the price guide and you approve everything before it lands.
              </p>
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
                style={{ border: '2px dashed var(--line-2)', borderRadius: 12, padding: '44px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--panel-2)' }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>📁</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Drop your CSV here or tap to choose</div>
                <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 6, fontFamily: 'var(--mono)' }}>player, set, year, number, grade… any column order works</div>
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0])} />
            </>
          )}

          {step === 'map' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 14px' }}>
                {dataRows.length.toLocaleString()} rows found. Tell us what each column is, we guessed where we could.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)', marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} />
                First row is a header
              </label>
              <div style={{ display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {(grid[0] || []).map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hasHeader ? (h || `Column ${i + 1}`) : `Column ${i + 1}`}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--dim)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {dataRows.slice(0, 3).map(r => r[i]).filter(v => v != null && v !== '').slice(0, 3).join(' · ') || '(empty)'}
                      </div>
                    </div>
                    <select value={mapping[i] || ''} onChange={e => setMapping(m => m.map((v, j) => j === i ? e.target.value : v))}
                      style={{ padding: '7px 10px', fontSize: 12, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 7, color: mapping[i] ? 'var(--gold)' : 'var(--muted)', maxWidth: 180 }}>
                      {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {error && <p style={{ color: 'var(--down)', fontSize: 12.5, marginTop: 10 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button className="buy" style={{ padding: '10px 22px', fontSize: 13 }} onClick={startMatch}>Match {dataRows.length.toLocaleString()} rows →</button>
                <button className="offer" style={{ padding: '10px 18px', fontSize: 13 }} onClick={() => { setStep('upload'); setGrid([]); }}>Different file</button>
              </div>
            </>
          )}

          {step === 'matching' && (
            <div style={{ padding: '34px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Walking the aisles for your cards…</div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--panel-2)', overflow: 'hidden', maxWidth: 380, margin: '0 auto' }}>
                <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--gold)', transition: 'width .3s' }} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 10 }}>{Math.round(progress * 100)}%, nothing is saved yet</div>
            </div>
          )}

          {step === 'review' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 12px' }}>
                Review before anything is added: <b style={{ color: 'var(--up)' }}>{counts.matched} matched</b>
                {counts.ambiguous > 0 && <> · <b style={{ color: 'var(--gold)' }}>{counts.ambiguous} need a pick</b></>}
                {counts.unmatched > 0 && <> · <b style={{ color: 'var(--dim)' }}>{counts.unmatched} not found</b></>}
              </p>
              <div style={{ display: 'grid', gap: 6, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
                {rows.map((r, i) => {
                  const st = r.result.status;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 10px', opacity: st === 'unmatched' ? .55 : 1 }}>
                      <input type="checkbox" checked={r.include} disabled={!r.chosen}
                        onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))}
                        style={{ marginTop: 3, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{r.input.player || '(no player)'}</span>
                          <span style={{ fontSize: 10.5, color: 'var(--dim)', fontFamily: 'var(--mono)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            {[r.input.year, r.input.set, r.input.number && `#${r.input.number}`, r.input.grader && `${r.input.grader} ${r.input.grade || ''}`.trim()].filter(Boolean).join(' · ')}
                          </span>
                          {st === 'matched' && pill('var(--up-soft, rgba(22,199,132,.12))', 'var(--up)', r.result.confidence === 'exact' ? 'Matched' : 'Matched · high')}
                          {st === 'ambiguous' && pill('var(--gold-soft)', 'var(--gold)', 'Pick one')}
                          {st === 'unmatched' && pill('var(--panel)', 'var(--dim)', 'Not found')}
                        </div>
                        {st === 'matched' && r.chosen && (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                            <CardThumb src={r.chosen.thumbnail} name={r.chosen.player} sport={r.chosen.sport} width={26} height={36} radius={4} />
                            <span style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {candLabel(r.chosen)}
                              {!r.chosen.gradeMatched && r.input.grader && <span style={{ color: 'var(--gold)' }}> · closest tier we track</span>}
                            </span>
                          </div>
                        )}
                        {st === 'ambiguous' && (
                          <select value={r.chosen ? r.chosen.cardId : ''}
                            onChange={e => {
                              const c = r.result.candidates.find(x => x.cardId === e.target.value) || null;
                              setRows(rs => rs.map((x, j) => j === i ? { ...x, chosen: c, include: !!c } : x));
                            }}
                            style={{ marginTop: 6, width: '100%', padding: '7px 10px', fontSize: 11.5, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 7, color: r.chosen ? 'var(--txt)' : 'var(--muted)' }}>
                            <option value="">Choose the right card…</option>
                            {r.result.candidates.map(c => (
                              <option key={c.cardId} value={c.cardId}>{`${c.player}, ${candLabel(c)}`}</option>
                            ))}
                          </select>
                        )}
                        {st === 'unmatched' && (
                          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>Not in the price guide yet, add it manually with Search &amp; Add.</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {error && <p style={{ color: 'var(--down)', fontSize: 12.5, marginTop: 10 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="buy" style={{ padding: '10px 22px', fontSize: 13, opacity: counts.selected && !committing ? 1 : .5 }}
                  disabled={!counts.selected || committing} onClick={commit}>
                  {committing ? 'Importing…' : `Import ${counts.selected.toLocaleString()} card${counts.selected === 1 ? '' : 's'}`}
                </button>
                <button className="offer" style={{ padding: '10px 18px', fontSize: 13 }} onClick={onClose}>Cancel</button>
                <span style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>Unchecked rows are skipped</span>
              </div>
            </>
          )}

          {step === 'done' && (
            <div style={{ padding: '30px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🎉</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{doneCount.toLocaleString()} card{doneCount === 1 ? '' : 's'} added to your collection</div>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>Values are live, check the P&amp;L on anything you set a paid price for.</p>
              <button className="buy" style={{ padding: '10px 24px', fontSize: 13, marginTop: 16 }} onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
