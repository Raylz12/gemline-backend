// eBay completed listings scraper via Apify.
// Uses Apify's web scraper to pull sold comps from eBay's public completed
// listings pages — no eBay partner approval needed.
// Actor: apify/cheerio-scraper (lightweight, runs fast)

const TOKEN = process.env.APIFY_TOKEN || '';
const ACTOR = 'apify/cheerio-scraper';

export function ebayScraperEnabled() { return !!TOKEN; }

// Build eBay completed listings URL for a card query
function completedUrl(query) {
  const q = encodeURIComponent(query);
  return `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Complete=1&LH_Sold=1&_sop=12&_ipg=20`;
}

const INPUT = (query) => ({
  startUrls: [{ url: completedUrl(query) }],
  pageFunction: `async function pageFunction(context) {
    const { $, request } = context;
    const results = [];
    $('li.s-item').each((i, el) => {
      if (i === 0) return; // first is a ghost element
      const title = $(el).find('.s-item__title').text().trim();
      const priceText = $(el).find('.s-item__price').first().text().replace(/[^0-9.]/g, '');
      const price = parseFloat(priceText);
      const url = $(el).find('a.s-item__link').attr('href') || '';
      const dateText = $(el).find('.s-item__ended-date, .s-item__listingDate').text().trim();
      if (price > 0) results.push({ title, price, url, date: dateText });
    });
    return results;
  }`,
  maxRequestsPerCrawl: 1,
  proxyConfiguration: { useApifyProxy: true },
});

// Returns recent sold comps for a card query. Returns [] on failure.
export async function soldComps(query, limit = 5) {
  if (!ebayScraperEnabled()) return [];
  try {
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}&timeout=30`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(INPUT(query)),
      }
    );
    if (!runRes.ok) return [];
    const items = await runRes.json();
    // Flatten nested results (Apify cheerio returns array of arrays)
    const flat = items.flatMap(i => Array.isArray(i) ? i : [i]).filter(i => i.price > 0);
    return flat.slice(0, limit).map(i => ({ source: 'ebay_sold', price: i.price, url: i.url, title: i.title, kind: 'comp' }));
  } catch {
    return [];
  }
}

// Returns the lowest current ask from eBay active listings (not sold).
export async function activeLowestAsk(query) {
  if (!ebayScraperEnabled()) return null;
  try {
    const activeUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_BIN=1&_sop=15&_ipg=10`;
    const input = {
      startUrls: [{ url: activeUrl }],
      pageFunction: `async function pageFunction(context) {
        const { $ } = context;
        const results = [];
        $('li.s-item').each((i, el) => {
          if (i === 0) return;
          const priceText = $(el).find('.s-item__price').first().text().replace(/[^0-9.]/g, '');
          const price = parseFloat(priceText);
          const url = $(el).find('a.s-item__link').attr('href') || '';
          if (price > 0) results.push({ price, url });
        });
        return results.sort((a,b) => a.price - b.price).slice(0,1);
      }`,
      maxRequestsPerCrawl: 1,
      proxyConfiguration: { useApifyProxy: true },
    };
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}&timeout=30`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
    );
    if (!runRes.ok) return null;
    const items = await runRes.json();
    const flat = items.flatMap(i => Array.isArray(i) ? i : [i]).filter(i => i.price > 0);
    if (!flat.length) return null;
    const lowest = flat.sort((a, b) => a.price - b.price)[0];
    return { source: 'ebay_active', price: lowest.price, url: lowest.url, kind: 'ask' };
  } catch {
    return null;
  }
}
