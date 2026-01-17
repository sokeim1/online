import { config as loadEnv } from "dotenv";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { dbQuery } from "@/lib/db";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

type Args = {
  out: string;
  format: "ndjson" | "json";
  batch: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { out: "./exports/flixcdn-catalog.ndjson", format: "ndjson", batch: 2000 };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a) continue;

    if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage:",
          "  npm run flixcdn:export -- [--out path] [--format ndjson|json] [--batch N]",
          "",
          "Examples:",
          "  npm run flixcdn:export -- --out ./exports/flixcdn.ndjson",
          "  npm run flixcdn:export -- --format json --out ./exports/flixcdn.json",
        ].join("\n"),
      );
      process.exit(0);
    }

    const next = argv[i + 1];

    if (a === "--out" && next) {
      args.out = next;
      i += 1;
      continue;
    }
    if (a === "--format" && next) {
      const v = next.trim().toLowerCase();
      if (v === "ndjson" || v === "json") args.format = v;
      i += 1;
      continue;
    }
    if (a === "--batch" && next) {
      const n = Number.parseInt(next, 10);
      if (Number.isFinite(n) && n > 0) args.batch = Math.min(10_000, n);
      i += 1;
      continue;
    }
  }

  return args;
}

type DbRow = {
  flixcdn_id: string | number;
  kp_id: number | null;
  imdb_id: string | null;
  type: "movie" | "serial";
  year: number | null;
  title_rus: string | null;
  title_orig: string | null;
  quality: string | null;
  poster_url: string | null;
  iframe_url: string | null;
  created_at: string | null;
  genres: string[] | null;
  countries: string[] | null;
  episodes_count: number | null;
};

async function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true }).catch(() => undefined);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function exportCatalog({ out, format, batch }: Args) {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("Missing env: DATABASE_URL");
  }

  const outPath = resolve(out);
  await ensureDir(outPath);

  if (await fileExists(outPath)) {
    throw new Error(`Output file already exists: ${outPath}`);
  }

  const totalRes = await dbQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM flixcdn_videos;`);
  const total = Number.parseInt(totalRes.rows[0]?.count ?? "0", 10) || 0;

  const ws = createWriteStream(outPath, { encoding: "utf8" });

  let lastId = 0;
  let written = 0;
  let first = true;

  if (format === "json") ws.write("[\n");

  while (true) {
    const rowsRes = await dbQuery<DbRow>(
      `SELECT
        flixcdn_id,
        kp_id,
        imdb_id,
        type,
        year,
        title_rus,
        title_orig,
        quality,
        poster_url,
        iframe_url,
        created_at,
        genres,
        countries,
        episodes_count
       FROM flixcdn_videos
       WHERE flixcdn_id > $1
       ORDER BY flixcdn_id ASC
       LIMIT $2;`,
      [lastId, batch],
    );

    if (!rowsRes.rows.length) break;

    for (const r of rowsRes.rows) {
      const idNum = typeof r.flixcdn_id === "string" ? Number.parseInt(r.flixcdn_id, 10) : Number(r.flixcdn_id);
      if (Number.isFinite(idNum)) lastId = Math.max(lastId, idNum);

      const item = {
        id: idNum,
        kinopoisk_id: r.kp_id,
        imdb_id: r.imdb_id,
        type: r.type,
        year: r.year,
        title_rus: r.title_rus,
        title_orig: r.title_orig,
        quality: r.quality,
        poster: r.poster_url,
        iframe_url: r.iframe_url,
        created_at: r.created_at,
        genres: r.genres,
        countries: r.countries,
        episode: r.type === "serial" ? r.episodes_count : null,
      };

      if (format === "ndjson") {
        ws.write(JSON.stringify(item));
        ws.write("\n");
      } else {
        if (!first) ws.write(",\n");
        first = false;
        ws.write(JSON.stringify(item));
      }

      written += 1;
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ success: true, out: outPath, format, written, total }, null, 2));
  }

  if (format === "json") ws.write("\n]\n");

  await new Promise<void>((resolvePromise, rejectPromise) => {
    ws.on("finish", () => resolvePromise());
    ws.on("error", (e) => rejectPromise(e));
    ws.end();
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ success: true, done: true, out: outPath, format, written, total }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await exportCatalog(args);
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ success: false, message }, null, 2));
  process.exit(1);
});
