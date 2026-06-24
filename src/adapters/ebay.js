// eBay Browse API adapter — active listing asks.
// Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in .env
const CLIENT_ID     = process.env.EBAY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';

export function ebayEnabled() { return !!(CLIENT_ID && CLIENT_SECRET); }

let _token = null, _tokenExp = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  const d = await res.json();
  _token = d.access_token;
  _tokenExp = Date.now() + (d.expires_in - 60) * 1000;
  return _token;
}

// Returns the lowest active eBay ask for a query string.
export async function lowestAsk(query) {
  if (!ebayEnabled()) return null;
  try {
    const tok = await getToken();
    const q = encodeURIComponent(query);
    const res = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${q}&limit=5&sort=price&filter=conditionIds%3A%7B2750%7C3000%7C4000%7D`,
      { headers: { Authorization: `Bearer ${tok}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } }
    );
    const d = await res.json();
    const items = d.itemSummaries || [];
    if (!items.length) return null;
    const lowest = items.reduce((a, b) => Number(a.price?.value) < Number(b.price?.value) ? a : b);
    return { source: 'ebay', price: Number(lowest.price?.value), url: lowest.itemWebUrl, kind: 'ask' };
  } catch {
    return null;
  }
}
