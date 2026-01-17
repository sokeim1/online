import { NextResponse } from "next/server";

import { flixcdnSearch, parseFlixcdnInt, parseFlixcdnYear } from "@/lib/flixcdn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { ts: number; payload: unknown };
const cache = new Map<string, CacheEntry>();

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
  const cacheKey = `search:${title}:${offset}:${safeLimit}`;

  try {
    const data = await flixcdnSearch({ title, offset, limit: safeLimit });

    const out = (data.result ?? []).map((x) => {
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
        // ratings are not available in FlixCDN
        kp_rating: null,
        imdb_rating: null,
        episodes_count: x.type === "serial" ? parseFlixcdnInt(x.episode) : null,
      };
    });

    const res = NextResponse.json({
      data: out,
      links: { first: "", last: "", prev: null, next: data.next ? "1" : null },
      meta: {
        current_page: safePage,
        from: out.length ? offset + 1 : null,
        last_page: data.next ? safePage + 1 : safePage,
        links: [],
        path: "",
        per_page: safeLimit,
        to: out.length ? offset + out.length : null,
        total: out.length,
      },
      success: true,
      message: "",
    });

    cache.set(cacheKey, { ts: Date.now(), payload: await res.clone().json() });
    return res;
  } catch (e) {
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && now - cached.ts < 5 * 60 * 1000) {
      const res = NextResponse.json(cached.payload);
      res.headers.set("x-cache-fallback", "1");
      return res;
    }

    const message = e instanceof Error ? e.message : "FlixCDN temporarily unavailable";
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
