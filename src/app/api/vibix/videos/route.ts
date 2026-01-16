import { NextResponse } from "next/server";

import { getVibixVideoByKpId, getVibixVideoLinks } from "@/lib/vibix";

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

type TagsEntry = {
  ts: number;
  tagIds: number[];
};

const tagsCache = new Map<number, TagsEntry>();

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

        const entry: EnrichEntry = {
          ts: now,
          genre: d.genre ?? null,
          country: d.country ?? null,
          kp_rating: d.kp_rating ?? null,
          imdb_rating: d.imdb_rating ?? null,
          episodes_count: null,
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

  function parseIntList(keys: string[]): number[] {
    const out: number[] = [];
    for (const k of keys) {
      for (const raw of searchParams.getAll(k)) {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n)) out.push(n);
      }
    }
    return Array.from(new Set(out));
  }

  function parseYearRange() {
    const fromRaw = searchParams.get("yearFrom");
    const toRaw = searchParams.get("yearTo");
    const from = fromRaw ? Number.parseInt(fromRaw, 10) : null;
    const to = toRaw ? Number.parseInt(toRaw, 10) : null;
    if (!from && !to) return null;
    const safeFrom = Number.isFinite(from as number) && (from as number) >= 1800 ? (from as number) : null;
    const safeTo = Number.isFinite(to as number) && (to as number) <= 2100 ? (to as number) : null;
    if (safeFrom == null && safeTo == null) return null;
    const start = safeFrom ?? 1800;
    const end = safeTo ?? new Date().getFullYear();
    if (end < start) return null;
    const span = end - start + 1;
    if (span > 250) return null;
    const years: number[] = [];
    for (let y = start; y <= end; y += 1) years.push(y);
    return years;
  }

  const type = searchParams.get("type") ?? undefined;
  const pageRaw = searchParams.get("page") ?? undefined;
  const limitRaw = searchParams.get("limit") ?? undefined;
  const enrich = searchParams.get("enrich") === "1";

  const page = pageRaw ? Number(pageRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const safeLimit = 20;

  const categoryIds = parseIntList(["categoryId", "category[]"]);
  const genreIds = parseIntList(["genreId", "genre[]"]);
  const countryIds = parseIntList(["countryId", "country[]"]);
  const tagIds = parseIntList(["tagId", "tag[]"]);
  const voiceoverIds = parseIntList(["voiceoverId", "voiceover[]"]);
  const excludeTagIds = parseIntList(["excludeTagId", "excludeTag[]"]);
  const years = parseYearRange();

  async function shouldExcludeByTags(kpId: number): Promise<boolean> {
    if (!excludeTagIds.length) return false;
    const ttlMs = 6 * 60 * 60 * 1000;
    const now = Date.now();
    const cached = tagsCache.get(kpId);
    if (cached && now - cached.ts < ttlMs) {
      return cached.tagIds.some((id) => excludeTagIds.includes(id));
    }

    const d = await getVibixVideoByKpId(kpId);
    const ids = (d.tags ?? []).map((t) => t.id).filter((n) => Number.isFinite(n));
    tagsCache.set(kpId, { ts: now, tagIds: ids });
    return ids.some((id) => excludeTagIds.includes(id));
  }

  try {
    const data = await getVibixVideoLinks({
      type: type === "movie" || type === "serial" ? type : undefined,
      page: page && Number.isFinite(page) ? page : undefined,
      limit: safeLimit,
      categoryIds: categoryIds.length ? categoryIds : undefined,
      genreIds: genreIds.length ? genreIds : undefined,
      countryIds: countryIds.length ? countryIds : undefined,
      tagIds: tagIds.length ? tagIds : undefined,
      voiceoverIds: voiceoverIds.length ? voiceoverIds : undefined,
      years: years?.length ? years : undefined,
    });

    if (excludeTagIds.length) {
      const checks = await Promise.allSettled(
        data.data.map(async (v) => {
          if (!v.kp_id) return { keep: false as const, v };
          const excluded = await shouldExcludeByTags(v.kp_id);
          return { keep: !excluded, v };
        }),
      );
      const filtered = checks
        .filter((r) => r.status === "fulfilled" && r.value.keep)
        .map((r) => (r as PromiseFulfilledResult<{ keep: boolean; v: typeof data.data[number] }>).value.v);
      data.data = filtered;
      data.meta = {
        ...data.meta,
        total: Math.min(data.meta.total, filtered.length),
        to: filtered.length ? filtered.length : null,
        from: filtered.length ? 1 : null,
      };
    }

    if (enrich) {
      data.data = await enrichLinks(data.data);
    }

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
