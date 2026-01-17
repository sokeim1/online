import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Image from "next/image";

import { Header } from "@/components/Header";
import { SimilarVideosScroller } from "@/components/SimilarVideosScroller";
import { MoviePlayers } from "@/components/MoviePlayers";
import { PosterLightbox } from "@/components/PosterLightbox";
import { hasDatabaseUrl } from "@/lib/db";
import { getFlixcdnVideoFromDbByKpId } from "@/lib/flixcdnIndex";
import { getVibixSerialByImdbId, getVibixSerialByKpId, getVibixVideoByImdbId, getVibixVideoByKpId } from "@/lib/vibix";
import { flixcdnSearch, parseFlixcdnInt, parseFlixcdnYear } from "@/lib/flixcdn";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath, parseKpIdFromMovieParam } from "@/lib/movieUrl";

export const runtime = "nodejs";
export const revalidate = 3600;

function parseFlixcdnDurationToMinutes(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const parts = s.split(":").map((p) => p.trim());
  if (parts.length === 2) {
    const a = Number.parseInt(parts[0], 10);
    const b = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a <= 0 && b <= 0) return null;
    if (a >= 10) {
      return a;
    }
    return a * 60 + b;
  }

  const m = s.match(/\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

function pickTitle(v: {
  name: string;
  name_rus: string | null;
  name_eng: string | null;
}): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

function guessTitleFromMovieParam(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const cleaned = s
    .replace(/\.html$/i, "")
    .replace(/^\d+-/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

export async function generateMetadata(
  { params }: { params: Promise<{ kpId: string }> },
): Promise<Metadata> {
  const { kpId: kpIdRaw } = await params;
  const id = parseKpIdFromMovieParam(kpIdRaw);
  if (!id) {
    return { title: "Doramy Online - Смотри бесплатно дорамы и сериалы" };
  }

  try {
    let video: any;
    try {
      video = await getVibixVideoByKpId(id);
    } catch {
      if (hasDatabaseUrl()) {
        const row = await getFlixcdnVideoFromDbByKpId(id).catch(() => null);
        if (row) {
          video = {
            name: row.title_rus ?? row.title_orig ?? "",
            name_rus: row.title_rus,
            name_eng: row.title_orig,
            year: row.year,
            description: null,
            description_short: null,
            poster_url: row.poster_url,
            backdrop_url: null,
          };
        }
      }

      if (video) {
        const title = pickTitle(video);
        const year = video.year ? ` (${video.year})` : "";
        const fullTitle = `${title}${year} — смотреть онлайн`;
        const description =
          video.description_short ??
          video.description ??
          "Смотри бесплатно дорамы и сериалы онлайн на Doramy Online";

        const images = [video.backdrop_url, video.poster_url]
          .filter(Boolean)
          .map((url) => ({ url: url as string }));

        const canonical = movieSlugHtmlPath(id, title);

        return {
          title: fullTitle,
          description,
          alternates: {
            canonical,
          },
          openGraph: {
            title: fullTitle,
            description,
            type: "video.movie",
            images,
          },
          twitter: {
            card: "summary_large_image",
            title: fullTitle,
            description,
            images: images.map((i) => i.url),
          },
        };
      }

      let first: any = null;
      try {
        const fl = await flixcdnSearch({ kinopoisk_id: id, limit: 5, offset: 0 });
        first = fl.result?.find((x) => parseFlixcdnInt(x.kinopoisk_id) === id) ?? fl.result?.[0] ?? null;
      } catch {
      }

      if (!first) {
        const guess = guessTitleFromMovieParam(kpIdRaw);
        if (guess) {
          const fl2 = await flixcdnSearch({ title: guess, limit: 15, offset: 0 });
          first = fl2.result?.find((x) => parseFlixcdnInt(x.kinopoisk_id) === id) ?? fl2.result?.[0] ?? null;
        }
      }

      if (!first) {
        return { title: "Doramy Online - Смотри бесплатно дорамы и сериалы" };
      }
      video = {
        name: first.title_rus ?? first.title_orig ?? "",
        name_rus: first.title_rus ?? null,
        name_eng: first.title_orig ?? null,
        year: parseFlixcdnYear(first.year),
        description: first.description ?? null,
        description_short: null,
        poster_url: typeof first.poster === "string" ? first.poster : null,
        backdrop_url: null,
      };
    }

    const title = pickTitle(video);
    const year = video.year ? ` (${video.year})` : "";
    const fullTitle = `${title}${year} — смотреть онлайн`;
    const description =
      video.description_short ??
      video.description ??
      "Смотри бесплатно дорамы и сериалы онлайн на Doramy Online";

    const images = [video.backdrop_url, video.poster_url]
      .filter(Boolean)
      .map((url) => ({ url: url as string }));

    const canonical = movieSlugHtmlPath(id, title);

    return {
      title: fullTitle,
      description,
      alternates: {
        canonical,
      },
      openGraph: {
        title: fullTitle,
        description,
        type: "video.movie",
        images,
      },
      twitter: {
        card: "summary_large_image",
        title: fullTitle,
        description,
        images: images.map((i) => i.url),
      },
    };
  } catch {
    return { title: "Doramy Online - Смотри бесплатно дорамы и сериалы" };
  }
}

export default async function MoviePage({
  params,
}: {
  params: Promise<{ kpId: string }>;
}) {
  const { kpId: kpIdRaw } = await params;
  const id = parseKpIdFromMovieParam(kpIdRaw);

  if (!id) {
    notFound();
  }

  type MovieVideo = {
    id: number;
    name: string;
    name_rus: string | null;
    name_eng: string | null;
    name_original: string | null;
    type: "movie" | "serial";
    year: number | null;
    kp_id: number | null;
    imdb_id: string | null;
    kp_rating: number | null;
    imdb_rating: number | null;
    slogan: string | null;
    age: string | null;
    iframe_url: string;
    poster_url: string | null;
    backdrop_url: string | null;
    duration: number | null;
    quality: string;
    genre: string[] | null;
    country: string[] | null;
    description: string | null;
    description_short: string | null;
    voiceovers: Array<{ id: number; name: string }> | null;
    tags: unknown[] | null;
    uploaded_at: string | null;
  };

  let video: MovieVideo | null = null;
  let vibixVideo: Awaited<ReturnType<typeof getVibixVideoByKpId>> | null = null;
  try {
    vibixVideo = await getVibixVideoByKpId(id);
    video = {
      ...(vibixVideo as unknown as MovieVideo),
      slogan: null,
      age: null,
    };
  } catch {
    if (hasDatabaseUrl()) {
      const row = await getFlixcdnVideoFromDbByKpId(id).catch(() => null);
      if (row) {
        video = {
          id: Number(row.flixcdn_id),
          name: row.title_rus ?? row.title_orig ?? "",
          name_rus: row.title_rus,
          name_eng: row.title_orig,
          name_original: row.title_orig,
          type: row.type,
          year: row.year,
          kp_id: row.kp_id,
          imdb_id: row.imdb_id,
          kp_rating: null,
          imdb_rating: null,
          slogan: null,
          age: null,
          iframe_url: row.iframe_url ?? "",
          poster_url: row.poster_url,
          backdrop_url: null,
          duration: null,
          quality: row.quality ?? "",
          genre: row.genres,
          country: row.countries,
          description: null,
          description_short: null,
          voiceovers: null,
          tags: null,
          uploaded_at: row.created_at,
        };
      }
    }

    if (!video) {
      let first: any = null;
      try {
        const fl = await flixcdnSearch({ kinopoisk_id: id, limit: 5, offset: 0 });
        first = fl.result?.find((x) => parseFlixcdnInt(x.kinopoisk_id) === id) ?? fl.result?.[0] ?? null;
      } catch {
        first = null;
      }

      if (!first) {
        const guess = guessTitleFromMovieParam(kpIdRaw);
        if (guess) {
          try {
            const fl2 = await flixcdnSearch({ title: guess, limit: 15, offset: 0 });
            first = fl2.result?.find((x) => parseFlixcdnInt(x.kinopoisk_id) === id) ?? fl2.result?.[0] ?? null;
          } catch {
            first = null;
          }
        }
      }

      if (!first) notFound();

      video = {
        id: first.id,
        name: first.title_rus ?? first.title_orig ?? "",
        name_rus: first.title_rus ?? null,
        name_eng: first.title_orig ?? null,
        name_original: first.title_orig ?? null,
        type: first.type === "serial" ? "serial" : "movie",
        year: parseFlixcdnYear(first.year),
        kp_id: parseFlixcdnInt(first.kinopoisk_id),
        imdb_id: typeof first.imdb_id === "string" ? first.imdb_id : null,
        kp_rating: null,
        imdb_rating: null,
        slogan: typeof first.slogan === "string" ? first.slogan : null,
        age: typeof first.age === "string" ? first.age : null,
        iframe_url: typeof first.iframe_url === "string" ? first.iframe_url : "",
        poster_url: typeof first.poster === "string" ? first.poster : null,
        backdrop_url: null,
        duration: parseFlixcdnDurationToMinutes(first.duration),
        quality: typeof first.quality === "string" ? first.quality : "",
        genre: Array.isArray(first.genres) ? first.genres : null,
        country: Array.isArray(first.countries) ? first.countries : null,
        description: first.description ?? null,
        description_short: null,
        voiceovers: Array.isArray(first.translations)
          ? first.translations
              .map((t: { id?: unknown; title?: unknown }) => ({
                id: Number.parseInt(String(t.id), 10) || 0,
                name: String(t.title ?? "").trim(),
              }))
              .filter((t: { id: number; name: string }) => t.name)
          : null,
        tags: null,
        uploaded_at: typeof first.created_at === "string" ? first.created_at : null,
      };
    }
  }

  if (!video) notFound();

  // Enrich details for DB/FlixCDN fallbacks:
  // - ratings & richer metadata from Vibix by imdb_id (when kp lookup fails)
  // - slogan/age/description/duration from FlixCDN by kp_id or imdb_id
  if (!vibixVideo) {
    const imdb = String(video.imdb_id ?? "").trim();
    if (/^tt\d+$/i.test(imdb)) {
      vibixVideo = await getVibixVideoByImdbId(imdb).catch(() => null);
      if (vibixVideo) {
        // keep the already resolved player urls / IDs, but hydrate missing fields
        video = {
          ...video,
          kp_id: video.kp_id ?? vibixVideo.kp_id ?? vibixVideo.kinopoisk_id ?? null,
          imdb_id: video.imdb_id ?? vibixVideo.imdb_id ?? null,
          kp_rating: (video as any).kp_rating ?? vibixVideo.kp_rating ?? null,
          imdb_rating: (video as any).imdb_rating ?? vibixVideo.imdb_rating ?? null,
          description: video.description ?? vibixVideo.description ?? null,
          description_short: video.description_short ?? vibixVideo.description_short ?? null,
          genre: video.genre ?? vibixVideo.genre ?? null,
          country: video.country ?? vibixVideo.country ?? null,
          duration: video.duration ?? vibixVideo.duration ?? null,
          poster_url: video.poster_url ?? vibixVideo.poster_url ?? null,
          backdrop_url: video.backdrop_url ?? vibixVideo.backdrop_url ?? null,
          name_rus: video.name_rus ?? vibixVideo.name_rus ?? null,
          name_eng: video.name_eng ?? vibixVideo.name_eng ?? null,
          name_original: video.name_original ?? vibixVideo.name_original ?? null,
          year: video.year ?? vibixVideo.year ?? null,
        };
      }
    }
  }

  if (video.slogan == null || video.age == null || video.description == null || video.duration == null) {
    const imdb = String(video.imdb_id ?? "").trim();
    const wantByImdb = /^tt\d+$/i.test(imdb);
    try {
      const fl = await flixcdnSearch(
        wantByImdb ? { imdb_id: imdb, limit: 5, offset: 0 } : { kinopoisk_id: id, limit: 5, offset: 0 },
        { timeoutMs: 6000, attempts: 2 },
      );
      const first =
        fl.result?.find((x) => parseFlixcdnInt(x.kinopoisk_id) === id) ??
        (wantByImdb ? fl.result?.find((x) => String(x.imdb_id ?? "").toLowerCase() === imdb.toLowerCase()) : null) ??
        fl.result?.[0] ??
        null;

      if (first) {
        video = {
          ...video,
          slogan: video.slogan ?? (typeof first.slogan === "string" ? first.slogan : null),
          age: video.age ?? (typeof first.age === "string" ? first.age : null),
          description: video.description ?? (first.description ?? null),
          duration: video.duration ?? parseFlixcdnDurationToMinutes(first.duration),
          name_eng: video.name_eng ?? (first.title_orig ?? null),
          name_original: video.name_original ?? (first.title_orig ?? null),
        };
      }
    } catch {
    }
  }

  const title = pickTitle(video);
  const canonicalPath = movieSlugHtmlPath(id, title);
  const canonicalParam = canonicalPath.replace(/^\/movie\//, "");
  if (kpIdRaw !== canonicalParam) {
    permanentRedirect(canonicalPath);
  }
  const description = video.description_short ?? video.description ?? null;
  const posterSrc = proxyImageUrl(video.poster_url);
  const backdropSrc = proxyImageUrl(video.backdrop_url);
  const primaryCountry = video.country?.filter(Boolean)?.[0] ?? null;
  const primaryGenre = video.genre?.filter(Boolean)?.[0] ?? null;
  const genres = video.genre?.filter(Boolean) ?? null;
  const voiceoverNames = (video.voiceovers ?? []).map((v) => v.name).filter(Boolean);
  const voiceoverText = voiceoverNames.slice(0, 3).join(", ");
  const hasMoreVoiceovers = voiceoverNames.length > 3;

  function parseRating(raw: unknown): number | null {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const s = raw.trim().replace(/,/g, ".");
      const m = s.match(/-?\d+(?:\.\d+)?/);
      if (!m) return null;
      const n = Number.parseFloat(m[0]);
      return Number.isFinite(n) ? n : null;
    }
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      return (
        parseRating(r.rating) ??
        parseRating(r.value) ??
        parseRating(r.score) ??
        parseRating(r.kp_rating) ??
        parseRating(r.imdb_rating)
      );
    }
    return null;
  }

  const kpRating = parseRating((video as unknown as { kp_rating?: unknown }).kp_rating);
  const imdbRating = parseRating((video as unknown as { imdb_rating?: unknown }).imdb_rating);

  const structuredRating = kpRating ?? imdbRating;

  function parseFirstNumber(raw: string | null | undefined): number | null {
    const s = String(raw ?? "");
    const m = s.match(/\d+/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  function isNumericLabel(raw: string | null | undefined): boolean {
    const s = String(raw ?? "").trim();
    return !!s && /^\d+$/.test(s);
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": video.type === "serial" ? "TVSeries" : "Movie",
    name: title,
    alternateName: [video.name_original, video.name_eng, video.name_rus].filter(Boolean),
    description: description ?? undefined,
    image: [video.poster_url, video.backdrop_url].filter(Boolean),
    datePublished: video.year ? `${video.year}-01-01` : undefined,
    aggregateRating:
      structuredRating != null
        ? {
            "@type": "AggregateRating",
            ratingValue: structuredRating,
            bestRating: 10,
            ratingCount: 1,
          }
        : undefined,
  };

  const serialInfo =
    vibixVideo && video.type === "serial"
      ? await (vibixVideo.imdb_id ? getVibixSerialByImdbId(vibixVideo.imdb_id).catch(() => null) : getVibixSerialByKpId(id).catch(() => null))
      : null;

  const episodesCount =
    video.type === "serial" && serialInfo?.seasons?.length
      ? serialInfo.seasons.reduce((acc, s) => acc + (s.series?.length ?? 0), 0)
      : null;

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />

      <main className="mx-auto w-full max-w-6xl px-3 pb-14 pt-4 sm:px-4 sm:pb-20 sm:pt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
            ← Назад к каталогу
          </Link>
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface)] sm:mt-6">
          <div className="relative">
            <div className="relative h-52 w-full bg-gradient-to-br from-[color:var(--accent-soft)] via-transparent to-transparent sm:h-64">
              {backdropSrc ? (
                <Image
                  src={backdropSrc}
                  alt={title}
                  fill
                  unoptimized
                  className="object-cover opacity-60"
                  sizes="(min-width: 640px) 1024px, 100vw"
                />
              ) : null}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--background)] via-[color:var(--background)]/30 to-transparent" />
          </div>

          <div className="px-3 pb-6 pt-4 sm:px-6 sm:pb-8 sm:pt-6">
            <div className="grid gap-4 sm:gap-6 md:grid-cols-[260px_1fr]">
              <div className="relative mx-auto aspect-[2/3] w-full max-w-[230px] shrink-0 overflow-hidden rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] shadow-[0_20px_60px_rgba(0,0,0,0.55)] md:mx-0 md:max-w-[260px]">
                {posterSrc ? (
                  <>
                    <Image
                      src={posterSrc}
                      alt={title}
                      fill
                      sizes="(min-width: 768px) 260px, 70vw"
                      unoptimized
                      className="object-cover"
                    />
                    <PosterLightbox src={posterSrc} alt={title} />
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-[color:var(--muted)]">
                    Нет постера
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                  {title}
                  {video.year ? ` (${video.year})` : ""}
                </h1>

                <div className="mt-4 space-y-2 text-sm text-[color:var(--foreground)]">
                  <div className="grid gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm sm:p-4">
                    <div className="flex flex-wrap gap-x-8 gap-y-1">
                      {primaryCountry ? (
                        <div>
                          <span className="text-[color:var(--muted)]">Страна:</span>{" "}
                          <span className="text-[color:var(--foreground)]">{primaryCountry}</span>
                        </div>
                      ) : null}
                      {video.year ? (
                        <div>
                          <span className="text-[color:var(--muted)]">Год:</span>{" "}
                          <span className="text-[color:var(--foreground)]">{video.year}</span>
                        </div>
                      ) : null}
                      {video.genre?.length ? (
                        <div>
                          <span className="text-[color:var(--muted)]">Жанры:</span>{" "}
                          <span className="text-[color:var(--foreground)]">{video.genre.join(", ")}</span>
                        </div>
                      ) : null}
                    </div>

                    {video.name_eng && video.name_rus && video.name_eng !== video.name_rus ? (
                      <div>
                        <span className="text-[color:var(--muted)]">Оригинальное название:</span>{" "}
                        <span className="text-[color:var(--foreground)]">{video.name_eng}</span>
                      </div>
                    ) : null}

                    {video.slogan ? (
                      <div>
                        <span className="text-[color:var(--muted)]">Слоган:</span>{" "}
                        <span className="text-[color:var(--foreground)]">{video.slogan}</span>
                      </div>
                    ) : null}

                    {video.age ? (
                      <div>
                        <span className="text-[color:var(--muted)]">Возраст:</span>{" "}
                        <span className="text-[color:var(--foreground)]">{video.age}</span>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-x-8 gap-y-1">
                      {video.type !== "serial" && video.duration ? (
                        <div>
                          <span className="text-[color:var(--muted)]">Время:</span>{" "}
                          <span className="text-[color:var(--foreground)]">{video.duration} мин</span>
                        </div>
                      ) : null}
                      <div>
                        <span className="text-[color:var(--muted)]">Тип:</span>{" "}
                        <span className="text-[color:var(--foreground)]">
                          {video.type === "serial" ? "Сериал" : "Фильм"}
                        </span>
                      </div>
                      {video.type === "serial" && episodesCount != null ? (
                        <div>
                          <span className="text-[color:var(--muted)]">Серий:</span>{" "}
                          <span className="text-[color:var(--foreground)]">{episodesCount}</span>
                        </div>
                      ) : null}
                    </div>

                    {kpRating != null || imdbRating != null ? (
                      <div className="flex flex-wrap gap-3 pt-2">
                        {kpRating != null ? (
                          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-2">
                            <div className="text-[10px] text-[color:var(--muted)]">Кинопоиск</div>
                            <div className="text-sm font-semibold text-[color:var(--foreground)]">{kpRating}</div>
                          </div>
                        ) : null}
                        {imdbRating != null ? (
                          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-2">
                            <div className="text-[10px] text-[color:var(--muted)]">IMDb</div>
                            <div className="text-sm font-semibold text-[color:var(--foreground)]">{imdbRating}</div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {voiceoverText ? (
                      <div className="pt-2 text-sm">
                        <span className="text-[color:var(--muted)]">Озвучка:</span>{" "}
                        <span className="text-[color:var(--foreground)]">
                          {voiceoverText}
                          {hasMoreVoiceovers ? "…" : ""}
                        </span>
                        <span className="ml-2 text-xs text-[color:var(--muted)]">Все</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-6">
                  <details className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 sm:p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-[color:var(--foreground)]">
                      Описание
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--muted)]">
                      {video.description ?? video.description_short ?? "Описание отсутствует"}
                    </p>
                  </details>
                </div>
              </div>
            </div>

            <section className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[color:var(--foreground)]">Просмотр</h2>
              </div>
              <div className="mt-3">
                <MoviePlayers
                  storageKey={`movie_player_${id}`}
                  kpId={id}
                  title={title}
                  year={video.year}
                  imdbId={video.imdb_id}
                  vibix={
                    vibixVideo
                      ? {
                          publisherId: "676077867",
                          type: video.type === "serial" ? "series" : "movie",
                          id: String(video.id),
                          fallbackIframeUrl: video.iframe_url,
                          posterSrc,
                        }
                      : undefined
                  }
                />
              </div>
            </section>

            {serialInfo?.seasons?.length ? (
              <section className="mt-8">
                <details className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[color:var(--foreground)]">
                    Сезоны и серии
                  </summary>
                  <div className="mt-4 space-y-3">
                    {serialInfo.seasons.map((s) => (
                      <details
                        key={s.name}
                        className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
                      >
                        <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                          {(() => {
                            const sn = parseFirstNumber(s.name);
                            return sn ? `Сезон ${sn}` : s.name;
                          })()}
                        </summary>
                        <div className="mt-3 grid grid-cols-1 gap-2">
                          {(s.series ?? []).map((ep, idx) => (
                            <div
                              key={ep.id}
                              className="flex items-start justify-between gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2"
                            >
                              {(() => {
                                const epNum = parseFirstNumber(ep.name) ?? idx + 1;
                                const rawName = String(ep.name ?? "").trim();
                                const showTitle = rawName && !isNumericLabel(rawName);
                                return (
                                  <>
                                    <div className="shrink-0 text-xs text-[color:var(--muted)]">Серия {epNum}</div>
                                    <div className="min-w-0 text-xs text-[color:var(--foreground)]">
                                      {showTitle ? rawName : null}
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              </section>
            ) : null}

            <SimilarVideosScroller
              genres={genres}
              seedTitle={title}
              year={video.year}
              country={primaryCountry}
              type={video.type}
              excludeKpId={id}
              title="Популярные фильмы"
              mode="popular"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
