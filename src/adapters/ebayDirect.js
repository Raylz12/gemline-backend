/**
 * ebayDirect.js — Direct eBay sold listings scraper (no Apify, no API key)
 * Hits eBay's public completed listings search and parses the HTML.
 * Rate-limited to be polite: 1 request per 1.5s.
 */

const SOLD_URL = 'https://www.ebay.com/sch/i.html';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Parse sold price from eBay HTML string (price text like "$325.00")
 */
function parsePrice(str) {
  if (!str) return null;
  const match = str.match(/\$?([\d,]+\.?\d*)/);
  return match ? parseFloat(match[1].replace(',', '')) : null;
}

/**
 * Extract thumbnail URL from eBay image tag
 */
function extractThumb(html) {
  const match = html.match(/s-item__image-img[^>]+src="([^"]+)"/);
  if (!match) return null;
  let url = match[1];
  // Convert to larger size
  url = url.replace(/\/s-l\d+\./, '/s-l400.');
  return url.startsWith('http') ? url : null;
}

/**
 * Scrape eBay completed/sold listings for a search query.
 * Returns array of { title, price, thumbnail, url, soldDate, condition }
 */
export async function scrapeEbaySold(query, maxItems = 20) {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Complete: '1',   // completed listings
    LH_Sold: '1',       // sold only
    _ipg: '60',         // items per page
    _sop: '13',         // sort by newest first
  });

  const url = `${SOLD_URL}?${params}`;

  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`eBay returned ${res.status}`);
    const html = await res.text();

    const results = [];

    // Split by item containers
    const itemBlocks = html.split('s-item__wrapper');
    
    for (let i = 1; i < itemBlocks.length && results.length < maxItems; i++) {
      const block = itemBlocks[i];

      // Extract title
      const titleMatch = block.match(/class="s-item__title[^"]*"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?\s*([^<]+)/);
      const title = titleMatch ? titleMatch[1].trim() : null;
      if (!title || title.toLowerCase().includes('shop on ebay')) continue;

      // Extract price
      const priceMatch = block.match(/class="s-item__price"[^>]*>\s*<span[^>]*>([\$\d,\.]+)/);
      const price = priceMatch ? parsePrice(priceMatch[1]) : null;
      if (!price || price < 1) continue;

      // Extract thumbnail
      const thumbMatch = block.match(/src="(https:\/\/i\.ebayimg\.com\/[^"]+)"/);
      const thumbnail = thumbMatch ? thumbMatch[1].replace(/\/s-l\d+\./, '/s-l400.') : null;

      // Extract URL
      const urlMatch = block.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"?]+)/);
      const itemUrl = urlMatch ? urlMatch[1] : null;

      // Extract sold date
      const dateMatch = block.match(/s-item__ended-date[^>]*>([^<]+)/);
      const soldDate = dateMatch ? dateMatch[1].trim() : null;

      // Extract condition
      const condMatch = block.match(/SECONDARY_INFO[^>]*>([^<]+)/);
      const condition = condMatch ? condMatch[1].trim() : null;

      if (title && price) {
        results.push({ title, price, thumbnail, url: itemUrl, soldDate, condition });
      }
    }

    return results;
  } catch (e) {
    console.error(`[ebayDirect] failed for "${query}":`, e.message);
    return [];
  }
}

/**
 * Ingest sold comps for a list of card searches into price_history.
 * Rate limited to avoid blocking.
 */
export async function ingestBatch(pool, searches, { delayMs = 1500, maxPerSearch = 15 } = {}) {
  let totalStored = 0;
  let totalThumbs = 0;

  for (let i = 0; i < searches.length; i++) {
    const { query, player, grader, grade, cardSet, cardId } = searches[i];
    console.log(`[${i+1}/${searches.length}] Scraping: ${query}`);

    const items = await scrapeEbaySold(query, maxPerSearch);
    console.log(`  → ${items.length} results`);

    for (const item of items) {
      const price = item.price;
      if (!price || price < 2) continue;

      // Detect grader/grade from title if not provided
      let detectedGrader = grader || 'RAW';
      let detectedGrade = grade || '';
      const tl = item.title.toLowerCase();
      if (!grader) {
        if (tl.includes('psa')) detectedGrader = 'PSA';
        else if (tl.includes('bgs')) detectedGrader = 'BGS';
        else if (tl.includes('sgc')) detectedGrader = 'SGC';
        else if (tl.includes('cgc')) detectedGrader = 'CGC';
      }
      if (!grade) {
        const gm = tl.match(/(?:psa|bgs|sgc|cgc)\s*(\d+(?:\.\d+)?)/i);
        if (gm) detectedGrade = gm[1];
      }

      try {
        await pool.query(`
          INSERT INTO price_history 
            (id, player, grader, grade, card_set, source, sale_price, listing_url, thumbnail, title, sale_date, scraped_at)
          VALUES 
            (gen_random_uuid(), $1, $2, $3, $4, 'ebay', $5, $6, $7, $8, $9, NOW())
        `, [
          player,
          detectedGrader,
          detectedGrade,
          cardSet || '',
          price,
          item.url || null,
          item.thumbnail || null,
          item.title || null,
          item.soldDate ? new Date(item.soldDate) : new Date(),
        ]);
        totalStored++;

        // Update card thumbnail
        if (item.thumbnail && cardId) {
          const r = await pool.query(
            `UPDATE cards SET ebay_thumb=$1 WHERE id=$2 AND ebay_thumb IS NULL`,
            [item.thumbnail, cardId]
          );
          if (r.rowCount) totalThumbs++;
        }
      } catch (e) {
        // Skip duplicates or errors
      }
    }

    // Rate limiting
    if (i < searches.length - 1) await sleep(delayMs);
  }

  return { totalStored, totalThumbs };
}
