import { config as loadEnv } from "dotenv";

import { dbQuery, hasDatabaseUrl } from "@/lib/db";
import { videoseedFindByKpId, videoseedItem } from "@/lib/videoseed";
import { ensureVideoseedSchema } from "@/lib/videoseedIndex";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseIntLoose(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const m = raw.match(/-?\d+/);
    if (!m) return null;
    const n = Number.parseInt(m[0], 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizePeopleField(raw: unknown): string | null {
  const pushName = (out: string[], v: unknown) => {
    if (typeof v === "string") {
      const s = v.trim();
      if (s) out.push(s);
      return;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const candidates = [obj.name, obj.title, obj.ru, obj.en, obj.value, obj.person, obj.actor, obj.director];
      for (const c of candidates) {
        if (typeof c === "string") {
          const s = c.trim();
          if (s) {
            out.push(s);
            return;
          }
        }
      }
    }
  };

  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s ? s : null;
  }
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const it of raw) pushName(out, it);
  } else if (raw && typeof raw === "object") {
    pushName(out, raw);
  }
  const uniq = Array.from(new Set(out.map((s) => s.trim()).filter(Boolean)));
  return uniq.length ? uniq.join(", ") : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseConcurrency(raw: string | null, fallback: number): number {
  const n = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(30, Math.max(1, n));
}

async function main() {
  const kindRaw = (getArg("--kind") ?? "all").trim();
  const kind: "movie" | "serial" | "all" = kindRaw === "movie" || kindRaw === "serial" ? kindRaw : "all";

  const limitRaw = Number.parseInt(getArg("--limit") ?? "300", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(2000, Math.max(1, limitRaw)) : 300;

  const untilDone = hasFlag("--until-done");
  const force = hasFlag("--force");

  const sleepRaw = Number.parseInt(getArg("--sleep-ms") ?? "80", 10);
  const sleepMs = Number.isFinite(sleepRaw) ? Math.min(2000, Math.max(0, sleepRaw)) : 80;

  const concurrency = parseConcurrency(getArg("--concurrency"), 8);

  const maxBatchesRaw = Number.parseInt(getArg("--batches") ?? "999999", 10);
  const maxBatches = Number.isFinite(maxBatchesRaw) ? Math.min(100000, Math.max(1, maxBatchesRaw)) : 1;

  if (!hasDatabaseUrl()) {
    throw new Error("Missing env: DATABASE_URL");
  }

  await ensureVideoseedSchema();

  let batch = 0;
  let totalSelected = 0;
  let totalUpdated = 0;
  let totalNotFound = 0;
  let totalNoData = 0;

  while (batch < maxBatches) {
    batch += 1;

    const params: unknown[] = [];
    const where: string[] = ["kp_id IS NOT NULL"]; 

    if (kind !== "all") {
      params.push(kind);
      where.push(`type = $${params.length}`);
    }

    if (!force) {
      where.push("(actors IS NULL OR directors IS NULL)");
    }

    params.push(limit);

    const sel = await dbQuery<{ kp_id: number; videoseed_id: number; type: "movie" | "serial" }>(
      `SELECT kp_id, videoseed_id, type
       FROM videoseed_videos
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC NULLS LAST, videoseed_id DESC
       LIMIT $${params.length};`,
      params,
    );

    const rows = sel.rows
      .map((r) => ({
        kp_id: r.kp_id,
        videoseed_id: r.videoseed_id,
        type: r.type,
      }))
      .filter((r) => Number.isFinite(r.kp_id) && Number.isFinite(r.videoseed_id));
    totalSelected += rows.length;

    if (!rows.length) {
      console.log(
        JSON.stringify({
          success: true,
          batch,
          kind,
          selected: 0,
          updated: 0,
          notFound: 0,
          noData: 0,
          totalSelected,
          totalUpdated,
          totalNotFound,
          totalNoData,
          done: true,
        }),
      );
      if (!untilDone) break;
      return;
    }

    let updated = 0;
    let notFound = 0;
    let noData = 0;

    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= rows.length) return;

        const r = rows[idx]!;
        const kpId = r.kp_id;

        let item: any = null;
        try {
          item = await videoseedItem({ item: r.type, id: r.videoseed_id }, { timeoutMs: 8000, attempts: 2 });
        } catch {
          item = null;
        }

        if (!item) {
          const fallback = await videoseedFindByKpId(kpId, { timeoutMs: 8000, attempts: 2 }).catch(() => null);
          item = fallback?.item ?? null;
        }

        if (!item) {
          notFound += 1;
          totalNotFound += 1;
          if (sleepMs) await sleep(sleepMs);
          continue;
        }

        const actors = normalizePeopleField(item.actor ?? item.actors ?? item.cast);
        const directors = normalizePeopleField(item.director ?? item.directors);

        if (!actors && !directors) {
          // Mark as processed so --until-done can finish, but keep UI clean (empty string is falsy).
          await dbQuery(
            `UPDATE videoseed_videos
             SET
               actors = COALESCE(actors, ''),
               directors = COALESCE(directors, ''),
               updated_at = NOW()
             WHERE kp_id = $1;`,
            [kpId],
          );
          noData += 1;
          totalNoData += 1;
          if (sleepMs) await sleep(sleepMs);
          continue;
        }

        const rawJson = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;

        await dbQuery(
          `UPDATE videoseed_videos
           SET
             actors = COALESCE($1, actors),
             directors = COALESCE($2, directors),
             raw_json = COALESCE(raw_json, $3),
             updated_at = NOW()
           WHERE kp_id = $4;`,
          [actors, directors, rawJson, kpId],
        );

        updated += 1;
        totalUpdated += 1;

        if (sleepMs) await sleep(sleepMs);
      }
    }

    const workerCount = Math.min(concurrency, rows.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    console.log(
      JSON.stringify({
        success: true,
        batch,
        kind,
        selected: rows.length,
        updated,
        notFound,
        noData,
        totalSelected,
        totalUpdated,
        totalNotFound,
        totalNoData,
        done: false,
      }),
    );

    if (!untilDone) break;
  }
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(JSON.stringify({ success: false, error: message }));
  process.exit(1);
});
