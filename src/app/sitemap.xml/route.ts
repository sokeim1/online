import { getVibixVideoLinks } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = {
  xml: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function buildSitemapIndex(baseUrl: string): Promise<string> {
  const limit = 100;
  const pagesPerSitemap = 35;

  const firstVideos = await getVibixVideoLinks({ page: 1, limit });
  const lastVideosPage = firstVideos.meta?.last_page ?? 1;
  const totalVideosSitemaps = Math.max(1, Math.ceil(lastVideosPage / pagesPerSitemap));
  const lastmod = new Date().toISOString();

  const sitemaps: Array<{ loc: string; lastmod?: string }> = [];
  sitemaps.push({ loc: `${baseUrl}/sitemap-static.xml`, lastmod });
  for (let part = 1; part <= totalVideosSitemaps; part += 1) {
    sitemaps.push({ loc: `${baseUrl}/sitemap-movies.xml/${part}`, lastmod });
  }

  const body = sitemaps
    .map((s) => {
      const lm = s.lastmod ? `<lastmod>${escapeXml(s.lastmod)}</lastmod>` : "";
      return `<sitemap><loc>${escapeXml(s.loc)}</loc>${lm}</sitemap>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const siteUrl = (process.env.SITE_URL ?? origin).replace(/\/$/, "");

  const cached = cache.get(siteUrl);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return new Response(cached.xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=3600",
      },
    });
  }

  const xml = await buildSitemapIndex(siteUrl);
  cache.set(siteUrl, { xml, expiresAt: now + 60 * 60 * 1000 });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
