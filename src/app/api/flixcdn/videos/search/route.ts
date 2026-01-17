import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/db";
import { flixcdnSearch, parseFlixcdnInt, parseFlixcdnYear } from "@/lib/flixcdn";
import { searchCatalogFromDb } from "@/lib/flixcdnIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { ts: number; payload: unknown };
const cache = new Map<string, CacheEntry>();

function parseRatingFromUpstream(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const s = raw.trim().replace(/,/g, ".");
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number.parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickRating(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    if (k in o) {
      const n = parseRatingFromUpstream(o[k]);
      if (n != null) return n;
    }
  }
  return null;
}

function normalizeText(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQueryTokens(raw: string): { tokens: string[]; year: number | null; text: string } {
  const trimmed = String(raw ?? "").trim();
  const m = trimmed.match(/\b(19|20)\d{2}\b/);
  const year = m ? Number.parseInt(m[0], 10) : null;
  const withoutYear = year ? trimmed.replace(new RegExp(`\\b${year}\\b`, "g"), " ") : trimmed;
  const text = normalizeText(withoutYear);
  const tokens = text
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  return { tokens, year: Number.isFinite(year as number) ? year : null, text };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const title = (searchParams.get("title") ?? "").trim();
  const pageRaw = searchParams.get("page");
  const limitRaw = searchParams.get("limit");

  if (!title) {
    return NextResponse.json({ success: false, message: "Missing query param: title" }, { status: 400 });
  }

  const page = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
  const safeLimit = Number.isFinite(limit) ? Math.min(50, Math.max(1, limit)) : 20;

  const offset = (safePage - 1) * safeLimit;

  const typeRaw = (searchParams.get("type") ?? "").trim();
  const type = typeRaw === "movie" || typeRaw === "serial" ? typeRaw : null;

  const yearRaw = (searchParams.get("year") ?? "").trim();
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;
  const safeYear = Number.isFinite(year) && year > 1800 ? year : null;

  const rawGenres = searchParams
    .getAll("genre")
    .flatMap((g) => String(g ?? "").split(","))
    .map((g) => g.trim())
    .filter(Boolean);
  const genres = Array.from(new Set(rawGenres)).slice(0, 6);
  const country = (searchParams.get("country") ?? "").trim() || null;

  const suggest = searchParams.get("suggest") === "1";
  const forceUpstream = searchParams.get("forceUpstream") === "1";

  const cacheKey = `search:${title}:${offset}:${safeLimit}:type=${type ?? ""}:year=${safeYear ?? ""}:genre=${genres.join(",")}:country=${country ?? ""}`;

  const now = Date.now();
  const cachedFast = cache.get(cacheKey);
  if (cachedFast && now - cachedFast.ts < 5 * 60 * 1000) {
    const res = NextResponse.json(cachedFast.payload);
    res.headers.set("x-cache-hit", "1");
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    return res;
  }

  if (!forceUpstream && hasDatabaseUrl()) {
    try {
      const r = await searchCatalogFromDb({
        query: title,
        offset,
        limit: safeLimit,
        type,
        year: safeYear,
        genres: genres.length ? genres : null,
        country,
      });

      const out = r.items.map((x) => {
        const uploadedAt = x.created_at ?? "";
        return {
          id: Number(x.flixcdn_id),
          name: x.title_orig ?? x.title_rus ?? "",
          name_rus: x.title_rus,
          name_eng: null,
          type: x.type,
          year: x.year,
          kp_id: x.kp_id,
          imdb_id: x.imdb_id,
          iframe_url: x.iframe_url ?? "",
          poster_url: x.poster_url,
          quality: x.quality ?? "",
          uploaded_at: uploadedAt,
          genre: x.genres,
          country: x.countries,
          kp_rating: null,
          imdb_rating: null,
          episodes_count: x.episodes_count,
        };
      });

      const lastPage = r.total > 0 ? Math.max(1, Math.ceil(r.total / safeLimit)) : 1;
      const hasNext = safePage < lastPage;

      const payload = {
        data: out,
        links: { first: "", last: "", prev: safePage > 1 ? "1" : null, next: hasNext ? "1" : null },
        meta: {
          current_page: safePage,
          from: out.length ? offset + 1 : null,
          last_page: lastPage,
          links: [],
          path: "",
          per_page: safeLimit,
          to: out.length ? offset + out.length : null,
          total: r.total,
        },
        success: true,
        message: "",
        source: "db",
      };

      cache.set(cacheKey, { ts: Date.now(), payload });

      const res = NextResponse.json(payload);
      res.headers.set("x-source", "db");
      res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
      return res;
    } catch (e) {
      const message = e instanceof Error ? e.message : "DB search failed";
      return NextResponse.json({ success: false, message, source: "db" }, { status: 500 });
    }
  }

  try {
    const data = await flixcdnSearch(
      { title, offset, limit: safeLimit },
      suggest ? { timeoutMs: 6000, attempts: 2 } : { timeoutMs: 2500, attempts: 1 },
    );

    const out = (data.result ?? [])
      .map((x) => {
      const kpId = parseFlixcdnInt(x.kinopoisk_id);
      const imdbId = typeof x.imdb_id === "string" ? x.imdb_id : null;
      const year = parseFlixcdnYear(x.year);
      const posterUrl = typeof x.poster === "string" ? x.poster : null;
      const iframeUrl = typeof x.iframe_url === "string" ? x.iframe_url : "";
      const quality = typeof x.quality === "string" ? x.quality : "";
      const uploadedAt = typeof x.created_at === "string" ? x.created_at : "";

      return {
        id: x.id,
        name: x.title_orig ?? x.title_rus ?? "",
        name_rus: x.title_rus ?? null,
        name_eng: null,
        type: x.type === "serial" ? "serial" : "movie",
        year,
        kp_id: kpId,
        imdb_id: imdbId,
        iframe_url: iframeUrl,
        poster_url: posterUrl,
        quality,
        uploaded_at: uploadedAt,
        genre: Array.isArray(x.genres) ? x.genres : null,
        country: Array.isArray(x.countries) ? x.countries : null,
        kp_rating: pickRating(x, ["kp_rating", "kinopoisk_rating", "kp", "rating_kp", "ratingKinopoisk", "rating_kinopoisk"]),
        imdb_rating: pickRating(x, ["imdb_rating", "imdb", "rating_imdb", "ratingImdb"]),
        episodes_count: x.type === "serial" ? parseFlixcdnInt(x.episode) : null,
      };
      })
      .filter((x) => typeof x.poster_url === "string" && x.poster_url.trim().length > 0);

    const norm = (s: string) => String(s ?? "").trim().toLowerCase();
    const wantGenres = genres.map(norm).filter(Boolean);
    const wantCountry = country ? norm(country) : null;

    const filtered = out.filter((x) => {
      if (type && x.type !== type) return false;
      if (safeYear != null && x.year !== safeYear) return false;
      if (wantCountry) {
        const cs = (x.country ?? []).map((c) => norm(String(c))).filter(Boolean);
        if (!cs.includes(wantCountry)) return false;
      }
      if (wantGenres.length) {
        const gs = (x.genre ?? []).map((g) => norm(String(g))).filter(Boolean);
        if (!wantGenres.some((g) => gs.includes(g))) return false;
      }
      return true;
    });

    const res = NextResponse.json({
      data: filtered,
      links: { first: "", last: "", prev: null, next: data.next ? "1" : null },
      meta: {
        current_page: safePage,
        from: filtered.length ? offset + 1 : null,
        last_page: data.next ? safePage + 1 : safePage,
        links: [],
        path: "",
        per_page: safeLimit,
        to: filtered.length ? offset + filtered.length : null,
        total: filtered.length,
      },
      success: true,
      message: "",
    });

    cache.set(cacheKey, { ts: Date.now(), payload: await res.clone().json() });
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    return res;
  } catch (e) {
    const cached = cache.get(cacheKey);
    if (cached && now - cached.ts < 5 * 60 * 1000) {
      const res = NextResponse.json(cached.payload);
      res.headers.set("x-cache-fallback", "1");
      res.headers.set("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
      return res;
    }

    const message = e instanceof Error ? e.message : "FlixCDN temporarily unavailable";
    const lower = message.toLowerCase();
    if (lower.includes("missing env: flixcdn_token") || lower.includes("юзер отсутств") || lower.includes("user") && lower.includes("absent")) {
      return NextResponse.json(
        {
          success: false,
          message,
          hint: "Set a valid FLIXCDN_TOKEN (and optionally FLIXCDN_API_BASE/FLIXCDN_API_BASES) or configure DATABASE_URL to use DB-first search.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
