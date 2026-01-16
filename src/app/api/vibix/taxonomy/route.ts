import { NextResponse } from "next/server";

import {
  getVibixCategories,
  getVibixCountries,
  getVibixGenres,
  getVibixTags,
  getVibixVoiceovers,
} from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 3600;

type TaxonomyPayload = {
  genres: Awaited<ReturnType<typeof getVibixGenres>>;
  countries: Awaited<ReturnType<typeof getVibixCountries>>;
  categories: Awaited<ReturnType<typeof getVibixCategories>>;
  tags: Awaited<ReturnType<typeof getVibixTags>>;
  voiceovers: Awaited<ReturnType<typeof getVibixVoiceovers>>;
};

type TaxonomyCacheEntry = {
  ts: number;
  data: TaxonomyPayload;
};

let cache: TaxonomyCacheEntry | null = null;

async function getCachedTaxonomy(): Promise<TaxonomyPayload> {
  const now = Date.now();
  const ttlMs = 6 * 60 * 60 * 1000;
  if (cache && now - cache.ts < ttlMs) return cache.data;

  const [genres, countries, categories, tags, voiceovers] = await Promise.all([
    getVibixGenres(),
    getVibixCountries(),
    getVibixCategories(),
    getVibixTags(),
    getVibixVoiceovers(),
  ]);

  cache = {
    ts: now,
    data: {
      genres,
      countries,
      categories,
      tags,
      voiceovers,
    },
  };

  return cache.data;
}

export async function GET() {
  try {
    const data = await getCachedTaxonomy();
    const res = NextResponse.json({ success: true, data });
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=21600");
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
