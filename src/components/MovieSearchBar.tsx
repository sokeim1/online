"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

import type { VibixVideoLink, VibixVideoLinksResponse } from "@/lib/vibix";
import { proxyImageUrl } from "@/lib/imageProxy";
import { movieSlugHtmlPath } from "@/lib/movieUrl";

type Props = {
  className?: string;
};

type TaxonomyPayload = {
  genres: Array<{ id: number; name: string | null; name_eng?: string | null; code?: string | null }>;
  countries: Array<{ id: number; name: string | null; name_eng?: string | null; code?: string | null }>;
  categories: Array<{ id: number; name: string | null; name_eng?: string | null; code?: string | null }>;
  tags: Array<{ id: number; name: string | null; name_eng?: string | null; code?: string | null }>;
  voiceovers: Array<{ id: number; name: string | null; name_eng?: string | null; code?: string | null }>;
};

type LgbtMode = "any" | "present" | "absent";

type IdItem = { id: number; name: string | null; name_eng?: string | null; code?: string | null };

function pickTitle(v: VibixVideoLink): string {
  return v.name_rus ?? v.name_eng ?? v.name;
}

function parseResponse(data: unknown): VibixVideoLinksResponse {
  return data as VibixVideoLinksResponse;
}

function formatTypeLabel(type: VibixVideoLink["type"] | null | undefined): string {
  return type === "serial" ? "Сериал" : "Фильм";
}

function labelForItem(x: IdItem): string {
  return x.name ?? x.name_eng ?? x.code ?? String(x.id);
}

export function MovieSearchBar({ className }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<VibixVideoLink[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isGenresOpen, setIsGenresOpen] = useState(false);

  const genresAnchorRef = useRef<HTMLDivElement | null>(null);

  const [taxonomy, setTaxonomy] = useState<TaxonomyPayload | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<"all" | "movie" | "serial">("all");
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [genreIds, setGenreIds] = useState<number[]>([]);
  const [countryIds, setCountryIds] = useState<number[]>([]);
  const [voiceoverIds, setVoiceoverIds] = useState<number[]>([]);
  const [yearFrom, setYearFrom] = useState<string>("");
  const [yearTo, setYearTo] = useState<string>("");
  const [lgbtMode, setLgbtMode] = useState<LgbtMode>("any");

  const lgbtTagId = useMemo(() => {
    if (!taxonomy) return null;
    const pick = taxonomy.tags.find((t) => {
      const hay = `${t.name ?? ""} ${t.name_eng ?? ""} ${t.code ?? ""}`.toLowerCase();
      return hay.includes("лгбт") || hay.includes("lgbt");
    });
    return pick?.id ?? null;
  }, [taxonomy]);

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const out: number[] = [];
    for (let y = current; y >= 1895; y -= 1) out.push(y);
    return out;
  }, []);

  const filterQueryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (filterType !== "all") sp.set("type", filterType);

    categoryIds.forEach((id) => sp.append("categoryId", String(id)));
    genreIds.forEach((id) => sp.append("genreId", String(id)));
    countryIds.forEach((id) => sp.append("countryId", String(id)));
    voiceoverIds.forEach((id) => sp.append("voiceoverId", String(id)));

    if (yearFrom.trim()) sp.set("yearFrom", yearFrom.trim());
    if (yearTo.trim()) sp.set("yearTo", yearTo.trim());

    if (lgbtMode !== "any" && lgbtTagId) {
      if (lgbtMode === "present") sp.append("tagId", String(lgbtTagId));
      if (lgbtMode === "absent") sp.append("excludeTagId", String(lgbtTagId));
    }

    return sp.toString();
  }, [categoryIds, countryIds, filterType, genreIds, lgbtMode, lgbtTagId, voiceoverIds, yearFrom, yearTo]);

  const isDirectIdQuery = useMemo(() => {
    const q = query.trim();
    return /^\d+$/.test(q) || /^tt\d+$/i.test(q);
  }, [query]);

  function applyFiltersToHome() {
    const sp = new URLSearchParams(filterQueryString);
    const q = query.trim();
    if (q) sp.set("q", q);
    const next = sp.toString();
    router.push(next ? `/?${next}` : "/");
    setIsFiltersOpen(false);
    setIsGenresOpen(false);
  }

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

    const sp = new URLSearchParams(filterQueryString);
    sp.set("q", q);
    router.push(`/?${sp.toString()}`);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const t = (sp.get("type") ?? "all").trim();
    setFilterType(t === "movie" || t === "serial" ? t : "all");

    const parseIds = (key: string) =>
      sp
        .getAll(key)
        .map((x) => Number.parseInt(x, 10))
        .filter((n) => Number.isFinite(n));

    setCategoryIds(parseIds("categoryId"));
    setGenreIds(parseIds("genreId"));
    setCountryIds(parseIds("countryId"));
    setVoiceoverIds(parseIds("voiceoverId"));

    setYearFrom(sp.get("yearFrom") ?? "");
    setYearTo(sp.get("yearTo") ?? "");
  }, [pathname]);

  useEffect(() => {
    if (!isFiltersOpen) return;
    if (taxonomy) return;

    const ac = new AbortController();
    void (async () => {
      setTaxonomyError(null);
      try {
        const res = await fetch("/api/vibix/taxonomy", { signal: ac.signal });
        const json = (await res.json()) as
          | { success: true; data: TaxonomyPayload }
          | { success: false; message: string };
        if (!res.ok || !json.success) {
          throw new Error("message" in json ? json.message : `HTTP ${res.status}`);
        }
        setTaxonomy(json.data);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setTaxonomyError(e instanceof Error ? e.message : "Unknown error");
      }
    })();

    return () => ac.abort();
  }, [isFiltersOpen, taxonomy]);

  useEffect(() => {
    if (!isFiltersOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsFiltersOpen(false);
        setIsGenresOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFiltersOpen]);

  useEffect(() => {
    if (!isGenresOpen) return;
    function onDown(e: MouseEvent) {
      const anchor = genresAnchorRef.current;
      if (anchor && e.target instanceof Node && anchor.contains(e.target)) return;
      setIsGenresOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isGenresOpen]);

  useEffect(() => {
    if (!taxonomy) return;
    if (typeof window === "undefined") return;
    if (!lgbtTagId) return;
    const sp = new URLSearchParams(window.location.search);
    const tags = sp
      .getAll("tagId")
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isFinite(n));
    const excl = sp
      .getAll("excludeTagId")
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isFinite(n));
    if (tags.includes(lgbtTagId)) setLgbtMode("present");
    else if (excl.includes(lgbtTagId)) setLgbtMode("absent");
    else setLgbtMode("any");
  }, [lgbtTagId, taxonomy]);

  function resetFilters() {
    setFilterType("all");
    setCategoryIds([]);
    setGenreIds([]);
    setCountryIds([]);
    setVoiceoverIds([]);
    setYearFrom("");
    setYearTo("");
    setLgbtMode("any");
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
        sp.set("enrich", "0");
        const extra = new URLSearchParams(filterQueryString);
        extra.forEach((value, key) => {
          sp.append(key, value);
        });
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
  }, [filterQueryString, isDirectIdQuery, query]);

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
            inputMode="search"
            enterKeyHint="search"
            placeholder="Поиск"
            className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] outline-none focus:border-[color:var(--accent)]"
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
                            {s.year ?? "—"} • {formatTypeLabel(s.type)}
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

        <div className="flex items-center gap-2 sm:shrink-0">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setIsFiltersOpen((v) => {
                const next = !v;
                if (!next) setIsGenresOpen(false);
                return next;
              });
            }}
            className="grid h-11 w-11 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
            aria-label="Фильтры"
            title="Фильтры"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M4 6h10m4 0h2M8 6a2 2 0 1 0-4 0a2 2 0 0 0 4 0zm0 12h10m4 0h2M8 18a2 2 0 1 0-4 0a2 2 0 0 0 4 0zM14 12h6m4 0h0M14 12a2 2 0 1 0-4 0a2 2 0 0 0 4 0z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={onSubmitSearch}
            className="min-h-11 flex-1 rounded-xl bg-[color:var(--accent)] px-4 py-3 text-sm font-medium text-black hover:opacity-90 sm:flex-none"
          >
            Найти
          </button>
        </div>
      </div>

      <div
        className={`${
          isFiltersOpen && isGenresOpen ? "overflow-visible" : "overflow-hidden"
        } transition-[max-height,opacity,transform] duration-200 ${
          isFiltersOpen ? "mt-2 max-h-[1200px] opacity-100 translate-y-0" : "max-h-0 opacity-0 -translate-y-1"
        }`}
        style={{ pointerEvents: isFiltersOpen ? "auto" : "none" }}
      >
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">Фильтры</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => resetFilters()}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
              >
                Сбросить
              </button>
              <button
                type="button"
                onClick={() => setIsFiltersOpen(false)}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
              >
                Свернуть
              </button>
            </div>
          </div>

          {taxonomyError ? (
            <div className="mt-3 rounded-2xl border border-[color:var(--danger)]/30 bg-[color:var(--danger-soft)] p-4 text-sm text-[color:var(--foreground)]">
              <div className="whitespace-pre-wrap text-[color:var(--muted)]">{taxonomyError}</div>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="w-full">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as "all" | "movie" | "serial")}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)]"
              >
                <option value="all">Все типы</option>
                <option value="movie">Фильмы</option>
                <option value="serial">Сериалы</option>
              </select>
            </div>

            <div className="w-full">
              <select
                value={categoryIds[0] ? String(categoryIds[0]) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const id = v ? Number.parseInt(v, 10) : NaN;
                  setCategoryIds(Number.isFinite(id) ? [id] : []);
                }}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)]"
              >
                <option value="">Все разделы</option>
                {(taxonomy?.categories ?? []).map((c) => (
                  <option key={`c-opt-${c.id}`} value={String(c.id)}>
                    {labelForItem(c)}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full">
              <select
                value={countryIds[0] ? String(countryIds[0]) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const id = v ? Number.parseInt(v, 10) : NaN;
                  setCountryIds(Number.isFinite(id) ? [id] : []);
                }}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)]"
              >
                <option value="">Все страны</option>
                {(taxonomy?.countries ?? []).map((c) => (
                  <option key={`co-opt-${c.id}`} value={String(c.id)}>
                    {labelForItem(c)}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full">
              <select
                value={voiceoverIds[0] ? String(voiceoverIds[0]) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const id = v ? Number.parseInt(v, 10) : NaN;
                  setVoiceoverIds(Number.isFinite(id) ? [id] : []);
                }}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)]"
              >
                <option value="">Все озвучки</option>
                {(taxonomy?.voiceovers ?? []).map((v) => (
                  <option key={`vo-opt-${v.id}`} value={String(v.id)}>
                    {labelForItem(v)}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full">
              <select
                value={yearFrom}
                onChange={(e) => {
                  const y = e.target.value;
                  setYearFrom(y);
                  setYearTo(y);
                }}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)]"
              >
                <option value="">Выбрать год</option>
                {yearOptions.map((y) => (
                  <option key={`y-${y}`} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full">
              <select
                value={lgbtMode}
                onChange={(e) => setLgbtMode(e.target.value as LgbtMode)}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)]"
              >
                <option value="any">ЛГБТ: любой</option>
                <option value="present" disabled={!lgbtTagId}>
                  ЛГБТ: присутствует
                </option>
                <option value="absent" disabled={!lgbtTagId}>
                  ЛГБТ: отсутствует
                </option>
              </select>
            </div>

            <div ref={genresAnchorRef} className="relative w-full">
              <button
                type="button"
                onClick={() => setIsGenresOpen((v) => !v)}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-left text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
              >
                {genreIds.length ? `Выбрать жанр (${genreIds.length})` : "Выбрать жанр"}
              </button>

              {isGenresOpen ? (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--background)] shadow-xl">
                  <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                    <div className="text-xs text-[color:var(--muted)]">Подобрать жанры</div>
                    <button
                      type="button"
                      onClick={() => setGenreIds([])}
                      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1 text-xs text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
                    >
                      Сбросить
                    </button>
                  </div>
                  <div className="max-h-80 overflow-auto p-2">
                    {(taxonomy?.genres ?? []).map((g) => {
                      const checked = genreIds.includes(g.id);
                      return (
                        <label
                          key={`g-dd-${g.id}`}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setGenreIds((prev) => (checked ? prev.filter((x) => x !== g.id) : prev.concat(g.id)));
                            }}
                          />
                          <span className="min-w-0 truncate">{labelForItem(g)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => {
                resetFilters();
                applyFiltersToHome();
              }}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
            >
              Сбросить и применить
            </button>
            <button
              type="button"
              onClick={applyFiltersToHome}
              className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-black hover:opacity-90"
            >
              Применить
            </button>
          </div>
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
