import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/db";
import { videoseedList } from "@/lib/videoseed";
import { getVideoseedTaxonomyFromDb } from "@/lib/videoseedIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (hasDatabaseUrl()) {
      const data = await getVideoseedTaxonomyFromDb();
      const res = NextResponse.json({ success: true, data });
      res.headers.set("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
      res.headers.set("x-source", "db");
      return res;
    }

    const [genresRes, countriesRes] = await Promise.all([
      videoseedList({ list: "category", page: 1, items: 500, sortBy: "title asc" }, { timeoutMs: 10000, attempts: 2 }).catch(() => null),
      videoseedList({ list: "country", page: 1, items: 500, sortBy: "title asc" }, { timeoutMs: 10000, attempts: 2 }).catch(() => null),
    ]);

    const pickNames = (rows: any[] | null | undefined): string[] => {
      const out: string[] = [];
      for (const r of rows ?? []) {
        if (!r || typeof r !== "object") continue;
        const name = String((r as any).name ?? (r as any).title ?? "").trim();
        if (name) out.push(name);
      }
      return Array.from(new Set(out));
    };

    const years: number[] = [];
    const current = new Date().getFullYear();
    for (let y = current + 1; y >= 1950; y -= 1) years.push(y);

    const data = {
      genres: pickNames(genresRes?.data as any[] | undefined),
      countries: pickNames(countriesRes?.data as any[] | undefined),
      years,
    };

    const res = NextResponse.json({ success: true, data });
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    res.headers.set("x-source", "videoseed");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load taxonomy";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
