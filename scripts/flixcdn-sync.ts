import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";

import { getFlixcdnApiBases, getFlixcdnToken } from "@/lib/flixcdn";
import { ensureFlixcdnSchema, syncFlixcdnCatalog } from "@/lib/flixcdnIndex";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

type Args = {
  mode: "recent" | "full";
  pages: number;
  limit: number;
  reset: boolean;
  probe: boolean;
  untilDone: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "recent", pages: 10, limit: 50, reset: false, probe: false, untilDone: false };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;

    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  npm run sync:flixcdn -- [--mode recent|full] [--pages N] [--limit N] [--reset]",
          "",
          "Examples:",
          "  npm run sync:flixcdn -- --mode recent --pages 5 --limit 50",
          "  npm run sync:flixcdn -- --mode full --pages 60 --limit 50 --reset",
        ].join("\n"),
      );
      process.exit(0);
    }

    if (a === "--reset") {
      args.reset = true;
      continue;
    }

    if (a === "--probe") {
      args.probe = true;
      continue;
    }

    if (a === "--until-done") {
      args.untilDone = true;
      continue;
    }

    const next = argv[i + 1];

    if (a === "--mode") {
      const v = (next ?? "").trim();
      if (v === "full" || v === "recent") args.mode = v;
      i += 1;
      continue;
    }

    if (a === "--pages") {
      const n = Number.parseInt(next ?? "", 10);
      if (Number.isFinite(n)) args.pages = n;
      i += 1;
      continue;
    }

    if (a === "--limit") {
      const n = Number.parseInt(next ?? "", 10);
      if (Number.isFinite(n)) args.limit = n;
      i += 1;
      continue;
    }

    if (a.includes("=")) {
      const [kRaw, vRaw] = a.split("=", 2);
      const k = (kRaw ?? "").trim();
      const v = (vRaw ?? "").trim();

      if (k === "mode" && (v === "full" || v === "recent")) args.mode = v;
      if (k === "pages") {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) args.pages = n;
      }
      if (k === "limit") {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) args.limit = n;
      }
      if (k === "reset") args.reset = v === "1" || v.toLowerCase() === "true";
      continue;
    }
  }

  args.pages = Math.min(60, Math.max(1, args.pages));
  args.limit = Math.min(50, Math.max(1, args.limit));

  return args;
}

function summarizeBody(body: string, max = 500): string {
  const trimmed = String(body ?? "").trim();
  if (!trimmed) return "";
  const noTags = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return noTags.length > max ? `${noTags.slice(0, max)}…` : noTags;
}

async function probeFlixcdnUpdates(): Promise<void> {
  const bases = getFlixcdnApiBases();
  const token = getFlixcdnToken();

  const out: Array<Record<string, unknown>> = [];

  for (const base of bases) {
    const url = new URL(`${base}/api/updates`);
    url.searchParams.set("token", token);
    url.searchParams.set("limit", "1");
    url.searchParams.set("offset", "0");

    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const ct = res.headers.get("content-type") || "";
      const text = await res.text().catch(() => "");

      let json: unknown = null;
      try {
        json = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        json = null;
      }

      const obj = json && typeof json === "object" ? (json as any) : null;
      const lengths: Record<string, number> = {};
      for (const k of ["result", "results", "data", "items", "list", "films", "movies"]) {
        const v = obj?.[k];
        if (Array.isArray(v)) lengths[k] = v.length;
      }

      out.push({
        base,
        ok: res.ok,
        status: res.status,
        contentType: ct,
        bodySummary: summarizeBody(text),
        jsonType: Array.isArray(json) ? "array" : typeof json,
        jsonKeys: obj ? Object.keys(obj).slice(0, 30) : null,
        listLengths: Object.keys(lengths).length ? lengths : null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ base, ok: false, error: msg });
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ success: true, probe: "updates", attempts: out }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const envInfo = {
    cwd: process.cwd(),
    hasDotEnv: existsSync(".env"),
    hasDotEnvLocal: existsSync(".env.local"),
    presentKeys: Object.keys(process.env)
      .filter((k) => /^(DATABASE_URL|POSTGRES|NEON|FLIXCDN_|VIBIX_)/i.test(k))
      .sort(),
  };

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(`Missing env: DATABASE_URL (set it in .env.local). envInfo=${JSON.stringify(envInfo)}`);
  }
  if (!process.env.FLIXCDN_TOKEN?.trim()) {
    throw new Error(`Missing env: FLIXCDN_TOKEN (set it in .env.local). envInfo=${JSON.stringify(envInfo)}`);
  }

  if (args.probe) {
    await probeFlixcdnUpdates();
    return;
  }

  await ensureFlixcdnSchema();

  if (args.untilDone) {
    if (args.mode !== "full") {
      throw new Error("--until-done is supported only with --mode full");
    }

    let totalScanned = 0;
    let totalUpserted = 0;
    let loops = 0;
    let first = true;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const isTransient = (message: string) => {
      const m = message.toLowerCase();
      return (
        /api error 5\d\d/.test(m) ||
        /error code 5\d\d/.test(m) ||
        m.includes("bad gateway") ||
        m.includes("cloudflare") ||
        m.includes("internal server") ||
        m.includes("aborted") ||
        m.includes("timeout") ||
        m.includes("etimedout") ||
        m.includes("econnreset")
      );
    };

    let transientRetries = 0;

    while (true) {
      loops += 1;
      if (loops > 200) {
        throw new Error("Stopped after 200 batches to avoid infinite loop. Re-run to continue.");
      }

      let r: Awaited<ReturnType<typeof syncFlixcdnCatalog>>;
      try {
        r = await syncFlixcdnCatalog({
          mode: "full",
          pages: args.pages,
          limit: args.limit,
          reset: first ? args.reset : false,
        });
        transientRetries = 0;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!isTransient(msg)) throw e;

        transientRetries += 1;
        const base = 5_000;
        const exp = Math.min(10 * 60_000, base * Math.pow(2, transientRetries - 1));
        const jitter = Math.floor(Math.random() * 1500);
        const waitMs = exp + jitter;

        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ success: false, transient: true, retry: transientRetries, waitMs, message: msg }, null, 2));

        await sleep(waitMs);
        loops -= 1;
        continue;
      }
      first = false;

      totalScanned += r.scanned;
      totalUpserted += r.upserted;

      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            success: true,
            batch: loops,
            batch_scanned: r.scanned,
            batch_upserted: r.upserted,
            nextOffset: r.nextOffset,
            done: r.done,
            total_scanned: totalScanned,
            total_upserted: totalUpserted,
          },
          null,
          2,
        ),
      );

      if (r.done || r.nextOffset == null) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ success: true, done: true, total_scanned: totalScanned, total_upserted: totalUpserted }, null, 2));
        return;
      }

      if (r.scanned === 0) {
        throw new Error("Full sync returned 0 items but is not done. Stopping to avoid infinite loop.");
      }
    }
  }

  const r = await syncFlixcdnCatalog(args);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ success: true, ...args, ...r }, null, 2));
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ success: false, message }, null, 2));
  process.exit(1);
});
