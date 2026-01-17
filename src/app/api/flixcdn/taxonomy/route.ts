import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/db";
import { getFlixcdnTaxonomyFromDb } from "@/lib/flixcdnIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ success: false, message: "DATABASE_URL is not set" }, { status: 500 });
  }

  try {
    const data = await getFlixcdnTaxonomyFromDb();
    const res = NextResponse.json({ success: true, data });
    res.headers.set("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load taxonomy";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
