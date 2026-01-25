import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { hasDatabaseUrl, dbQuery } from "@/lib/db";
import { movieSlugHtmlPath } from "@/lib/movieUrl";
import { ensureVideoseedSchema } from "@/lib/videoseedIndex";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

type Args = {
  skipDb: boolean;
  urlsPerSitemap: number;
  maxMovieSitemaps: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    skipDb: false,
    urlsPerSitemap: 10_000,
    maxMovieSitemaps: 5000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;

    if (a === "--skip-db") {
      args.skipDb = true;
      continue;
    }

    const next = argv[i + 1];
    if (a === "--urls-per-sitemap") {
      const n = Number.parseInt(next ?? "", 10);
      if (Number.isFinite(n)) args.urlsPerSitemap = n;
      i += 1;
      continue;
    }

    if (a === "--max-movie-sitemaps") {
      const n = Number.parseInt(next ?? "", 10);
      if (Number.isFinite(n)) args.maxMovieSitemaps = n;
      i += 1;
      continue;
    }
  }

  args.urlsPerSitemap = Math.min(50_000, Math.max(1, args.urlsPerSitemap));
  args.maxMovieSitemaps = Math.min(5000, Math.max(0, args.maxMovieSitemaps));
  return args;
}

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

function buildStaticSitemap(baseUrl: string): string {
  const urls: Array<{ loc: string; lastmod?: string }> = [];
  urls.push({ loc: `${baseUrl}/` });

  const body = urls
    .map((u) => {
      const lastmod = u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : "";
      return `<url><loc>${escapeXml(u.loc)}</loc>${lastmod}</url>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`
  );
}

function buildSitemapIndex(sitemaps: Array<{ loc: string; lastmod?: string }>): string {
  const body = sitemaps
    .map((s) => {
      const lm = s.lastmod ? `<lastmod>${escapeXml(s.lastmod)}</lastmod>` : "";
      return `<sitemap><loc>${escapeXml(s.loc)}</loc>${lm}</sitemap>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`
  );
}

async function buildMoviesSitemap(baseUrl: string, part: number, urlsPerSitemap: number): Promise<string> {
  if (!hasDatabaseUrl()) {
    return `<?xml version="1.0" encoding="UTF-8"?>` + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
  }

  await ensureVideoseedSchema();

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

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const siteUrlRaw = process.env.SITE_URL?.trim() ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!siteUrlRaw) throw new Error("Missing env: SITE_URL (or VERCEL_URL)");
  const siteUrl = normalizeSiteUrl(siteUrlRaw);

  const publicDir = join(process.cwd(), "public");
  const sitemapsDir = join(publicDir, "sitemaps");
  await mkdir(sitemapsDir, { recursive: true });

  const lastmod = new Date().toISOString();

  const staticXml = buildStaticSitemap(siteUrl);
  await writeFile(join(sitemapsDir, "sitemap-static.xml"), staticXml, { encoding: "utf8" });

  const urlsPerSitemap = args.urlsPerSitemap;
  let totalMovieSitemaps = 0;

  if (!args.skipDb && hasDatabaseUrl()) {
    try {
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

      totalMovieSitemaps = Math.max(0, Math.ceil(total / urlsPerSitemap));
      totalMovieSitemaps = Math.min(args.maxMovieSitemaps, totalMovieSitemaps);

      for (let part = 1; part <= totalMovieSitemaps; part += 1) {
        const xml = await buildMoviesSitemap(siteUrl, part, urlsPerSitemap);
        await writeFile(join(sitemapsDir, `sitemap-movies-${part}.xml`), xml, { encoding: "utf8" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Skipping movie sitemaps due to DB error: ${msg}`);
      totalMovieSitemaps = 0;
    }
  }

  const sitemaps: Array<{ loc: string; lastmod?: string }> = [];
  sitemaps.push({ loc: `${siteUrl}/sitemaps/sitemap-static.xml`, lastmod });
  for (let part = 1; part <= totalMovieSitemaps; part += 1) {
    sitemaps.push({ loc: `${siteUrl}/sitemaps/sitemap-movies-${part}.xml`, lastmod });
  }

  const indexXml = buildSitemapIndex(sitemaps);
  await writeFile(join(sitemapsDir, "sitemap.xml"), indexXml, { encoding: "utf8" });

  console.log(JSON.stringify({ success: true, siteUrl, totalMovieSitemaps, urlsPerSitemap, skipDb: args.skipDb }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
