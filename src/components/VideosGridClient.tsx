"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

import type { VibixVideoLink, VibixVideoType, VibixVideoLinksResponse } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

import { VideoRowCard } from "@/components/VideoRowCard";

type TypeFilter = VibixVideoType | "all";

const FILTER_KEYS = [
  "categoryId",
  "genreId",
  "countryId",
  "voiceoverId",
  "yearFrom",
  "yearTo",
  "tagId",
  "excludeTagId",
] as const;

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

function pickRatingValue(v: VibixVideoLink): number {
  const raw = (v.kp_rating ?? v.imdb_rating) as unknown;
  const n = parseRating(raw);
  return Number.isFinite(n) ? n : -1;
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

  const filtersKey = useMemo(() => {
    return FILTER_KEYS
      .flatMap((k) => searchParams.getAll(k).map((v) => `${k}=${v}`))
      .sort()
      .join("&");
  }, [searchParams]);

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeNonce, setHomeNonce] = useState(0);

  const [debouncedQuery, setDebouncedQuery] = useState(() => (initialQ ?? "").trim());

  const [navGenre, setNavGenre] = useState<string | null>(null);
  const [navCountry, setNavCountry] = useState<string | null>(null);
  const [navYear, setNavYear] = useState<number | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const featuredNewScrollerRef = useRef<HTMLDivElement | null>(null);
  const [featuredNewItems, setFeaturedNewItems] = useState<VibixVideoLink[]>([]);

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
      setIsMobileNavOpen(false);
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

    setDebouncedQuery("");
    setIsMobileNavOpen(false);
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
      setDebouncedQuery(nextDebounced);
      setNavYear(nextYear);
      setNavGenre(nextGenre);
      setNavCountry(nextCountry);
      return;
    }

    setType((prev) => (prev === nextType ? prev : nextType));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setDebouncedQuery((prev) => (prev === nextDebounced ? prev : nextDebounced));
    setNavYear((prev) => (prev === nextYear ? prev : nextYear));
    setNavGenre((prev) => (prev === nextGenre ? prev : nextGenre));
    setNavCountry((prev) => (prev === nextCountry ? prev : nextCountry));
  }, [searchParams]);

  useEffect(() => {
    if (!didInitFromUrl.current) return;

    const sp = new URLSearchParams(searchParams.toString());
    const q = debouncedQuery.trim();
    sp.delete("name");
    if (q) sp.set("q", q);
    else sp.delete("q");

    if (type !== "all") sp.set("type", type);
    else sp.delete("type");

    if (page !== 1) sp.set("page", String(page));
    else sp.delete("page");

    if (!q) {
      sp.delete("year");
      sp.delete("genre");
      sp.delete("country");

      if (navYear != null) sp.set("year", String(navYear));
      else if (navGenre) sp.set("genre", navGenre);
      else if (navCountry) sp.set("country", navCountry);
    } else {
      sp.delete("year");
      sp.delete("genre");
      sp.delete("country");
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

  useEffect(() => {
    function onHome() {
      setDebouncedQuery("");
      setType("all");
      setItems([]);
      setPage(1);
      setLastPage(null);
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

  const featuredNew = useMemo(() => {
    const base = (featuredNewItems ?? []).slice().sort((a, b) => {
      const ay = typeof a.year === "number" && Number.isFinite(a.year) ? a.year : -1;
      const by = typeof b.year === "number" && Number.isFinite(b.year) ? b.year : -1;
      if (by !== ay) return by - ay;

      const at = Date.parse(a.uploaded_at ?? "") || 0;
      const bt = Date.parse(b.uploaded_at ?? "") || 0;
      if (bt !== at) return bt - at;

      return b.id - a.id;
    });
    return base.slice(0, 12);
  }, [featuredNewItems]);

  useEffect(() => {
    const ac = new AbortController();
    async function loadFeaturedNewByYear() {
      try {
        const target = 24;
        const dedup = new Map<number, VibixVideoLink>();
        for (let p = 1; p <= 5 && dedup.size < target; p += 1) {
          const sp = new URLSearchParams();
          sp.set("page", String(p));
          sp.set("limit", "20");

          const res = await fetch(`/api/flixcdn/videos?${sp.toString()}`, { signal: ac.signal });
          if (!res.ok) break;
          const json = parseResponse(await res.json());
          const rows = json.data ?? [];
          if (!rows.length) break;
          for (const v of rows) {
            if (!dedup.has(v.id)) dedup.set(v.id, v);
            if (dedup.size >= target) break;
          }
          const last = json.meta?.last_page ?? 1;
          if (p >= last) break;
        }

        setFeaturedNewItems(Array.from(dedup.values()));
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    void loadFeaturedNewByYear();
    return () => ac.abort();
  }, [homeNonce]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  useEffect(() => {
    // when switching to search mode, reset pagination
    setItems([]);
    setPage(1);
    setLastPage(null);
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

        for (const k of FILTER_KEYS) {
          for (const v of searchParams.getAll(k)) {
            sp.append(k, v);
          }
        }

        let url: string;
        if (isSearchMode) {
          const search = new URLSearchParams(sp);
          search.delete("name");
          search.set("title", debouncedQuery);
          url = `/api/flixcdn/videos/search?${search.toString()}`;
        } else if (isBrowseMode) {
          const browse = new URLSearchParams(Object.fromEntries(sp.entries()));
          browse.delete("limit");
          FILTER_KEYS.forEach((k) => browse.delete(k));
          if (navYear != null) browse.set("year", String(navYear));
          else if (navGenre) browse.set("genre", navGenre);
          else if (navCountry) browse.set("country", navCountry);
          url = `/api/vibix/videos/browse?${browse.toString()}`;
        } else {
          url = `/api/flixcdn/videos?${sp.toString()}`;
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

        const base = json.data;
        const filtered = isSearchMode && type !== "all" ? base.filter((v) => v.type === type) : base;

        const withOrdering =
          !isSearchMode
            ? filtered
                .slice()
                .sort((a, b) => {
                  const av = pickRatingValue(a);
                  const bv = pickRatingValue(b);
                  if (bv !== av) return bv - av;

                  const ay = typeof a.year === "number" && Number.isFinite(a.year) ? a.year : -1;
                  const by = typeof b.year === "number" && Number.isFinite(b.year) ? b.year : -1;
                  if (by !== ay) return by - ay;

                  return b.id - a.id;
                })
            : filtered;

        setItems(withOrdering);
        if (isSearchMode && type !== "all") {
          setLastPage(1);
        } else {
          setLastPage(json.meta?.last_page ?? null);
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
  }, [page, type, isBrowseMode, isSearchMode, debouncedQuery, homeNonce, navCountry, navGenre, navYear, filtersKey]);

  const PaginationBlock = useMemo(() => {
    if (!pagination.show) return null;
    return (
      <div className="mt-6 flex flex-col items-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || isLoading || !!error}
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--foreground)] disabled:opacity-40 sm:px-5 sm:py-3 sm:text-sm"
          >
            Назад
          </button>

          {pagination.pages.map((p, idx) => {
            const prev = pagination.pages[idx - 1];
            const showDots = prev != null && p - prev > 1;

            return (
              <div key={`nav-${p}`} className="flex items-center gap-2">
                {showDots ? <span className="px-1 text-xs text-[color:var(--muted)]">…</span> : null}
                <button
                  type="button"
                  onClick={() => goToPage(p)}
                  disabled={isLoading || !!error}
                  className={`min-w-10 rounded-2xl border px-3 py-2 text-xs transition disabled:opacity-40 sm:min-w-12 sm:px-5 sm:py-3 sm:text-sm ${
                    p === page
                      ? "border-[color:var(--border)] bg-[color:var(--pagination-active)] text-white"
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
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--foreground)] disabled:opacity-40 sm:px-5 sm:py-3 sm:text-sm"
          >
            Вперёд
          </button>
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
    <div className="mx-auto w-full max-w-7xl px-3 pb-12 sm:px-4 sm:pb-16">
      <div className="mt-4 rounded-[28px] bg-[color:var(--surface)]/80 p-3 backdrop-blur-xl sm:mt-6 sm:rounded-[32px] sm:p-6">
        <div className="flex gap-4 sm:gap-6">
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
            <div className="mb-4 md:hidden">
              <button
                type="button"
                onClick={() => setIsMobileNavOpen((v) => !v)}
                className="w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-left text-sm font-semibold text-[color:var(--foreground)]"
              >
                Навигация
              </button>

              {isMobileNavOpen ? (
                <div className="mt-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <div className="space-y-4 text-xs text-[color:var(--muted)]">
                    <div>
                      <div className="mb-2 text-[color:var(--foreground)]">Жанры</div>
                      <div className="grid grid-cols-2 gap-1">
                        {navLists.genres.map((g) => (
                          <button
                            key={`m-${g}`}
                            type="button"
                            onClick={() => {
                              if (navGenre === g) setNavigation(null);
                              else setNavigation({ genre: g });
                            }}
                            className={`rounded-lg border px-2 py-1 text-left transition ${
                              navGenre === g
                                ? "border-[color:var(--accent)] bg-[color:var(--surface-hover)] text-[color:var(--foreground)]"
                                : "border-[color:var(--border)] bg-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)]"
                            }`}
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[color:var(--foreground)]">По году</div>
                      <div className="grid grid-cols-3 gap-1">
                        {navLists.years.map((y) => (
                          <button
                            key={`my-${y}`}
                            type="button"
                            onClick={() => {
                              if (navYear === y) setNavigation(null);
                              else setNavigation({ year: y });
                            }}
                            className={`rounded-lg border px-2 py-1 text-left transition ${
                              navYear === y
                                ? "border-[color:var(--accent)] bg-[color:var(--surface-hover)] text-[color:var(--foreground)]"
                                : "border-[color:var(--border)] bg-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)]"
                            }`}
                          >
                            {y}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[color:var(--foreground)]">Страны</div>
                      <div className="grid grid-cols-2 gap-1">
                        {navLists.countries.map((c) => (
                          <button
                            key={`mc-${c}`}
                            type="button"
                            onClick={() => {
                              if (navCountry === c) setNavigation(null);
                              else setNavigation({ country: c });
                            }}
                            className={`rounded-lg border px-2 py-1 text-left transition ${
                              navCountry === c
                                ? "border-[color:var(--accent)] bg-[color:var(--surface-hover)] text-[color:var(--foreground)]"
                                : "border-[color:var(--border)] bg-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-hover)]"
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 sm:p-4">
              <div className="text-sm font-semibold text-[color:var(--foreground)] sm:text-base">
                Новые фильмы, сериалы, мультфильмы и аниме
              </div>

              <div className="relative mt-4">
                <button
                  type="button"
                  onClick={() => featuredNewScrollerRef.current?.scrollBy({ left: -420, behavior: "smooth" })}
                  className="absolute left-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[color:var(--accent)] text-sm font-semibold text-white shadow hover:opacity-90 sm:flex"
                  aria-label="Scroll left"
                >
                  <span aria-hidden>‹</span>
                </button>
                <button
                  type="button"
                  onClick={() => featuredNewScrollerRef.current?.scrollBy({ left: 420, behavior: "smooth" })}
                  className="absolute right-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[color:var(--accent)] text-sm font-semibold text-white shadow hover:opacity-90 sm:flex"
                  aria-label="Scroll right"
                >
                  <span aria-hidden>›</span>
                </button>

                <div
                  ref={featuredNewScrollerRef}
                  className="no-scrollbar overflow-x-auto sm:px-10"
                >
                  <div className="flex w-max gap-3">
                    {featuredNew.map((v) => {
                      const t = pickTitle(v);
                      const href = v.kp_id ? movieSlugHtmlPath(v.kp_id, t) : null;
                      const posterSrc = proxyImageUrl(v.poster_url);
                      const rating = formatRating(v);

                      const body = (
                        <>
                          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)]">
                            {posterSrc ? (
                              <Image
                                src={posterSrc}
                                alt={t}
                                fill
                                unoptimized
                                className="object-cover"
                                sizes="(min-width: 640px) 140px, 120px"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-[color:var(--muted)]">
                                Нет постера
                              </div>
                            )}

                            {rating ? (
                              <div className="absolute left-1 top-1 rounded bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow">
                                {rating}
                              </div>
                            ) : null}
                          </div>

                          <div className="mt-2 line-clamp-2 text-xs font-medium text-[color:var(--foreground)] transition-colors group-hover:text-[color:var(--title-hover)]">
                            {t}
                          </div>
                        </>
                      );

                      return href ? (
                        <button
                          key={`ft-${v.id}-${v.kp_id}`}
                          type="button"
                          onClick={() => router.push(href)}
                          title={t}
                          className="group w-[120px] shrink-0 text-left sm:w-[140px]"
                        >
                          {body}
                        </button>
                      ) : (
                        <div key={`ft-${v.id}-nokp`} title={t} className="group w-[120px] shrink-0 text-left sm:w-[140px]">
                          {body}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-auto w-full max-w-3xl pt-4">
              {PaginationBlock}

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
                        setDebouncedQuery("");
                        router.push("/");
                      }}
                      className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-black hover:opacity-90"
                    >
                      На главную
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-6 flex flex-col gap-3">
                {visibleItems.map((v) => (
                  <VideoRowCard key={`${v.id}-${v.kp_id ?? "nokp"}`} video={v} />
                ))}
              </div>

              {PaginationBlock}
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
