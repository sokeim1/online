import { NextResponse } from "next/server";

import { flixcdnSearch, flixcdnUpdates, parseFlixcdnInt, parseFlixcdnYear } from "@/lib/flixcdn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const pageRaw = searchParams.get("page");
  const limitRaw = searchParams.get("limit");

  const page = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
  const safeLimit = Number.isFinite(limit) ? Math.min(50, Math.max(1, limit)) : 20;

  const offset = (safePage - 1) * safeLimit;

  try {
    let data = await flixcdnUpdates({ offset, limit: safeLimit });
    if (!data.result?.length) {
      data = await flixcdnSearch({ offset, limit: safeLimit });
    }

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

    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
