export type FlixcdnContentType = "movie" | "serial";

export type FlixcdnTranslation = {
  id: number | string;
  title: string;
  season?: string | null;
  episode?: string | null;
};

export type FlixcdnSearchItem = {
  id: number;
  created_at?: string | null;
  type: FlixcdnContentType;
  title_rus?: string | null;
  title_orig?: string | null;
  quality?: string | null;
  year?: string | number | null;
  kinopoisk_id?: string | number | null;
  imdb_id?: string | null;
  description?: string | null;
  poster?: string | null;
  duration?: string | null;
  slogan?: string | null;
  age?: string | null;
  iframe_url?: string | null;
  genres?: string[] | null;
  countries?: string[] | null;
  translations?: FlixcdnTranslation[] | null;
  season?: string | null;
  episode?: string | null;
};

export type FlixcdnSearchResponse = {
  prev: { offset: number; limit: number } | null;
  result: FlixcdnSearchItem[];
  next: { offset: number; limit: number } | null;
};

export type FlixcdnUpdatesResponse = FlixcdnSearchResponse;

export function getFlixcdnApiBase(): string {
  return process.env.FLIXCDN_API_BASE?.trim() || "https://api0.flixcdn.biz";
}

export function getFlixcdnToken(): string {
  const t = process.env.FLIXCDN_TOKEN?.trim();
  if (!t) throw new Error("Missing env: FLIXCDN_TOKEN");
  return t;
}

export type FlixcdnSearchQuery = {
  title?: string;
  kinopoisk_id?: number;
  imdb_id?: string;
  offset?: number;
  limit?: number;
};

export async function flixcdnSearch(query: FlixcdnSearchQuery): Promise<FlixcdnSearchResponse> {
  const base = getFlixcdnApiBase().replace(/\/$/, "");
  const url = new URL(`${base}/api/search`);
  url.searchParams.set("token", getFlixcdnToken());

  if (query.title) url.searchParams.set("title", query.title);
  if (query.kinopoisk_id != null) url.searchParams.set("kinopoisk_id", String(query.kinopoisk_id));
  if (query.imdb_id) url.searchParams.set("imdb_id", query.imdb_id);
  if (query.offset != null) url.searchParams.set("offset", String(query.offset));
  if (query.limit != null) url.searchParams.set("limit", String(query.limit));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FlixCDN API error ${res.status}: ${text}`);
  }

  return (await res.json()) as FlixcdnSearchResponse;
}

export type FlixcdnUpdatesQuery = {
  offset?: number;
  limit?: number;
};

export async function flixcdnUpdates(query: FlixcdnUpdatesQuery): Promise<FlixcdnUpdatesResponse> {
  const base = getFlixcdnApiBase().replace(/\/$/, "");
  const url = new URL(`${base}/api/updates`);
  url.searchParams.set("token", getFlixcdnToken());

  if (query.offset != null) url.searchParams.set("offset", String(query.offset));
  if (query.limit != null) url.searchParams.set("limit", String(query.limit));

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FlixCDN API error ${res.status}: ${text}`);
  }

  return (await res.json()) as FlixcdnUpdatesResponse;
}

export function parseFlixcdnYear(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const m = raw.match(/\d{4}/);
    if (!m) return null;
    const n = Number.parseInt(m[0], 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseFlixcdnInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
