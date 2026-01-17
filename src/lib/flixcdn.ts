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

export function getFlixcdnApiBases(): string[] {
  const raw = process.env.FLIXCDN_API_BASES?.trim();
  if (raw) {
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\/$/, ""));
    if (list.length) return list;
  }
  return [getFlixcdnApiBase().replace(/\/$/, "")];
}

export function getFlixcdnToken(): string {
  const t = process.env.FLIXCDN_TOKEN?.trim();
  if (!t) throw new Error("Missing env: FLIXCDN_TOKEN");
  return t;
}

function summarizeUpstreamBody(body: string): string {
  const trimmed = String(body ?? "").trim();
  if (!trimmed) return "";
  const noTags = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return noTags.length > 220 ? `${noTags.slice(0, 220)}…` : noTags;
}

async function fetchJsonWithRetry(url: string, { timeoutMs, attempts }: { timeoutMs: number; attempts: number }): Promise<unknown> {
  let lastErr: unknown = null;

  for (let i = 0; i < attempts; i += 1) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: ac.signal,
      });

      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(`FlixCDN API error ${res.status}: ${summarizeUpstreamBody(text)}`);
      }

      try {
        return text ? (JSON.parse(text) as unknown) : null;
      } catch {
        return null;
      }
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }

    await new Promise((r) => setTimeout(r, 150 * (i + 1)));
  }

  throw lastErr instanceof Error ? lastErr : new Error("FlixCDN upstream request failed");
}

function normalizeFlixcdnResponse(raw: unknown): FlixcdnSearchResponse {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;

  const resultRaw = obj?.result;
  const result = Array.isArray(resultRaw) ? (resultRaw as FlixcdnSearchItem[]) : [];

  const parseNav = (v: unknown): { offset: number; limit: number } | null => {
    if (!v || typeof v !== "object") return null;
    const nav = v as Record<string, unknown>;
    const off = parseFlixcdnInt(nav.offset);
    const lim = parseFlixcdnInt(nav.limit);
    if (off == null || lim == null) return null;
    return { offset: off, limit: lim };
  };

  return {
    prev: parseNav(obj?.prev),
    next: parseNav(obj?.next),
    result,
  };
}

export type FlixcdnSearchQuery = {
  title?: string;
  kinopoisk_id?: number;
  imdb_id?: string;
  offset?: number;
  limit?: number;
};

export type FlixcdnRequestOpts = {
  timeoutMs?: number;
  attempts?: number;
};

export async function flixcdnSearch(query: FlixcdnSearchQuery, opts?: FlixcdnRequestOpts): Promise<FlixcdnSearchResponse> {
  const bases = getFlixcdnApiBases();
  const token = getFlixcdnToken();

  const timeoutMs = typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 3000;
  const attempts = typeof opts?.attempts === "number" && Number.isFinite(opts.attempts) && opts.attempts > 0 ? opts.attempts : 2;

  let lastErr: unknown = null;
  for (const base of bases) {
    const url = new URL(`${base}/api/search`);
    url.searchParams.set("token", token);

    if (query.title) url.searchParams.set("title", query.title);
    if (query.kinopoisk_id != null) url.searchParams.set("kinopoisk_id", String(query.kinopoisk_id));
    if (query.imdb_id) url.searchParams.set("imdb_id", query.imdb_id);
    if (query.offset != null) url.searchParams.set("offset", String(query.offset));
    if (query.limit != null) url.searchParams.set("limit", String(query.limit));

    try {
      const json = await fetchJsonWithRetry(url.toString(), { timeoutMs, attempts });
      return normalizeFlixcdnResponse(json);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("FlixCDN search failed");
}

export type FlixcdnUpdatesQuery = {
  offset?: number;
  limit?: number;
};

export async function flixcdnUpdates(query: FlixcdnUpdatesQuery, opts?: FlixcdnRequestOpts): Promise<FlixcdnUpdatesResponse> {
  const bases = getFlixcdnApiBases();
  const token = getFlixcdnToken();

  const timeoutMs = typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 3000;
  const attempts = typeof opts?.attempts === "number" && Number.isFinite(opts.attempts) && opts.attempts > 0 ? opts.attempts : 2;

  let lastErr: unknown = null;
  for (const base of bases) {
    const url = new URL(`${base}/api/updates`);
    url.searchParams.set("token", token);
    if (query.offset != null) url.searchParams.set("offset", String(query.offset));
    if (query.limit != null) url.searchParams.set("limit", String(query.limit));

    try {
      const json = await fetchJsonWithRetry(url.toString(), { timeoutMs, attempts });
      return normalizeFlixcdnResponse(json);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("FlixCDN updates failed");
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
