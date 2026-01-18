import { dbQuery } from "@/lib/db";
import { parseVideoseedYear, splitCommaList, videoseedList } from "@/lib/videoseed";

export type VideoseedSyncMode = "recent" | "full";

let schemaReady: Promise<void> | null = null;
let pgTrgmReady: Promise<boolean> | null = null;

async function hasPgTrgm(): Promise<boolean> {
  if (pgTrgmReady) return pgTrgmReady;
  pgTrgmReady = (async () => {
    try {
      const r = await dbQuery<{ exists: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS exists;`);
      return !!r.rows[0]?.exists;
    } catch {
      return false;
    }
  })();
  return pgTrgmReady;
}

export async function ensureVideoseedSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      await dbQuery(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    } catch {
    }

    await dbQuery(
      `CREATE TABLE IF NOT EXISTS videoseed_videos (
        videoseed_id BIGINT PRIMARY KEY,
        kp_id INTEGER NULL,
        imdb_id TEXT NULL,
        tmdb_id TEXT NULL,
        type TEXT NOT NULL,
        year INTEGER NULL,
        title_rus TEXT NULL,
        title_orig TEXT NULL,
        poster_url TEXT NULL,
        iframe_url TEXT NULL,
        created_at TIMESTAMPTZ NULL,
        description TEXT NULL,
        time_raw TEXT NULL,
        translation TEXT NULL,
        translation_iframe JSONB NULL,
        video_type TEXT NULL,
        actors TEXT NULL,
        directors TEXT NULL,
        last_content_date TIMESTAMPTZ NULL,
        last_add_element TEXT NULL,
        subs JSONB NULL,
        raw_json JSONB NULL,
        genres TEXT[] NULL,
        countries TEXT[] NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`,
    );

    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS genres TEXT[] NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS countries TEXT[] NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS description TEXT NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS time_raw TEXT NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS tmdb_id TEXT NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS translation TEXT NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS translation_iframe JSONB NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS video_type TEXT NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS actors TEXT NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS directors TEXT NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS last_content_date TIMESTAMPTZ NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS last_add_element TEXT NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS subs JSONB NULL;`);
    await dbQuery(`ALTER TABLE videoseed_videos ADD COLUMN IF NOT EXISTS raw_json JSONB NULL;`);

    await dbQuery(`CREATE INDEX IF NOT EXISTS videoseed_videos_kp_id_idx ON videoseed_videos(kp_id);`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS videoseed_videos_created_at_idx ON videoseed_videos(created_at DESC NULLS LAST, videoseed_id DESC);`);

    try {
      await dbQuery(
        `CREATE INDEX IF NOT EXISTS videoseed_videos_title_rus_trgm_idx
         ON videoseed_videos
         USING gin (coalesce(title_rus, '') gin_trgm_ops);`,
      );
      await dbQuery(
        `CREATE INDEX IF NOT EXISTS videoseed_videos_title_orig_trgm_idx
         ON videoseed_videos
         USING gin (coalesce(title_orig, '') gin_trgm_ops);`,
      );
    } catch {
    }

    await dbQuery(
      `CREATE TABLE IF NOT EXISTS videoseed_sync_state (
        "key" TEXT PRIMARY KEY,
        "page" INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`,
    );

    await dbQuery(
      `INSERT INTO videoseed_sync_state("key", "page") VALUES ('movie', 1)
       ON CONFLICT ("key") DO NOTHING;`,
    );
    await dbQuery(
      `INSERT INTO videoseed_sync_state("key", "page") VALUES ('serial', 1)
       ON CONFLICT ("key") DO NOTHING;`,
    );
  })();

  return schemaReady;
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

export type VideoseedVideoRow = {
  videoseed_id: number;
  kp_id: number | null;
  imdb_id: string | null;
  tmdb_id: string | null;
  type: "movie" | "serial";
  year: number | null;
  title_rus: string | null;
  title_orig: string | null;
  poster_url: string | null;
  iframe_url: string | null;
  created_at: string | null;
  description: string | null;
  time_raw: string | null;
  translation: string | null;
  translation_iframe: Record<string, unknown> | null;
  video_type: string | null;
  actors: string | null;
  directors: string | null;
  last_content_date: string | null;
  last_add_element: string | null;
  subs: any[] | null;
  raw_json: Record<string, unknown> | null;
  genres: string[] | null;
  countries: string[] | null;
};

function buildUpsertQuery(rows: VideoseedVideoRow[]): { text: string; params: unknown[] } {
  const cols = [
    "videoseed_id",
    "kp_id",
    "imdb_id",
    "tmdb_id",
    "type",
    "year",
    "title_rus",
    "title_orig",
    "poster_url",
    "iframe_url",
    "created_at",
    "description",
    "time_raw",
    "translation",
    "translation_iframe",
    "video_type",
    "actors",
    "directors",
    "last_content_date",
    "last_add_element",
    "subs",
    "raw_json",
    "genres",
    "countries",
  ];

  const params: unknown[] = [];
  const values = rows
    .map((r, rowIdx) => {
      const base = rowIdx * cols.length;
      params.push(
        r.videoseed_id,
        r.kp_id,
        r.imdb_id,
        r.tmdb_id,
        r.type,
        r.year,
        r.title_rus,
        r.title_orig,
        r.poster_url,
        r.iframe_url,
        r.created_at,
        r.description,
        r.time_raw,
        r.translation,
        r.translation_iframe,
        r.video_type,
        r.actors,
        r.directors,
        r.last_content_date,
        r.last_add_element,
        r.subs,
        r.raw_json,
        r.genres,
        r.countries,
      );

      const placeholders = cols.map((_, colIdx) => `$${base + colIdx + 1}`).join(", ");
      return `(${placeholders})`;
    })
    .join(", ");

  const text = `INSERT INTO videoseed_videos (${cols.join(", ")}) VALUES ${values}
    ON CONFLICT (videoseed_id) DO UPDATE SET
      kp_id = COALESCE(EXCLUDED.kp_id, videoseed_videos.kp_id),
      imdb_id = COALESCE(EXCLUDED.imdb_id, videoseed_videos.imdb_id),
      tmdb_id = COALESCE(EXCLUDED.tmdb_id, videoseed_videos.tmdb_id),
      type = EXCLUDED.type,
      year = COALESCE(EXCLUDED.year, videoseed_videos.year),
      title_rus = COALESCE(EXCLUDED.title_rus, videoseed_videos.title_rus),
      title_orig = COALESCE(EXCLUDED.title_orig, videoseed_videos.title_orig),
      poster_url = COALESCE(EXCLUDED.poster_url, videoseed_videos.poster_url),
      iframe_url = COALESCE(EXCLUDED.iframe_url, videoseed_videos.iframe_url),
      created_at = COALESCE(EXCLUDED.created_at, videoseed_videos.created_at),
      description = COALESCE(EXCLUDED.description, videoseed_videos.description),
      time_raw = COALESCE(EXCLUDED.time_raw, videoseed_videos.time_raw),
      translation = COALESCE(EXCLUDED.translation, videoseed_videos.translation),
      translation_iframe = COALESCE(EXCLUDED.translation_iframe, videoseed_videos.translation_iframe),
      video_type = COALESCE(EXCLUDED.video_type, videoseed_videos.video_type),
      actors = COALESCE(EXCLUDED.actors, videoseed_videos.actors),
      directors = COALESCE(EXCLUDED.directors, videoseed_videos.directors),
      last_content_date = COALESCE(EXCLUDED.last_content_date, videoseed_videos.last_content_date),
      last_add_element = COALESCE(EXCLUDED.last_add_element, videoseed_videos.last_add_element),
      subs = COALESCE(EXCLUDED.subs, videoseed_videos.subs),
      raw_json = COALESCE(EXCLUDED.raw_json, videoseed_videos.raw_json),
      genres = COALESCE(EXCLUDED.genres, videoseed_videos.genres),
      countries = COALESCE(EXCLUDED.countries, videoseed_videos.countries),
      updated_at = NOW();`;

  return { text, params };
}

export async function syncVideoseedCatalog({
  mode,
  kind,
  pages,
  items,
  reset,
}: {
  mode: VideoseedSyncMode;
  kind: "movie" | "serial";
  pages: number;
  items: number;
  reset: boolean;
}): Promise<{ scanned: number; upserted: number; nextPage: number | null; done: boolean }> {
  await ensureVideoseedSchema();

  const safeItems = Math.min(999, Math.max(1, items));
  const maxPages = Math.min(200, Math.max(1, pages));

  let page = 1;
  if (mode === "full") {
    if (reset) {
      await dbQuery(`UPDATE videoseed_sync_state SET "page" = 1, updated_at = NOW() WHERE "key" = $1;`, [kind]);
      page = 1;
    } else {
      const st = await dbQuery<{ page: number }>(`SELECT "page" AS page FROM videoseed_sync_state WHERE "key" = $1;`, [kind]);
      page = typeof st.rows[0]?.page === "number" && Number.isFinite(st.rows[0]?.page) ? st.rows[0]!.page : 1;
      if (page < 1) page = 1;
    }
  }

  let scanned = 0;
  let upserted = 0;
  let done = false;
  let nextPage: number | null = null;

  const pick = <T>(cur: T | null, next: T | null): T | null => (cur != null ? cur : next);

  const unionArray = (a: string[] | null, b: string[] | null): string[] | null => {
    if (!a?.length) return b?.length ? b : null;
    if (!b?.length) return a;
    const set = new Set<string>();
    for (const x of a) if (typeof x === "string" && x.trim()) set.add(x.trim());
    for (const x of b) if (typeof x === "string" && x.trim()) set.add(x.trim());
    const out = Array.from(set);
    return out.length ? out : null;
  };

  for (let p = 0; p < maxPages; p += 1) {
    const sortBy = mode === "recent" ? "post_date desc" : "post_date asc";
    const data = await videoseedList(
      {
        list: kind,
        page,
        items: safeItems,
        sortBy,
      },
      { timeoutMs: mode === "recent" ? 10_000 : 15_000, attempts: 3 },
    );

    const itemsList = data.data ?? [];
    if (!itemsList.length) {
      done = true;
      nextPage = null;
      if (mode === "full") {
        await dbQuery(`UPDATE videoseed_sync_state SET "page" = 1, updated_at = NOW() WHERE "key" = $1;`, [kind]);
      }
      break;
    }

    scanned += itemsList.length;

    const rowsRaw = itemsList
      .map((x) => {
        const videoseedId = parseIntLoose((x as any).id);
        if (videoseedId == null) return null;

        const kpId = parseIntLoose((x as any).id_kp);
        const imdbId = typeof (x as any).id_imdb === "string" ? ((x as any).id_imdb as string) : null;
        const tmdbId = typeof (x as any).id_tmdb === "string" || typeof (x as any).id_tmdb === "number" ? String((x as any).id_tmdb) : null;
        const year = parseVideoseedYear((x as any).year);
        const titleRus = typeof (x as any).name === "string" ? ((x as any).name as string) : null;
        const titleOrig = typeof (x as any).original_name === "string" ? ((x as any).original_name as string) : null;
        const posterUrl = typeof (x as any).poster === "string" ? ((x as any).poster as string) : null;
        const iframeUrl = typeof (x as any).iframe === "string" ? ((x as any).iframe as string) : null;
        const createdAt = typeof (x as any).date === "string" ? ((x as any).date as string) : null;
        const description = typeof (x as any).description === "string" ? ((x as any).description as string) : null;
        const timeRaw = typeof (x as any).time === "string" || typeof (x as any).time === "number" ? String((x as any).time) : null;
        const translation = typeof (x as any).translation === "string" ? ((x as any).translation as string) : null;
        const translationIframe = (x as any).translation_iframe;
        const genres = splitCommaList((x as any).genre);
        const countries = splitCommaList((x as any).country);

        const videoType = typeof (x as any).video_type === "string" ? ((x as any).video_type as string) : null;
        const actors = normalizePeopleField((x as any).actor ?? (x as any).actors ?? (x as any).cast);
        const directors = normalizePeopleField((x as any).director ?? (x as any).directors);
        const lastContentDate = typeof (x as any).last_content_date === "string" ? ((x as any).last_content_date as string) : null;
        const lastAddElement = typeof (x as any).last_add_element === "string" || typeof (x as any).last_add_element === "number" ? String((x as any).last_add_element) : null;

        const subsRaw = (x as any).subs;
        const subsJson = Array.isArray(subsRaw) ? (subsRaw as any[]) : null;

        const translationIframeJson =
          translationIframe && typeof translationIframe === "object" && !Array.isArray(translationIframe)
            ? (translationIframe as Record<string, unknown>)
            : null;

        const rawJson = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

        return {
          videoseed_id: videoseedId,
          kp_id: kpId,
          imdb_id: imdbId,
          tmdb_id: tmdbId,
          type: kind,
          year,
          title_rus: titleRus,
          title_orig: titleOrig,
          poster_url: posterUrl,
          iframe_url: iframeUrl,
          created_at: createdAt,
          description,
          time_raw: timeRaw,
          translation,
          translation_iframe: translationIframeJson,
          video_type: videoType,
          actors,
          directors,
          last_content_date: lastContentDate,
          last_add_element: lastAddElement,
          subs: subsJson,
          raw_json: rawJson,
          genres,
          countries,
        };
      })
      .filter((x): x is VideoseedVideoRow => x != null);

    const rowsMap = new Map<number, VideoseedVideoRow>();
    for (const r of rowsRaw) {
      const prev = rowsMap.get(r.videoseed_id);
      if (!prev) {
        rowsMap.set(r.videoseed_id, r);
        continue;
      }
      rowsMap.set(r.videoseed_id, {
        videoseed_id: r.videoseed_id,
        kp_id: pick(prev.kp_id, r.kp_id),
        imdb_id: pick(prev.imdb_id, r.imdb_id),
        tmdb_id: pick(prev.tmdb_id, r.tmdb_id),
        type: prev.type,
        year: pick(prev.year, r.year),
        title_rus: pick(prev.title_rus, r.title_rus),
        title_orig: pick(prev.title_orig, r.title_orig),
        poster_url: pick(prev.poster_url, r.poster_url),
        iframe_url: pick(prev.iframe_url, r.iframe_url),
        created_at: pick(prev.created_at, r.created_at),
        description: pick(prev.description, r.description),
        time_raw: pick(prev.time_raw, r.time_raw),
        translation: pick(prev.translation, r.translation),
        translation_iframe: pick(prev.translation_iframe, r.translation_iframe),
        video_type: pick(prev.video_type, r.video_type),
        actors: pick(prev.actors, r.actors),
        directors: pick(prev.directors, r.directors),
        last_content_date: pick(prev.last_content_date, r.last_content_date),
        last_add_element: pick(prev.last_add_element, r.last_add_element),
        subs: pick(prev.subs, r.subs),
        raw_json: pick(prev.raw_json, r.raw_json),
        genres: unionArray(prev.genres, r.genres),
        countries: unionArray(prev.countries, r.countries),
      });
    }

    const rows = Array.from(rowsMap.values());
    if (rows.length) {
      const q = buildUpsertQuery(rows);
      await dbQuery(q.text, q.params);
      upserted += rows.length;
    }

    nextPage = data.nextPage != null ? data.nextPage : itemsList.length >= safeItems ? page + 1 : null;

    if (mode === "recent") {
      if (nextPage == null || itemsList.length < safeItems) {
        done = true;
        nextPage = null;
        break;
      }
      page = nextPage;
      continue;
    }

    if (nextPage == null || itemsList.length < safeItems) {
      done = true;
      nextPage = null;
      await dbQuery(`UPDATE videoseed_sync_state SET "page" = 1, updated_at = NOW() WHERE "key" = $1;`, [kind]);
      break;
    }

    await dbQuery(`UPDATE videoseed_sync_state SET "page" = $1, updated_at = NOW() WHERE "key" = $2;`, [nextPage, kind]);
    page = nextPage;
  }

  return { scanned, upserted, nextPage, done };
}

export async function getVideoseedTaxonomyFromDb(): Promise<{ genres: string[]; countries: string[]; years: number[] }> {
  await ensureVideoseedSchema();

  const genresRes = await dbQuery<{ v: string }>(
    `SELECT DISTINCT trim(v) AS v
     FROM (
       SELECT unnest(genres) AS v
       FROM videoseed_videos
       WHERE genres IS NOT NULL
     ) t
     WHERE v IS NOT NULL AND v <> ''
     ORDER BY v ASC
     LIMIT 500;`,
  );

  const countriesRes = await dbQuery<{ v: string }>(
    `SELECT DISTINCT trim(v) AS v
     FROM (
       SELECT unnest(countries) AS v
       FROM videoseed_videos
       WHERE countries IS NOT NULL
     ) t
     WHERE v IS NOT NULL AND v <> ''
     ORDER BY v ASC
     LIMIT 500;`,
  );

  const yearsRes = await dbQuery<{ year: number }>(
    `SELECT DISTINCT year
     FROM videoseed_videos
     WHERE year IS NOT NULL
     ORDER BY year DESC
     LIMIT 120;`,
  );

  return {
    genres: genresRes.rows.map((r) => r.v).filter(Boolean),
    countries: countriesRes.rows.map((r) => r.v).filter(Boolean),
    years: yearsRes.rows.map((r) => r.year).filter((n) => Number.isFinite(n)),
  };
}

function parseSearchQuery(raw: string): { text: string; tokens: string[]; year: number | null } {
  const trimmed = String(raw ?? "").trim();
  const m = trimmed.match(/\b(19|20)\d{2}\b/);
  const year = m ? Number.parseInt(m[0], 10) : null;

  const withoutYear = year ? trimmed.replace(new RegExp(`\\b${year}\\b`, "g"), " ") : trimmed;
  const normalized = withoutYear
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const rawTokens = normalized.split(" ").map((t) => t.trim()).filter(Boolean);
  const minLen = normalized.length <= 2 ? 1 : 2;
  const tokens = rawTokens.filter((t) => t.length >= minLen).slice(0, 6);

  return { text: normalized, tokens, year: Number.isFinite(year as number) ? year : null };
}

export async function getVideoseedVideoFromDbByKpId(kpId: number): Promise<VideoseedVideoRow | null> {
  await ensureVideoseedSchema();
  const res = await dbQuery<VideoseedVideoRow>(
    `SELECT
      videoseed_id,
      kp_id,
      imdb_id,
      tmdb_id,
      type,
      year,
      title_rus,
      title_orig,
      poster_url,
      iframe_url,
      created_at,
      description,
      time_raw,
      translation,
      translation_iframe,
      video_type,
      actors,
      directors,
      last_content_date,
      last_add_element,
      subs,
      raw_json,
      genres,
      countries
     FROM videoseed_videos
     WHERE kp_id = $1
     ORDER BY created_at DESC NULLS LAST, videoseed_id DESC
     LIMIT 1;`,
    [kpId],
  );
  return res.rows[0] ?? null;
}

export async function listVideoseedCatalogFromDb({
  offset,
  limit,
  type,
  year,
  genres,
  country,
}: {
  offset: number;
  limit: number;
  type: "movie" | "serial" | null;
  year: number | null;
  genres: string[] | null;
  country: string | null;
}): Promise<{ total: number; items: VideoseedVideoRow[] }> {
  await ensureVideoseedSchema();

  const whereParts: string[] = [];
  const params: unknown[] = [];

  whereParts.push(`poster_url IS NOT NULL AND poster_url <> ''`);

  if (type) {
    params.push(type);
    whereParts.push(`type = $${params.length}`);
  }
  if (year != null) {
    params.push(year);
    whereParts.push(`year = $${params.length}`);
  }
  if (genres?.length) {
    const normalized = genres
      .map((g) => String(g ?? "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 6);
    if (normalized.length) {
      params.push(normalized);
      whereParts.push(
        `genres IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(genres) g WHERE lower(trim(g)) = ANY($${params.length}::text[]))`,
      );
    }
  }
  if (country) {
    params.push(country);
    whereParts.push(
      `countries IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(countries) c WHERE lower(trim(c)) = lower(trim($${params.length}::text)))`,
    );
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const totalRes = await dbQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM videoseed_videos ${where};`, params);
  const total = Number.parseInt(totalRes.rows[0]?.count ?? "0", 10) || 0;

  params.push(limit);
  params.push(offset);

  const rowsRes = await dbQuery<VideoseedVideoRow>(
    `SELECT
      videoseed_id,
      kp_id,
      imdb_id,
      tmdb_id,
      type,
      year,
      title_rus,
      title_orig,
      poster_url,
      iframe_url,
      created_at,
      description,
      time_raw,
      translation,
      translation_iframe,
      video_type,
      actors,
      directors,
      last_content_date,
      last_add_element,
      subs,
      raw_json,
      genres,
      countries
     FROM videoseed_videos
     ${where}
     ORDER BY created_at DESC NULLS LAST, videoseed_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length};`,
    params,
  );

  return { total, items: rowsRes.rows };
}

export async function searchVideoseedCatalogFromDb({
  query,
  offset,
  limit,
  type,
  year,
  genres,
  country,
}: {
  query: string;
  offset: number;
  limit: number;
  type: "movie" | "serial" | null;
  year: number | null;
  genres: string[] | null;
  country: string | null;
}): Promise<{ total: number; items: VideoseedVideoRow[] }> {
  await ensureVideoseedSchema();

  const parsed = parseSearchQuery(query);
  const qText = parsed.text || query;
  const qLike = `%${qText}%`;

  const whereParts: string[] = [];
  const params: unknown[] = [];

  whereParts.push(`poster_url IS NOT NULL AND poster_url <> ''`);

  let phraseParamIdx: number | null = null;
  if (qText) {
    params.push(qLike);
    phraseParamIdx = params.length;
  }

  if (parsed.tokens.length) {
    for (const tok of parsed.tokens) {
      params.push(`%${tok}%`);
      const idx = params.length;
      whereParts.push(`(title_rus ILIKE $${idx} OR title_orig ILIKE $${idx})`);
    }
  } else if (phraseParamIdx) {
    whereParts.push(`(title_rus ILIKE $${phraseParamIdx} OR title_orig ILIKE $${phraseParamIdx})`);
  }

  const effectiveYear = year != null ? year : parsed.year;
  let yearParamIdx: number | null = null;
  if (effectiveYear) {
    params.push(effectiveYear);
    yearParamIdx = params.length;
    whereParts.push(`year = $${yearParamIdx}`);
  }

  if (genres?.length) {
    const normalized = genres
      .map((g) => String(g ?? "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 6);
    if (normalized.length) {
      params.push(normalized);
      whereParts.push(
        `genres IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(genres) g WHERE lower(trim(g)) = ANY($${params.length}::text[]))`,
      );
    }
  }

  if (country) {
    params.push(country);
    whereParts.push(
      `countries IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(countries) c WHERE lower(trim(c)) = lower(trim($${params.length}::text)))`,
    );
  }

  const trgm = await hasPgTrgm();
  let trgmParamIdx: number | null = null;
  if (trgm) {
    params.push(qText);
    trgmParamIdx = params.length;
  }

  if (type) {
    params.push(type);
    whereParts.push(`type = $${params.length}`);
  }

  const where = `WHERE ${whereParts.join(" AND ")}`;

  const scoreParts: string[] = [];
  if (phraseParamIdx) {
    scoreParts.push(
      `CASE WHEN (title_rus ILIKE $${phraseParamIdx} OR title_orig ILIKE $${phraseParamIdx}) THEN 12 ELSE 0 END`,
    );
  }
  if (yearParamIdx) scoreParts.push(`5`);
  if (trgmParamIdx) {
    scoreParts.push(
      `GREATEST(similarity(coalesce(title_rus, ''), $${trgmParamIdx}), similarity(coalesce(title_orig, ''), $${trgmParamIdx})) * 10`,
    );
  }
  const scoreExpr = scoreParts.length ? scoreParts.join(" + ") : "0";

  const totalRes = await dbQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM (
       SELECT 1, (${scoreExpr}) AS score
       FROM videoseed_videos
       ${where}
     ) t;`,
    params,
  );
  const total = Number.parseInt(totalRes.rows[0]?.count ?? "0", 10) || 0;

  params.push(limit);
  params.push(offset);

  const rowsRes = await dbQuery<VideoseedVideoRow>(
    `SELECT
      videoseed_id,
      kp_id,
      imdb_id,
      tmdb_id,
      type,
      year,
      title_rus,
      title_orig,
      poster_url,
      iframe_url,
      created_at,
      description,
      time_raw,
      translation,
      translation_iframe,
      video_type,
      actors,
      directors,
      last_content_date,
      last_add_element,
      subs,
      raw_json,
      genres,
      countries
     FROM videoseed_videos
     ${where}
     ORDER BY ${scoreExpr} DESC, created_at DESC NULLS LAST, videoseed_id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length};`,
    params,
  );

  return { total, items: rowsRes.rows };
}
