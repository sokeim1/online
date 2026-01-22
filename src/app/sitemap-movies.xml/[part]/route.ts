import { movieSlugHtmlPath } from "@/lib/movieUrl";
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

function toLastMod(dateLike: string | null | undefined): string | null {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

class SitemapNotFoundError extends Error {
  name = "SitemapNotFoundError";
}

async function buildMoviesSitemap(baseUrl: string, part: number): Promise<string> {
  if (!hasDatabaseUrl()) {
    return `<?xml version="1.0" encoding="UTF-8"?>` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
  }

  await ensureVideoseedSchema();

  const urlsPerSitemap = 10000;
  const offset = (part - 1) * urlsPerSitemap;

  const rows = await dbQuery<{ kp_id: number; title_rus: string | null; title_orig: string | null; created_at: string | null }>(
    `SELECT kp_id, MAX(title_rus) AS title_rus, MAX(title_orig) AS title_orig, MAX(created_at) AS created_at
     FROM videoseed_videos
     WHERE kp_id IS NOT NULL
     GROUP BY kp_id
     ORDER BY MAX(created_at) DESC NULLS LAST, kp_id DESC
     LIMIT $1 OFFSET $2;`,
    [urlsPerSitemap, offset],
  );

  const urls: Array<{ loc: string; lastmod?: string }> = [];
  for (const r of rows.rows) {
    const title = r.title_rus ?? r.title_orig ?? String(r.kp_id);
    urls.push({
      loc: `${baseUrl}${movieSlugHtmlPath(r.kp_id, title)}`,
      lastmod: toLastMod(r.created_at) ?? undefined,
    });
  }

  const body = urls
    .map((u) => {
      const lastmod = u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : "";
      return `<url><loc>${escapeXml(u.loc)}</loc>${lastmod}</url>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export async function GET(req: Request, ctx: { params: Promise<{ part: string }> }) {
  const origin = new URL(req.url).origin;
  const siteUrl = normalizeSiteUrl(process.env.SITE_URL ?? origin);

  const { part: partRaw } = await ctx.params;
  const part = Number.parseInt(partRaw, 10);

  if (!Number.isFinite(part) || part < 1 || part > 5000) {
    return new Response("Invalid part", { status: 400 });
  }

  const cacheKey = `${siteUrl}|movies|${part}`;
  const cached = cache.get(cacheKey);
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
    const xml = await buildMoviesSitemap(siteUrl, part);
    cache.set(cacheKey, { xml, expiresAt: now + 60 * 60 * 1000 });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=3600",
      },
    });
  } catch (e) {
    if (cached) {
      return new Response(cached.xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=0, s-maxage=3600",
        },
      });
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
