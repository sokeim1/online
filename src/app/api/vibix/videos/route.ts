import { NextResponse } from "next/server";

import { getVibixVideoByKpId, getVibixVideoLinks } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnrichEntry = {
  ts: number;
  genre: string[] | null;
  country: string[] | null;
};

const enrichCache = new Map<number, EnrichEntry>();

async function enrichLinks<T extends { kp_id: number | null; genre?: string[] | null; country?: string[] | null }>(
  items: T[],
): Promise<T[]> {
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const type = searchParams.get("type") ?? undefined;
  const pageRaw = searchParams.get("page") ?? undefined;
  const limitRaw = searchParams.get("limit") ?? undefined;

  const page = pageRaw ? Number(pageRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;

  try {
    const data = await getVibixVideoLinks({
      type: type === "movie" || type === "serial" ? type : undefined,
      page: page && Number.isFinite(page) ? page : undefined,
      limit: limit && Number.isFinite(limit) ? limit : undefined,
    });

    data.data = await enrichLinks(data.data);

    return NextResponse.json(data);
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
