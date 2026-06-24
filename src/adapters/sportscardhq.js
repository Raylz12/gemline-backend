// SportsCardHQ / guide price adapter.
// Set SCHQ_API_KEY in .env to enable.
const KEY = process.env.SCHQ_API_KEY || '';

export function schqEnabled() { return !!KEY; }

// Returns a guide price for a card query + grade.
export async function guidePrice(query, grade) {
  if (!schqEnabled()) return null;
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(`https://api.sportscardhq.com/v1/guide?q=${q}&grade=${grade}`, {
      headers: { 'X-Api-Key': KEY },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const price = d.guidePrice || d.price || null;
    if (!price) return null;
    return { source: 'sportscardhq', price: Number(price), url: d.url || null, kind: 'guide' };
  } catch {
    return null;
  }
}
