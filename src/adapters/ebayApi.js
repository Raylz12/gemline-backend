/**
 * ebayApi.js — Official eBay Finding API integration
 * Free: 5,000 calls/day with a developer AppID
 * Register at: https://developer.ebay.com (takes 5 minutes, free)
 *
 * Set env var: EBAY_APP_ID=<your AppID>
 * 
 * findCompletedItems returns sold listings with price, thumbnail, condition, etc.
 */

const FINDING_API = 'https://svcs.ebay.com/services/search/FindingService/v1';

function getAppId() {
  return process.env.EBAY_APP_ID || null;
}

/**
 * Find completed (sold) eBay listings for a search query.
 * Returns array of { title, soldPrice, thumbnail, url, condition, endDate, bids }
 */
export async function findCompletedItems(query, { maxItems = 20, minPrice = 5 } = {}) {
  const appId = getAppId();
  if (!appId) {
    console.warn('[ebayApi] EBAY_APP_ID not set — skipping eBay API call');
    return [];
  }

  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': appId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    'keywords': query,
    'sortOrder': 'EndTimeSoonest',
    'paginationInput.entriesPerPage': String(Math.min(maxItems, 100)),
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'itemFilter(1).name': 'MinPrice',
    'itemFilter(1).value': String(minPrice),
    'itemFilter(1).paramName': 'Currency',
    'itemFilter(1).paramValue': 'USD',
    'outputSelector(0)': 'PictureURLLarge',
    'outputSelector(1)': 'SellerInfo',
  });

  try {
    const res = await fetch(`${FINDING_API}?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`eBay API returned ${res.status}`);
    const data = await res.json();
    const response = data?.findCompletedItemsResponse?.[0];
    const ack = response?.ack?.[0];

    if (ack !== 'Success') {
      const errMsg = response?.errorMessage?.[0]?.error?.[0]?.message?.[0];
      throw new Error(`eBay API error: ${errMsg || ack}`);
    }

    const items = response?.searchResult?.[0]?.item || [];
    return items.map(item => {
      const currentPrice = item?.sellingStatus?.[0]?.currentPrice?.[0];
      const price = parseFloat(currentPrice?.['__value__'] || 0);
      const thumb = item?.pictureURLLarge?.[0] || item?.galleryURL?.[0] || null;
      return {
        title: item?.title?.[0] || '',
        soldPrice: price,
        thumbnail: thumb,
        url: item?.viewItemURL?.[0] || null,
        condition: item?.condition?.[0]?.conditionDisplayName?.[0] || null,
        endDate: item?.listingInfo?.[0]?.endTime?.[0] || null,
        bids: parseInt(item?.sellingStatus?.[0]?.bidCount?.[0] || 0),
        itemId: item?.itemId?.[0] || null,
      };
    }).filter(i => i.soldPrice > minPrice);
  } catch (e) {
    console.error(`[ebayApi] findCompletedItems failed for "${query}":`, e.message);
    return [];
  }
}

/**
 * Bulk ingest for all catalog cards using the eBay Finding API.
 * Rate-limited to stay within 5000 calls/day limit.
 */
export async function bulkIngest(pool, cards, { delayMs = 500 } = {}) {
  let totalStored = 0;
  let totalThumbs = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const query = `${card.player} ${card.grader || ''} ${card.grade || ''} ${card.card_set || ''}`.replace(/\s+/g,' ').trim();
    
    console.log(`[${i+1}/${cards.length}] ${query}`);
    const items = await findCompletedItems(query, { maxItems: 20 });
    console.log(`  → ${items.length} results`);

    for (const item of items) {
      if (!item.soldPrice || item.soldPrice < 5) continue;
      try {
        await pool.query(`
          INSERT INTO price_history (id,player,grader,grade,card_set,source,sale_price,listing_url,thumbnail,title,sale_date,scraped_at)
          VALUES (gen_random_uuid(),$1,$2,$3,$4,'ebay',$5,$6,$7,$8,$9,NOW())
        `, [card.player, card.grader||'RAW', card.grade||'', card.card_set||'', 
            item.soldPrice, item.url, item.thumbnail, item.title, 
            item.endDate ? new Date(item.endDate) : new Date()]);
        totalStored++;

        if (item.thumbnail && card.id) {
          const r = await pool.query(`UPDATE cards SET ebay_thumb=$1 WHERE id=$2 AND ebay_thumb IS NULL`, [item.thumbnail, card.id]);
          if (r.rowCount) totalThumbs++;
        }
      } catch(e) { /* skip */ }
    }

    if (i < cards.length - 1) await new Promise(r => setTimeout(r, delayMs));
  }

  return { totalStored, totalThumbs };
}
