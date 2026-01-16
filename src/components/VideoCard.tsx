import Link from "next/link";

import type { VibixVideoLink } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

function parseRating(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const s = raw.trim().replace(/,/g, ".");
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return NaN;
    const n = Number.parseFloat(m[0]);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function formatRating(v: VibixVideoLink): string | null {
  const raw = (v.kp_rating ?? v.imdb_rating) as unknown;
  const n = parseRating(raw);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export function VideoCard({ video }: { video: VibixVideoLink }) {
  const title = pickTitle(video);
  const href = video.kp_id ? movieSlugHtmlPath(video.kp_id, title) : undefined;
  const posterSrc = proxyImageUrl(video.poster_url);
  const rating = formatRating(video);
  const country = video.country?.filter(Boolean)?.[0] ?? null;
  const genres = (video.genre ?? []).filter(Boolean).slice(0, 2);

  const card = (
    <div className="group relative overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="aspect-[2/3] w-full">
        {posterSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={posterSrc}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[color:var(--surface-hover)] to-transparent text-xs text-[color:var(--muted)]">
            Нет постера
          </div>
        )}
      </div>

      {rating ? (
        <div className="absolute left-1.5 top-1.5 rounded-md bg-orange-600 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow sm:left-2 sm:top-2 sm:px-2 sm:py-1 sm:text-xs">
          {rating}
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 p-2 sm:p-3">
        <div className="absolute inset-x-0 bottom-0 h-28 bg-black/50 backdrop-blur-xl" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        <div className="relative">
          <div className="line-clamp-2 text-[13px] font-semibold text-white drop-shadow transition-colors group-hover:text-[color:var(--title-hover)] sm:text-sm">
            {title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-white/80 sm:gap-2 sm:text-xs">
            {video.year ? <span>{video.year}</span> : null}
            {country ? (
              <span className="rounded-md border border-white/15 bg-black/35 px-1.5 py-0.5 sm:px-2">{country}</span>
            ) : null}
            {genres.map((g) => (
              <span key={g} className="rounded-md border border-white/15 bg-black/35 px-1.5 py-0.5 sm:px-2">
                {g}
              </span>
            ))}
          </div>
        </div>
      </div>

      {!video.kp_id ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-white/80">
          Нет kp_id
        </div>
      ) : null}
    </div>
  );

  if (!href) return card;

  return (
    <Link href={href} className="block focus:outline-none">
      {card}
    </Link>
  );
}
