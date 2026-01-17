import { dbQuery } from "@/lib/db";
import { flixcdnUpdates, parseFlixcdnInt, parseFlixcdnYear } from "@/lib/flixcdn";

export type FlixcdnSyncMode = "recent" | "full";

let schemaReady: Promise<void> | null = null;

export async function ensureFlixcdnSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
  await dbQuery(
    `CREATE TABLE IF NOT EXISTS flixcdn_videos (
      flixcdn_id BIGINT PRIMARY KEY,
      kp_id INTEGER NULL,
      imdb_id TEXT NULL,
      type TEXT NOT NULL,
      year INTEGER NULL,
      title_rus TEXT NULL,
      title_orig TEXT NULL,
      quality TEXT NULL,
      poster_url TEXT NULL,
      iframe_url TEXT NULL,
      created_at TIMESTAMPTZ NULL,
      genres TEXT[] NULL,
      countries TEXT[] NULL,
      episodes_count INTEGER NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  );

  await dbQuery(`ALTER TABLE flixcdn_videos ADD COLUMN IF NOT EXISTS genres TEXT[] NULL;`);
  await dbQuery(`ALTER TABLE flixcdn_videos ADD COLUMN IF NOT EXISTS countries TEXT[] NULL;`);

  const cols = await dbQuery<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'flixcdn_videos'
       AND column_name IN ('genres','countries');`,
  );

  const colType = new Map(cols.rows.map((r) => [r.column_name, r.data_type] as const));

  if (colType.get("genres") === "jsonb") {
    await dbQuery(
      `ALTER TABLE flixcdn_videos
       ALTER COLUMN genres TYPE TEXT[]
       USING (
         CASE
           WHEN genres IS NULL THEN NULL
           WHEN jsonb_typeof(genres) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(genres))
           ELSE NULL
         END
       );`,
    );
  }

  if (colType.get("countries") === "jsonb") {
    await dbQuery(
      `ALTER TABLE flixcdn_videos
       ALTER COLUMN countries TYPE TEXT[]
       USING (
         CASE
           WHEN countries IS NULL THEN NULL
           WHEN jsonb_typeof(countries) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(countries))
           ELSE NULL
         END
       );`,
    );
  }

  await dbQuery(`CREATE INDEX IF NOT EXISTS flixcdn_videos_kp_id_idx ON flixcdn_videos(kp_id);`);
  await dbQuery(`CREATE INDEX IF NOT EXISTS flixcdn_videos_created_at_idx ON flixcdn_videos(created_at DESC NULLS LAST, flixcdn_id DESC);`);

  await dbQuery(
    `CREATE TABLE IF NOT EXISTS flixcdn_sync_state (
      "key" TEXT PRIMARY KEY,
      "offset" INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  );

  await dbQuery(
    `INSERT INTO flixcdn_sync_state("key", "offset") VALUES ('full', 0)
     ON CONFLICT ("key") DO NOTHING;`,
  );
  })();

  return schemaReady;
}

type FlixcdnVideoRow = {
  flixcdn_id: number;
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

function buildUpsertQuery(rows: FlixcdnVideoRow[]): { text: string; params: unknown[] } {
  const cols = [
    "flixcdn_id",
    "kp_id",
    "imdb_id",
    "type",
    "year",
    "title_rus",
    "title_orig",
    "quality",
    "poster_url",
    "iframe_url",
    "created_at",
    "genres",
    "countries",
    "episodes_count",
  ];

  const params: unknown[] = [];
  const values = rows
    .map((r, rowIdx) => {
      const base = rowIdx * cols.length;
      params.push(
        r.flixcdn_id,
        r.kp_id,
        r.imdb_id,
        r.type,
        r.year,
        r.title_rus,
        r.title_orig,
        r.quality,
        r.poster_url,
        r.iframe_url,
        r.created_at,
        r.genres,
        r.countries,
        r.episodes_count,
      );

      const placeholders = cols.map((_, colIdx) => `$${base + colIdx + 1}`).join(", ");
      return `(${placeholders})`;
    })
    .join(", ");

  const text = `INSERT INTO flixcdn_videos (${cols.join(", ")}) VALUES ${values}
    ON CONFLICT (flixcdn_id) DO UPDATE SET
      kp_id = EXCLUDED.kp_id,
      imdb_id = EXCLUDED.imdb_id,
      type = EXCLUDED.type,
      year = EXCLUDED.year,
      title_rus = EXCLUDED.title_rus,
      title_orig = EXCLUDED.title_orig,
      quality = EXCLUDED.quality,
      poster_url = EXCLUDED.poster_url,
      iframe_url = EXCLUDED.iframe_url,
      created_at = EXCLUDED.created_at,
      genres = EXCLUDED.genres,
      countries = EXCLUDED.countries,
      episodes_count = EXCLUDED.episodes_count,
      updated_at = NOW();`;

  return { text, params };
}

export async function syncFlixcdnCatalog({
  mode,
  pages,
  limit,
  reset,
}: {
  mode: FlixcdnSyncMode;
  pages: number;
  limit: number;
  reset: boolean;
}): Promise<{ scanned: number; upserted: number; nextOffset: number | null; done: boolean }> {
  await ensureFlixcdnSchema();

  const safeLimit = Math.min(50, Math.max(1, limit));
  const maxPages = Math.min(60, Math.max(1, pages));

  let offset = 0;
  if (mode === "full") {
    if (reset) {
      await dbQuery(`UPDATE flixcdn_sync_state SET "offset" = 0, updated_at = NOW() WHERE "key" = 'full';`);
      offset = 0;
    } else {
      const st = await dbQuery<{ offset: number }>(
        `SELECT "offset" AS offset FROM flixcdn_sync_state WHERE "key" = 'full';`,
      );
      offset = typeof st.rows[0]?.offset === "number" ? st.rows[0].offset : 0;
    }
  }

  let scanned = 0;
  let upserted = 0;
  let done = false;
  let nextOffset: number | null = null;

  for (let p = 0; p < maxPages; p += 1) {
    const data = await flixcdnUpdates({ offset, limit: safeLimit }, { timeoutMs: 4000, attempts: 2 });
    const items = data.result ?? [];
    if (!items.length) {
      done = true;
      nextOffset = null;
      break;
    }

    scanned += items.length;

    const rowsRaw: FlixcdnVideoRow[] = items.map((x) => {
      const kpId = parseFlixcdnInt(x.kinopoisk_id);
      const imdbId = typeof x.imdb_id === "string" ? x.imdb_id : null;
      const year = parseFlixcdnYear(x.year);
      const posterUrl = typeof x.poster === "string" ? x.poster : null;
      const iframeUrl = typeof x.iframe_url === "string" ? x.iframe_url : null;
      const quality = typeof x.quality === "string" ? x.quality : null;
      const createdAt = typeof x.created_at === "string" ? x.created_at : null;
      const type = x.type === "serial" ? "serial" : "movie";
      const episodesCount = type === "serial" ? parseFlixcdnInt(x.episode) : null;

      return {
        flixcdn_id: x.id,
        kp_id: kpId,
        imdb_id: imdbId,
        type,
        year,
        title_rus: x.title_rus ?? null,
        title_orig: x.title_orig ?? null,
        quality,
        poster_url: posterUrl,
        iframe_url: iframeUrl,
        created_at: createdAt,
        genres: Array.isArray(x.genres) ? x.genres : null,
        countries: Array.isArray(x.countries) ? x.countries : null,
        episodes_count: episodesCount,
      };
    });

    const unionArray = (a: string[] | null, b: string[] | null): string[] | null => {
      if (!a?.length) return b?.length ? b : null;
      if (!b?.length) return a;
      const set = new Set<string>();
      for (const x of a) if (typeof x === "string" && x.trim()) set.add(x.trim());
      for (const x of b) if (typeof x === "string" && x.trim()) set.add(x.trim());
      const out = Array.from(set);
      return out.length ? out : null;
    };

    const pick = <T>(cur: T | null, next: T | null): T | null => (cur != null ? cur : next);

    const rowsMap = new Map<number, FlixcdnVideoRow>();
    for (const r of rowsRaw) {
      const prev = rowsMap.get(r.flixcdn_id);
      if (!prev) {
        rowsMap.set(r.flixcdn_id, r);
        continue;
      }
      rowsMap.set(r.flixcdn_id, {
        flixcdn_id: r.flixcdn_id,
        kp_id: pick(prev.kp_id, r.kp_id),
        imdb_id: pick(prev.imdb_id, r.imdb_id),
        type: prev.type,
        year: pick(prev.year, r.year),
        title_rus: pick(prev.title_rus, r.title_rus),
        title_orig: pick(prev.title_orig, r.title_orig),
        quality: pick(prev.quality, r.quality),
        poster_url: pick(prev.poster_url, r.poster_url),
        iframe_url: pick(prev.iframe_url, r.iframe_url),
        created_at: pick(prev.created_at, r.created_at),
        genres: unionArray(prev.genres, r.genres),
        countries: unionArray(prev.countries, r.countries),
        episodes_count: pick(prev.episodes_count, r.episodes_count),
      });
    }

    const rows = Array.from(rowsMap.values());

    const q = buildUpsertQuery(rows);
    await dbQuery(q.text, q.params);
    upserted += rows.length;

    nextOffset = data.next?.offset ?? null;

    if (mode === "full") {
      if (nextOffset != null) {
        await dbQuery(`UPDATE flixcdn_sync_state SET "offset" = $1, updated_at = NOW() WHERE "key" = 'full';`, [nextOffset]);
      }
    }

    if (mode === "recent") {
      if (data.next == null || items.length < safeLimit) {
        done = true;
        nextOffset = null;
        break;
      }
      offset += safeLimit;
      continue;
    }

    if (nextOffset == null || items.length < safeLimit) {
      done = true;
      nextOffset = null;
      if (mode === "full") {
        await dbQuery(`UPDATE flixcdn_sync_state SET "offset" = 0, updated_at = NOW() WHERE "key" = 'full';`);
      }
      break;
    }

    offset = nextOffset;
  }

  return { scanned, upserted, nextOffset, done };
}

export async function listCatalogFromDb({
  offset,
  limit,
  type,
}: {
  offset: number;
  limit: number;
  type: "movie" | "serial" | null;
}): Promise<{ total: number; items: FlixcdnVideoRow[] }> {
  await ensureFlixcdnSchema();

  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (type) {
    params.push(type);
    whereParts.push(`type = $${params.length}`);
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const totalRes = await dbQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM flixcdn_videos ${where};`, params);
  const total = Number.parseInt(totalRes.rows[0]?.count ?? "0", 10) || 0;

  params.push(limit);
  params.push(offset);

  const rowsRes = await dbQuery<FlixcdnVideoRow>(
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
     ${where}
     ORDER BY created_at DESC NULLS LAST, flixcdn_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length};`,
    params,
  );

  return { total, items: rowsRes.rows };
}

export async function searchCatalogFromDb({
  query,
  offset,
  limit,
  type,
}: {
  query: string;
  offset: number;
  limit: number;
  type: "movie" | "serial" | null;
}): Promise<{ total: number; items: FlixcdnVideoRow[] }> {
  await ensureFlixcdnSchema();

  const q = `%${query}%`;

  const whereParts: string[] = [];
  const params: unknown[] = [q];
  whereParts.push(`(title_rus ILIKE $1 OR title_orig ILIKE $1)`);

  if (type) {
    params.push(type);
    whereParts.push(`type = $${params.length}`);
  }

  const where = `WHERE ${whereParts.join(" AND ")}`;

  const totalRes = await dbQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM flixcdn_videos
     ${where};`,
    params,
  );
  const total = Number.parseInt(totalRes.rows[0]?.count ?? "0", 10) || 0;

  params.push(limit);
  params.push(offset);

  const rowsRes = await dbQuery<FlixcdnVideoRow>(
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
     ${where}
     ORDER BY created_at DESC NULLS LAST, flixcdn_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length};`,
    params,
  );

  return { total, items: rowsRes.rows };
}
