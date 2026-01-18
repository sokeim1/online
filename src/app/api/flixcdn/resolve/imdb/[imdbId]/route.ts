import { NextResponse } from "next/server";

import { videoseedItem } from "@/lib/videoseed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ imdbId: string }> }) {
  const { imdbId } = await params;
  const id = String(imdbId ?? "").trim();

  if (!/^tt\d+$/i.test(id)) {
    return NextResponse.json({ success: false, message: "Invalid imdbId" }, { status: 400 });
  }

  try {
    const movie = await videoseedItem({ item: "movie", imdb: id }, { timeoutMs: 8000, attempts: 2 }).catch(() => null);
    const serial = movie ? null : await videoseedItem({ item: "serial", imdb: id }, { timeoutMs: 8000, attempts: 2 }).catch(() => null);

    const picked = movie ?? serial;
    const kpRaw = picked && (picked as any).id_kp;
    const kpId = kpRaw != null ? Number(kpRaw) : null;

    return NextResponse.json({ success: true, data: { kp_id: kpId } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
