// Card image resolver.
// Pokemon: Pokémon TCG API (free, no key, official images).
// Sports: eBay listing thumbnails via Apify scraper.

const POKEMON_API = 'https://api.pokemontcg.io/v2/cards';
const APIFY_TOKEN = process.env.APIFY_TOKEN || '';

// Pokémon TCG set/card id map for catalog cards.
// Full list: https://pokemontcg.io
const POKEMON_IDS = {
  'Charizard|1999 Base Set|Holo 1st Edition':   'base1-4',
  'Charizard|1999 Base Set|Holo Shadowless':     'base1-4',
  'Umbreon|2022 Evolving Skies|Alt Art VMAX':    'swsh7-215',
  'Pikachu Illustrator|1998 CoroCoro|Promo':     'pgo-71',  // closest available
};

const _imgCache = new Map();

// Fetch official Pokémon card image. Returns URL string or null.
async function pokemonImage(player, set, variant) {
  const key = `${player}|${set}|${variant}`;
  if (_imgCache.has(key)) return _imgCache.get(key);

  // Try direct ID lookup first.
  const directId = POKEMON_IDS[key];
  if (directId) {
    try {
      const res = await fetch(`${POKEMON_API}/${directId}`);
      if (res.ok) {
        const d = await res.json();
        const url = d.data?.images?.large || d.data?.images?.small || null;
        _imgCache.set(key, url);
        return url;
      }
    } catch {}
  }

  // Fuzzy search fallback.
  try {
    const q = encodeURIComponent(`name:"${player}"`);
    const res = await fetch(`${POKEMON_API}?q=${q}&pageSize=5`);
    if (res.ok) {
      const d = await res.json();
      const card = d.data?.[0];
      const url = card?.images?.large || card?.images?.small || null;
      _imgCache.set(key, url);
      return url;
    }
  } catch {}

  _imgCache.set(key, null);
  return null;
}

// Fetch eBay listing thumbnail via Apify cheerio scraper. Returns URL or null.
async function ebayThumbnail(query) {
  if (!APIFY_TOKEN) return null;
  const cacheKey = `ebay:${query}`;
  if (_imgCache.has(cacheKey)) return _imgCache.get(cacheKey);

  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_BIN=1&_ipg=5`;
    const input = {
      startUrls: [{ url }],
      pageFunction: `async function pageFunction(context) {
        const { $ } = context;
        const imgs = [];
        $('li.s-item').each((i, el) => {
          if (i === 0) return;
          const src = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
          if (src && !src.includes('s-l64') && src.startsWith('http')) imgs.push(src.replace('s-l225','s-l500').replace('s-l140','s-l500'));
        });
        return imgs.slice(0, 1);
      }`,
      maxRequestsPerCrawl: 1,
      proxyConfiguration: { useApifyProxy: true },
    };
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/apify~cheerio-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=25`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
    );
    if (!runRes.ok) { _imgCache.set(cacheKey, null); return null; }
    const items = await runRes.json();
    const flat = items.flatMap(i => Array.isArray(i) ? i : [i]).filter(Boolean);
    const imgUrl = flat[0] || null;
    _imgCache.set(cacheKey, imgUrl);
    return imgUrl;
  } catch {
    _imgCache.set(cacheKey, null);
    return null;
  }
}

// Main resolver — picks the right strategy by sport.
export async function resolveImage(entry) {
  if (entry.sport === 'Pokémon') {
    return pokemonImage(entry.player, entry.set, entry.variant);
  }
  // Sports cards: scrape eBay
  const q = `${entry.player} ${entry.set} ${entry.grader} ${entry.grade} PSA card`;
  return ebayThumbnail(q);
}

// Batch resolve images for multiple entries concurrently (capped).
export async function resolveImages(entries, limit = 10) {
  const top = entries.slice(0, limit);
  const rest = entries.slice(limit);
  const topResults = await Promise.all(top.map(e => resolveImage(e).catch(() => null)));
  return [...topResults, ...rest.map(() => null)];
}
