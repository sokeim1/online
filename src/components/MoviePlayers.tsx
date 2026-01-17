"use client";

import { useEffect, useMemo, useState } from "react";

import { VibixRendexPlayer } from "@/components/VibixRendexPlayer";

type PlayerId = "p1" | "p2";

export function MoviePlayers({
  storageKey,
  kpId,
  title,
  year,
  imdbId,
  vibix,
}: {
  storageKey: string;
  kpId: number;
  title: string;
  year?: number | null;
  imdbId?: string | null;
  vibix: {
    publisherId: string;
    type: "movie" | "series";
    id: string;
    fallbackIframeUrl: string;
    posterSrc?: string | null;
  };
}) {
  const sources = useMemo(() => {
    const list: Array<{ id: PlayerId; label: string }> = [{ id: "p1", label: "Плеер 1" }];
    list.push({ id: "p2", label: "Плеер 2" });
    return list;
  }, []);

  const [selectedId, setSelectedId] = useState<PlayerId>("p1");

  const p2IframeUrl = useMemo(() => {
    if (Number.isFinite(kpId) && kpId > 0) {
      return `https://player0.flixcdn.space/show/kinopoisk/${kpId}`;
    }
    const imdb = String(imdbId ?? "").trim();
    if (/^tt\d+$/i.test(imdb)) {
      return `https://player0.flixcdn.space/show/imdb/${encodeURIComponent(imdb)}`;
    }
    return null;
  }, [imdbId, kpId]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey) as PlayerId | null;
      if (saved === "p1" || saved === "p2") {
        setSelectedId(saved);
      } else {
        setSelectedId("p1");
      }
    } catch {
    }
  }, [storageKey]);

  function select(id: PlayerId) {
    setSelectedId(id);
    try {
      window.localStorage.setItem(storageKey, id);
    } catch {
    }
  }

  return (
    <div>
      {sources.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                selectedId === s.id
                  ? "bg-[color:var(--accent)] text-black"
                  : "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-black">
        <div className="relative aspect-video w-full">
          {selectedId === "p1" ? (
            p2IframeUrl ? (
              <iframe
                src={p2IframeUrl}
                className="absolute inset-0 h-full w-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                loading="lazy"
                title={title}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/70">
                Плеер недоступен.
              </div>
            )
          ) : (
            <VibixRendexPlayer
              publisherId={vibix.publisherId}
              type={vibix.type}
              id={vibix.id}
              title={title}
              fallbackIframeUrl={vibix.fallbackIframeUrl}
              posterSrc={vibix.posterSrc}
            />
          )}
        </div>
      </div>
    </div>
  );
}
