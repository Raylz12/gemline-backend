// Image serving helpers — R2-first thumbnail preference.
//
// cards.r2_thumb holds full URLs into our own R2 bucket
// (https://pub-….r2.dev/cards/<id>.jpg — ~1.06M rows). We prefer those over
// the scraped ebay/bubble/cardhedge thumbs (ebay_thumb) and legacy image_url.
//
// IMG_BASE (optional env): swaps the r2.dev host at RESPONSE time — lets us
// move serving to a Cloudflare Worker or custom domain later without touching
// a million DB rows. Unset ⇒ URLs pass through unchanged.
export const R2_PUB_HOST = 'https://pub-7ef1ca8df9574b60bba11826ed1ac782.r2.dev';

export const rewriteImg = (url) => {
  if (!url) return null;
  const base = (process.env.IMG_BASE || '').replace(/\/+$/, '');
  return (base && url.startsWith(R2_PUB_HOST)) ? base + url.slice(R2_PUB_HOST.length) : url;
};

// One true thumbnail pick for API responses: our R2 copy first (host-rewritten
// when IMG_BASE is set), then ebay/bubble thumb, then legacy image_url.
export const pickThumb = (c) => rewriteImg(c.r2_thumb) || c.ebay_thumb || c.image_url || null;
