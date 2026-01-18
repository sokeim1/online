import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/db";
import { parseVideoseedYear, splitCommaList, videoseedList } from "@/lib/videoseed";
import { searchVideoseedCatalogFromDb } from "@/lib/videoseedIndex";
import { getVibixVideoByKpId } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { ts: number; payload: unknown };
const cache = new Map<string, CacheEntry>();

type RatingEntry = { ts: number; kp_rating: number | null; imdb_rating: number | null };
const ratingCache = new Map<number, RatingEntry>();

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

function ratingValue(v: { kp_rating?: unknown; imdb_rating?: unknown }): number {
  const a = parseRatingFromUpstream(v.kp_rating);
  const b = parseRatingFromUpstream(v.imdb_rating);
  const n = Math.max(a ?? -1, b ?? -1);
  return Number.isFinite(n) ? n : -1;
}

async function enrichRatings<T extends { kp_id: number | null; kp_rating?: number | null; imdb_rating?: number | null }>(
  items: T[],
): Promise<T[]> {
  const ttlMs = 6 * 60 * 60 * 1000;
  const now = Date.now();
  const out = items.slice();

  const need = out
    .map((v, idx) => ({ v, idx }))
    .filter(({ v }) => v.kp_id != null && (v.kp_rating == null || v.imdb_rating == null));

  const concurrency = 8;
  for (let i = 0; i < need.length; i += concurrency) {
    const chunk = need.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async ({ v }) => {
        const kpId = v.kp_id as number;
        const cached = ratingCache.get(kpId);
        if (cached && now - cached.ts < ttlMs) return cached;
        try {
          const d = await getVibixVideoByKpId(kpId);
          const entry: RatingEntry = {
            ts: now,
            kp_rating: d.kp_rating ?? null,
            imdb_rating: d.imdb_rating ?? null,
          };
          ratingCache.set(kpId, entry);
          return entry;
        } catch {
          const entry: RatingEntry = { ts: now, kp_rating: null, imdb_rating: null };
          ratingCache.set(kpId, entry);
          return entry;
        }
      }),
    );

    for (let j = 0; j < chunk.length; j += 1) {
      const { idx } = chunk[j]!;
      const r = results[j];
      if (r.status !== "fulfilled") continue;
      out[idx] = {
        ...out[idx],
        kp_rating: out[idx].kp_rating ?? r.value.kp_rating,
        imdb_rating: out[idx].imdb_rating ?? r.value.imdb_rating,
      };
    }
  }

  return out;
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

  const sort = (searchParams.get("sort") ?? "").trim();
  const sortByRating = sort === "rating";

  const cacheKey = `search:${title}:${offset}:${safeLimit}:type=${type ?? ""}:year=${safeYear ?? ""}:genre=${genres.join(",")}:country=${country ?? ""}:sort=${sortByRating ? "rating" : ""}`;

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
      const r = await searchVideoseedCatalogFromDb({
        query: title,
        offset,
        limit: safeLimit,
        type,
        year: safeYear,
        genres: genres.length ? genres : null,
        country,
      });

      let out = r.items.map((x) => {
        const uploadedAt = x.created_at ?? "";
        return {
          id: Number(x.videoseed_id),
          name: x.title_orig ?? x.title_rus ?? "",
          name_rus: x.title_rus,
          name_eng: x.title_orig,
          type: x.type,
          year: x.year,
          kp_id: x.kp_id,
          imdb_id: x.imdb_id,
          iframe_url: x.iframe_url ?? "",
          poster_url: x.poster_url,
          quality: "",
          uploaded_at: uploadedAt,
          genre: x.genres,
          country: x.countries,
          kp_rating: null,
          imdb_rating: null,
          episodes_count: null,
        };
      });

      if (sortByRating) {
        out = await enrichRatings(out);
        out.sort((a, b) => {
          const av = ratingValue(a);
          const bv = ratingValue(b);
          if (bv !== av) return bv - av;
          return (b.id ?? 0) - (a.id ?? 0);
        });
      }

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
    } catch {
      // fall back to upstream
    }
  }

  try {
    void forceUpstream;
    const requestOpts = suggest ? { timeoutMs: 9000, attempts: 2 } : { timeoutMs: 6000, attempts: 2 };

    const norm = (s: string) => String(s ?? "").trim().toLowerCase();
    const wantGenres = genres.map(norm).filter(Boolean);
    const wantCountry = country ? norm(country) : null;

    const yearFrom = safeYear != null ? safeYear : undefined;
    const yearTo = safeYear != null ? safeYear : undefined;

    const fetchType = async (listType: "movie" | "serial") => {
      const r = await videoseedList(
        {
          list: listType,
          page: safePage,
          items: safeLimit,
          sortBy: "post_date desc",
          q: title,
          releaseYearFrom: yearFrom,
          releaseYearTo: yearTo,
        },
        requestOpts,
      );
      return { kind: listType, r };
    };

    const results = type ? [await fetchType(type)] : await Promise.all([fetchType("movie"), fetchType("serial")]);

    const outRaw = results
      .flatMap(({ kind, r }) =>
        (r.data ?? []).map((x) => {
          const kpId = typeof (x as any).id_kp === "string" || typeof (x as any).id_kp === "number" ? Number((x as any).id_kp) : null;
          const imdbId = typeof (x as any).id_imdb === "string" ? ((x as any).id_imdb as string) : null;
          const year = parseVideoseedYear((x as any).year);
          const posterUrl = typeof (x as any).poster === "string" ? ((x as any).poster as string) : null;
          const iframeUrl = typeof (x as any).iframe === "string" ? ((x as any).iframe as string) : "";
          const uploadedAt = typeof (x as any).date === "string" ? ((x as any).date as string) : "";

          const gs = splitCommaList((x as any).genre);
          const cs = splitCommaList((x as any).country);

          return {
            id: Number((x as any).id) || 0,
            name: String((x as any).original_name ?? (x as any).name ?? ""),
            name_rus: typeof (x as any).name === "string" ? ((x as any).name as string) : null,
            name_eng: typeof (x as any).original_name === "string" ? ((x as any).original_name as string) : null,
            type: kind,
            year,
            kp_id: Number.isFinite(kpId as number) ? (kpId as number) : null,
            imdb_id: imdbId,
            iframe_url: iframeUrl,
            poster_url: posterUrl,
            quality: "",
            uploaded_at: uploadedAt,
            genre: gs,
            country: cs,
            kp_rating: null,
            imdb_rating: null,
            episodes_count: null,
          };
        }),
      )
      .filter((x) => typeof x.poster_url === "string" && x.poster_url.trim().length > 0);

    let filtered = outRaw.filter((x) => {
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

    if (sortByRating) {
      filtered = await enrichRatings(filtered);
      filtered.sort((a, b) => {
        const av = ratingValue(a);
        const bv = ratingValue(b);
        if (bv !== av) return bv - av;
        return (b.id ?? 0) - (a.id ?? 0);
      });
    }

    const anyNext = results.some(({ r }) => r.nextPage != null);
    const total = results.length === 1 ? results[0]!.r.total ?? filtered.length : filtered.length;
    const lastPage = total > 0 ? Math.max(1, Math.ceil(total / safeLimit)) : anyNext ? safePage + 1 : safePage;

    const res = NextResponse.json({
      data: filtered,
      links: { first: "", last: "", prev: safePage > 1 ? "1" : null, next: anyNext ? "1" : null },
      meta: {
        current_page: safePage,
        from: filtered.length ? offset + 1 : null,
        last_page: lastPage,
        links: [],
        path: "",
        per_page: safeLimit,
        to: filtered.length ? offset + filtered.length : null,
        total,
      },
      success: true,
      message: "",
      source: "videoseed",
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

    const message = e instanceof Error ? e.message : "Videoseed temporarily unavailable";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
