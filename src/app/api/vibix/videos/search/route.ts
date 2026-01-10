import { NextResponse } from "next/server";

import { getVibixVideoByKpId, getVibixVideoLinks, searchVibixVideosByName } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  genre?: string[] | null;
  country?: string[] | null;
};

type EnrichEntry = {
  ts: number;
  genre: string[] | null;
  country: string[] | null;
};

const enrichCache = new Map<number, EnrichEntry>();

async function enrichLinks<
  T extends { kp_id: number | null; genre?: string[] | null; country?: string[] | null },
>(items: T[]): Promise<T[]> {
  const ttlMs = 6 * 60 * 60 * 1000;
  const now = Date.now();
  const out = items.slice();
  const need = out
    .map((v, idx) => ({ v, idx }))
    .filter(({ v }) => v.kp_id && (v.genre == null || v.country == null));

  const concurrency = 5;
  for (let i = 0; i < need.length; i += concurrency) {
    const chunk = need.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async ({ v }) => {
        const kpId = v.kp_id as number;
        const cached = enrichCache.get(kpId);
        if (cached && now - cached.ts < ttlMs) return cached;

        const d = await getVibixVideoByKpId(kpId);
        const entry: EnrichEntry = {
          ts: now,
          genre: d.genre ?? null,
          country: d.country ?? null,
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

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function pickHaystack(v: CatalogItem): string {
  return normalizeText([v.name_rus, v.name_eng, v.name].filter(Boolean).join(" "));
}

function isMatch(haystack: string, rawQuery: string): { ok: boolean; score: number } {
  const q = normalizeText(rawQuery);
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return { ok: false, score: 0 };

  let score = 0;
  for (const w of words) {
    const idx = haystack.indexOf(w);
    if (idx === -1) return { ok: false, score: 0 };
    score += w.length >= 4 ? 3 : 1;
    if (idx === 0) score += 1;
  }

  if (haystack === q) score += 10;
  if (haystack.includes(q)) score += 4;
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

async function fuzzySearchPaged(rawQuery: string, targetCount: number): Promise<FuzzyCacheEntry> {
  const key = normalizeText(rawQuery);
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
    const first = await getVibixVideoLinks({ page: 1, limit: 100 });
    entry = {
      ts: now,
      scannedUpToPage: 0,
      lastPage: first.meta?.last_page ?? 1,
      perPage: first.meta?.per_page ?? 100,
      matches: [],
    };
  }

  const maxPagesPerRequest = 25;
  let scannedThisRequest = 0;

  for (
    let p = Math.max(1, entry.scannedUpToPage + 1);
    p <= entry.lastPage && scannedThisRequest < maxPagesPerRequest && entry.matches.length < targetCount;
    p += 1
  ) {
    const resp = await getVibixVideoLinks({ page: p, limit: 100 });
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

  const name = (searchParams.get("name") ?? "").trim();
  const pageRaw = searchParams.get("page") ?? undefined;
  const limitRaw = searchParams.get("limit") ?? undefined;

  if (!name) {
    return NextResponse.json(
      { success: false, message: "Missing query param: name" },
      { status: 400 },
    );
  }

  const page = pageRaw ? Number(pageRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const safePage = page && Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safeLimit = limit && Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 30;

  try {
    const data = await searchVibixVideosByName({
      name,
      page: safePage,
      limit: safeLimit,
    });

    if (data.data.length > 0) {
      data.data = await enrichLinks(data.data);
      return NextResponse.json(data);
    }

    if (name.trim().length < 3) {
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

    const targetCount = safePage * safeLimit;
    const entry = await fuzzySearchPaged(name, targetCount);
    const matches = entry.matches;
    const total = matches.length;
    const last_page = Math.max(1, Math.ceil(total / safeLimit));
    const current_page = Math.min(safePage, last_page);
    const from = total ? (current_page - 1) * safeLimit + 1 : null;
    const to = total ? Math.min(current_page * safeLimit, total) : null;
    const pageItems = matches.slice((current_page - 1) * safeLimit, current_page * safeLimit);

    const enriched = await enrichLinks(pageItems);

    return NextResponse.json({
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
          per_page: limit && Number.isFinite(limit) ? limit : 30,
          to: null,
          total: 0,
        },
        success: true,
        message: "",
      });
    }

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
}
