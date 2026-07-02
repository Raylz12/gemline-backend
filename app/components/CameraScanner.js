'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

export default function CameraScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState('camera'); // camera | analyzing | result | error
  const [cardInfo, setCardInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      } catch (e) {
        if (!cancelled) { setError('Camera access denied. Please allow camera permissions.'); setState('error'); }
      }
    })();
    return () => { cancelled = true; stopStream(); };
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [stopStream, onClose]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.85);

    setState('analyzing');

    try {
      const res = await fetch('/api/cards/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      });
      const data = await res.json();
      if (data.error && !data.player) {
        setError(data.error);
        setState('error');
      } else {
        setCardInfo(data);
        setState('result');
      }
    } catch (e) {
      setError('Failed to analyze card. Please try again.');
      setState('error');
    }
  }, []);

  const retake = useCallback(() => {
    setState('camera');
    setCardInfo(null);
    setError(null);
  }, []);

  const confirm = useCallback(() => {
    stopStream();
    onResult(cardInfo);
  }, [cardInfo, onResult, stopStream]);

  return (
    <div className="overlay on" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <button className="modal-close" onClick={handleClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>

        <h2 style={{ fontFamily: 'var(--disp)', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
          📷 Scan Card
        </h2>

        {state === 'camera' && (
          <>
            <div style={{ position: 'relative', borderRadius: 'var(--r)', overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: '10%', border: '2px dashed var(--gold)', borderRadius: 12, pointerEvents: 'none', opacity: 0.5 }} />
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', margin: '12px 0 4px' }}>
              Position the card within the frame
            </p>
            <button onClick={capture} className="buy" style={{ width: '100%', marginTop: 12, padding: '12px 0', fontSize: 15, fontWeight: 600 }}>
              Capture
            </button>
          </>
        )}

        {state === 'analyzing' && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div className="scan-spinner" />
            <p style={{ color: 'var(--muted)', marginTop: 16, fontSize: 14 }}>Analyzing card with AI...</p>
          </div>
        )}

        {state === 'result' && cardInfo && (
          <div>
            <div style={{ background: 'var(--panel)', borderRadius: 'var(--r)', padding: 18, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontFamily: 'var(--disp)', fontWeight: 700, fontSize: 16 }}>{cardInfo.player || 'Unknown'}</span>
                <span className={`conf-badge conf-${cardInfo.confidence >= 0.8 ? 'high' : cardInfo.confidence >= 0.5 ? 'medium' : 'low'}`}
                  style={{ fontSize: 11, padding: '3px 8px' }}>
                  {Math.round((cardInfo.confidence || 0) * 100)}% match
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                {cardInfo.year && <div><span style={{ color: 'var(--muted)' }}>Year:</span> {cardInfo.year}</div>}
                {cardInfo.set && <div><span style={{ color: 'var(--muted)' }}>Set:</span> {cardInfo.set}</div>}
                {cardInfo.sport && <div><span style={{ color: 'var(--muted)' }}>Sport:</span> {cardInfo.sport}</div>}
                {cardInfo.grader && <div><span style={{ color: 'var(--muted)' }}>Grader:</span> {cardInfo.grader} {cardInfo.grade}</div>}
                {cardInfo.condition && <div><span style={{ color: 'var(--muted)' }}>Condition:</span> {cardInfo.condition}</div>}
                {cardInfo.cardNumber && <div><span style={{ color: 'var(--muted)' }}>Card #:</span> {cardInfo.cardNumber}</div>}
                {cardInfo.variant && <div><span style={{ color: 'var(--muted)' }}>Variant:</span> {cardInfo.variant}</div>}
                {cardInfo.certNumber && <div><span style={{ color: 'var(--muted)' }}>Cert #:</span> {cardInfo.certNumber}</div>}
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 12px', textAlign: 'center' }}>
              Next you’ll confirm the exact catalog card — nothing is added yet.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={retake} className="offer" style={{ flex: 1, padding: '11px 0' }}>Retake</button>
              <button onClick={confirm} className="buy" style={{ flex: 1, padding: '11px 0' }}>Find My Card</button>
            </div>
          </div>
        )}

        {state === 'error' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p style={{ color: 'var(--down)', marginBottom: 16 }}>{error}</p>
            <button onClick={retake} className="offer" style={{ padding: '10px 24px' }}>Try Again</button>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      <style jsx>{`
        .scan-spinner {
          width: 40px; height: 40px; margin: 0 auto;
          border: 3px solid var(--line);
          border-top-color: var(--gold);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
