"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { VibixVideoLink, VibixVideoType, VibixVideoLinksResponse } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didInitFromUrl = useRef(false);

  const [type, setType] = useState<TypeFilter>("all");
  const [items, setItems] = useState<VibixVideoLink[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeNonce, setHomeNonce] = useState(0);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<VibixVideoLink[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);

  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    const t = searchParams.get("type") ?? "all";
    const pRaw = searchParams.get("page");
    const p = pRaw ? Number.parseInt(pRaw, 10) : 1;

    const nextType: TypeFilter = t === "movie" || t === "serial" || t === "all" ? t : "all";
    const nextPage = Number.isFinite(p) && p > 0 ? p : 1;
    const nextQuery = q;
    const nextDebounced = q.trim();

    if (!didInitFromUrl.current) {
      didInitFromUrl.current = true;
      setType(nextType);
      setPage(nextPage);
      setQuery(nextQuery);
      setDebouncedQuery(nextDebounced);
      return;
    }

    setType((prev) => (prev === nextType ? prev : nextType));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setQuery((prev) => (prev === nextQuery ? prev : nextQuery));
    setDebouncedQuery((prev) => (prev === nextDebounced ? prev : nextDebounced));
  }, [searchParams]);

  useEffect(() => {
    if (!didInitFromUrl.current) return;

    const sp = new URLSearchParams();
    const q = debouncedQuery.trim();
    if (q) sp.set("q", q);
    if (type !== "all") sp.set("type", type);
    if (page !== 1) sp.set("page", String(page));

    const next = sp.toString();
    const current = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : searchParams.toString();
    if (next === current) return;

    const url = next ? `${pathname}?${next}` : pathname;
    window.history.replaceState(null, "", url);
  }, [debouncedQuery, page, pathname, searchParams, type]);

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

    // name search
    setDebouncedQuery(q);
  }

  function clearSearch() {
    setQuery("");
    setDebouncedQuery("");
    setSuggestions([]);
  }

  useEffect(() => {
    function onHome() {
      setQuery("");
      setDebouncedQuery("");
      setSuggestions([]);
      setType("all");
      setItems([]);
      setPage(1);
      setLastPage(null);
      setTotal(null);
      setError(null);
      setHomeNonce((n) => n + 1);
    }

    window.addEventListener("doramy:home", onHome);
    return () => {
      window.removeEventListener("doramy:home", onHome);
    };
  }, []);

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
        if (type !== "all") sp.set("type", type);

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
          }
          throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
        }

        const json = parseResponse(await res.json());

        const filtered =
          isSearchMode && type !== "all"
            ? json.data.filter((v) => v.type === type)
            : json.data;

        setItems(filtered);
        if (isSearchMode && type !== "all") {
          setLastPage(1);
          setTotal(filtered.length);
        } else {
          setLastPage(json.meta?.last_page ?? null);
          setTotal(json.meta?.total ?? null);
        }
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
  }, [page, type, isSearchMode, debouncedQuery, homeNonce]);

  function goToPage(nextPage: number) {
    if (!lastPage) {
      setPage(Math.max(1, nextPage));
      return;
    }
    setPage(Math.min(Math.max(1, nextPage), lastPage));
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:pb-16">
      <div className="flex flex-col gap-3 pt-6 sm:pt-8">
        <div className="flex flex-col gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 sm:flex-row sm:items-center">
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
              placeholder="Поиск"
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] outline-none focus:border-[color:var(--accent)]"
            />

            {isSearchFocused && !isDirectIdQuery && query.trim().length >= 2 ? (
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
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={posterSrc}
                                alt={title}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-[color:var(--foreground)]">{title}</div>
                            <div className="mt-0.5 text-xs text-[color:var(--muted)]">
                              {s.year ?? "—"} • {s.type} • {s.quality}
                              {!canOpen ? " • нет kp_id" : ""}
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-1">
            <button
              onClick={() => setType("all")}
              className={`rounded-xl px-3 py-1.5 text-sm transition ${
                type === "all"
                  ? "bg-[color:var(--accent)] text-black"
                  : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
              }`}
              type="button"
            >
              Все
            </button>
            <button
              onClick={() => setType("movie")}
              className={`rounded-xl px-3 py-1.5 text-sm transition ${
                type === "movie"
                  ? "bg-[color:var(--accent)] text-black"
                  : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
              }`}
              type="button"
            >
              Фильмы
            </button>
            <button
              onClick={() => setType("serial")}
              className={`rounded-xl px-3 py-1.5 text-sm transition ${
                type === "serial"
                  ? "bg-[color:var(--accent)] text-black"
                  : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
              }`}
              type="button"
            >
              Сериалы
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-[color:var(--danger)]/30 bg-[color:var(--danger-soft)] p-4 text-sm text-[color:var(--foreground)]">
          <div className="font-medium">Ошибка</div>
          <div className="mt-1 whitespace-pre-wrap text-[color:var(--muted)]">{error}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetAndReload}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
            >
              Повторить
            </button>
          </div>
        </div>
      ) : null}

      {!isLoading && !error && isSearchMode && items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
          <div className="text-sm font-medium text-[color:var(--foreground)]">Контент не найден</div>
          <div className="mt-1 text-xs text-[color:var(--muted)]">
            Попробуй другой запрос или вернись на главную.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                clearSearch();
                router.push("/");
              }}
              className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-black hover:opacity-90"
            >
              На главную
            </button>
          </div>
        </div>
      ) : null}

      {pagination.show ? (
        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1 || isLoading || !!error}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs text-[color:var(--foreground)] disabled:opacity-40"
            >
              Назад
            </button>

            {pagination.pages.map((p, idx) => {
              const prev = pagination.pages[idx - 1];
              const showDots = prev != null && p - prev > 1;

              return (
                <div key={`top-${p}`} className="flex items-center gap-2">
                  {showDots ? <span className="px-1 text-xs text-white/40">…</span> : null}
                  <button
                    type="button"
                    onClick={() => goToPage(p)}
                    disabled={isLoading || !!error}
                    className={`min-w-10 rounded-xl border px-4 py-2 text-xs transition disabled:opacity-40 ${
                      p === page
                        ? "border-[color:var(--border)] bg-[color:var(--accent)] text-black"
                        : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
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
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs text-[color:var(--foreground)] disabled:opacity-40"
            >
              Вперёд
            </button>
          </div>

          <div className="text-xs text-[color:var(--muted)]">
            Страница {page} из {lastPage}
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((v) => (
          <VideoCard key={`${v.id}-${v.kp_id ?? "nokp"}`} video={v} />
        ))}

        {isLoading
          ? Array.from({ length: 10 }).map((_, idx) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={`sk-${idx}`}
                className="animate-pulse overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]"
              >
                <div className="aspect-[2/3] w-full bg-[color:var(--surface-hover)]" />
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
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs text-[color:var(--foreground)] disabled:opacity-40"
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
                        ? "border-[color:var(--border)] bg-[color:var(--accent)] text-black"
                        : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
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
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs text-[color:var(--foreground)] disabled:opacity-40"
            >
              Вперёд
            </button>
          </div>

          <div className="text-xs text-[color:var(--muted)]">
            Страница {page} из {lastPage}
          </div>
        </div>
      ) : null}
    </div>
  );
}
