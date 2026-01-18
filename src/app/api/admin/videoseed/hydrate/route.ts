import { NextResponse } from "next/server";

import { dbQuery, hasDatabaseUrl } from "@/lib/db";
import { parseVideoseedYear, splitCommaList, videoseedFindByKpId } from "@/lib/videoseed";
import { ensureVideoseedSchema } from "@/lib/videoseedIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const kpIdRaw = (searchParams.get("kpId") ?? searchParams.get("kp") ?? "").trim();
  const kpIdParsed = kpIdRaw ? Number.parseInt(kpIdRaw, 10) : NaN;

  const kpId = Number.isFinite(kpIdParsed)
    ? kpIdParsed
    : (
        await dbQuery<{ kp_id: number }>(
          `SELECT kp_id
           FROM videoseed_videos
           WHERE kp_id IS NOT NULL
           ORDER BY updated_at DESC NULLS LAST, videoseed_id DESC
           LIMIT 1;`,
        ).then((r) => r.rows[0]?.kp_id ?? null)
      );

  if (!kpId) {
    return NextResponse.json({ success: false, message: "Missing kpId (and no kp_id found in DB)" }, { status: 400 });
  }

  const before = await dbQuery(
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
      countries,
      updated_at
     FROM videoseed_videos
     WHERE kp_id = $1
     ORDER BY created_at DESC NULLS LAST, videoseed_id DESC
     LIMIT 1;`,
    [kpId],
  ).then((r) => r.rows[0] ?? null);

  const found = await videoseedFindByKpId(kpId, { timeoutMs: 8000, attempts: 2 });
  if (!found) {
    return NextResponse.json({ success: false, message: `Videoseed item not found for kpId=${kpId}` }, { status: 404 });
  }

  const x = found.item as any;
  const videoseedId = parseIntLoose(x.id);
  if (!videoseedId) {
    return NextResponse.json({ success: false, message: `Videoseed item has no valid id for kpId=${kpId}` }, { status: 502 });
  }

  const translationIframe = x.translation_iframe;
  const translationIframeJson =
    translationIframe && typeof translationIframe === "object" && !Array.isArray(translationIframe)
      ? (translationIframe as Record<string, unknown>)
      : null;

  const subsRaw = x.subs;
  const subsJson = Array.isArray(subsRaw) ? (subsRaw as any[]) : null;

  const rawJson = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

  const row = {
    videoseed_id: videoseedId,
    kp_id: parseIntLoose(x.id_kp) ?? kpId,
    imdb_id: typeof x.id_imdb === "string" ? (x.id_imdb as string) : null,
    tmdb_id: typeof x.id_tmdb === "string" || typeof x.id_tmdb === "number" ? String(x.id_tmdb) : null,
    type: found.kind,
    year: parseVideoseedYear(x.year),
    title_rus: typeof x.name === "string" ? (x.name as string) : null,
    title_orig: typeof x.original_name === "string" ? (x.original_name as string) : null,
    poster_url: typeof x.poster === "string" ? (x.poster as string) : null,
    iframe_url: typeof x.iframe === "string" ? (x.iframe as string) : null,
    created_at: typeof x.date === "string" ? (x.date as string) : null,
    description: typeof x.description === "string" ? (x.description as string) : null,
    time_raw: typeof x.time === "string" || typeof x.time === "number" ? String(x.time) : null,
    translation: typeof x.translation === "string" ? (x.translation as string) : null,
    translation_iframe: translationIframeJson,
    video_type: typeof x.video_type === "string" ? (x.video_type as string) : null,
    actors: normalizePeopleField(x.actor ?? x.actors ?? x.cast),
    directors: normalizePeopleField(x.director ?? x.directors),
    last_content_date: typeof x.last_content_date === "string" ? (x.last_content_date as string) : null,
    last_add_element:
      typeof x.last_add_element === "string" || typeof x.last_add_element === "number" ? String(x.last_add_element) : null,
    subs: subsJson,
    raw_json: rawJson,
    genres: splitCommaList(x.genre),
    countries: splitCommaList(x.country),
  };

  await dbQuery(
    `INSERT INTO videoseed_videos (
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
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
    )
    ON CONFLICT (videoseed_id) DO UPDATE SET
      kp_id = EXCLUDED.kp_id,
      imdb_id = EXCLUDED.imdb_id,
      tmdb_id = EXCLUDED.tmdb_id,
      type = EXCLUDED.type,
      year = EXCLUDED.year,
      title_rus = EXCLUDED.title_rus,
      title_orig = EXCLUDED.title_orig,
      poster_url = EXCLUDED.poster_url,
      iframe_url = EXCLUDED.iframe_url,
      created_at = EXCLUDED.created_at,
      description = EXCLUDED.description,
      time_raw = EXCLUDED.time_raw,
      translation = EXCLUDED.translation,
      translation_iframe = EXCLUDED.translation_iframe,
      video_type = EXCLUDED.video_type,
      actors = EXCLUDED.actors,
      directors = EXCLUDED.directors,
      last_content_date = EXCLUDED.last_content_date,
      last_add_element = EXCLUDED.last_add_element,
      subs = EXCLUDED.subs,
      raw_json = EXCLUDED.raw_json,
      genres = EXCLUDED.genres,
      countries = EXCLUDED.countries,
      updated_at = NOW();`,
    [
      row.videoseed_id,
      row.kp_id,
      row.imdb_id,
      row.tmdb_id,
      row.type,
      row.year,
      row.title_rus,
      row.title_orig,
      row.poster_url,
      row.iframe_url,
      row.created_at,
      row.description,
      row.time_raw,
      row.translation,
      row.translation_iframe,
      row.video_type,
      row.actors,
      row.directors,
      row.last_content_date,
      row.last_add_element,
      row.subs,
      row.raw_json,
      row.genres,
      row.countries,
    ],
  );

  const after = await dbQuery(
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
      countries,
      updated_at
     FROM videoseed_videos
     WHERE videoseed_id = $1
     LIMIT 1;`,
    [videoseedId],
  ).then((r) => r.rows[0] ?? null);

  const descriptionSample = typeof x.description === "string" ? x.description.slice(0, 160) : null;

  return NextResponse.json({
    success: true,
    kpId,
    kind: found.kind,
    videoseedId,
    upstream: {
      hasDescription: typeof x.description === "string" && x.description.trim().length > 0,
      descriptionSample,
      hasActors: normalizePeopleField(x.actor ?? x.actors ?? x.cast) != null,
      hasDirectors: normalizePeopleField(x.director ?? x.directors) != null,
      keys: rawJson ? Object.keys(rawJson).slice(0, 60) : [],
    },
    before,
    after,
  });
}
