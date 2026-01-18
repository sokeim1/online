import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";

import { ensureVideoseedSchema, syncVideoseedCatalog } from "@/lib/videoseedIndex";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

type Args = {
  mode: "recent" | "full";
  pages: number;
  items: number;
  reset: boolean;
  probe: boolean;
  untilDone: boolean;
  kind: "movie" | "serial" | "all";
};

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "recent", pages: 10, items: 999, reset: false, probe: false, untilDone: false, kind: "all" };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;

    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  npm run sync:videoseed -- [--mode recent|full] [--kind movie|serial|all] [--pages N] [--items N] [--reset]",
          "",
          "Examples:",
          "  npm run sync:videoseed -- --mode recent --pages 2 --items 999",
          "  npm run sync:videoseed -- --mode full --kind all --pages 50 --items 999 --reset --until-done",
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

    if (a === "--kind") {
      const v = (next ?? "").trim();
      if (v === "movie" || v === "serial" || v === "all") args.kind = v;
      i += 1;
      continue;
    }

    if (a === "--pages") {
      const n = Number.parseInt(next ?? "", 10);
      if (Number.isFinite(n)) args.pages = n;
      i += 1;
      continue;
    }

    if (a === "--items") {
      const n = Number.parseInt(next ?? "", 10);
      if (Number.isFinite(n)) args.items = n;
      i += 1;
      continue;
    }

    if (a.includes("=")) {
      const [kRaw, vRaw] = a.split("=", 2);
      const k = (kRaw ?? "").trim();
      const v = (vRaw ?? "").trim();

      if (k === "mode" && (v === "full" || v === "recent")) args.mode = v;
      if (k === "kind" && (v === "movie" || v === "serial" || v === "all")) args.kind = v;
      if (k === "pages") {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) args.pages = n;
      }
      if (k === "items") {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) args.items = n;
      }
      if (k === "reset") args.reset = v === "1" || v.toLowerCase() === "true";
      continue;
    }
  }

  args.pages = Math.min(200, Math.max(1, args.pages));
  args.items = Math.min(999, Math.max(1, args.items));

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const envInfo = {
    cwd: process.cwd(),
    hasDotEnv: existsSync(".env"),
    hasDotEnvLocal: existsSync(".env.local"),
    presentKeys: Object.keys(process.env)
      .filter((k) => /^(DATABASE_URL|POSTGRES|NEON|VIDEOSEED_|VIBIX_)/i.test(k))
      .sort(),
  };

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(`Missing env: DATABASE_URL (set it in .env.local). envInfo=${JSON.stringify(envInfo)}`);
  }
  if (!process.env.VIDEOSEED_TOKEN?.trim()) {
    throw new Error(`Missing env: VIDEOSEED_TOKEN (set it in .env.local). envInfo=${JSON.stringify(envInfo)}`);
  }

  if (args.probe) {
    await ensureVideoseedSchema();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ success: true, probe: true }, null, 2));
    return;
  }

  await ensureVideoseedSchema();

  const kinds: Array<"movie" | "serial"> = args.kind === "all" ? ["movie", "serial"] : [args.kind];

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

  if (args.untilDone) {
    if (args.mode !== "full") {
      throw new Error("--until-done is supported only with --mode full");
    }

    for (const kind of kinds) {
      let totalScanned = 0;
      let totalUpserted = 0;
      let loops = 0;
      let first = true;
      let transientRetries = 0;

      while (true) {
        loops += 1;
        if (loops > 500) {
          throw new Error("Stopped after 500 batches to avoid infinite loop. Re-run to continue.");
        }

        let r: Awaited<ReturnType<typeof syncVideoseedCatalog>>;
        try {
          r = await syncVideoseedCatalog({
            mode: "full",
            kind,
            pages: args.pages,
            items: args.items,
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
          console.log(JSON.stringify({ success: false, transient: true, kind, retry: transientRetries, waitMs, message: msg }, null, 2));

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
              kind,
              batch: loops,
              batch_scanned: r.scanned,
              batch_upserted: r.upserted,
              nextPage: r.nextPage,
              done: r.done,
              total_scanned: totalScanned,
              total_upserted: totalUpserted,
            },
            null,
            2,
          ),
        );

        if (r.done || r.nextPage == null) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ success: true, kind, done: true, total_scanned: totalScanned, total_upserted: totalUpserted }, null, 2));
          break;
        }

        if (r.scanned === 0) {
          throw new Error("Full sync returned 0 items but is not done. Stopping to avoid infinite loop.");
        }
      }
    }

    return;
  }

  const out: Array<Record<string, unknown>> = [];
  for (const kind of kinds) {
    const r = await syncVideoseedCatalog({
      mode: args.mode,
      kind,
      pages: args.pages,
      items: args.items,
      reset: args.reset,
    });
    out.push({ kind, ...r });
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ success: true, ...args, results: out }, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
