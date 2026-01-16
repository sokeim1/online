import Link from "next/link";
import Image from "next/image";

import type { VibixVideoLink } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

function formatRating(v: VibixVideoLink): string | null {
  const raw = (v.kp_rating ?? v.imdb_rating) as unknown;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export function VideoRowCard({ video }: { video: VibixVideoLink }) {
  const title = pickTitle(video);
  const href = video.kp_id ? movieSlugHtmlPath(video.kp_id, title) : undefined;
  const posterSrc = proxyImageUrl(video.poster_url);
  const rating = formatRating(video);
  const country = video.country?.filter(Boolean)?.[0] ?? null;
  const genres = (video.genre ?? []).filter(Boolean).slice(0, 3);
  const episodes = video.type === "serial" ? video.episodes_count ?? null : null;

  const content = (
    <div className="group flex w-full items-start gap-4 py-5 sm:gap-8 sm:py-8">
      <div className="shrink-0">
        {href ? (
          <Link href={href} className="relative block h-[180px] w-[125px] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] sm:h-[270px] sm:w-[190px]">
            {posterSrc ? (
              <Image
                src={posterSrc}
                alt={title}
                fill
                sizes="(min-width: 640px) 190px, 150px"
                unoptimized
                className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-[color:var(--muted)]">
                Нет постера
              </div>
            )}

            {rating ? (
              <div className="absolute left-2 top-2 rounded-md bg-orange-600 px-2 py-1 text-xs font-semibold text-white shadow">
                {rating}
              </div>
            ) : null}
          </Link>
        ) : (
          <div className="relative h-[180px] w-[125px] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] sm:h-[270px] sm:w-[190px]">
            {posterSrc ? (
              <Image
                src={posterSrc}
                alt={title}
                fill
                sizes="(min-width: 640px) 190px, 150px"
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-[color:var(--muted)]">
                Нет постера
              </div>
            )}
            {rating ? (
              <div className="absolute left-2 top-2 rounded-md bg-orange-600 px-2 py-1 text-xs font-semibold text-white shadow">
                {rating}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {href ? (
          <Link
            href={href}
            className="break-words text-lg font-semibold leading-snug text-[color:var(--foreground)] transition-colors group-hover:text-[color:var(--title-hover)] sm:text-xl"
          >
            {title}
          </Link>
        ) : (
          <div className="break-words text-lg font-semibold leading-snug text-[color:var(--foreground)] sm:text-xl">{title}</div>
        )}
        {video.name_eng ? (
          <div className="mt-1 truncate text-sm text-[color:var(--muted)]">{video.name_eng}</div>
        ) : null}

        <div className="mt-3 space-y-2 text-sm text-[color:var(--muted)] sm:mt-4 sm:text-base">
          <div>
            {country ? `${country}, ` : ""}
            {video.year ?? "—"}
          </div>
          <div className="text-[color:var(--muted)]">{genres.length ? genres.join(", ") : "Жанры: —"}</div>
          <div className="text-[color:var(--muted)]">
            {video.type === "serial" ? "Сериал" : "Фильм"}
            {episodes != null ? ` • ${episodes} серий` : ""}
          </div>
        </div>
      </div>
    </div>
  );

  return content;
}
