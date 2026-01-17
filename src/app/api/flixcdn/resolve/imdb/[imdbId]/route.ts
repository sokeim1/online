import { NextResponse } from "next/server";

import { flixcdnSearch, parseFlixcdnInt } from "@/lib/flixcdn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ imdbId: string }> }) {
  const { imdbId } = await params;
  const id = String(imdbId ?? "").trim();

  if (!/^tt\d+$/i.test(id)) {
    return NextResponse.json({ success: false, message: "Invalid imdbId" }, { status: 400 });
  }

  try {
    const data = await flixcdnSearch({ imdb_id: id, limit: 1, offset: 0 });
    const first = (data.result ?? [])[0];
    const kpId = first ? parseFlixcdnInt(first.kinopoisk_id) : null;

    return NextResponse.json({ success: true, data: { kp_id: kpId } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
