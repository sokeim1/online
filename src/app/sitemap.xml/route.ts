import { hasDatabaseUrl } from "@/lib/db";
import { dbQuery } from "@/lib/db";
import { ensureVideoseedSchema } from "@/lib/videoseedIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = {
  xml: string;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function normalizeSiteUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl.replace(/\/$/, "");
  }

  const parts = url.hostname.split(".");
  if (parts[0] === "m") {
    parts.shift();
  }
  if (parts[0] === "www" && parts[1] === "m") {
    parts.splice(1, 1);
  }

  if (parts[0] === "www") {
    parts.shift();
  }

  const host = parts.join(".");
  url.hostname = host;
  return url.toString().replace(/\/$/, "");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function buildSitemapIndex(baseUrl: string): Promise<string> {
  const lastmod = new Date().toISOString();

  const sitemaps: Array<{ loc: string; lastmod?: string }> = [];
  sitemaps.push({ loc: `${baseUrl}/sitemap-static.xml`, lastmod });

  if (hasDatabaseUrl()) {
    await ensureVideoseedSchema();
    const totalRes = await dbQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM (
         SELECT DISTINCT kp_id
         FROM videoseed_videos
         WHERE kp_id IS NOT NULL
       ) t;`,
    );
    const total = Number.parseInt(totalRes.rows[0]?.count ?? "0", 10) || 0;

    const desiredSitemaps = 5;
    const maxUrlsPerSitemap = 50000;
    const urlsPerSitemap = Math.min(maxUrlsPerSitemap, Math.max(1, Math.ceil(total / desiredSitemaps)));
    const totalSitemaps = Math.max(1, Math.ceil(total / urlsPerSitemap));
    const safeTotal = Math.min(5000, Math.max(desiredSitemaps, totalSitemaps));
    for (let part = 1; part <= safeTotal; part += 1) {
      sitemaps.push({ loc: `${baseUrl}/sitemap-movies.xml/${part}`, lastmod });
    }
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
  const siteUrl = normalizeSiteUrl(process.env.SITE_URL ?? origin);

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

  try {
    const xml = await buildSitemapIndex(siteUrl);
    cache.set(siteUrl, { xml, expiresAt: now + 60 * 60 * 1000 });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=3600",
      },
    });
  } catch {
    if (cached) {
      return new Response(cached.xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=0, s-maxage=3600",
        },
      });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>`;
    return new Response(xml, {
      status: 503,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
