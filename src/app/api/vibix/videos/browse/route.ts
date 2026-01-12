import { NextResponse } from "next/server";

import {
  getVibixCountries,
  getVibixGenres,
  getVibixSerialByKpId,
  getVibixVideoByKpId,
  getVibixVideoLinks,
} from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

type CatalogItem = {
  id: number;
  kp_id: number | null;
  imdb_id: string | null;
  type: "movie" | "serial";
  year: number | null;
  quality: string;
  poster_url: string | null;
  name: string;
  name_rus: string | null;
  name_eng: string | null;
  iframe_url: string;
  uploaded_at: string;
  kp_rating?: number | null;
  imdb_rating?: number | null;
  episodes_count?: number | null;
  genre?: string[] | null;
  country?: string[] | null;
};

type EnrichEntry = {
  ts: number;
  genre: string[] | null;
  country: string[] | null;
  kp_rating: number | null;
  imdb_rating: number | null;
  episodes_count: number | null;
};

const enrichCache = new Map<number, EnrichEntry>();

type TaxonomyCacheEntry = {
  ts: number;
  genres: Awaited<ReturnType<typeof getVibixGenres>>;
  countries: Awaited<ReturnType<typeof getVibixCountries>>;
};

let taxonomyCache: TaxonomyCacheEntry | null = null;

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function getTaxonomy(): Promise<TaxonomyCacheEntry> {
  const now = Date.now();
  const ttlMs = 6 * 60 * 60 * 1000;
  if (taxonomyCache && now - taxonomyCache.ts < ttlMs) return taxonomyCache;
  const [genres, countries] = await Promise.all([getVibixGenres(), getVibixCountries()]);
  taxonomyCache = {
    ts: now,
    genres,
    countries,
  };
  return taxonomyCache;
}

function resolveGenreId(genres: TaxonomyCacheEntry["genres"], raw: string): number | null {
  const q = normalizeText(raw);
  if (!q) return null;
  const qWords = q.split(/\s+/).filter(Boolean);
  const exact = genres.find((g) => normalizeText(g.name ?? g.name_eng ?? "") === q);
  if (exact) return exact.id;
  const loose = genres.find((g) => {
    const hay = normalizeText(g.name ?? g.name_eng ?? "");
    if (!hay) return false;
    if (hay.includes(q) || q.includes(hay)) return true;
    return qWords.length > 0 && qWords.every((w) => hay.includes(w));
  });
  return loose?.id ?? null;
}

function resolveCountryId(countries: TaxonomyCacheEntry["countries"], raw: string): number | null {
  const q = normalizeText(raw);
  if (!q) return null;
  const qWords = q.split(/\s+/).filter(Boolean);
  const exact = countries.find((c) => normalizeText(c.name ?? c.name_eng ?? "") === q);
  if (exact) return exact.id;
  const loose = countries.find((c) => {
    const hay = normalizeText(c.name ?? c.name_eng ?? "");
    if (!hay) return false;
    if (hay.includes(q) || q.includes(hay)) return true;
    return qWords.length > 0 && qWords.every((w) => hay.includes(w));
  });
  return loose?.id ?? null;
}

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
>(items: T[]): Promise<T[]> {
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

  const year = searchParams.get("year");
  const genre = searchParams.get("genre");
  const country = searchParams.get("country");
  const typeRaw = (searchParams.get("type") ?? "all").trim();
  const pageRaw = searchParams.get("page") ?? "1";
  const limitRaw = searchParams.get("limit") ?? undefined;

  const type: "all" | "movie" | "serial" = typeRaw === "movie" || typeRaw === "serial" ? typeRaw : "all";
  const safePage = Math.max(1, Math.floor(Number(pageRaw) || 1));

  const safeLimit = 20;
  void limitRaw;

  const active = [
    year ? ({ mode: "year" as const, value: year } as const) : null,
    genre ? ({ mode: "genre" as const, value: genre } as const) : null,
    country ? ({ mode: "country" as const, value: country } as const) : null,
  ].filter(Boolean) as Array<{ mode: BrowseMode; value: string }>;

  if (active.length !== 1) {
    return NextResponse.json(
      { success: false, message: "Provide exactly one of: year, genre, country" },
      { status: 400 },
    );
  }

  try {
    const { mode, value } = active[0];

    const yearsRaw = mode === "year" ? Number(value) : null;
    if (mode === "year" && (!yearsRaw || !Number.isFinite(yearsRaw) || yearsRaw < 1800)) {
      return NextResponse.json({
        data: [],
        links: { first: "", last: "", prev: null, next: null },
        meta: {
          current_page: 1,
          from: null,
          last_page: 1,
          links: [],
          path: "",
          per_page: safeLimit,
          to: null,
          total: 0,
        },
        success: true,
        message: "",
      });
    }

    const years = mode === "year" ? [yearsRaw as number] : undefined;

    const taxonomy = mode === "genre" || mode === "country" ? await getTaxonomy() : null;
    const genreId = mode === "genre" && taxonomy ? resolveGenreId(taxonomy.genres, value) : null;
    const countryId = mode === "country" && taxonomy ? resolveCountryId(taxonomy.countries, value) : null;

    if (mode === "genre" && !genreId) {
      return NextResponse.json({
        data: [],
        links: { first: "", last: "", prev: null, next: null },
        meta: {
          current_page: 1,
          from: null,
          last_page: 1,
          links: [],
          path: "",
          per_page: safeLimit,
          to: null,
          total: 0,
        },
        success: true,
        message: "",
      });
    }
    if (mode === "country" && !countryId) {
      return NextResponse.json({
        data: [],
        links: { first: "", last: "", prev: null, next: null },
        meta: {
          current_page: 1,
          from: null,
          last_page: 1,
          links: [],
          path: "",
          per_page: safeLimit,
          to: null,
          total: 0,
        },
        success: true,
        message: "",
      });
    }

    const data = await getVibixVideoLinks({
      type: type === "movie" || type === "serial" ? type : undefined,
      page: safePage,
      limit: safeLimit,
      years,
      genreIds: genreId ? [genreId] : undefined,
      countryIds: countryId ? [countryId] : undefined,
    });

    data.data = (await enrichLinks(data.data as CatalogItem[])).filter((v) => v.kp_id != null);

    const res = NextResponse.json(data);
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
