"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { VibixVideoLink } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

export function SimilarVideosScroller({
  genre,
  excludeKpId,
  title = "Похожие",
}: {
  genre: string | null | undefined;
  excludeKpId?: number | null;
  title?: string;
}) {
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<VibixVideoLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const g = (genre ?? "").trim();
    if (!g) {
      setItems([]);
      return;
    }

    const ac = new AbortController();
    setError(null);
    setItems(null);

    void (async () => {
      try {
        const res = await fetch(`/api/vibix/videos/browse?genre=${encodeURIComponent(g)}&page=1&enrich=0`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { data?: VibixVideoLink[] };
        const out = (json.data ?? [])
          .filter((v) => v.kp_id != null)
          .filter((v) => (excludeKpId ? v.kp_id !== excludeKpId : true))
          .slice(0, 16);
        setItems(out);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setItems([]);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [excludeKpId, genre]);

  const visible = useMemo(() => (items ?? []).filter((v) => proxyImageUrl(v.poster_url)), [items]);

  if (!genre) return null;
  if (error) return null;
  if (items == null) return null;
  if (!visible.length) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[color:var(--foreground)]">{title}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => scrollerRef.current?.scrollBy({ left: -520, behavior: "smooth" })}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
            aria-label="Scroll left"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => scrollerRef.current?.scrollBy({ left: 520, behavior: "smooth" })}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
            aria-label="Scroll right"
          >
            ▶
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="mt-4 overflow-x-auto">
        <div className="flex w-max gap-4 pr-2">
          {visible.map((v) => {
            const t = pickTitle(v);
            const href = v.kp_id ? movieSlugHtmlPath(v.kp_id, t) : null;
            const posterSrc = proxyImageUrl(v.poster_url);
            if (!href || !posterSrc) return null;

            return (
              <button
                key={`sim-${v.id}-${v.kp_id}`}
                type="button"
                onClick={() => router.push(href)}
                className="w-[150px] shrink-0 text-left"
                title={t}
              >
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-hover)]">
                  <Image src={posterSrc} alt={t} fill unoptimized className="object-cover" sizes="150px" />
                </div>
                <div className="mt-2 line-clamp-2 text-sm font-medium text-[color:var(--foreground)]">{t}</div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
