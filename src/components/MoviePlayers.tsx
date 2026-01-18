"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { VibixRendexPlayer } from "@/components/VibixRendexPlayer";

type PlayerId = "p1" | "p2";

type VibixPlayerType = "movie" | "series" | "kp" | "imdb";

export function MoviePlayers({
  storageKey,
  kpId,
  title,
  year,
  imdbId,
  siteDomain,
  vibix,
}: {
  storageKey: string;
  kpId: number;
  title: string;
  year?: number | null;
  imdbId?: string | null;
  siteDomain?: string | null;
  vibix?: {
    publisherId: string;
    type: VibixPlayerType;
    id: string;
    fallbackIframeUrl: string;
    posterSrc?: string | null;
  };
}) {
  const sources = useMemo(() => {
    const list: Array<{ id: PlayerId; label: string }> = [{ id: "p1", label: "Плеер 1" }];
    if (vibix) list.push({ id: "p2", label: "Плеер 2" });
    return list;
  }, [vibix]);

  const [selectedId, setSelectedId] = useState<PlayerId>("p1");

  const [videoseedIframeUrl, setVideoseedIframeUrl] = useState<string | null>(null);

  const videoseedIframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastProgressSavedRef = useRef<{ ts: number; sec: number } | null>(null);

  const progressStorageKey = useMemo(() => `${storageKey}_progress_v1`, [storageKey]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const u = new URL("/api/videoseed/iframe", window.location.origin);
        if (Number.isFinite(kpId) && kpId > 0) u.searchParams.set("kpId", String(kpId));
        const imdb = String(imdbId ?? "").trim();
        if (imdb) u.searchParams.set("imdbId", imdb);

        u.searchParams.set("autostart", "0");

        try {
          const raw = window.localStorage.getItem(progressStorageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as { sec?: unknown; ts?: unknown };
            const sec = typeof parsed?.sec === "number" ? parsed.sec : Number(parsed?.sec);
            if (Number.isFinite(sec) && sec > 0) {
              u.searchParams.set("start", String(Math.floor(sec)));
            }
          }
        } catch {
        }

        const res = await fetch(u.toString(), { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setVideoseedIframeUrl(null);
          return;
        }
        const json = (await res.json().catch(() => null)) as any;
        const iframeUrl = typeof json?.iframeUrl === "string" ? json.iframeUrl : null;
        if (!cancelled) setVideoseedIframeUrl(iframeUrl);
      } catch {
        if (!cancelled) setVideoseedIframeUrl(null);
      }
    }

    if (typeof window !== "undefined") load();

    return () => {
      cancelled = true;
    };
  }, [imdbId, kpId, progressStorageKey]);

  useEffect(() => {
    function extractSeconds(data: unknown): number | null {
      if (typeof data === "number" && Number.isFinite(data)) return data;
      if (typeof data === "string") {
        const trimmed = data.trim();
        if (!trimmed) return null;
        try {
          return extractSeconds(JSON.parse(trimmed) as unknown);
        } catch {
        }
        const m = trimmed.match(/\b\d+(?:\.\d+)?\b/);
        if (!m) return null;
        const n = Number.parseFloat(m[0]);
        return Number.isFinite(n) ? n : null;
      }
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const o = data as Record<string, unknown>;
        const candidates = ["currentTime", "time", "position", "seconds", "sec", "t"];
        for (const k of candidates) {
          if (k in o) {
            const n = typeof o[k] === "number" ? (o[k] as number) : Number(o[k]);
            if (Number.isFinite(n)) return n;
          }
        }
        if ("data" in o) {
          return extractSeconds(o.data);
        }
      }
      return null;
    }

    function onMessage(ev: MessageEvent) {
      if (selectedId !== "p1") return;
      const iframe = videoseedIframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      if (ev.source !== iframe.contentWindow) return;

      const secondsRaw = extractSeconds(ev.data);
      if (secondsRaw == null) return;
      const sec = Math.max(0, Math.floor(secondsRaw));
      const now = Date.now();

      const last = lastProgressSavedRef.current;
      if (last && now - last.ts < 4000 && Math.abs(sec - last.sec) < 5) return;
      lastProgressSavedRef.current = { ts: now, sec };

      try {
        window.localStorage.setItem(progressStorageKey, JSON.stringify({ sec, ts: now }));
      } catch {
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [progressStorageKey, selectedId]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey) as PlayerId | null;
      if (saved === "p2" && !vibix) {
        setSelectedId("p1");
        return;
      }
      if (saved === "p1" || saved === "p2") {
        setSelectedId(saved);
      } else {
        setSelectedId("p1");
      }
    } catch {
    }
  }, [storageKey, vibix]);

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
            videoseedIframeUrl ? (
              <iframe
                src={videoseedIframeUrl}
                ref={videoseedIframeRef}
                className="absolute inset-0 h-full w-full"
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
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
            vibix ? (
              <VibixRendexPlayer
                publisherId={vibix.publisherId}
                type={vibix.type}
                id={vibix.id}
                title={title}
                fallbackIframeUrl={vibix.fallbackIframeUrl}
                posterSrc={vibix.posterSrc}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/70">
                Плеер недоступен.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
