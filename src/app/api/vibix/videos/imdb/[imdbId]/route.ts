import { NextRequest, NextResponse } from "next/server";

import { getVibixVideoByImdbId } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ imdbId: string }> },
) {
  const { imdbId } = await params;

  if (!imdbId) {
    return NextResponse.json(
      { success: false, message: "Invalid imdbId" },
      { status: 400 },
    );
  }

  try {
    const data = await getVibixVideoByImdbId(imdbId);
    return NextResponse.json({ success: true, data });
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
