'use client';
import { useState, useEffect } from 'react';
import DealFinder from '../components/DealFinder';

// THE paid surface: the Deal Finder (net-edge deal board, GEMLINE Score,
// Live Deals, alerts) plus Worth Grading and the Track Record. Behind the
// GEMLINE Pro paywall — gating lives in ProGate.js CAPABILITY_PLAN under
// 'dealfinder' ('pro'), and the API enforces it server-side too.
// URL-driven + deep-linkable via ?tab= (e.g. /deal-finder?tab=grading).
const DF_TABS = [
  ['deals', 'Deals'],
  ['grading', 'Worth Grading'],
  ['track', 'Our Track Record'],
];
const VALID_TABS = new Set(DF_TABS.map(t => t[0]));

// One page header for all views — the tab bar lives INSIDE it, right under
// the title, same underline pattern as the market tab bar.
const HERO = {
  deals: ['Deal Finder', 'Cards priced below fair value, fees already counted and every deal scored 0–100 — with live eBay cross-checks. A GEMLINE Pro feature.'],
  grading: ['Worth grading?', 'Run the numbers before you send a card in. Raw price, graded price, and grading cost, all in one view.'],
  track: ['Our Track Record', 'Every deal we flagged, and what the price did next. Receipts, not promises.'],
};

export default function DealFinderPage() {
  // Top-level view: deals (deal board) | grading (Worth Grading calculator).
  const [activeTab, setActiveTab] = useState('deals');

  // The whole page commits to the dark trade-desk theme. Toggled at body
  // level so header/footer follow, and cleanly reverted on unmount.
  useEffect(() => {
    document.body.classList.add('page-dark');
    return () => document.body.classList.remove('page-dark');
  }, []);

  // Read the active tab from the URL on load + keep it in sync with back/
  // forward navigation (?tab=grading is shareable and history-friendly).
  useEffect(() => {
    const readTab = () => {
      try {
        const t = new URLSearchParams(window.location.search).get('tab');
        setActiveTab(VALID_TABS.has(t) ? t : 'deals');
      } catch { setActiveTab('deals'); }
    };
    readTab();
    window.addEventListener('popstate', readTab);
    return () => window.removeEventListener('popstate', readTab);
  }, []);

  const selectTab = (t) => {
    setActiveTab(t);
    try {
      const url = new URL(window.location.href);
      if (t === 'deals') url.searchParams.delete('tab');
      else url.searchParams.set('tab', t);
      window.history.pushState(null, '', url.toString());
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch {}
  };

  return (
    <>
      {/* Page header — title + native underline tab bar (Deals | Worth
          Grading). The tab bar sticks under the site header while scrolling.
          .market-hero collapses on mobile so the desk lands in the first
          viewport. */}
      <div className="market-hero">
        <div className="eyebrow">Pricing Tools</div>
        <h1 className="page">{HERO[activeTab][0]}</h1>
        <p className="sub">{HERO[activeTab][1]}</p>
      </div>
      <div className="market-tabs" role="tablist" aria-label="Deal Finder views">
        {DF_TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={activeTab === k}
            className={`market-tab ${activeTab === k ? 'on' : ''}`}
            onClick={() => selectTab(k)}>{label}</button>
        ))}
      </div>

      <DealFinder view={activeTab} />
    </>
  );
}
