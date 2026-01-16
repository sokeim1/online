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

function parseRating(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const s = raw.trim().replace(/,/g, ".");
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number.parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatRating(v: VibixVideoLink): string | null {
  const n = parseRating((v.kp_rating ?? v.imdb_rating) as unknown);
  return n == null ? null : n.toFixed(2);
}

function ratingValue(v: VibixVideoLink): number {
  return parseRating((v.kp_rating ?? v.imdb_rating) as unknown) ?? 0;
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenizeTitle(input: string): string[] {
  const stop = new Set([
    "и",
    "в",
    "во",
    "на",
    "по",
    "к",
    "ко",
    "из",
    "от",
    "до",
    "с",
    "со",
    "the",
    "a",
    "an",
    "of",
    "to",
    "in",
    "on",
    "and",
    "or",
  ]);
  const words = normalizeText(input).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3) continue;
    if (stop.has(w)) continue;
    out.push(w);
  }
  return Array.from(new Set(out));
}

function buildFranchiseQuery(seedTitle: string): string {
  const tokens = tokenizeTitle(seedTitle);
  if (!tokens.length) return seedTitle.trim();
  return tokens.slice(0, Math.min(2, tokens.length)).join(" ");
}

function setFromList(items: string[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const v of items ?? []) {
    const n = normalizeText(String(v ?? "")).trim();
    if (n) out.add(n);
  }
  return out;
}

function intersectSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

export function SimilarVideosScroller({
  genres,
  seedTitle,
  year,
  country,
  type,
  excludeKpId,
  title = "Похожие",
}: {
  genres: string[] | null | undefined;
  seedTitle: string;
  year?: number | null;
  country?: string | null;
  type?: "movie" | "serial";
  excludeKpId?: number | null;
  title?: string;
}) {
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<VibixVideoLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const gs = (genres ?? []).map((g) => (g ?? "").trim()).filter(Boolean);
    if (!gs.length) {
      setItems([]);
      return;
    }

    const topGenres = gs.slice(0, 3);
    const seedTokens = tokenizeTitle(seedTitle);
    const seedTokenSet = new Set(seedTokens);
    const seedYear = typeof year === "number" && Number.isFinite(year) ? year : null;
    const seedCountry = (country ?? "").trim() || null;
    const seedType = type ?? null;
    const seedGenreSet = setFromList(gs);
    const franchiseQuery = buildFranchiseQuery(seedTitle);

    const ac = new AbortController();
    setError(null);
    setItems(null);

    void (async () => {
      try {
        const sources: Array<{ kind: "genre" | "country" | "year"; value: string }> = [];
        for (const g of topGenres) sources.push({ kind: "genre", value: g });
        if (seedCountry) sources.push({ kind: "country", value: seedCountry });
        if (seedYear) sources.push({ kind: "year", value: String(seedYear) });

        const titleSearchPromise = franchiseQuery.length >= 2
          ? fetch(
              `/api/vibix/videos/search?name=${encodeURIComponent(franchiseQuery)}&page=1&enrich=1`,
              { signal: ac.signal },
            )
          : null;

        const results = await Promise.allSettled(
          sources.map(async (s) => {
            const sp = new URLSearchParams();
            sp.set(s.kind, s.value);
            sp.set("page", "1");
            sp.set("enrich", "1");
            if (seedType) sp.set("type", seedType);
            const res = await fetch(`/api/vibix/videos/browse?${sp.toString()}`, {
              signal: ac.signal,
            });
            if (!res.ok) {
              const text = await res.text().catch(() => "");
              throw new Error(text ? `HTTP ${res.status}: ${text}` : `HTTP ${res.status}`);
            }
            const json = (await res.json()) as { data?: VibixVideoLink[] };
            return { kind: s.kind, items: json.data ?? [] };
          }),
        );

        let titleItems: VibixVideoLink[] = [];
        if (titleSearchPromise) {
          const res = await titleSearchPromise;
          if (res.ok) {
            const json = (await res.json()) as { data?: VibixVideoLink[] };
            titleItems = json.data ?? [];
          }
        }

        const byKp = new Map<
          number,
          { v: VibixVideoLink; genreHits: number; countryHit: boolean; yearHit: boolean; titleHit: boolean }
        >();
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          for (const v of r.value.items) {
            if (v.kp_id == null) continue;
            if (excludeKpId && v.kp_id === excludeKpId) continue;
            if (seedType && v.type !== seedType) continue;
            const prev = byKp.get(v.kp_id);
            const next = prev ?? { v, genreHits: 0, countryHit: false, yearHit: false, titleHit: false };
            next.v = prev?.v ?? v;
            if (r.value.kind === "genre") next.genreHits += 1;
            if (r.value.kind === "country") next.countryHit = true;
            if (r.value.kind === "year") next.yearHit = true;
            byKp.set(v.kp_id, next);
          }
        }

        for (const v of titleItems) {
          if (v.kp_id == null) continue;
          if (excludeKpId && v.kp_id === excludeKpId) continue;
          if (seedType && v.type !== seedType) continue;
          const prev = byKp.get(v.kp_id);
          const next = prev ?? { v, genreHits: 0, countryHit: false, yearHit: false, titleHit: false };
          next.v = prev?.v ?? v;
          next.titleHit = true;
          byKp.set(v.kp_id, next);
        }

        const ranked = Array.from(byKp.values())
          .map((x) => {
            const candTokens = tokenizeTitle(pickTitle(x.v));
            let common = 0;
            for (const t of candTokens) if (seedTokenSet.has(t)) common += 1;
            const titleOverlap = seedTokens.length ? common / seedTokens.length : 0;
            const candGenreSet = setFromList(x.v.genre ?? []);
            const genreOverlap = seedGenreSet.size ? intersectSize(seedGenreSet, candGenreSet) : 0;
            const genreUnion = seedGenreSet.size + candGenreSet.size - genreOverlap;
            const genreJaccard = genreUnion > 0 ? genreOverlap / genreUnion : 0;
            const rating = ratingValue(x.v);
            const yearDiff = seedYear && x.v.year ? Math.abs(seedYear - x.v.year) : null;
            const candCountrySet = setFromList(x.v.country ?? []);
            const countryExact = seedCountry ? candCountrySet.has(normalizeText(seedCountry)) : false;
            const yearCloseness = yearDiff == null ? 0 : Math.max(0, 1 - Math.min(12, yearDiff) / 12);
            const score =
              genreOverlap * 6 +
              genreJaccard * 10 +
              titleOverlap * 10 +
              (x.titleHit ? 2 : 0) +
              (countryExact ? 1.5 : 0) +
              yearCloseness * 2 +
              Math.min(2, rating / 5);

            return {
              ...x,
              countryExact,
              genreJaccard,
              genreOverlap,
              score,
              titleOverlap,
              rating,
              yearDiff,
            };
          })
          .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.genreOverlap !== a.genreOverlap) return b.genreOverlap - a.genreOverlap;
            if (b.titleOverlap !== a.titleOverlap) return b.titleOverlap - a.titleOverlap;
            if (b.genreHits !== a.genreHits) return b.genreHits - a.genreHits;
            if (b.countryExact !== a.countryExact) return Number(b.countryExact) - Number(a.countryExact);
            if (b.yearHit !== a.yearHit) return Number(b.yearHit) - Number(a.yearHit);
            if (a.yearDiff != null && b.yearDiff != null && a.yearDiff !== b.yearDiff) return a.yearDiff - b.yearDiff;
            if (b.rating !== a.rating) return b.rating - a.rating;
            return (b.v.year ?? 0) - (a.v.year ?? 0);
          });

        const baseMinGenreOverlap = seedGenreSet.size >= 3 ? 2 : seedGenreSet.size >= 2 ? 1 : 0;
        const minTitleOverlap = 0.5;
        const keepRelevant = (x: (typeof ranked)[number]) =>
          x.genreOverlap >= baseMinGenreOverlap || x.titleOverlap >= minTitleOverlap;

        let out = ranked.filter(keepRelevant);
        if (out.length < 10) out = ranked.filter((x) => x.genreOverlap >= 1 || x.titleOverlap >= 0.34);
        if (out.length < 10) out = ranked.filter((x) => x.genreOverlap >= 1 || x.titleOverlap > 0);
        if (out.length < 10) out = ranked;

        setItems(out.map((x) => x.v).slice(0, 16));
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Unknown error");
        setItems([]);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [country, excludeKpId, genres, seedTitle, type, year]);

  const visible = useMemo(() => (items ?? []).filter((v) => proxyImageUrl(v.poster_url)), [items]);

  if (!genres?.length) return null;
  if (error) return null;
  if (items == null) return null;
  if (!visible.length) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[color:var(--foreground)]">{title}</h2>
        <div />
      </div>

      <div className="relative mt-4">
        <button
          type="button"
          onClick={() => scrollerRef.current?.scrollBy({ left: -520, behavior: "smooth" })}
          className="absolute left-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[color:var(--accent)] text-sm font-semibold text-white shadow hover:opacity-90 sm:flex"
          aria-label="Scroll left"
        >
          <span aria-hidden>‹</span>
        </button>
        <button
          type="button"
          onClick={() => scrollerRef.current?.scrollBy({ left: 520, behavior: "smooth" })}
          className="absolute right-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[color:var(--accent)] text-sm font-semibold text-white shadow hover:opacity-90 sm:flex"
          aria-label="Scroll right"
        >
          <span aria-hidden>›</span>
        </button>

        <div ref={scrollerRef} className="no-scrollbar overflow-x-auto sm:px-10">
          <div className="flex w-max gap-4 pr-2">
            {visible.map((v) => {
              const t = pickTitle(v);
              const href = v.kp_id ? movieSlugHtmlPath(v.kp_id, t) : null;
              const posterSrc = proxyImageUrl(v.poster_url);
              const rating = formatRating(v);
              if (!href || !posterSrc) return null;

              return (
                <button
                  key={`sim-${v.id}-${v.kp_id}`}
                  type="button"
                  onClick={() => router.push(href)}
                  className="group w-[130px] shrink-0 text-left sm:w-[150px]"
                  title={t}
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-hover)]">
                    <Image src={posterSrc} alt={t} fill unoptimized className="object-cover" sizes="150px" />

                    {rating ? (
                      <div className="absolute left-2 top-2 rounded-md bg-orange-600 px-2 py-1 text-xs font-semibold text-white shadow">
                        {rating}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 line-clamp-2 text-sm font-medium text-[color:var(--foreground)] transition-colors group-hover:text-[color:var(--title-hover)]">
                    {t}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
