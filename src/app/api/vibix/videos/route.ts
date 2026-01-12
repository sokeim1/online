import { NextResponse } from "next/server";

import { getVibixSerialByKpId, getVibixVideoByKpId, getVibixVideoLinks } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

type EnrichEntry = {
  ts: number;
  genre: string[] | null;
  country: string[] | null;
  kp_rating: number | null;
  imdb_rating: number | null;
  episodes_count: number | null;
};

const enrichCache = new Map<number, EnrichEntry>();

async function enrichLinks<
  T extends {
    kp_id: number | null;
    type?: string;
    genre?: string[] | null;
    country?: string[] | null;
    kp_rating?: number | null;
    imdb_rating?: number | null;
    episodes_count?: number | null;
  },
>(
  items: T[],
): Promise<T[]> {
  const ttlMs = 6 * 60 * 60 * 1000;
  const now = Date.now();
  const out = items.slice();

  const need = out
    .map((v, idx) => ({ v, idx }))
    .filter(
      ({ v }) =>
        v.kp_id &&
        (v.genre == null ||
          v.country == null ||
          v.kp_rating == null ||
          v.imdb_rating == null ||
          (v.type === "serial" && v.episodes_count == null)),
    );

  const concurrency = 8;
  for (let i = 0; i < need.length; i += concurrency) {
    const chunk = need.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async ({ v }) => {
        const kpId = v.kp_id as number;
        const cached = enrichCache.get(kpId);
        if (cached && now - cached.ts < ttlMs) {
          if (v.type !== "serial" || cached.episodes_count != null) {
            return cached;
          }
        }

        const d = await getVibixVideoByKpId(kpId);

        let episodesCount: number | null = null;
        if (v.type === "serial") {
          const si = await getVibixSerialByKpId(kpId).catch(() => null);
          if (si?.seasons?.length) {
            episodesCount = si.seasons.reduce((acc, s) => acc + (s.series?.length ?? 0), 0);
          }
        }
        const entry: EnrichEntry = {
          ts: now,
          genre: d.genre ?? null,
          country: d.country ?? null,
          kp_rating: d.kp_rating ?? null,
          imdb_rating: d.imdb_rating ?? null,
          episodes_count: episodesCount,
        };
        enrichCache.set(kpId, entry);
        return entry;
      }),
    );

    for (let j = 0; j < chunk.length; j += 1) {
      const { idx } = chunk[j];
      const r = results[j];
      if (r.status !== "fulfilled") continue;
      out[idx] = {
        ...out[idx],
        genre: out[idx].genre ?? r.value.genre,
        country: out[idx].country ?? r.value.country,
        kp_rating: out[idx].kp_rating ?? r.value.kp_rating,
        imdb_rating: out[idx].imdb_rating ?? r.value.imdb_rating,
        episodes_count: out[idx].episodes_count ?? r.value.episodes_count,
      };
    }
  }

  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const type = searchParams.get("type") ?? undefined;
  const pageRaw = searchParams.get("page") ?? undefined;
  const limitRaw = searchParams.get("limit") ?? undefined;

  const page = pageRaw ? Number(pageRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const safeLimit = 20;

  try {
    const data = await getVibixVideoLinks({
      type: type === "movie" || type === "serial" ? type : undefined,
      page: page && Number.isFinite(page) ? page : undefined,
      limit: safeLimit,
    });

    data.data = await enrichLinks(data.data);

    const res = NextResponse.json(data);
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { success: false, message },
      {
        status: 500,
      },
    );
  }
}
