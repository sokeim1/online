"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { VibixVideoLink, VibixVideoType, VibixVideoLinksResponse } from "@/lib/vibix";

import { VideoCard } from "@/components/VideoCard";

type TypeFilter = VibixVideoType | "all";

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

function parseResponse(data: unknown): VibixVideoLinksResponse {
  return data as VibixVideoLinksResponse;
}

export function VideosGridClient() {
  const router = useRouter();

  const [type, setType] = useState<TypeFilter>("all");
  const [items, setItems] = useState<VibixVideoLink[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<VibixVideoLink[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);

  const canLoadMore = useMemo(() => {
    if (isLoading) return false;
    if (error) return false;
    if (lastPage == null) return true;
    return page < lastPage;
  }, [error, isLoading, lastPage, page]);

  const isSearchMode = useMemo(() => debouncedQuery.trim().length > 0, [debouncedQuery]);

  const isDirectIdQuery = useMemo(() => {
    const q = query.trim();
    return /^\d+$/.test(q) || /^tt\d+$/i.test(q);
  }, [query]);

  const pagination = useMemo(() => {
    if (!lastPage || lastPage <= 1) {
      return { pages: [] as number[], show: false };
    }
    const windowSize = 2;
    const pages = new Set<number>();
    pages.add(1);
    pages.add(lastPage);
    for (let p = Math.max(1, page - windowSize); p <= Math.min(lastPage, page + windowSize); p += 1) {
      pages.add(p);
    }

    const sorted = Array.from(pages).sort((a, b) => a - b);
    return { pages: sorted, show: true };
  }, [lastPage, page]);

  async function onSubmitSearch() {
    const q = query.trim();
    if (!q) {
      return;
    }

    if (/^\d+$/.test(q)) {
      router.push(`/movie/${q}`);
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
        router.push(`/movie/${kpId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
      return;
    }

    // name search
    setDebouncedQuery(q);
  }

  function clearSearch() {
    setQuery("");
    setDebouncedQuery("");
    setSuggestions([]);
  }

  function resetAndReload() {
    setItems([]);
    setPage(1);
    setLastPage(null);
    setTotal(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    resetAndReload();
  }, [type]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 400);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || isDirectIdQuery) {
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
        sp.set("limit", "7");

        const res = await fetch(`/api/vibix/videos/search?${sp.toString()}`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const json = parseResponse(await res.json());
        setSuggestions(json.data);
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

  useEffect(() => {
    // when switching to search mode, reset pagination
    setItems([]);
    setPage(1);
    setLastPage(null);
    setTotal(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [debouncedQuery]);

  useEffect(() => {
    const ac = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams();
        sp.set("page", String(page));
        sp.set("limit", "30");
        if (!isSearchMode && type !== "all") sp.set("type", type);

        const url = isSearchMode
          ? `/api/vibix/videos/search?${new URLSearchParams({
              ...Object.fromEntries(sp.entries()),
              name: debouncedQuery,
            }).toString()}`
          : `/api/vibix/videos?${sp.toString()}`;

        const res = await fetch(url, {
          signal: ac.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          try {
            const maybeJson = JSON.parse(text) as { message?: string };
            if (maybeJson?.message) {
              throw new Error(maybeJson.message);
            }
          } catch {
            // ignore JSON parse errors
          }
          throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
        }

        const json = parseResponse(await res.json());

        setItems(json.data);
        setLastPage(json.meta?.last_page ?? null);
        setTotal(json.meta?.total ?? null);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    }

    load();

    return () => {
      ac.abort();
    };
  }, [page, type, isSearchMode, debouncedQuery]);

  function goToPage(nextPage: number) {
    if (!lastPage) {
      setPage(Math.max(1, nextPage));
      return;
    }
    setPage(Math.min(Math.max(1, nextPage), lastPage));
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16">
      <div className="flex flex-col gap-3 pt-8">
        <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center">
          <div className="relative w-full flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => {
                // небольшой таймаут, чтобы клик по подсказке успел сработать
                window.setTimeout(() => setIsSearchFocused(false), 120);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onSubmitSearch();
                }
              }}
              placeholder="Поиск: название, kpId (цифры) или IMDb (tt123...)"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/20"
            />

            {isSearchFocused && !isDirectIdQuery && query.trim().length >= 2 ? (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b12] shadow-xl">
                {isSuggestionsLoading ? (
                  <div className="p-3 text-xs text-white/60">Поиск...</div>
                ) : suggestions.length ? (
                  <div className="max-h-80 overflow-auto">
                    {suggestions.map((s) => {
                      const title = pickTitle(s);
                      const canOpen = !!s.kp_id;

                      return (
                        <button
                          key={`${s.id}-${s.kp_id ?? "nokp"}`}
                          type="button"
                          disabled={!canOpen}
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            if (!s.kp_id) return;
                            router.push(`/movie/${s.kp_id}`);
                          }}
                          className="flex w-full items-center gap-3 border-b border-white/5 p-3 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="h-12 w-9 overflow-hidden rounded-lg border border-white/10 bg-white/10">
                            {s.poster_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={s.poster_url}
                                alt={title}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-white/90">{title}</div>
                            <div className="mt-0.5 text-xs text-white/50">
                              {s.year ?? "—"} • {s.type} • {s.quality}
                              {!canOpen ? " • нет kp_id" : ""}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-3 text-xs text-white/60">Ничего не найдено</div>
                )}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSubmitSearch}
              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
            >
              Найти
            </button>
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
            >
              Очистить
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-white">
            {isSearchMode ? "Результаты поиска" : "Все видео из Vibix"}
          </h1>

          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
            <button
              onClick={() => setType("all")}
              disabled={isSearchMode}
              className={`rounded-xl px-3 py-1.5 text-sm transition ${
                type === "all" ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
              }`}
              type="button"
            >
              Все
            </button>
            <button
              onClick={() => setType("movie")}
              disabled={isSearchMode}
              className={`rounded-xl px-3 py-1.5 text-sm transition ${
                type === "movie" ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
              }`}
              type="button"
            >
              Фильмы
            </button>
            <button
              onClick={() => setType("serial")}
              disabled={isSearchMode}
              className={`rounded-xl px-3 py-1.5 text-sm transition ${
                type === "serial" ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
              }`}
              type="button"
            >
              Сериалы
            </button>
          </div>
        </div>

        <p className="text-sm text-white/60">
          Показано: <span className="text-white/90">{items.length}</span>
          {total != null ? (
            <>
              {" "}
              <span className="text-white/40">•</span> всего {total}
            </>
          ) : null}
          {lastPage ? (
            <>
              {" "}
              <span className="text-white/40">•</span> стр. {page} / {lastPage}
            </>
          ) : null}
        </p>
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          <div className="font-medium">Ошибка</div>
          <div className="mt-1 whitespace-pre-wrap">{error}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetAndReload}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15"
            >
              Повторить
            </button>
            <div className="text-xs text-white/70">
              Если видишь <span className="text-white">Missing env: VIBIX_API_KEY</span>, создай
              <span className="text-white"> .env.local</span> и перезапусти <span className="text-white">npm run dev</span>.
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((v) => (
          <VideoCard key={`${v.id}-${v.kp_id ?? "nokp"}`} video={v} />
        ))}

        {isLoading
          ? Array.from({ length: 10 }).map((_, idx) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={`sk-${idx}`}
                className="animate-pulse overflow-hidden rounded-2xl border border-white/10 bg-white/5"
              >
                <div className="aspect-[2/3] w-full bg-white/10" />
              </div>
            ))
          : null}
      </div>

      {pagination.show ? (
        <div className="mt-10 flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1 || isLoading || !!error}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/90 disabled:opacity-40"
            >
              Назад
            </button>

            {pagination.pages.map((p, idx) => {
              const prev = pagination.pages[idx - 1];
              const showDots = prev != null && p - prev > 1;

              return (
                <div key={p} className="flex items-center gap-2">
                  {showDots ? (
                    <span className="px-1 text-xs text-white/40">…</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => goToPage(p)}
                    disabled={isLoading || !!error}
                    className={`min-w-10 rounded-xl border px-4 py-2 text-xs transition disabled:opacity-40 ${
                      p === page
                        ? "border-white/20 bg-white text-black"
                        : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
                    }`}
                  >
                    {p}
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={(lastPage != null ? page >= lastPage : false) || isLoading || !!error}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/90 disabled:opacity-40"
            >
              Вперёд
            </button>
          </div>

          <div className="text-xs text-white/50">
            Страница {page} из {lastPage}
          </div>
        </div>
      ) : null}
    </div>
  );
}
