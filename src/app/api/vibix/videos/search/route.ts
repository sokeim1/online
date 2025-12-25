import { NextResponse } from "next/server";

import { getVibixVideoLinks, searchVibixVideosByName } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CatalogItem = {
  id: number;
  kp_id: number | null;
  type: "movie" | "serial";
  year: number | null;
  quality: string;
  poster_url: string | null;
  name: string;
  name_rus: string | null;
  name_eng: string | null;
  iframe_url: string;
  uploaded_at: string;
};

let catalogCache: { ts: number; items: CatalogItem[]; perPage: number; lastPage: number } | null = null;
let catalogPromise: Promise<CatalogItem[]> | null = null;

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

async function ensureCatalog(): Promise<CatalogItem[]> {
  const now = Date.now();
  const ttlMs = 6 * 60 * 60 * 1000;
  if (catalogCache && now - catalogCache.ts < ttlMs) {
    return catalogCache.items;
  }

  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const first = await getVibixVideoLinks({ page: 1, limit: 100 });
    const last = first.meta?.last_page ?? 1;
    const items: CatalogItem[] = [...first.data];

    for (let p = 2; p <= last; p += 1) {
      const resp = await getVibixVideoLinks({ page: p, limit: 100 });
      items.push(...resp.data);
    }

    catalogCache = {
      ts: Date.now(),
      items,
      perPage: first.meta?.per_page ?? 100,
      lastPage: last,
    };

    catalogPromise = null;
    return items;
  })().catch((e) => {
    catalogPromise = null;
    throw e;
  });

  return catalogPromise;
}

function fuzzySearch(all: CatalogItem[], rawQuery: string): CatalogItem[] {
  const q = normalizeText(rawQuery);
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const scored: Array<{ v: CatalogItem; score: number }> = [];
  for (const v of all) {
    const hay = pickHaystack(v);
    let ok = true;
    let score = 0;
    for (const w of words) {
      const idx = hay.indexOf(w);
      if (idx === -1) {
        ok = false;
        break;
      }
      score += w.length >= 4 ? 3 : 1;
      if (idx === 0) score += 1;
    }
    if (!ok) continue;
    if (hay === q) score += 10;
    if (hay.includes(q)) score += 4;
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

    const all = await ensureCatalog();
    const matches = fuzzySearch(all, name);
    const total = matches.length;
    const last_page = Math.max(1, Math.ceil(total / safeLimit));
    const current_page = Math.min(safePage, last_page);
    const from = total ? (current_page - 1) * safeLimit + 1 : null;
    const to = total ? Math.min(current_page * safeLimit, total) : null;
    const pageItems = matches.slice((current_page - 1) * safeLimit, current_page * safeLimit);

    return NextResponse.json({
      data: pageItems,
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

    return NextResponse.json(
      { success: false, message },
      {
        status: 500,
      },
    );
  }
}
