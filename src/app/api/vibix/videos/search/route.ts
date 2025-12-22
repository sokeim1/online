import { NextResponse } from "next/server";

import { searchVibixVideosByName } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const data = await searchVibixVideosByName({
      name,
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
