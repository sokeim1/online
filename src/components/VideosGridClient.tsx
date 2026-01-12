"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

import type { VibixVideoLink, VibixVideoType, VibixVideoLinksResponse } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

import { VideoRowCard } from "@/components/VideoRowCard";

type TypeFilter = VibixVideoType | "all";

type TopTab = "home" | "new" | "serials" | "holiday";

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

function parseResponse(data: unknown): VibixVideoLinksResponse {
  return data as VibixVideoLinksResponse;
}

type VideosGridClientProps = {
  initialQ?: string;
  initialType?: string;
  initialPage?: string;
  initialItems?: VibixVideoLink[];
  initialLastPage?: number | null;
  initialTotal?: number | null;
};

export function VideosGridClient({
  initialQ,
  initialType,
  initialPage,
  initialItems,
  initialLastPage,
  initialTotal,
}: VideosGridClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didInitFromUrl = useRef(false);

  const [type, setType] = useState<TypeFilter>(() => {
    const t = (initialType ?? "all").trim();
    return t === "movie" || t === "serial" || t === "all" ? t : "all";
  });
  const [items, setItems] = useState<VibixVideoLink[]>(() => initialItems ?? []);
  const [page, setPage] = useState(() => {
    const p = initialPage ? Number.parseInt(initialPage, 10) : 1;
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [lastPage, setLastPage] = useState<number | null>(() => initialLastPage ?? null);
  const [total, setTotal] = useState<number | null>(() => initialTotal ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeNonce, setHomeNonce] = useState(0);

  const [query, setQuery] = useState(() => initialQ ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(() => (initialQ ?? "").trim());
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<VibixVideoLink[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);

  const topTab: TopTab = "home";
  const [navGenre, setNavGenre] = useState<string | null>(null);
  const [navCountry, setNavCountry] = useState<string | null>(null);
  const [navYear, setNavYear] = useState<number | null>(null);

  const featuredScrollerRef = useRef<HTMLDivElement | null>(null);

  const navLists = useMemo(() => {
    const years = [2025, 2020, 2017, 2013, 2009, 2002, 2021, 2018, 2015, 2011, 2004, 2000];
    const genres = [
      "триллер",
      "ужасы",
      "комедия",
      "боевик",
      "драма",
      "криминал",
      "фэнтези",
      "мультфильм",
      "мелодрама",
      "приключения",
      "фантастика",
      "короткометражка",
      "детский",
      "реальное ТВ",
      "детектив",
      "семейный",
      "мюзикл",
    ];
    const countries = [
      "США",
      "Корея Южная",
      "Канада",
      "СССР",
      "Украина",
      "Турция",
      "Испания",
      "Великобритания",
      "Германия",
    ];
    return { years, genres, countries };
  }, []);

  function setNavigation(next: { year?: number; genre?: string; country?: string } | null) {
    if (!next) {
      setNavYear(null);
      setNavGenre(null);
      setNavCountry(null);
      setPage(1);
      return;
    }

    if (next.year != null) {
      setNavYear(next.year);
      setNavGenre(null);
      setNavCountry(null);
    } else if (next.genre) {
      setNavGenre(next.genre);
      setNavYear(null);
      setNavCountry(null);
    } else if (next.country) {
      setNavCountry(next.country);
      setNavYear(null);
      setNavGenre(null);
    }

    setQuery("");
    setDebouncedQuery("");
    setSuggestions([]);
    setPage(1);
  }

  useEffect(() => {
    const q = searchParams.get("q") ?? searchParams.get("name") ?? initialQ ?? "";
    const t = searchParams.get("type") ?? initialType ?? "all";
    const pRaw = searchParams.get("page") ?? initialPage ?? null;
    const p = pRaw ? Number.parseInt(pRaw, 10) : 1;

    const yRaw = searchParams.get("year");
    const gRaw = searchParams.get("genre");
    const cRaw = searchParams.get("country");
    const y = yRaw ? Number.parseInt(yRaw, 10) : null;

    const nextType: TypeFilter = t === "movie" || t === "serial" || t === "all" ? t : "all";
    const nextPage = Number.isFinite(p) && p > 0 ? p : 1;
    const nextQuery = q;
    const nextDebounced = q.trim();

    let nextYear: number | null = null;
    let nextGenre: string | null = null;
    let nextCountry: string | null = null;
    if (Number.isFinite(y as number) && y && y > 1800) {
      nextYear = y;
    } else if (gRaw) {
      nextGenre = gRaw;
    } else if (cRaw) {
      nextCountry = cRaw;
    }

    if (!didInitFromUrl.current) {
      didInitFromUrl.current = true;
      setType(nextType);
      setPage(nextPage);
      setQuery(nextQuery);
      setDebouncedQuery(nextDebounced);
      setNavYear(nextYear);
      setNavGenre(nextGenre);
      setNavCountry(nextCountry);
      return;
    }

    setType((prev) => (prev === nextType ? prev : nextType));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setQuery((prev) => (prev === nextQuery ? prev : nextQuery));
    setDebouncedQuery((prev) => (prev === nextDebounced ? prev : nextDebounced));
    setNavYear((prev) => (prev === nextYear ? prev : nextYear));
    setNavGenre((prev) => (prev === nextGenre ? prev : nextGenre));
    setNavCountry((prev) => (prev === nextCountry ? prev : nextCountry));
  }, [searchParams]);

  useEffect(() => {
    if (!didInitFromUrl.current) return;

    const sp = new URLSearchParams();
    const q = debouncedQuery.trim();
    if (q) sp.set("q", q);
    if (type !== "all") sp.set("type", type);
    if (page !== 1) sp.set("page", String(page));

    if (!q) {
      if (navYear != null) sp.set("year", String(navYear));
      else if (navGenre) sp.set("genre", navGenre);
      else if (navCountry) sp.set("country", navCountry);
    }

    const next = sp.toString();
    const current = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : searchParams.toString();
    if (next === current) return;

    const url = next ? `${pathname}?${next}` : pathname;
    window.history.replaceState(null, "", url);
  }, [debouncedQuery, navCountry, navGenre, navYear, page, pathname, searchParams, type]);

  const canLoadMore = useMemo(() => {
    if (isLoading) return false;
    if (error) return false;
    if (lastPage == null) return true;
    return page < lastPage;
  }, [error, isLoading, lastPage, page]);

  const isSearchMode = useMemo(() => debouncedQuery.trim().length > 0, [debouncedQuery]);

  const isBrowseMode = useMemo(() => !isSearchMode && (navYear != null || !!navGenre || !!navCountry), [isSearchMode, navCountry, navGenre, navYear]);

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
    setNavGenre(null);
    setNavCountry(null);
    setNavYear(null);
  }, [type]);

  const visibleItems = useMemo(() => items, [items]);

  const featured = useMemo(() => {
    const base = (items ?? []).slice().sort((a, b) => {
      const at = Date.parse(a.uploaded_at ?? "") || 0;
      const bt = Date.parse(b.uploaded_at ?? "") || 0;
      return bt - at;
    });
    return base.slice(0, 12);
  }, [items]);

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

  useEffect(() => {
    // when switching to search mode, reset pagination
    setItems([]);
    setPage(1);
    setLastPage(null);
    setTotal(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [debouncedQuery, navCountry, navGenre, navYear]);

  useEffect(() => {
    const ac = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams();
        sp.set("page", String(page));
        sp.set("limit", "20");
        if (type !== "all") sp.set("type", type);

        let url: string;
        if (isSearchMode) {
          url = `/api/vibix/videos/search?${new URLSearchParams({
            ...Object.fromEntries(sp.entries()),
            name: debouncedQuery,
            enrich: "0",
          }).toString()}`;
        } else if (isBrowseMode) {
          const browse = new URLSearchParams(Object.fromEntries(sp.entries()));
          browse.delete("limit");
          if (navYear != null) browse.set("year", String(navYear));
          else if (navGenre) browse.set("genre", navGenre);
          else if (navCountry) browse.set("country", navCountry);
          browse.set("enrich", "0");
          url = `/api/vibix/videos/browse?${browse.toString()}`;
        } else {
          sp.set("enrich", "0");
          url = `/api/vibix/videos?${sp.toString()}`;
        }

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

        const base = json.data.filter((v) => v.kp_id != null);
        const filtered = isSearchMode && type !== "all" ? base.filter((v) => v.type === type) : base;

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
  }, [page, type, isBrowseMode, isSearchMode, debouncedQuery, homeNonce, navCountry, navGenre, navYear]);

  const PaginationBlock = useMemo(() => {
    if (!pagination.show) return null;
    return (
      <div className="mt-6 flex flex-col items-center gap-2">
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
              <div key={`nav-${p}`} className="flex items-center gap-2">
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
    );
  }, [error, goToPage, isLoading, lastPage, page, pagination.pages, pagination.show]);

  function goToPage(nextPage: number) {
    if (!lastPage) {
      setPage(Math.max(1, nextPage));
      return;
    }
    setPage(Math.min(Math.max(1, nextPage), lastPage));
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:pb-16">
      <div className="mt-6 rounded-[32px] bg-[color:var(--surface)]/60 p-4 sm:p-6">
        <div className="flex gap-6">
          <aside className="hidden w-72 shrink-0 md:block">
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="text-sm font-semibold text-[color:var(--foreground)]">Навигация</div>
              <div className="mt-3 space-y-4 text-xs text-[color:var(--muted)]">
                <div>
                  <div className="mb-2 text-[color:var(--foreground)]">Жанры</div>
                  <div className="grid grid-cols-1 gap-1">
                    {navLists.genres.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          if (navGenre === g) setNavigation(null);
                          else setNavigation({ genre: g });
                        }}
                        className={`text-left hover:text-[color:var(--foreground)] ${
                          navGenre === g ? "text-[color:var(--accent)]" : ""
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[color:var(--foreground)]">По году</div>
                  <div className="grid grid-cols-2 gap-1">
                    {navLists.years.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => {
                          if (navYear === y) setNavigation(null);
                          else setNavigation({ year: y });
                        }}
                        className={`text-left hover:text-[color:var(--foreground)] ${
                          navYear === y ? "text-[color:var(--accent)]" : ""
                        }`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[color:var(--foreground)]">Страны</div>
                  <div className="grid grid-cols-1 gap-1">
                    {navLists.countries.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          if (navCountry === c) setNavigation(null);
                          else setNavigation({ country: c });
                        }}
                        className={`text-left hover:text-[color:var(--foreground)] ${
                          navCountry === c ? "text-[color:var(--accent)]" : ""
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-xs font-semibold text-black">ГЛАВНАЯ</div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs font-semibold text-[color:var(--foreground)]">
                  НОВИНКИ
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs font-semibold text-[color:var(--foreground)]">
                  СЕРИАЛЫ
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-xs font-semibold text-[color:var(--foreground)]">
                  НОВОГОДНИЕ
                </div>
              </div>

              <div className="relative mt-4">
                <button
                  type="button"
                  onClick={() => featuredScrollerRef.current?.scrollBy({ left: -420, behavior: "smooth" })}
                  className="absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)] sm:block"
                  aria-label="Scroll left"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => featuredScrollerRef.current?.scrollBy({ left: 420, behavior: "smooth" })}
                  className="absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)] sm:block"
                  aria-label="Scroll right"
                >
                  ▶
                </button>

                <div
                  ref={featuredScrollerRef}
                  className="overflow-x-auto sm:px-10"
                >
                  <div className="flex w-max gap-3">
                    {featured.map((v) => {
                      const t = pickTitle(v);
                      const href = v.kp_id ? movieSlugHtmlPath(v.kp_id, t) : null;
                      const posterSrc = proxyImageUrl(v.poster_url);
                      const canOptimizePoster = !!posterSrc && posterSrc.startsWith("/api/image-proxy");
                      if (!href || !posterSrc) return null;
                      return (
                        <button
                          key={`ft-${v.id}-${v.kp_id}`}
                          type="button"
                          onClick={() => router.push(href)}
                          title={t}
                          className="relative h-[120px] w-[86px] shrink-0 overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)]"
                        >
                          <Image
                            src={posterSrc}
                            alt={t}
                            fill
                            unoptimized={!canOptimizePoster}
                            className="object-cover"
                            sizes="86px"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-4">
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
                    inputMode="search"
                    enterKeyHint="search"
                    placeholder="Поиск"
                    className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] outline-none focus:border-[color:var(--accent)]"
                  />

                  {isSearchFocused && !isDirectIdQuery && query.trim().length >= 1 ? (
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

                <div className="flex w-full gap-2 sm:w-auto">
                  <button
                    type="button"
                    onClick={onSubmitSearch}
                    className="flex-1 rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-black hover:opacity-90"
                  >
                    Найти
                  </button>
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
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

            {PaginationBlock}

            <div className="mt-6 flex flex-col gap-3">
              {visibleItems.map((v) => (
                <VideoRowCard key={`${v.id}-${v.kp_id ?? "nokp"}`} video={v} />
              ))}
            </div>

            {isLoading
              ? Array.from({ length: 8 }).map((_, idx) => (
                  <div
                    // eslint-disable-next-line react/no-array-index-key
                    key={`sk-${idx}`}
                    className="animate-pulse overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 sm:p-4"
                  >
                    <div className="flex gap-4">
                      <div className="h-[150px] w-[110px] rounded-xl bg-[color:var(--surface-hover)] sm:h-[170px] sm:w-[125px]" />
                      <div className="flex-1">
                        <div className="h-5 w-2/3 rounded bg-[color:var(--surface-hover)]" />
                        <div className="mt-2 h-4 w-1/3 rounded bg-[color:var(--surface-hover)]" />
                        <div className="mt-4 h-4 w-1/2 rounded bg-[color:var(--surface-hover)]" />
                        <div className="mt-2 h-4 w-3/4 rounded bg-[color:var(--surface-hover)]" />
                      </div>
                    </div>
                  </div>
                ))
              : null}

            <div className="h-12" />
          </main>
        </div>
      </div>
    </div>
  );

}
