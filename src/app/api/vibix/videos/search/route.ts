import { NextResponse } from "next/server";

import {
  getVibixTags,
  getVibixVideoByKpId,
  getVibixVideoLinks,
  searchVibixVideosByName,
  type VibixVideosLinksQuery,
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

type FuzzyCacheEntry = {
  ts: number;
  scannedUpToPage: number;
  lastPage: number;
  perPage: number;
  matches: CatalogItem[];
};

const fuzzyCache = new Map<string, FuzzyCacheEntry>();

function stableKeyPart(q: VibixVideosLinksQuery): string {
  const sorted = <T extends number | string>(arr: T[] | undefined) => (arr ? arr.slice().sort().join(",") : "");
  return [
    q.type ?? "",
    sorted(q.categoryIds),
    sorted(q.genreIds),
    sorted(q.countryIds),
    sorted(q.tagIds),
    sorted(q.voiceoverIds),
    sorted((q.years ?? []).map((y) => String(y))),
  ].join("|");
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const stopWords = new Set([
  "и",
  "в",
  "во",
  "на",
  "по",
  "за",
  "к",
  "ко",
  "о",
  "об",
  "от",
  "до",
  "для",
  "из",
  "с",
  "со",
  "без",
  "под",
  "над",
  "при",
  "про",
  "как",
  "это",
  "тот",
  "та",
  "те",
  "этот",
  "эта",
  "эти",
  "новый",
  "новая",
  "новое",
  "новые",
  "смотреть",
  "онлайн",
  "фильм",
  "сериал",
  "movie",
  "serial",
  "watch",
  "online",
]);

function tokenize(raw: string): string[] {
  const base = normalizeText(raw).split(/\s+/).filter(Boolean);
  const filtered = base.filter((w) => w.length > 1 && !stopWords.has(w));
  return filtered.length ? filtered : base;
}

type TagsCacheEntry = {
  ts: number;
  tags: Awaited<ReturnType<typeof getVibixTags>>;
};

let tagsCache: TagsCacheEntry | null = null;

async function getTags(): Promise<TagsCacheEntry> {
  const now = Date.now();
  const ttlMs = 6 * 60 * 60 * 1000;
  if (tagsCache && now - tagsCache.ts < ttlMs) return tagsCache;
  const tags = await getVibixTags();
  tagsCache = { ts: now, tags };
  return tagsCache;
}

function resolveTagId(tags: TagsCacheEntry["tags"], raw: string): number | null {
  const q = normalizeText(raw);
  if (!q) return null;
  const qWords = tokenize(raw);
  const exact = tags.find((t) => normalizeText(t.name ?? t.name_eng ?? t.code ?? "") === q);
  if (exact) return exact.id;
  const loose = tags.find((t) => {
    const hay = normalizeText(t.name ?? t.name_eng ?? t.code ?? "");
    if (!hay) return false;
    if (hay.includes(q) || q.includes(hay)) return true;
    return (
      qWords.length > 0 &&
      qWords.every((w) =>
        hay.includes(w) || (w.length >= 4 ? hay.includes(w.slice(0, 3)) : false),
      )
    );
  });
  return loose?.id ?? null;
}

function pickHaystack(v: CatalogItem): string {
  return normalizeText([v.name_rus, v.name_eng, v.name].filter(Boolean).join(" "));
}

function isMatch(haystack: string, rawQuery: string): { ok: boolean; score: number } {
  const q = normalizeText(rawQuery);
  const words = tokenize(rawQuery);
  if (!words.length) return { ok: false, score: 0 };

  const yearWords = words.filter((w) => /^\d{4}$/.test(w) && Number(w) >= 1800 && Number(w) <= 2100);
  const textWords = words.filter((w) => !yearWords.includes(w));
  const effectiveWords = textWords.length ? textWords : words;

  if (haystack === q) return { ok: true, score: 100 };
  if (q && haystack.includes(q)) {
    return { ok: true, score: 40 + Math.min(20, q.length) };
  }

  const required =
    effectiveWords.length <= 2 ? effectiveWords.length : Math.max(2, Math.ceil(effectiveWords.length * 0.6));

  let score = 0;
  let matched = 0;
  for (const w of effectiveWords) {
    const idx = haystack.indexOf(w);
    if (idx !== -1) {
      matched += 1;
      score += w.length >= 4 ? 3 : 1;
      if (idx === 0) score += 1;
      continue;
    }

    if (w.length >= 4) {
      const pref3 = w.slice(0, 3);
      const pIdx = haystack.indexOf(pref3);
      if (pIdx !== -1) {
        matched += 1;
        score += 1;
        if (pIdx === 0) score += 1;
      }
    }
  }

  for (const yw of yearWords) {
    if (haystack.includes(yw)) score += 2;
  }

  if (matched < required) return { ok: false, score: 0 };
  if (matched === effectiveWords.length) score += 4;
  return { ok: true, score };
}

function rankAndDedupe(items: CatalogItem[], rawQuery: string): CatalogItem[] {
  const seen = new Set<number>();
  const scored: Array<{ v: CatalogItem; score: number }> = [];

  for (const v of items) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    const hay = pickHaystack(v);
    const { ok, score } = isMatch(hay, rawQuery);
    if (!ok) continue;
    scored.push({ v, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const by = b.v.year ?? -1;
    const ay = a.v.year ?? -1;
    if (by !== ay) return by - ay;
    return b.v.id - a.v.id;
  });

  return scored.map((x) => x.v);
}

async function fuzzySearchPaged(
  rawQuery: string,
  baseQuery: VibixVideosLinksQuery,
  targetCount: number,
  maxPagesPerRequest: number,
): Promise<FuzzyCacheEntry> {
  const key = `${normalizeText(rawQuery)}|${stableKeyPart(baseQuery)}`;
  const now = Date.now();
  const ttlMs = 60 * 60 * 1000;

  const existing = fuzzyCache.get(key);
  if (existing && now - existing.ts < ttlMs && existing.matches.length >= targetCount) {
    return existing;
  }

  let entry: FuzzyCacheEntry;
  if (existing && now - existing.ts < ttlMs) {
    entry = existing;
  } else {
    const first = await getVibixVideoLinks({
      ...baseQuery,
      page: 1,
      limit: 20,
    });
    entry = {
      ts: now,
      scannedUpToPage: 0,
      lastPage: first.meta?.last_page ?? 1,
      perPage: first.meta?.per_page ?? 20,
      matches: [],
    };
  }

  let scannedThisRequest = 0;

  for (
    let p = Math.max(1, entry.scannedUpToPage + 1);
    p <= entry.lastPage && scannedThisRequest < maxPagesPerRequest && entry.matches.length < targetCount;
    p += 1
  ) {
    const resp = await getVibixVideoLinks({
      ...baseQuery,
      page: p,
      limit: 20,
    });
    entry.lastPage = resp.meta?.last_page ?? entry.lastPage;
    entry.perPage = resp.meta?.per_page ?? entry.perPage;

    const merged = entry.matches.concat(resp.data);
    entry.matches = rankAndDedupe(merged, rawQuery);
    entry.scannedUpToPage = p;
    scannedThisRequest += 1;
  }

  entry.ts = now;
  fuzzyCache.set(key, entry);
  return entry;
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

  const name = (searchParams.get("name") ?? "").trim();
  const pageRaw = searchParams.get("page") ?? undefined;
  const limitRaw = searchParams.get("limit") ?? undefined;
  const suggest = searchParams.get("suggest") === "1";
  const enrich = searchParams.get("enrich") === "1";

  const typeRaw = searchParams.get("type") ?? undefined;
  const type: VibixVideosLinksQuery["type"] = typeRaw === "movie" || typeRaw === "serial" ? typeRaw : undefined;
  const categoryIds = parseIntList(["categoryId", "category[]"]);
  const genreIds = parseIntList(["genreId", "genre[]"]);
  const countryIds = parseIntList(["countryId", "country[]"]);
  const tagIds = parseIntList(["tagId", "tag[]"]);
  const voiceoverIds = parseIntList(["voiceoverId", "voiceover[]"]);
  const excludeTagIds = parseIntList(["excludeTagId", "excludeTag[]"]);
  const years = parseYearRange();

  const baseQuery: VibixVideosLinksQuery = {
    type,
    categoryIds: categoryIds.length ? categoryIds : undefined,
    genreIds: genreIds.length ? genreIds : undefined,
    countryIds: countryIds.length ? countryIds : undefined,
    tagIds: tagIds.length ? tagIds : undefined,
    voiceoverIds: voiceoverIds.length ? voiceoverIds : undefined,
    years: years?.length ? years : undefined,
  };

  const hasLinkFilters = !!(
    baseQuery.categoryIds?.length ||
    baseQuery.genreIds?.length ||
    baseQuery.countryIds?.length ||
    baseQuery.voiceoverIds?.length ||
    baseQuery.years?.length ||
    baseQuery.tagIds?.length ||
    excludeTagIds.length
  );

  if (!name) {
    return NextResponse.json(
      { success: false, message: "Missing query param: name" },
      { status: 400 },
    );
  }

  const page = pageRaw ? Number(pageRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const safePage = page && Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safeLimit = 20;

  try {
    const qLen = name.trim().length;

    let directData: CatalogItem[] = [];
    let tagData: CatalogItem[] = [];

    // 1) Try Vibix direct search for len>=3.
    // For suggestions we still try it first, because fuzzy scanning may miss titles far in the catalog.
    if (qLen >= 3 && !hasLinkFilters) {
      try {
        const direct = await searchVibixVideosByName({
          name,
          page: safePage,
          limit: safeLimit,
        });

        directData = direct.data.filter((v) => v.kp_id != null && (!type || v.type === type));
      } catch {
        // ignore and continue to fallback
      }
    }

    // 2) Keyword search by tags (e.g. "новый" -> tag "Новинка")
    // Use it both for normal searches and for suggestions when direct search is too narrow.
    if (qLen >= 2) {
      const tc = await getTags().catch(() => null);
      const tagId = tc ? resolveTagId(tc.tags, name) : null;
      if (tagId) {
        const tagged = await getVibixVideoLinks({
          ...baseQuery,
          page: safePage,
          limit: safeLimit,
          tagIds: Array.from(new Set([...(baseQuery.tagIds ?? []), tagId])),
        });
        tagData = tagged.data.filter((v) => v.kp_id != null);
      }
    }

    const baseMerged = rankAndDedupe(directData.concat(tagData), name);

    const maybeAugmentWithFuzzy = async (current: CatalogItem[], targetCount: number, maxPages: number) => {
      if (qLen < 2) return current;
      if (current.length >= targetCount) return current;
      const entry = await fuzzySearchPaged(name, baseQuery, targetCount, maxPages);
      const fuzzy = entry.matches.filter((v) => v.kp_id != null);
      return rankAndDedupe(current.concat(fuzzy), name);
    };

    const shouldExcludeByTags = async (kpId: number): Promise<boolean> => {
      if (!excludeTagIds.length) return false;
      const d = await getVibixVideoByKpId(kpId);
      const ids = (d.tags ?? []).map((t) => t.id).filter((n) => Number.isFinite(n));
      return ids.some((id) => excludeTagIds.includes(id));
    };

    const filterExcluded = async (items: CatalogItem[]): Promise<CatalogItem[]> => {
      if (!excludeTagIds.length) return items;
      const checks = await Promise.allSettled(
        items.map(async (v) => {
          if (!v.kp_id) return { keep: false as const, v };
          const excluded = await shouldExcludeByTags(v.kp_id);
          return { keep: !excluded, v };
        }),
      );
      return checks
        .filter((r) => r.status === "fulfilled" && r.value.keep)
        .map((r) => (r as PromiseFulfilledResult<{ keep: boolean; v: CatalogItem }>).value.v);
    };

    // Suggestions must be fast: do not run expensive fuzzy scanning.
    if (suggest) {
      const merged = await maybeAugmentWithFuzzy(baseMerged, safeLimit, 8);
      const data = await filterExcluded(merged.slice(0, safeLimit));
      const res = NextResponse.json({
        data,
        links: { first: "", last: "", prev: null, next: null },
        meta: {
          current_page: 1,
          from: data.length ? 1 : null,
          last_page: 1,
          links: [],
          path: "",
          per_page: safeLimit,
          to: data.length ? data.length : null,
          total: data.length,
        },
        success: true,
        message: "",
      });
      res.headers.set("Cache-Control", "public, max-age=0, s-maxage=120, stale-while-revalidate=600");
      return res;
    }

    // Normal search: prefer fast merged results and only fallback to fuzzy if nothing found.
    const targetCount = safePage * safeLimit;
    const merged = await maybeAugmentWithFuzzy(baseMerged, targetCount, 40);

    if (merged.length > 0) {
      const filteredMerged = await filterExcluded(merged);

      const total = filteredMerged.length;
      const last_page = Math.max(1, Math.ceil(total / safeLimit));
      const current_page = Math.min(safePage, last_page);
      const from = total ? (current_page - 1) * safeLimit + 1 : null;
      const to = total ? Math.min(current_page * safeLimit, total) : null;
      const pageItems = filteredMerged.slice((current_page - 1) * safeLimit, current_page * safeLimit);
      const enriched = enrich ? await enrichLinks(pageItems) : pageItems;

      const res = NextResponse.json({
        data: enriched,
        links: { first: "", last: "", prev: null, next: null },
        meta: {
          current_page,
          from,
          last_page,
          links: [],
          path: "",
          per_page: safeLimit,
          to,
          total,
        },
        success: true,
        message: "",
      });
      res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
      return res;
    }

    const entry = await fuzzySearchPaged(name, baseQuery, targetCount, 80);
    const mergedMatches = rankAndDedupe(entry.matches.filter((v) => v.kp_id != null), name);
    const total = mergedMatches.length;
    const last_page = Math.max(1, Math.ceil(total / safeLimit));
    const current_page = Math.min(safePage, last_page);
    const from = total ? (current_page - 1) * safeLimit + 1 : null;
    const to = total ? Math.min(current_page * safeLimit, total) : null;
    const pageItems = mergedMatches.slice((current_page - 1) * safeLimit, current_page * safeLimit);

    const enriched = enrich ? await enrichLinks(pageItems) : pageItems;

    const res = NextResponse.json({
      data: enriched,
      links: { first: "", last: "", prev: null, next: null },
      meta: {
        current_page,
        from,
        last_page,
        links: [],
        path: "",
        per_page: safeLimit,
        to,
        total,
      },
      success: true,
      message: "",
    });
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";

    if (message.includes(" 404") || message.includes("404:")) {
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

    // In case of any unexpected error, still return empty success payload.
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
      message,
    });
  }
}
