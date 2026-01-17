import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/db";
import { ensureFlixcdnSchema, syncFlixcdnCatalog } from "@/lib/flixcdnIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.ADMIN_SYNC_TOKEN?.trim();
  if (!secret) {
    return NextResponse.json({ success: false, message: "Missing env: ADMIN_SYNC_TOKEN" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const auth = req.headers.get("authorization");
  const bearer = auth && auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const token = bearer ?? searchParams.get("token")?.trim() ?? "";

  if (token !== secret) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ success: false, message: "Missing env: DATABASE_URL" }, { status: 500 });
  }

  try {
    await ensureFlixcdnSchema();
  } catch (e) {
    const message = e instanceof Error ? e.message : "DB init failed";
    return NextResponse.json({ success: false, message: `DB error: ${message}` }, { status: 502 });
  }

  const modeRaw = (searchParams.get("mode") ?? "recent").trim();
  const mode = modeRaw === "full" ? "full" : "recent";

  const pagesRaw = Number.parseInt(searchParams.get("pages") ?? "10", 10);
  const pages = Number.isFinite(pagesRaw) ? Math.min(60, Math.max(1, pagesRaw)) : 10;

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 50;

  const reset = searchParams.get("reset") === "1";

  try {
    const r = await syncFlixcdnCatalog({ mode, pages, limit, reset });
    return NextResponse.json({ success: true, mode, ...r });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ success: false, message: `Sync error: ${message}` }, { status: 502 });
  }
}
