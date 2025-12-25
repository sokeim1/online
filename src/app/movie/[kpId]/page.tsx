import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Header } from "@/components/Header";
import { getVibixSerialByKpId, getVibixVideoByKpId } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickTitle(v: {
  name: string;
  name_rus: string | null;
  name_eng: string | null;
  name_original: string | null;
}): string {
  return v.name_rus ?? v.name_eng ?? v.name_original ?? v.name;
}

export async function generateMetadata(
  { params }: { params: Promise<{ kpId: string }> },
): Promise<Metadata> {
  const { kpId } = await params;
  const id = Number(kpId);
  if (!Number.isFinite(id)) {
    return { title: "Doramy Online - Смотри бесплатно фильмы" };
  }

  try {
    const video = await getVibixVideoByKpId(id);
    const title = pickTitle(video);
    const year = video.year ? ` (${video.year})` : "";
    const fullTitle = `${title}${year} — смотреть онлайн`;
    const description =
      video.description_short ??
      video.description ??
      "Смотри бесплатно фильмы и сериалы онлайн на Doramy Online";

    const images = [video.backdrop_url, video.poster_url]
      .filter(Boolean)
      .map((url) => ({ url: url as string }));

    return {
      title: fullTitle,
      description,
      alternates: {
        canonical: `/movie/${id}`,
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
    return { title: "Doramy Online - Смотри бесплатно фильмы" };
  }
}

export default async function MoviePage({
  params,
}: {
  params: Promise<{ kpId: string }>;
}) {
  const { kpId } = await params;
  const id = Number(kpId);

  if (!Number.isFinite(id)) {
    notFound();
  }

  let video;
  try {
    video = await getVibixVideoByKpId(id);
  } catch {
    notFound();
  }

  const title = pickTitle(video);
  const description = video.description_short ?? video.description ?? null;
  const posterSrc = proxyImageUrl(video.poster_url);
  const backdropSrc = proxyImageUrl(video.backdrop_url);

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

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />

      <main className="mx-auto w-full max-w-6xl px-4 pb-14 pt-5 sm:pb-20 sm:pt-8">
        <Link href="/" className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
          ← Назад к каталогу
        </Link>

        <div className="mt-5 overflow-hidden rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface)] sm:mt-6">
          <div className="relative">
            <div className="h-56 w-full bg-gradient-to-br from-[color:var(--accent-soft)] via-transparent to-transparent sm:h-72">
              {backdropSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={backdropSrc}
                  alt={title}
                  className="h-full w-full object-cover opacity-70"
                />
              ) : null}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--background)] via-[color:var(--background)]/20 to-transparent" />

            <div className="relative -mt-24 flex flex-col gap-6 px-5 pb-6 sm:-mt-28 sm:flex-row sm:items-end sm:px-6">
              <div className="w-40 shrink-0 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] sm:w-56">
                {posterSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={posterSrc}
                    alt={title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center text-xs text-[color:var(--muted)]">
                    Нет постера
                  </div>
                )}
              </div>

              <div className="flex-1 pb-2">
                <h1 className="text-balance text-3xl font-semibold tracking-tight">
                  {title}
                </h1>
                {video.name_original ? (
                  <div className="mt-1 text-sm text-[color:var(--muted)]">{video.name_original}</div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[color:var(--muted)]">
                  {video.year ? (
                    <span className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1">
                      {video.year}
                    </span>
                  ) : null}
                  <span className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1">
                    {video.type === "movie" ? "Фильм" : "Сериал"}
                  </span>
                  <span className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1">
                    {video.quality}
                  </span>
                  {video.duration ? (
                    <span className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1">
                      {video.duration} мин
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3">
                    <div className="text-xs text-[color:var(--muted)]">Кинопоиск</div>
                    <div className="text-lg font-semibold">
                      {video.kp_rating ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3">
                    <div className="text-xs text-[color:var(--muted)]">IMDb</div>
                    <div className="text-lg font-semibold">
                      {video.imdb_rating ?? "—"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 px-5 pb-7 sm:gap-8 sm:px-6 sm:pb-8 lg:grid-cols-5">
            <section className="lg:col-span-3">
              <h2 className="text-lg font-semibold">Описание</h2>

              {video.description || video.description_short ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[color:var(--muted)]">
                  {video.description ?? video.description_short}
                </p>
              ) : (
                <p className="mt-3 text-sm text-[color:var(--muted)]">Описание отсутствует.</p>
              )}
            </section>

            <aside className="lg:col-span-2">
              <h2 className="text-lg font-semibold">Детали</h2>

              <div className="mt-3 space-y-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                {video.genre?.length ? (
                  <div>
                    <div className="text-xs text-[color:var(--muted)]">Жанры</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {video.genre.map((g) => (
                        <span
                          key={g}
                          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-1 text-xs text-[color:var(--foreground)]"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {video.country?.length ? (
                  <div>
                    <div className="text-xs text-[color:var(--muted)]">Страны</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {video.country.map((c) => (
                        <span
                          key={c}
                          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-1 text-xs text-[color:var(--foreground)]"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {video.voiceovers?.length ? (
                  <div>
                    <div className="text-xs text-[color:var(--muted)]">Озвучки</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {video.voiceovers.map((v) => (
                        <span
                          key={v.id}
                          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-1 text-xs text-[color:var(--foreground)]"
                        >
                          {v.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {video.tags?.length ? (
                  <div>
                    <div className="text-xs text-[color:var(--muted)]">Теги</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {video.tags.map((t) => (
                        <span
                          key={t.id}
                          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-1 text-xs text-[color:var(--foreground)]"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {serialInfo?.seasons?.length ? (
                <div className="mt-6">
                  <h2 className="text-lg font-semibold">Сезоны и серии</h2>
                  <div className="mt-3 space-y-3">
                    {serialInfo.seasons.map((s) => (
                      <details
                        key={s.name}
                        className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
                      >
                        <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                          {s.name}
                        </summary>
                        <div className="mt-3 grid grid-cols-1 gap-2">
                          {s.series.map((ep) => (
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
                </div>
              ) : null}
            </aside>

            <section className="lg:col-span-5">
              <h2 className="text-lg font-semibold">Просмотр</h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-black">
                <div className="relative aspect-video w-full">
                  <iframe
                    src={video.iframe_url}
                    className="absolute inset-0 h-full w-full"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    referrerPolicy="no-referrer"
                    title={title}
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
