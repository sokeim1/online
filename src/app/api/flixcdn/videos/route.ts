import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/db";
import { flixcdnSearch, flixcdnUpdates, parseFlixcdnInt, parseFlixcdnYear } from "@/lib/flixcdn";
import { listCatalogFromDb } from "@/lib/flixcdnIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { ts: number; payload: unknown };
const cache = new Map<string, CacheEntry>();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const debug = searchParams.get("debug") === "1";

  const pageRaw = searchParams.get("page");
  const limitRaw = searchParams.get("limit");

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

  const rawGenres = searchParams.getAll("genre").map((g) => String(g ?? "").trim()).filter(Boolean);
  const legacyGenre = (searchParams.get("genre") ?? "").trim();
  const genres = (rawGenres.length ? rawGenres : legacyGenre ? [legacyGenre] : []).slice(0, 6);

  const country = (searchParams.get("country") ?? "").trim() || null;

  const cacheKey = `videos:${offset}:${safeLimit}:type=${type ?? ""}:year=${safeYear ?? ""}:genre=${genres.join(",")}:country=${country ?? ""}`;

  const now = Date.now();
  const cachedFast = cache.get(cacheKey);
  if (cachedFast && now - cachedFast.ts < 5 * 60 * 1000) {
    const res = NextResponse.json(cachedFast.payload);
    res.headers.set("x-cache-hit", "1");
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    return res;
  }

  let dbAttempted = false;
  let dbTotal: number | null = null;
  let dbError: string | null = null;

  if (hasDatabaseUrl()) {
    try {
      dbAttempted = true;
      const r = await listCatalogFromDb({ offset, limit: safeLimit, type, year: safeYear, genres: genres.length ? genres : null, country });
      dbTotal = r.total;
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
        ...(debug
          ? {
              debug: {
                hasDatabaseUrl: true,
                dbAttempted,
                dbTotal,
                dbError,
              },
            }
          : null),
      };

      cache.set(cacheKey, { ts: Date.now(), payload });

      const res = NextResponse.json(payload);
      res.headers.set("x-source", "db");
      res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
      return res;
    } catch {
      dbAttempted = true;
      dbError = "DB query failed";
    }
  }

  try {
    const requestOpts = debug ? { timeoutMs: 8000, attempts: 1 } : { timeoutMs: 2500, attempts: 1 };

    let data = await flixcdnUpdates({ offset, limit: safeLimit }, requestOpts);
    if (!data.result?.length) {
      data = await flixcdnSearch({ offset, limit: safeLimit }, requestOpts);
    }

    const outRaw = (data.result ?? [])
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
        kp_rating: null,
        imdb_rating: null,
        episodes_count: x.type === "serial" ? parseFlixcdnInt(x.episode) : null,
      };
      })
      .filter((x) => typeof x.poster_url === "string" && x.poster_url.trim().length > 0);

    const norm = (s: string) => String(s ?? "").trim().toLowerCase();
    const wantGenres = genres.map(norm).filter(Boolean);
    const wantCountry = country ? norm(country) : null;

    const filteredAll = outRaw.filter((x) => {
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

    const slice = filteredAll;

    const res = NextResponse.json({
      data: slice,
      links: { first: "", last: "", prev: null, next: data.next ? "1" : null },
      meta: {
        current_page: safePage,
        from: slice.length ? offset + 1 : null,
        last_page: data.next ? safePage + 1 : safePage,
        links: [],
        path: "",
        per_page: safeLimit,
        to: slice.length ? offset + slice.length : null,
        total: slice.length,
      },
      success: true,
      message: "",
      source: "upstream",
      ...(debug
        ? {
            debug: {
              hasDatabaseUrl: hasDatabaseUrl(),
              dbAttempted,
              dbTotal,
              dbError,
            },
          }
        : null),
    });

    cache.set(cacheKey, { ts: Date.now(), payload: await res.clone().json() });

    res.headers.set("x-source", "upstream");
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
    return NextResponse.json(
      {
        success: false,
        message,
        ...(debug
          ? {
              debug: {
                hasDatabaseUrl: hasDatabaseUrl(),
                dbAttempted,
                dbTotal,
                dbError,
              },
            }
          : null),
      },
      { status: 502 },
    );
  }
}
