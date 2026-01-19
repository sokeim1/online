export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = {
  iframeUrl: string | null;
  expiresAt: number;
  strategy: string | null;
};

const cache = new Map<string, CacheEntry>();

function getCacheKey({
  kpId,
  imdbId,
  title,
  year,
}: {
  kpId: number | null;
  imdbId: string | null;
  title: string | null;
  year: number | null;
}): string {
  return `kp:${kpId ?? ""}|imdb:${imdbId ?? ""}|title:${title ?? ""}|year:${year ?? ""}`;
}

function getFlixcdnApiBase(): string {
  const raw = process.env.FLIXCDN_API_BASE?.trim() ?? "";
  if (raw && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.hostname) return raw.replace(/\/$/, "");
    } catch {
    }
  }
  return "https://api0.flixcdn.biz";
}

function pickFirstArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const p = payload as any;
  const candidates = [p.data, p.results, p.result, p.items, p.list, p.films, p.movies];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return null;
}

function pickIframeUrlFromObject(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as any;

  const directCandidates = [
    o.iframe,
    o.iframe_url,
    o.iframeUrl,
    o.embed,
    o.embed_url,
    o.embedUrl,
    o.player,
    o.player_url,
    o.playerUrl,
    o.url,
    o.link,
  ];

  for (const v of directCandidates) {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    if (v && typeof v === "object") {
      const nested = pickIframeUrlFromObject(v);
      if (nested) return nested;
    }
  }

  const stack: Array<{ value: unknown; depth: number }> = [{ value: o, depth: 0 }];
  const visited = new Set<unknown>();

  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (!value || typeof value !== "object") continue;
    if (visited.has(value)) continue;
    visited.add(value);
    if (depth > 4) continue;

    for (const v of Object.values(value as Record<string, unknown>)) {
      if (typeof v === "string") {
        if (/^https?:\/\//i.test(v) && /(iframe|embed|player)/i.test(v)) return v;
      } else if (v && typeof v === "object") {
        stack.push({ value: v, depth: depth + 1 });
      }
    }
  }

  return null;
}

async function fetchSearch(url: URL): Promise<{ ok: boolean; status: number; payloadText: string; payloadJson: unknown | null }> {
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payloadText = await res.text().catch(() => "");
  let payloadJson: unknown | null = null;
  try {
    payloadJson = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    payloadJson = null;
  }

  return { ok: res.ok, status: res.status, payloadText, payloadJson };
}

export async function GET(req: Request) {
  const token = process.env.FLIXCDN_TOKEN?.trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "FLIXCDN_TOKEN is not set" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const url = new URL(req.url);
  const kpIdRaw = url.searchParams.get("kpId");
  const imdbIdRaw = url.searchParams.get("imdbId");
  const titleRaw = url.searchParams.get("title");
  const yearRaw = url.searchParams.get("year");

  const kpId = kpIdRaw ? Number.parseInt(kpIdRaw, 10) : NaN;
  const imdbId = imdbIdRaw ? imdbIdRaw.trim() : "";
  const title = titleRaw ? titleRaw.trim() : "";
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;

  const cacheKey = getCacheKey({
    kpId: Number.isFinite(kpId) && kpId > 0 ? kpId : null,
    imdbId: imdbId || null,
    title: title || null,
    year: Number.isFinite(year) && year > 0 ? year : null,
  });
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return new Response(JSON.stringify({ iframeUrl: cached.iframeUrl, strategy: cached.strategy ?? "cache" }), {
      status: cached.iframeUrl ? 200 : 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const apiBase = getFlixcdnApiBase().replace(/\/$/, "");

  const attempts: Array<{ name: string; params: Array<[string, string]> }> = [];

  if (imdbId) {
    attempts.push({ name: "imdb_id", params: [["imdb_id", imdbId]] });
    attempts.push({ name: "q_imdb", params: [["q", imdbId]] });
  }

  if (Number.isFinite(kpId) && kpId > 0) {
    attempts.push({ name: "kinopoisk_id", params: [["kinopoisk_id", String(kpId)]] });
    attempts.push({ name: "kp_id", params: [["kp_id", String(kpId)]] });
    attempts.push({ name: "q_kp", params: [["q", String(kpId)]] });
  }

  if (title) {
    const q = Number.isFinite(year) && year > 0 ? `${title} ${year}` : title;
    attempts.push({ name: "q_title", params: [["q", q]] });
    attempts.push({ name: "query_title", params: [["query", q]] });
    attempts.push({ name: "search_title", params: [["search", q]] });
  }

  if (attempts.length === 0) {
    return new Response(JSON.stringify({ error: "No identifiers provided" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  let lastError: { status: number; body: string } | null = null;

  for (const attempt of attempts.slice(0, 6)) {
    const apiUrl = new URL(`${apiBase}/api/search`);
    apiUrl.searchParams.set("token", token);
    for (const [k, v] of attempt.params) apiUrl.searchParams.set(k, v);

    let fetched;
    try {
      fetched = await fetchSearch(apiUrl);
    } catch {
      lastError = { status: 502, body: "Upstream fetch failed" };
      continue;
    }

    if (!fetched.ok) {
      lastError = { status: 502, body: fetched.payloadText || `HTTP ${fetched.status}` };
      continue;
    }

    const payload = fetched.payloadJson ?? fetched.payloadText;
    const list = pickFirstArray(payload);
    const first = list && list.length ? list[0] : payload;
    const iframeUrl = pickIframeUrlFromObject(first);

    if (iframeUrl) {
      cache.set(cacheKey, { iframeUrl, expiresAt: now + 15 * 60 * 1000, strategy: attempt.name });
      return new Response(JSON.stringify({ iframeUrl, strategy: attempt.name }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  if (lastError) {
    cache.set(cacheKey, { iframeUrl: null, expiresAt: now + 60 * 1000, strategy: "error" });
    return new Response(JSON.stringify({ error: "Upstream error", status: lastError.status, body: lastError.body }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  cache.set(cacheKey, { iframeUrl: null, expiresAt: now + 60 * 1000, strategy: "not_found" });
  return new Response(JSON.stringify({ iframeUrl: null }), {
    status: 404,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
