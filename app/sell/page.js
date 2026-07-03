'use client';
import { useMemo, useState, useEffect, useRef } from 'react';
import { useAuth } from '../components/AuthContext';
import { useCardStore } from '../components/CardStore';
import { fmt } from '../lib/data';
import { toast } from '../lib/toast';
import SignupTeaser from '../components/SignupTeaser';
import PreviewGate, { SampleCardGrid } from '../components/PreviewGate';
import { IconStore, IconCheck } from '../components/Icons';

const STEPS = ['Search', 'Price', 'Type', 'Photos', 'Review'];

export default function SellPage() {
  const { token, user } = useAuth();
  const { cards } = useCardStore();
  const [tab, setTab] = useState('list'); // list | my | store
  const [storeForm, setStoreForm] = useState({ store_name: '', store_description: '', store_location: '', store_website: '' });
  const [storeSubmitting, setStoreSubmitting] = useState(false);
  const [storeMsg, setStoreMsg] = useState('');
  const [step, setStep] = useState(0);

  // Listing form state
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [price, setPrice] = useState('');
  const [listingType, setListingType] = useState('buy_now');
  const [openToOffers, setOpenToOffers] = useState(false);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [fmv, setFmv] = useState(null);

  // My listings
  const [myListings, setMyListings] = useState([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editPrice, setEditPrice] = useState('');

  // Photo listing state
  const [photoIdentifying, setPhotoIdentifying] = useState(false);
  const [photoIdResult, setPhotoIdResult] = useState(null); // null | 'success' | 'failed'

  const fileRef = useRef(null);
  const photoScanRef = useRef(null);

  // Search catalog
  useEffect(() => {
    if (searchQ.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/catalog/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: searchQ }),
        });
        const data = await res.json();
        setSearchResults(data.results || []);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  // Fetch FMV when card selected
  useEffect(() => {
    if (!selectedCard) return;
    setFmv(null);
    fetch(`/api/prices?player=${encodeURIComponent(selectedCard.player)}&grader=${selectedCard.grader || ''}&grade=${selectedCard.grade || ''}&set=${selectedCard.card_set || ''}`)
      .then(r => r.json())
      .then(d => setFmv(d.stats || null))
      .catch(() => {});
  }, [selectedCard]);

  // Load my listings
  useEffect(() => {
    if (tab !== 'my' || !token) return;
    setLoadingMine(true);
    fetch('/api/listings/mine', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setMyListings(d.listings || []))
      .catch(() => {})
      .finally(() => setLoadingMine(false));
  }, [tab, token]);

  const selectCard = (card) => {
    setSelectedCard(card);
    setStep(1);
    // Pre-fill price from catalog
    if (card.catalog_price) setPrice(String(Math.round(Number(card.catalog_price))));
  };

  const handlePhoto = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        setPhotos(prev => [...prev.slice(0, 7), reader.result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoIdentifying(true);
    setPhotoIdResult(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result;
        const res = await fetch('/api/cards/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 }),
        });
        const data = await res.json();
        if (data.success && data.card) {
          // Pre-fill search and select
          setSearchQ(data.card.player || '');
          const fakeCard = {
            id: data.card.cardId,
            player: data.card.player,
            card_set: data.card.set,
            year: data.card.year,
            sport: data.card.sport,
            grader: data.card.grader,
            grade: data.card.grade,
            ebay_thumb: data.card.thumbnail,
            catalog_price: null,
          };
          selectCard(fakeCard);
          setPhotoIdResult('success');
          toast(`Found: ${data.card.player} — please verify the details below`);
        } else {
          setPhotoIdResult('failed');
          toast("We couldn't identify this card — fill in manually", true);
        }
      } catch {
        setPhotoIdResult('failed');
        toast("Identification failed — fill in manually", true);
      } finally {
        setPhotoIdentifying(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!token) { toast('Please log in first', true); return; }
    if (!selectedCard) { toast('Select a card first', true); return; }
    if (!price || Number(price) <= 0) { toast('Set a valid price', true); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: selectedCard.id,
          price: Number(price),
          listingType,
          openToOffers,
          description: description || undefined,
          photos: photos.length ? photos : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create listing');
      toast('Card listed! ');
      reset();
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep(0);
    setSelectedCard(null);
    setPrice('');
    setListingType('buy_now');
    setOpenToOffers(false);
    setDescription('');
    setPhotos([]);
    setSearchQ('');
    setSearchResults([]);
    setFmv(null);
  };

  const cancelListing = async (id) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/listings/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setMyListings(prev => prev.filter(l => l.id !== id));
        toast('Listing cancelled');
      }
    } catch { toast('Failed to cancel', true); }
  };

  const updatePrice = async (id) => {
    if (!token || !editPrice) return;
    try {
      const res = await fetch(`/api/listings/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: Number(editPrice) }),
      });
      if (res.ok) {
        setMyListings(prev => prev.map(l => l.id === id ? { ...l, price: Number(editPrice) } : l));
        setEditId(null);
        toast('Price updated');
      }
    } catch { toast('Failed to update', true); }
  };

  if (!token) {
    return (
      <>
        <div className="eyebrow">Sell</div>
        <h1 className="page">List your cards.</h1>
        <p className="sub">Set your price backed by real market data. Listing is free — GEMLINE keeps 10% only when your card sells.</p>
        <PreviewGate
          icon=""
          cta="Start selling on GEMLINE"
          subtitle="List cards at your price. Buy now, make offers, or auction. Free to list — 10% only when it sells."
          preview={<SampleCardGrid count={8} />}
        />
      </>
    );
  }

  return (
    <>
      <div className="eyebrow">Your Storefront</div>
      <h1 className="page">Sell your cards.</h1>
      <p className="sub">List cards from the catalog, set your price, and start selling. Every listing is backed by real market data.</p>

      {/* Tabs */}
      <div className="sell-tabs" style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        <button className={`chip ${tab === 'list' ? 'on' : ''}`} onClick={() => setTab('list')}>+ List a Card</button>
        <button className={`chip ${tab === 'my' ? 'on' : ''}`} onClick={() => setTab('my')}>My Listings</button>
        <button className={`chip ${tab === 'store' ? 'on' : ''}`} onClick={() => setTab('store')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconStore size={13} /> Apply to Sell as Store</button>
      </div>

      {tab === 'list' && (
        <div className="sell-flow">
          {/* Progress */}
          <div className="sell-steps" style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            {STEPS.map((s, i) => (
              <div key={s} className="sell-step" style={{
                display: 'flex', alignItems: 'center', gap: 6,
                color: i <= step ? 'var(--gold)' : 'var(--dim)',
                fontFamily: 'var(--mono)', fontSize: 11, fontWeight: i === step ? 700 : 400,
              }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: i < step ? 'var(--gold)' : i === step ? 'var(--gold-soft)' : 'var(--panel)',
                  color: i < step ? '#000' : i === step ? 'var(--gold)' : 'var(--dim)',
                  fontSize: 10, fontWeight: 700,
                }}>{i < step ? '✓' : i + 1}</span>
                <span className="step-label">{s}</span>
                {i < STEPS.length - 1 && <span style={{ color: 'var(--line)', margin: '0 2px' }}>—</span>}
              </div>
            ))}
          </div>

          {/* Step 0: Search */}
          {step === 0 && (
            <div className="sell-card-panel" style={{ background: 'var(--panel)', borderRadius: 'var(--r)', padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontFamily: 'var(--disp)', margin: 0 }}>Find your card</h3>
                <button
                  onClick={() => photoScanRef.current?.click()}
                  disabled={photoIdentifying}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: photoIdentifying ? 'var(--panel-2)' : 'var(--gold-soft)',
                    color: photoIdentifying ? 'var(--muted)' : 'var(--gold)',
                    border: '1px solid var(--gold)',
                    cursor: photoIdentifying ? 'wait' : 'pointer',
                  }}
                >
                  {photoIdentifying ? (
                    <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Scanning...</>
                  ) : (
                    <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: '-2px' }}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> List by Photo</>
                  )}
                </button>
                <input
                  ref={photoScanRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handlePhotoScan}
                />
              </div>
              {photoIdResult === 'failed' && (
                <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,92,108,.1)', border: '1px solid rgba(255,92,108,.3)', color: 'var(--down)', fontSize: 12 }}>
                  We couldn't identify this card — fill in the details manually below.
                </div>
              )}
              {photoIdResult === 'success' && (
                <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(52,216,138,.1)', border: '1px solid rgba(52,216,138,.3)', color: 'var(--up)', fontSize: 12 }}>
                  Card identified! Please verify the details are correct.
                </div>
              )}
              <input
                type="text" placeholder="Or search player, set, year..."
                value={searchQ} onChange={e => setSearchQ(e.target.value)}
                style={{
                  width: '100%', padding: '12px 16px', background: 'var(--ink)', border: '1px solid var(--line)',
                  borderRadius: 10, color: 'var(--txt)', fontSize: 14, outline: 'none', marginBottom: 12,
                }}
              />
              {searchResults.length > 0 && (
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {searchResults.map(c => (
                    <div key={c.id} onClick={() => selectCard(c)} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      borderRadius: 8, cursor: 'pointer', transition: '.15s',
                      border: '1px solid transparent',
                    }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--panel-2)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{
                        width: 44, height: 56, borderRadius: 6, background: 'var(--panel-2)',
                        display: 'grid', placeItems: 'center', fontSize: 10, fontFamily: 'var(--mono)',
                        color: 'var(--dim)', overflow: 'hidden', flexShrink: 0,
                      }}>
                        {(c.ebay_thumb || c.image_url) ? (
                          <img src={c.ebay_thumb || c.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (c.player || '').split(' ').map(w => w[0]).join('').slice(0, 3)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{c.player}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {c.grader} {c.grade} · {c.card_set} {c.variant ? `· ${c.variant}` : ''}
                        </div>
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--gold)' }}>
                        {c.catalog_price ? fmt(Number(c.catalog_price)) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {searchQ.length >= 2 && searchResults.length === 0 && (
                <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                  No cards found. Try a different search.
                </div>
              )}
            </div>
          )}

          {/* Step 1: Set Price */}
          {step === 1 && selectedCard && (
            <div className="sell-card-panel" style={{ background: 'var(--panel)', borderRadius: 'var(--r)', padding: 24 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                <div style={{
                  width: 60, height: 80, borderRadius: 8, background: 'var(--panel-2)',
                  display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0,
                }}>
                  {(selectedCard.ebay_thumb || selectedCard.image_url)
                    ? <img src={selectedCard.ebay_thumb || selectedCard.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)' }}>{(selectedCard.player || '').split(' ').map(w => w[0]).join('').slice(0, 3)}</span>}
                </div>
                <div>
                  <h3 style={{ fontFamily: 'var(--disp)', fontSize: 16 }}>{selectedCard.player}</h3>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>{selectedCard.grader} {selectedCard.grade} · {selectedCard.card_set}</div>
                </div>
              </div>

              {fmv && (
                <div style={{
                  background: 'var(--gold-soft)', borderRadius: 8, padding: '10px 14px',
                  marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, color: 'var(--gold)',
                }}>
                  <span></span>
                  <span>Market value: {fmv.lo ? `${fmt(fmv.lo)} – ${fmt(fmv.hi)}` : fmt(fmv.avg || fmv.median || 0)}</span>
                  {fmv.avg && <span style={{ color: 'var(--muted)', fontSize: 11 }}>· Avg {fmt(fmv.avg)}</span>}
                </div>
              )}

              <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'block' }}>Your price (USD)</label>
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 18 }}>$</span>
                <input
                  type="number" value={price} onChange={e => setPrice(e.target.value)}
                  placeholder="0.00" min="1" max="9999" step="0.01"
                  style={{
                    width: '100%', padding: '14px 16px 14px 32px', background: 'var(--ink)', border: '1px solid var(--line)',
                    borderRadius: 10, color: 'var(--txt)', fontSize: 18, fontFamily: 'var(--mono)',
                    outline: 'none',
                  }}
                />
              </div>

              {price && fmv?.avg && (
                <div style={{ fontSize: 12, color: Number(price) < (fmv.lo || fmv.avg * 0.85) ? 'var(--up)' : Number(price) > (fmv.hi || fmv.avg * 1.15) ? 'var(--down)' : 'var(--muted)', marginBottom: 10 }}>
                  {Number(price) < (fmv.lo || fmv.avg * 0.85) ? 'Below market — will sell fast' : Number(price) > (fmv.hi || fmv.avg * 1.15) ? 'Above market range' : 'Fair market price'}
                </div>
              )}

              {/* Fee transparency AT the price step — not just buried in review */}
              {price && Number(price) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', background: 'var(--ink)', borderRadius: 8, padding: '9px 14px', marginBottom: 16, fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>You&apos;ll receive after the 10% fee</span>
                  <span className="mono" style={{ color: 'var(--up)', fontWeight: 700, fontSize: 14 }}>${(Number(price) * 0.9).toFixed(2)}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="chip" onClick={() => setStep(0)} style={{ color: 'var(--muted)' }}>← Back</button>
                <button className="chip on" onClick={() => { if (price && Number(price) > 0) setStep(2); else toast('Set a price first', true); }}>Continue →</button>
              </div>
            </div>
          )}

          {/* Step 2: Listing Type */}
          {step === 2 && (
            <div className="sell-card-panel" style={{ background: 'var(--panel)', borderRadius: 'var(--r)', padding: 24 }}>
              <h3 style={{ fontFamily: 'var(--disp)', marginBottom: 16 }}>Listing type</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  { key: 'buy_now', icon: '', label: 'Buy Now', desc: 'Fixed price. First buyer gets it.' },
                  { key: 'auction', icon: '🔨', label: 'Auction', desc: 'Let buyers bid. Goes to highest bidder.' },
                  { key: 'offer', icon: '', label: 'Open to Offers', desc: 'Buyers submit offers. You choose.' },
                ].map(t => (
                  <div key={t.key} onClick={() => { setListingType(t.key); if (t.key === 'offer') setOpenToOffers(true); else setOpenToOffers(false); }}
                    style={{
                      padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${listingType === t.key ? 'var(--gold)' : 'var(--line)'}`,
                      background: listingType === t.key ? 'var(--gold-soft)' : 'transparent',
                      transition: '.15s',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>{t.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>{t.desc}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {listingType === 'buy_now' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={openToOffers} onChange={e => setOpenToOffers(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--gold)' }} />
                  Also accept offers below asking price
                </label>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="chip" onClick={() => setStep(1)} style={{ color: 'var(--muted)' }}>← Back</button>
                <button className="chip on" onClick={() => setStep(3)}>Continue →</button>
              </div>
            </div>
          )}

          {/* Step 3: Photos */}
          {step === 3 && (
            <div className="sell-card-panel" style={{ background: 'var(--panel)', borderRadius: 'var(--r)', padding: 24 }}>
              <h3 style={{ fontFamily: 'var(--disp)', marginBottom: 6 }}>Add photos</h3>
              <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 16 }}>Optional — add up to 8 photos of your card.</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 10, marginBottom: 16 }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative', aspectRatio: '3/4', borderRadius: 8, overflow: 'hidden' }}>
                    <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                      style={{
                        position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                        borderRadius: '50%', background: 'rgba(0,0,0,.7)', color: '#fff',
                        fontSize: 12, display: 'grid', placeItems: 'center',
                      }}>✕</button>
                  </div>
                ))}
                {photos.length < 8 && (
                  <div onClick={() => fileRef.current?.click()}
                    style={{
                      aspectRatio: '3/4', borderRadius: 8, border: '2px dashed var(--line)',
                      display: 'grid', placeItems: 'center', cursor: 'pointer',
                      color: 'var(--dim)', fontSize: 24, transition: '.15s',
                    }}>
                    +
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple
                onChange={handlePhoto} style={{ display: 'none' }} />

              <textarea
                placeholder="Description (optional) — mention any flaws, centering notes, etc."
                value={description} onChange={e => setDescription(e.target.value)}
                rows={3}
                style={{
                  width: '100%', padding: 12, background: 'var(--ink)', border: '1px solid var(--line)',
                  borderRadius: 10, color: 'var(--txt)', fontSize: 13, outline: 'none', resize: 'vertical',
                  fontFamily: 'var(--ui)', marginBottom: 16,
                }}
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="chip" onClick={() => setStep(2)} style={{ color: 'var(--muted)' }}>← Back</button>
                <button className="chip on" onClick={() => setStep(4)}>Continue →</button>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && selectedCard && (
            <div className="sell-card-panel" style={{ background: 'var(--panel)', borderRadius: 'var(--r)', padding: 24 }}>
              <h3 style={{ fontFamily: 'var(--disp)', marginBottom: 16 }}>Review your listing</h3>

              <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                <div style={{
                  width: 80, height: 110, borderRadius: 8, background: 'var(--panel-2)',
                  display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0,
                }}>
                  {(photos[0] || selectedCard.ebay_thumb || selectedCard.image_url)
                    ? <img src={photos[0] || selectedCard.ebay_thumb || selectedCard.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--dim)' }}>{(selectedCard.player || '').split(' ').map(w => w[0]).join('').slice(0, 3)}</span>}
                </div>
                <div>
                  <h4 style={{ fontFamily: 'var(--disp)', fontSize: 18 }}>{selectedCard.player}</h4>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>
                    {selectedCard.grader} {selectedCard.grade} · {selectedCard.card_set}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 22, color: 'var(--gold)', fontWeight: 700 }}>
                    ${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <span style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 6,
                      background: 'var(--gold-soft)', color: 'var(--gold)',
                    }}>
                      {listingType === 'buy_now' ? 'Buy Now' : listingType === 'auction' ? '🔨 Auction' : 'Offers'}
                    </span>
                    {openToOffers && listingType !== 'offer' && (
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--panel-2)', color: 'var(--muted)' }}>
                        + Accepts offers
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {description && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, padding: '8px 12px', background: 'var(--ink)', borderRadius: 8 }}>
                  {description}
                </div>
              )}

              {photos.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
                  {photos.map((p, i) => (
                    <img key={i} src={p} alt="" style={{ height: 60, borderRadius: 6, objectFit: 'cover' }} />
                  ))}
                </div>
              )}

              <div style={{ background: 'var(--ink)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--muted)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>Platform fee (10%)</span>
                  <span className="mono">${(Number(price) * 0.1).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: 'var(--txt)' }}>
                  <span>You receive</span>
                  <span className="mono">${(Number(price) * 0.9).toFixed(2)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="chip" onClick={() => setStep(3)} style={{ color: 'var(--muted)' }}>← Back</button>
                <button className="chip on" onClick={submit} disabled={submitting}
                  style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>
                  {submitting ? 'Listing...' : 'List it'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'my' && (
        <div>
          {loadingMine && <div style={{ color: 'var(--muted)', padding: 20 }}>Loading...</div>}
          {!loadingMine && myListings.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--muted)' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}></div>
              <p style={{ fontSize: 15, marginBottom: 6 }}>No active listings yet.</p>
              <p style={{ fontSize: 13 }}>Switch to &ldquo;List a Card&rdquo; to get started.</p>
            </div>
          )}
          <div className="grid">
            {myListings.map(l => (
              <div key={l.id} style={{
                background: 'var(--panel)', borderRadius: 'var(--r)', overflow: 'hidden',
                border: '1px solid var(--line)',
              }}>
                <div style={{ height: 140, background: 'var(--panel-2)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                  {(l.ebay_thumb || l.image_url)
                    ? <img src={l.ebay_thumb || l.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--dim)' }}>{(l.player || '').split(' ').map(w => w[0]).join('').slice(0, 3)}</span>}
                </div>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{l.player}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>
                    {l.grader} {l.grade} · {l.card_set}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--gold)', fontWeight: 700 }}>
                      {fmt(Number(l.price))}
                    </span>
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 4,
                      background: l.status === 'active' ? 'var(--up-soft)' : 'var(--panel-2)',
                      color: l.status === 'active' ? 'var(--up)' : 'var(--dim)',
                    }}>
                      {l.status?.toUpperCase()}
                    </span>
                  </div>
                  {l.offer_count > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--gold)', marginBottom: 6 }}>
                      {l.offer_count} offer{l.offer_count > 1 ? 's' : ''}
                    </div>
                  )}

                  {editId === l.id ? (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)}
                        style={{
                          flex: 1, padding: '6px 8px', background: 'var(--ink)', border: '1px solid var(--line)',
                          borderRadius: 6, color: 'var(--txt)', fontFamily: 'var(--mono)', fontSize: 12,
                        }} />
                      <button className="chip on" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => updatePrice(l.id)}>Save</button>
                      <button className="chip" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => setEditId(null)}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="chip" style={{ fontSize: 11, flex: 1 }}
                        onClick={() => { setEditId(l.id); setEditPrice(String(Number(l.price))); }}>
                        ✏️ Edit Price
                      </button>
                      <button className="chip" style={{ fontSize: 11, color: 'var(--down)' }}
                        onClick={() => cancelListing(l.id)}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'store' && (
        <div style={{ maxWidth: 560 }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, padding: 28, marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--gold-soft)', color: 'var(--gold)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><IconStore size={26} /></div>
              <div>
                <h2 style={{ fontFamily: 'var(--disp)', fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>Apply to Sell as a Store</h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>Verified stores get a dedicated storefront, bulk inventory upload, a verified badge on all listings, and featured placement across the marketplace.</p>
              </div>
            </div>
            {storeMsg ? (
              <div style={{ background: storeMsg.startsWith('✓') ? 'rgba(52,216,138,.1)' : 'rgba(255,92,108,.1)', border: `1px solid ${storeMsg.startsWith('✓') ? 'rgba(52,216,138,.3)' : 'rgba(255,92,108,.3)'}`, borderRadius: 10, padding: '12px 16px', fontSize: 13, color: storeMsg.startsWith('✓') ? 'var(--up)' : 'var(--down)', marginBottom: 16 }}>{storeMsg}</div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { key: 'store_name', label: 'Store Name', placeholder: 'e.g. Pacific Coast Cards', required: true },
                { key: 'store_location', label: 'Location', placeholder: 'e.g. San Diego, CA' },
                { key: 'store_website', label: 'Website', placeholder: 'e.g. https://yourshop.com' },
              ].map(({ key, label, placeholder, required }) => (
                <div key={key}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>{label} {required && <span style={{ color: 'var(--gold)' }}>*</span>}</label>
                  <input value={storeForm[key]} onChange={e => setStoreForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                    style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 9, padding: '10px 12px', color: 'var(--txt)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>About Your Store</label>
                <textarea value={storeForm.store_description} onChange={e => setStoreForm(f => ({ ...f, store_description: e.target.value }))}
                  placeholder="Tell collectors what you specialize in — sports, eras, brands, grades..."
                  rows={3} style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 9, padding: '10px 12px', color: 'var(--txt)', fontSize: 13, outline: 'none', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
              <button onClick={async () => {
                if (!storeForm.store_name.trim()) { setStoreMsg('Store name is required'); return; }
                setStoreSubmitting(true); setStoreMsg('');
                try {
                  const res = await fetch('/api/store/apply', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(storeForm) });
                  const data = await res.json();
                  if (!res.ok) setStoreMsg(data.error || 'Submission failed');
                  else setStoreMsg('✓ Application submitted! We will review and verify your store within 24 hours.');
                } catch { setStoreMsg('Something went wrong. Try again.'); }
                finally { setStoreSubmitting(false); }
              }} disabled={storeSubmitting}
                style={{ padding: '12px 0', borderRadius: 10, background: 'linear-gradient(135deg,#16c784, #0fa76f)', color: '#000', fontWeight: 800, fontSize: 14, border: 'none', cursor: storeSubmitting ? 'wait' : 'pointer', opacity: storeSubmitting ? 0.7 : 1 }}>
                {storeSubmitting ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </div>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 20px' }}>
            <div style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>What you get as a verified store</div>
            {['Dedicated storefront page at gemlinecards.com/store/yourname','Verified badge on every listing','Bulk inventory upload (up to 200 cards at once)','Featured placement across the marketplace','Sales analytics dashboard'].map(text => (
              <div key={text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>
                <span style={{ flexShrink: 0, color: 'var(--gold)', marginTop: 1 }}><IconCheck size={14} /></span>{text}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
