"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import type { VibixVideoLink, VibixVideoLinksResponse } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

type Props = {
  className?: string;
};

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

function parseResponse(data: unknown): VibixVideoLinksResponse {
  return data as VibixVideoLinksResponse;
}

export function MovieSearchBar({ className }: Props) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<VibixVideoLink[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirectIdQuery = useMemo(() => {
    const q = query.trim();
    return /^\d+$/.test(q) || /^tt\d+$/i.test(q);
  }, [query]);

  async function onSubmitSearch() {
    const q = query.trim();
    if (!q) return;

    if (/^\d+$/.test(q)) {
      router.push(movieSlugHtmlPath(Number(q), q));
      return;
    }

    if (/^tt\d+$/i.test(q)) {
      setError(null);
      try {
        const res = await fetch(`/api/vibix/videos/imdb/${encodeURIComponent(q)}`);
        const json = (await res.json()) as
          | { success: true; data: { kp_id: number | null } }
          | { success: false; message: string };
        if (!res.ok || !json.success) {
          throw new Error("message" in json ? json.message : `HTTP ${res.status}`);
        }
        const kpId = json.data.kp_id;
        if (!kpId) {
          throw new Error("У этого IMDb ID нет kp_id в Vibix");
        }
        router.push(movieSlugHtmlPath(kpId, String(kpId)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
      return;
    }

    router.push(`/?q=${encodeURIComponent(q)}`);
  }

  function clearSearch() {
    setQuery("");
    setSuggestions([]);
    setError(null);
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1 || isDirectIdQuery) {
      setSuggestions([]);
      setIsSuggestionsLoading(false);
      return;
    }

    const ac = new AbortController();
    const t = window.setTimeout(async () => {
      setIsSuggestionsLoading(true);
      try {
        const sp = new URLSearchParams();
        sp.set("name", q);
        sp.set("page", "1");
        sp.set("suggest", "1");
        // limit is omitted because Vibix /links may require a minimum (e.g. 20)

        const res = await fetch(`/api/vibix/videos/search?${sp.toString()}`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const json = parseResponse(await res.json());
        setSuggestions(json.data.filter((x) => x.kp_id != null).slice(0, 7));
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSuggestions([]);
      } finally {
        setIsSuggestionsLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [isDirectIdQuery, query]);

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 sm:flex-row sm:items-center">
        <div className="relative w-full flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              window.setTimeout(() => setIsFocused(false), 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onSubmitSearch();
              }
            }}
            placeholder="Поиск"
            className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] outline-none focus:border-[color:var(--accent)]"
          />

          {isFocused && !isDirectIdQuery && query.trim().length >= 1 ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--background)] shadow-xl">
              {isSuggestionsLoading ? (
                <div className="p-3 text-xs text-[color:var(--muted)]">Поиск...</div>
              ) : suggestions.length ? (
                <div className="max-h-80 overflow-auto">
                  {suggestions.map((s) => {
                    const title = pickTitle(s);
                    const canOpen = !!s.kp_id;
                    const posterSrc = proxyImageUrl(s.poster_url);

                    return (
                      <button
                        key={`${s.id}-${s.kp_id ?? "nokp"}`}
                        type="button"
                        disabled={!canOpen}
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          if (!s.kp_id) return;
                          router.push(movieSlugHtmlPath(s.kp_id, title));
                        }}
                        className="flex w-full items-center gap-3 border-b border-[color:var(--border)] p-3 text-left hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="h-12 w-9 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
                          {posterSrc ? (
                            <Image
                              src={posterSrc}
                              alt={title}
                              width={36}
                              height={48}
                              unoptimized
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-[color:var(--foreground)]">{title}</div>
                          <div className="mt-0.5 text-xs text-[color:var(--muted)]">
                            {s.year ?? "—"} • {s.type} • {s.quality}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 text-xs text-[color:var(--muted)]">Ничего не найдено</div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSubmitSearch}
            className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-black hover:opacity-90"
          >
            Найти
          </button>
          <button
            type="button"
            onClick={clearSearch}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
          >
            Очистить
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-2 rounded-2xl border border-[color:var(--danger)]/30 bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--foreground)]">
          <div className="whitespace-pre-wrap text-[color:var(--muted)]">{error}</div>
        </div>
      ) : null}
    </div>
  );
}
