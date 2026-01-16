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

  const parts = url.hostname.split(".");
  if (parts[0] === "m") {
    parts.shift();
  }
  if (parts[0] === "www" && parts[1] === "m") {
    parts.splice(1, 1);
  }

  const host = parts.join(".");
  if (
    host &&
    !host.startsWith("www.") &&
    !host.startsWith("localhost") &&
    !host.startsWith("127.0.0.1") &&
    !host.endsWith(".vercel.app")
  ) {
    url.hostname = `www.${host}`;
  } else {
    url.hostname = host;
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

class SitemapNotFoundError extends Error {
  name = "SitemapNotFoundError";
}

async function buildMoviesSitemap(
  baseUrl: string,
  part: number,
  firstMoviesMeta: Awaited<ReturnType<typeof getVibixVideoLinks>>,
  firstSerialsMeta: Awaited<ReturnType<typeof getVibixVideoLinks>>,
): Promise<string> {
  const limit = 20;
  const maxPartsTotal = 10;
  const lastMoviesPageOverall = firstMoviesMeta.meta?.last_page ?? 1;
  const lastSerialsPageOverall = firstSerialsMeta.meta?.last_page ?? 1;
  const totalPages = Math.max(1, lastMoviesPageOverall + lastSerialsPageOverall);
  const pagesPerSitemap = Math.max(1, Math.ceil(totalPages / maxPartsTotal));
  const totalParts = Math.min(maxPartsTotal, Math.max(1, Math.ceil(totalPages / pagesPerSitemap)));

  if (part > totalParts) {
    throw new SitemapNotFoundError("Not found");
  }

  const virtualStart = (part - 1) * pagesPerSitemap + 1;
  const virtualEnd = part * pagesPerSitemap;

  const urls: Array<{ loc: string; lastmod?: string }> = [];

  const pushLinks = (data: Awaited<ReturnType<typeof getVibixVideoLinks>>["data"]) => {
    for (const v of data) {
      if (!v.kp_id) continue;
      const title = v.name_rus ?? v.name_eng ?? v.name;
      urls.push({
        loc: `${baseUrl}${movieSlugHtmlPath(v.kp_id, title)}`,
        lastmod: toLastMod(v.uploaded_at) ?? undefined,
      });
    }
  };

  // Virtual pages are laid out as: movie pages [1..lastMovies], then serial pages [1..lastSerials]
  const movieStart = virtualStart;
  const movieEnd = Math.min(virtualEnd, lastMoviesPageOverall);
  const hasMovies = movieStart <= movieEnd;

  const serialStart = Math.max(1, virtualStart - lastMoviesPageOverall);
  const serialEnd = Math.min(virtualEnd - lastMoviesPageOverall, lastSerialsPageOverall);
  const hasSerials = serialStart <= serialEnd;

  const batchSize = 4;

  if (hasMovies) {
    const firstMovies = movieStart === 1
      ? firstMoviesMeta
      : await getVibixVideoLinks({ type: "movie", page: movieStart, limit });
    pushLinks(firstMovies.data);

    const pages: number[] = [];
    for (let page = movieStart + 1; page <= movieEnd; page += 1) {
      pages.push(page);
    }

    for (let i = 0; i < pages.length; i += batchSize) {
      const chunk = pages.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        chunk.map((page) => getVibixVideoLinks({ type: "movie", page, limit })),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        pushLinks(r.value.data);
      }
    }
  }

  if (hasSerials) {
    const firstSerials = serialStart === 1
      ? firstSerialsMeta
      : await getVibixVideoLinks({ type: "serial", page: serialStart, limit });
    pushLinks(firstSerials.data);

    const pages: number[] = [];
    for (let page = serialStart + 1; page <= serialEnd; page += 1) {
      pages.push(page);
    }

    for (let i = 0; i < pages.length; i += batchSize) {
      const chunk = pages.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        chunk.map((page) => getVibixVideoLinks({ type: "serial", page, limit })),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        pushLinks(r.value.data);
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
    const limit = 20;
    const [firstMoviesMeta, firstSerialsMeta] = await Promise.all([
      getVibixVideoLinks({ type: "movie", page: 1, limit }),
      getVibixVideoLinks({ type: "serial", page: 1, limit }),
    ]);
    const xml = await buildMoviesSitemap(siteUrl, part, firstMoviesMeta, firstSerialsMeta);
    cache.set(cacheKey, { xml, expiresAt: now + 60 * 60 * 1000 });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=3600",
      },
    });
  } catch (e) {
    if (e instanceof SitemapNotFoundError) {
      return new Response("Not found", { status: 404 });
    }
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
