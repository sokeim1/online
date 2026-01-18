import { NextResponse } from "next/server";

import { hasDatabaseUrl } from "@/lib/db";
import { ensureVideoseedSchema, syncVideoseedCatalog } from "@/lib/videoseedIndex";

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
    await ensureVideoseedSchema();
  } catch (e) {
    const message = e instanceof Error ? e.message : "DB init failed";
    return NextResponse.json({ success: false, message: `DB error: ${message}` }, { status: 502 });
  }

  const modeRaw = (searchParams.get("mode") ?? "recent").trim();
  const mode = modeRaw === "full" ? "full" : "recent";

  const kindRaw = (searchParams.get("kind") ?? "all").trim();
  const kind = kindRaw === "movie" || kindRaw === "serial" ? kindRaw : "all";

  const pagesRaw = Number.parseInt(searchParams.get("pages") ?? "10", 10);
  const pages = Number.isFinite(pagesRaw) ? Math.min(200, Math.max(1, pagesRaw)) : 10;

  const itemsRaw = Number.parseInt(searchParams.get("items") ?? "999", 10);
  const items = Number.isFinite(itemsRaw) ? Math.min(999, Math.max(1, itemsRaw)) : 999;

  const reset = searchParams.get("reset") === "1";

  try {
    const kinds: Array<"movie" | "serial"> = kind === "all" ? ["movie", "serial"] : [kind];
    const results: Array<Record<string, unknown>> = [];

    for (const k of kinds) {
      const r = await syncVideoseedCatalog({ mode, kind: k, pages, items, reset });
      results.push({ kind: k, ...r });
    }

    return NextResponse.json({ success: true, mode, pages, items, reset, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ success: false, message: `Sync error: ${message}` }, { status: 502 });
  }
}
