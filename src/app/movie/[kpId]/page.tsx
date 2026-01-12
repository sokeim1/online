import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Image from "next/image";

import { Header } from "@/components/Header";
import { MovieSearchBar } from "@/components/MovieSearchBar";
import { SimilarVideosScroller } from "@/components/SimilarVideosScroller";
import { getVibixSerialByKpId, getVibixVideoByKpId } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath, parseKpIdFromMovieParam } from "@/lib/movieUrl";

export const runtime = "nodejs";
export const revalidate = 3600;

function pickTitle(v: {
  name: string;
  name_rus: string | null;
  name_eng: string | null;
}): string {
  return v.name_rus ?? v.name_eng ?? v.name;
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
    const video = await getVibixVideoByKpId(id);
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

  let video;
  try {
    video = await getVibixVideoByKpId(id);
  } catch {
    notFound();
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
  const voiceoverNames = (video.voiceovers ?? []).map((v) => v.name).filter(Boolean);
  const voiceoverText = voiceoverNames.slice(0, 3).join(", ");
  const hasMoreVoiceovers = voiceoverNames.length > 3;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": video.type === "serial" ? "TVSeries" : "Movie",
    name: title,
    alternateName: [video.name_original, video.name_eng, video.name_rus].filter(Boolean),
    description: description ?? undefined,
    image: [video.poster_url, video.backdrop_url].filter(Boolean),
    datePublished: video.year ? `${video.year}-01-01` : undefined,
    aggregateRating:
      video.kp_rating || video.imdb_rating
        ? {
            "@type": "AggregateRating",
            ratingValue: (video.kp_rating ?? video.imdb_rating) as number,
            bestRating: 10,
            ratingCount: 1,
          }
        : undefined,
  };

  const serialInfo =
    video.type === "serial"
      ? await getVibixSerialByKpId(id).catch(() => null)
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

      <main className="mx-auto w-full max-w-6xl px-4 pb-14 pt-5 sm:pb-20 sm:pt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
            ← Назад к каталогу
          </Link>

          <div className="w-full sm:w-[520px]">
            <MovieSearchBar />
          </div>
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

          <div className="px-5 pb-7 pt-5 sm:px-6 sm:pb-8 sm:pt-6">
            <div className="grid gap-6 md:grid-cols-[260px_1fr]">
              <div className="">
                <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]">
                  {posterSrc ? (
                    <Image
                      src={posterSrc}
                      alt={title}
                      width={520}
                      height={780}
                      unoptimized
                      className="h-auto w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[2/3] w-full items-center justify-center text-xs text-[color:var(--muted)]">
                      Нет постера
                    </div>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                  {title}
                  {video.year ? ` (${video.year})` : ""}
                </h1>

                <div className="mt-4 space-y-2 text-sm text-[color:var(--foreground)]">
                  <div>
                    <span className="text-[color:var(--muted)]">{primaryCountry ?? "—"}</span>
                    {video.year ? <span className="text-[color:var(--muted)]">, {video.year}</span> : null}
                  </div>

                  <div className="text-[color:var(--muted)]">
                    {video.genre?.length ? video.genre.join(", ") : "Жанры: —"}
                  </div>

                  <div className="grid gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
                    <div className="flex flex-wrap gap-x-8 gap-y-1">
                      <div>
                        <span className="text-[color:var(--muted)]">Время:</span>{" "}
                        <span className="text-[color:var(--foreground)]">
                          {video.duration ? `${video.duration} мин` : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[color:var(--muted)]">Тип:</span>{" "}
                        <span className="text-[color:var(--foreground)]">
                          {video.type === "serial" ? "Сериал" : "Фильм"}
                        </span>
                      </div>
                      {video.type === "serial" ? (
                        <div>
                          <span className="text-[color:var(--muted)]">Серий:</span>{" "}
                          <span className="text-[color:var(--foreground)]">{episodesCount ?? "—"}</span>
                        </div>
                      ) : null}
                      <div>
                        <span className="text-[color:var(--muted)]">Качество:</span>{" "}
                        <span className="text-[color:var(--foreground)]">{video.quality}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 pt-2">
                      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-2">
                        <div className="text-[10px] text-[color:var(--muted)]">Кинопоиск</div>
                        <div className="text-sm font-semibold text-[color:var(--foreground)]">{video.kp_rating ?? "—"}</div>
                      </div>
                      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-2">
                        <div className="text-[10px] text-[color:var(--muted)]">IMDb</div>
                        <div className="text-sm font-semibold text-[color:var(--foreground)]">{video.imdb_rating ?? "—"}</div>
                      </div>
                    </div>

                    <div className="pt-2 text-sm">
                      <span className="text-[color:var(--muted)]">Озвучка:</span>{" "}
                      <span className="text-[color:var(--foreground)]">
                        {voiceoverText || "—"}
                        {hasMoreVoiceovers ? "…" : ""}
                      </span>
                      <span className="ml-2 text-xs text-[color:var(--muted)]">Все</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  {video.description || video.description_short ? (
                    <p className="whitespace-pre-wrap text-sm leading-7 text-[color:var(--muted)]">
                      {video.description ?? video.description_short}
                    </p>
                  ) : (
                    <p className="text-sm text-[color:var(--muted)]">Описание отсутствует.</p>
                  )}
                </div>
              </div>
            </div>

            <section className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[color:var(--foreground)]">Просмотр</h2>
              </div>
              <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-black">
                <div className="relative aspect-video w-full">
                  <iframe
                    src={video.iframe_url}
                    className="absolute inset-0 h-full w-full"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    title={title}
                  />
                </div>
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
                          {s.name}
                        </summary>
                        <div className="mt-3 grid grid-cols-1 gap-2">
                          {(s.series ?? []).map((ep) => (
                            <div
                              key={ep.id}
                              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--muted)]"
                            >
                              {ep.name}
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              </section>
            ) : null}

            <SimilarVideosScroller genre={primaryGenre} excludeKpId={id} title="Похожие" />
          </div>
        </div>
      </main>
    </div>
  );
}
