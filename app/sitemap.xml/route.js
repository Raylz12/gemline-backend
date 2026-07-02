// Sitemap index — points at 16 chunked card sitemaps served by the API.
// Chunks are split by uuid first hex character (uniform ~40K priced cards
// each, under the 50K-per-sitemap limit) so no expensive OFFSET scans.
export const revalidate = 86400;

export async function GET() {
  const now = new Date().toISOString().slice(0, 10);
  const chunks = [...Array(16).keys()].map(n => n.toString(16));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${chunks.map(c => `  <sitemap><loc>https://gemlinecards.com/api/sitemap/${c}</loc><lastmod>${now}</lastmod></sitemap>`).join('\n')}
</sitemapindex>`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
    },
  });
}
