import Link from "next/link";
import Image from "next/image";

import type { VibixVideoLink } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

function formatRating(v: VibixVideoLink): string | null {
  const r = v.kp_rating ?? v.imdb_rating;
  if (typeof r !== "number" || !Number.isFinite(r)) return null;
  return r.toFixed(2);
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
    <div className="rounded-[28px] bg-[color:var(--surface)] p-[2px] shadow-[0_10px_35px_rgba(0,0,0,0.35)]">
      <div className="group relative flex w-full gap-5 overflow-hidden rounded-[26px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 sm:p-5">
        <div className="relative h-[170px] w-[125px] shrink-0 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] sm:h-[190px] sm:w-[140px]">
        {posterSrc ? (
          <Image
            src={posterSrc}
            alt={title}
            fill
            sizes="140px"
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
      </div>

        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-[color:var(--foreground)] sm:text-lg">
          {title}
        </div>
        {video.name_eng ? (
          <div className="mt-0.5 truncate text-xs text-[color:var(--muted)]">{video.name_eng}</div>
        ) : null}

          <div className="mt-4 space-y-1.5 text-sm text-[color:var(--muted)]">
          <div>
            {country ? `${country}, ` : ""}
            {video.year ?? "—"}
          </div>
          <div className="text-[color:var(--muted)]">
            {genres.length ? genres.join(", ") : "Жанры: —"}
          </div>
          <div className="text-[color:var(--muted)]">
            {video.type === "serial" ? "Сериал" : "Видео"}
            {video.quality ? ` • ${video.quality}` : ""}
            {episodes != null ? ` • ${episodes} серий` : ""}
          </div>
        </div>
      </div>

      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}
