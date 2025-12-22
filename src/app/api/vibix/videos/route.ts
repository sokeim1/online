import { NextResponse } from "next/server";

import { getVibixVideoLinks } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
