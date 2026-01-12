import { getVibixVideoLinks } from "@/lib/vibix";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

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

  const host = url.hostname;
  if (
    host &&
    !host.startsWith("www.") &&
    !host.startsWith("localhost") &&
    !host.startsWith("127.0.0.1") &&
    !host.endsWith(".vercel.app")
  ) {
    url.hostname = `www.${host}`;
  }
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

async function buildMoviesSitemap(baseUrl: string, part: number): Promise<string> {
  const limit = 20;
  const pagesPerSitemap = 35;
  const startPage = (part - 1) * pagesPerSitemap + 1;
  const endPage = part * pagesPerSitemap;

  const urls: Array<{ loc: string; lastmod?: string }> = [];

  const first = await getVibixVideoLinks({ type: "movie", page: startPage, limit });
  for (const v of first.data) {
    if (!v.kp_id) continue;
    const title = v.name_rus ?? v.name_eng ?? v.name;
    urls.push({
      loc: `${baseUrl}${movieSlugHtmlPath(v.kp_id, title)}`,
      lastmod: toLastMod(v.uploaded_at) ?? undefined,
    });
  }

  const lastPage = first.meta?.last_page ?? startPage;
  const maxPage = Math.min(endPage, lastPage);
  const pages: number[] = [];
  for (let page = startPage + 1; page <= maxPage; page += 1) {
    pages.push(page);
  }

  const batchSize = 4;
  for (let i = 0; i < pages.length; i += batchSize) {
    const chunk = pages.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map((page) => getVibixVideoLinks({ type: "movie", page, limit })),
    );

    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const v of r.value.data) {
        if (!v.kp_id) continue;
        const title = v.name_rus ?? v.name_eng ?? v.name;
        urls.push({
          loc: `${baseUrl}${movieSlugHtmlPath(v.kp_id, title)}`,
          lastmod: toLastMod(v.uploaded_at) ?? undefined,
        });
      }
    }
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
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
    return new Response(xml, {
      status: 503,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
