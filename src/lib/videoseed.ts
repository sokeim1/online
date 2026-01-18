export type VideoseedListKind = "movie" | "serial" | "category" | "country";

export type VideoseedItemKind = "movie" | "serial";

export type VideoseedApiResponse = {
  status?: unknown;
  data?: unknown;
  total?: unknown;
  prev_page?: unknown;
  next_page?: unknown;
};

export type VideoseedContentItem = {
  name?: unknown;
  original_name?: unknown;
  year?: unknown;
  id?: unknown;
  id_kp?: unknown;
  id_imdb?: unknown;
  id_tmdb?: unknown;
  date?: unknown;
  poster?: unknown;
  description?: unknown;
  genre?: unknown;
  country?: unknown;
  iframe?: unknown;
  translation?: unknown;
  translation_iframe?: unknown;
  last_content_date?: unknown;
  last_add_element?: unknown;
};

export type VideoseedListResponse = {
  ok: boolean;
  status: number;
  data: VideoseedContentItem[];
  total: number | null;
  prevPage: number | null;
  nextPage: number | null;
};

function getVideoseedApiBase(): string {
  const raw = process.env.VIDEOSEED_API_BASE?.trim() ?? "";
  if (raw && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.hostname) return raw;
    } catch {
    }
  }
  return "https://api.videoseed.tv/apiv2.php";
}

export function getVideoseedToken(): string {
  const t = process.env.VIDEOSEED_TOKEN?.trim();
  if (!t) throw new Error("Missing env: VIDEOSEED_TOKEN");
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
        throw new Error(`Videoseed API error ${res.status}: ${summarizeUpstreamBody(text)}`);
      }

      try {
        return text ? (JSON.parse(text) as unknown) : null;
      } catch {
        if (text && text.trim()) {
          throw new Error(`Videoseed API invalid JSON: ${summarizeUpstreamBody(text)}`);
        }
        return null;
      }
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }

    await new Promise((r) => setTimeout(r, 150 * (i + 1)));
  }

  throw lastErr instanceof Error ? lastErr : new Error("Videoseed upstream request failed");
}

function parseIntLoose(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const m = raw.match(/-?\d+/);
    if (!m) return null;
    const n = Number.parseInt(m[0], 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseVideoseedYear(raw: unknown): number | null {
  const n = parseIntLoose(raw);
  if (n == null) return null;
  return n > 1800 && n < 2100 ? n : null;
}

function normalizeListPayload(raw: unknown): VideoseedListResponse {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as VideoseedApiResponse) : null;
  const statusRaw = obj?.status;
  const ok = typeof statusRaw === "string" ? statusRaw.toLowerCase() === "success" : true;

  const dataRaw = obj?.data;
  const data = Array.isArray(dataRaw) ? (dataRaw as VideoseedContentItem[]) : [];

  const total = parseIntLoose(obj?.total);
  const prevPage = parseIntLoose(obj?.prev_page);
  const nextPage = parseIntLoose(obj?.next_page);

  return { ok, status: ok ? 200 : 502, data, total, prevPage, nextPage };
}

export type VideoseedListQuery = {
  list: VideoseedListKind;
  page?: number;
  items?: number;
  sortBy?: string;
  q?: string;
  kp?: number;
  imdb?: string;
  tmdb?: string;
  categories?: string;
  releaseYearFrom?: number;
  releaseYearTo?: number;
};

export async function videoseedList(query: VideoseedListQuery, opts?: { timeoutMs?: number; attempts?: number }): Promise<VideoseedListResponse> {
  const base = getVideoseedApiBase();
  const token = getVideoseedToken();

  const timeoutMs = typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 5000;
  const attempts = typeof opts?.attempts === "number" && Number.isFinite(opts.attempts) && opts.attempts > 0 ? opts.attempts : 2;

  const url = new URL(base);
  url.searchParams.set("token", token);
  url.searchParams.set("list", query.list);

  if (query.page != null) url.searchParams.set("from", String(query.page));
  if (query.items != null) url.searchParams.set("items", String(query.items));
  if (query.sortBy) url.searchParams.set("sort_by", query.sortBy);

  if (query.q) url.searchParams.set("q", query.q);
  if (query.kp != null) url.searchParams.set("kp", String(query.kp));
  if (query.imdb) url.searchParams.set("imdb", query.imdb);
  if (query.tmdb) url.searchParams.set("tmdb", query.tmdb);
  if (query.categories) url.searchParams.set("categories", query.categories);

  if (query.releaseYearFrom != null) url.searchParams.set("release_year_from", String(query.releaseYearFrom));
  if (query.releaseYearTo != null) url.searchParams.set("release_year_to", String(query.releaseYearTo));

  const json = await fetchJsonWithRetry(url.toString(), { timeoutMs, attempts });
  return normalizeListPayload(json);
}

export type VideoseedItemQuery = {
  item: VideoseedItemKind;
  id?: number;
  kp?: number;
  imdb?: string;
  tmdb?: string;
};

export async function videoseedItem(query: VideoseedItemQuery, opts?: { timeoutMs?: number; attempts?: number }): Promise<VideoseedContentItem | null> {
  const base = getVideoseedApiBase();
  const token = getVideoseedToken();

  const timeoutMs = typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 5000;
  const attempts = typeof opts?.attempts === "number" && Number.isFinite(opts.attempts) && opts.attempts > 0 ? opts.attempts : 2;

  const url = new URL(base);
  url.searchParams.set("token", token);
  url.searchParams.set("item", query.item);

  if (query.id != null) url.searchParams.set("id", String(query.id));
  if (query.kp != null) url.searchParams.set("kp", String(query.kp));
  if (query.imdb) url.searchParams.set("imdb", query.imdb);
  if (query.tmdb) url.searchParams.set("tmdb", query.tmdb);

  const json = await fetchJsonWithRetry(url.toString(), { timeoutMs, attempts });
  const normalized = normalizeListPayload(json);
  return normalized.data[0] ?? null;
}

export async function videoseedFindByKpId(kpId: number, opts?: { timeoutMs?: number; attempts?: number }): Promise<{ kind: VideoseedItemKind; item: VideoseedContentItem } | null> {
  const [mRes, sRes] = await Promise.allSettled([
    videoseedItem({ item: "movie", kp: kpId }, opts),
    videoseedItem({ item: "serial", kp: kpId }, opts),
  ]);

  const m = mRes.status === "fulfilled" ? mRes.value : null;
  if (m) return { kind: "movie", item: m };

  const s = sRes.status === "fulfilled" ? sRes.value : null;
  if (s) return { kind: "serial", item: s };

  return null;
}

export function splitCommaList(raw: unknown): string[] | null {
  const s = typeof raw === "string" ? raw : null;
  if (!s) return null;
  const out = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return out.length ? out : null;
}
