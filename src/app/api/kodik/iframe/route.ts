export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KodikTranslation = {
  id: number;
  title: string;
  type: "voice" | "subtitles";
};

type KodikSearchItem = {
  id?: unknown;
  link?: unknown;
  quality?: unknown;
  translation?: unknown;
  blocked_countries?: unknown;
};

type KodikSearchResponse = {
  results?: unknown;
};

type CacheEntry = {
  iframeUrl: string | null;
  expiresAt: number;
  strategy: string | null;
};

const cache = new Map<string, CacheEntry>();

function normalizePlayerLink(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("//")) return `https:${s}`;
  return s.replace(/^http:\/\//i, "https://");
}

function parseQualityScore(raw: unknown): number {
  const s = typeof raw === "string" ? raw : raw != null ? String(raw) : "";
  const lower = s.toLowerCase();
  if (!lower) return 0;

  if (/(cam|ts|telesync|tc|telecine)/i.test(lower)) return -10;
  if (/(4k|2160)/i.test(lower)) return 2160;

  const m = lower.match(/(\d{3,4})\s*p/);
  if (m) {
    const n = Number.parseInt(m[1] ?? "", 10);
    return Number.isFinite(n) ? n : 0;
  }

  const m2 = lower.match(/\b(360|480|540|576|720|1080|1440|2160)\b/);
  if (m2) {
    const n = Number.parseInt(m2[1] ?? "", 10);
    return Number.isFinite(n) ? n : 0;
  }

  if (/(bd|bdrip|blu)/i.test(lower) && /(1080)/i.test(lower)) return 1080;
  if (/(bd|bdrip|blu)/i.test(lower) && /(720)/i.test(lower)) return 720;
  if (/(web)/i.test(lower) && /(1080)/i.test(lower)) return 1080;
  if (/(web)/i.test(lower) && /(720)/i.test(lower)) return 720;

  return 1;
}

function parseTranslation(raw: unknown): KodikTranslation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as any;
  const id = typeof o.id === "number" ? o.id : Number(o.id);
  const title = typeof o.title === "string" ? o.title : null;
  const type = o.type === "voice" || o.type === "subtitles" ? o.type : null;
  if (!Number.isFinite(id) || !title || !type) return null;
  return { id, title, type };
}

function getCacheKey({ kpId, imdbId, title, year }: { kpId: number | null; imdbId: string | null; title: string | null; year: number | null }): string {
  return `kp:${kpId ?? ""}|imdb:${imdbId ?? ""}|title:${title ?? ""}|year:${year ?? ""}`;
}

async function fetchJson(url: string): Promise<{ res: Response; text: string; json: unknown | null }> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");
  let json: unknown | null = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }

  return { res, text, json };
}

export async function GET(req: Request) {
  const token = process.env.KODIK_TOKEN?.trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "KODIK_TOKEN is not set" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const url = new URL(req.url);

  const kpIdRaw = url.searchParams.get("kpId");
  const imdbIdRaw = url.searchParams.get("imdbId");
  const titleRaw = url.searchParams.get("title");
  const yearRaw = url.searchParams.get("year");

  const kpId = kpIdRaw ? Number.parseInt(kpIdRaw, 10) : NaN;
  const imdbId = imdbIdRaw ? imdbIdRaw.trim() : "";
  const title = titleRaw ? titleRaw.trim() : "";
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;

  const anyId = (Number.isFinite(kpId) && kpId > 0) || !!imdbId || !!title;
  if (!anyId) {
    return new Response(JSON.stringify({ error: "No identifiers provided" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const cacheKey = getCacheKey({
    kpId: Number.isFinite(kpId) && kpId > 0 ? kpId : null,
    imdbId: imdbId || null,
    title: title || null,
    year: Number.isFinite(year) && year > 0 ? year : null,
  });
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return new Response(JSON.stringify({ iframeUrl: cached.iframeUrl, strategy: cached.strategy ?? "cache" }), {
      status: cached.iframeUrl ? 200 : 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const apiUrl = new URL("https://kodikapi.com/search");
  apiUrl.searchParams.set("token", token);
  apiUrl.searchParams.set("limit", "50");
  apiUrl.searchParams.set("camrip", "false");
  apiUrl.searchParams.set("prioritize_translation_type", "voice");

  let strategy = "";
  if (Number.isFinite(kpId) && kpId > 0) {
    apiUrl.searchParams.set("kinopoisk_id", String(kpId));
    strategy = "kinopoisk_id";
  } else if (imdbId) {
    apiUrl.searchParams.set("imdb_id", imdbId);
    strategy = "imdb_id";
  } else {
    apiUrl.searchParams.set("title", title);
    strategy = "title";
  }

  if (Number.isFinite(year) && year > 0) apiUrl.searchParams.set("year", String(year));

  const fetched = await fetchJson(apiUrl.toString()).catch(() => null);
  if (!fetched) {
    cache.set(cacheKey, { iframeUrl: null, expiresAt: now + 60 * 1000, strategy: "fetch_failed" });
    return new Response(JSON.stringify({ error: "Upstream fetch failed" }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (!fetched.res.ok) {
    cache.set(cacheKey, { iframeUrl: null, expiresAt: now + 60 * 1000, strategy: "upstream_error" });
    return new Response(JSON.stringify({ error: "Upstream error", status: fetched.res.status, body: fetched.text }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const payload = (fetched.json ?? null) as KodikSearchResponse | null;
  const results = Array.isArray(payload?.results) ? (payload!.results as unknown[]) : [];

  const candidates = results
    .map((x) => {
      const it = x as KodikSearchItem;
      const link = typeof it.link === "string" ? it.link : null;
      if (!link) return null;
      const translation = parseTranslation(it.translation);
      const translationTypeScore = translation?.type === "voice" ? 2 : translation?.type === "subtitles" ? 1 : 0;
      const qualityScore = parseQualityScore(it.quality);
      const score = translationTypeScore * 10_000 + qualityScore;
      return { link: normalizePlayerLink(link), score };
    })
    .filter((x): x is { link: string; score: number } => !!x);

  candidates.sort((a, b) => b.score - a.score);

  const iframeUrl = candidates[0]?.link ?? null;
  cache.set(cacheKey, { iframeUrl, expiresAt: now + 15 * 60 * 1000, strategy });

  return new Response(JSON.stringify({ iframeUrl, strategy }), {
    status: iframeUrl ? 200 : 404,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
