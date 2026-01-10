import Link from "next/link";

import type { VibixVideoLink } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

export function VideoCard({ video }: { video: VibixVideoLink }) {
  const title = pickTitle(video);
  const href = video.kp_id ? movieSlugHtmlPath(video.kp_id, title) : undefined;
  const posterSrc = proxyImageUrl(video.poster_url);
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

      <div className="absolute inset-x-0 bottom-0 p-3">
        <div className="absolute inset-x-0 bottom-0 h-28 bg-black/35 backdrop-blur-md" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        <div className="relative">
          <div className="line-clamp-2 text-sm font-semibold text-white drop-shadow">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/80">
            {video.year ? <span>{video.year}</span> : null}
            {country ? (
              <span className="rounded-md border border-white/15 bg-black/35 px-2 py-0.5">{country}</span>
            ) : null}
            {genres.map((g) => (
              <span key={g} className="rounded-md border border-white/15 bg-black/35 px-2 py-0.5">
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
