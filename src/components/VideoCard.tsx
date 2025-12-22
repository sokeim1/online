import Link from "next/link";

import type { VibixVideoLink } from "@/lib/vibix";

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

export function VideoCard({ video }: { video: VibixVideoLink }) {
  const title = pickTitle(video);
  const href = video.kp_id ? `/movie/${video.kp_id}` : undefined;

  const card = (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <div className="aspect-[2/3] w-full">
        {video.poster_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.poster_url}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/10 to-white/0 text-xs text-white/60">
            Нет постера
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-3">
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
        <div className="relative">
          <div className="line-clamp-2 text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/70">
            {video.year ? <span>{video.year}</span> : null}
            <span className="rounded-md border border-white/10 bg-white/10 px-2 py-0.5">
              {video.type}
            </span>
            <span className="rounded-md border border-white/10 bg-white/10 px-2 py-0.5">
              {video.quality}
            </span>
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
