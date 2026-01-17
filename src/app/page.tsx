import { Suspense } from "react";
import { Header } from "@/components/Header";
import { VideosGridClient } from "@/components/VideosGridClient";
import type { VibixVideoLinksResponse } from "@/lib/vibix";

function parseRating(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const s = raw.trim().replace(/,/g, ".");
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return -1;
    const n = Number.parseFloat(m[0]);
    return Number.isFinite(n) ? n : -1;
  }
  return -1;
}

function ratingValue(v: VibixVideoLinksResponse["data"][number]): number {
  return Math.max(parseRating((v as unknown as { kp_rating?: unknown }).kp_rating), parseRating((v as unknown as { imdb_rating?: unknown }).imdb_rating));
}

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const sp = searchParams ? await searchParams : undefined;

  const qRaw = sp?.q ?? sp?.name;
  const q = typeof qRaw === "string" ? qRaw : "";
  const typeRaw = sp?.type;
  const type = typeof typeRaw === "string" ? typeRaw : "all";
  const pageRaw = sp?.page;
  const page = typeof pageRaw === "string" ? pageRaw : "1";

  const pageNum = Number.parseInt(page, 10);
  const safePage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
  const hasBrowse = typeof sp?.year === "string" || typeof sp?.genre === "string" || typeof sp?.country === "string";

  const canSsrList = q.trim().length === 0 && !hasBrowse;

  let initialItems = [] as VibixVideoLinksResponse["data"];
  let initialLastPage: number | null = null;
  let initialTotal: number | null = null;

  if (canSsrList) {
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(safePage));
      qs.set("limit", "20");
      qs.set("enrich", "1");
      if (type === "movie" || type === "serial") qs.set("type", type);

      const res = await fetch(`/api/flixcdn/videos?${qs.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as VibixVideoLinksResponse;
        initialItems = data.data.slice()
          .sort((a, b) => {
            const ar = ratingValue(a);
            const br = ratingValue(b);
            if (br !== ar) return br - ar;

            const ay = typeof a.year === "number" && Number.isFinite(a.year) ? a.year : -1;
            const by = typeof b.year === "number" && Number.isFinite(b.year) ? b.year : -1;
            if (by !== ay) return by - ay;

            return b.id - a.id;
          });
        initialLastPage = null;
        initialTotal = null;
      }
    } catch {
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <Header />
      <Suspense fallback={null}>
        <VideosGridClient
          initialQ={q}
          initialType={type}
          initialPage={page}
          {...(canSsrList
            ? {
                initialItems,
                initialLastPage,
                initialTotal,
              }
            : null)}
        />
      </Suspense>
    </div>
  );
}
