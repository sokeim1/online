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
}: {
  kpId: number | null;
  imdbId: string | null;
}): string {
  const kpPart = kpId != null ? `kp:${kpId}` : "kp:";
  const imdbPart = imdbId ? `imdb:${imdbId}` : "imdb:";
  return `${kpPart}|${imdbPart}`;
}

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

function pickFirstDataItem(payload: unknown): unknown | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as any;
  const data = p.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

function pickIframeUrl(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as any;
  if (typeof o.iframe === "string" && /^https?:\/\//i.test(o.iframe)) return o.iframe;
  if (typeof o.iframe_url === "string" && /^https?:\/\//i.test(o.iframe_url)) return o.iframe_url;
  return null;
}

async function fetchJson(url: string): Promise<{ res: Response; text: string; json: unknown | null }> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");
  let json: unknown | null = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }

  return { res, text, json };
}

export async function GET(req: Request) {
  const tokenRaw = process.env.VIDEOSEED_TOKEN?.trim();
  if (!tokenRaw) {
    return new Response(JSON.stringify({ error: "VIDEOSEED_TOKEN is not set" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const token = tokenRaw;

  const url = new URL(req.url);
  const kpIdRaw = url.searchParams.get("kpId");
  const imdbIdRaw = url.searchParams.get("imdbId");

  const kpId = kpIdRaw ? Number.parseInt(kpIdRaw, 10) : NaN;
  const imdbId = imdbIdRaw ? imdbIdRaw.trim() : "";

  const subtitle = url.searchParams.get("subtitle");
  const defaultAudio = url.searchParams.get("default_audio");
  const autostart = url.searchParams.get("autostart");
  const start = url.searchParams.get("start");

  const attempts: Array<{ name: string; item: "movie" | "serial"; params: Array<[string, string]> }> = [];

  if (Number.isFinite(kpId) && kpId > 0) {
    attempts.push({ name: "kp_movie", item: "movie", params: [["kp", String(kpId)]] });
    attempts.push({ name: "kp_serial", item: "serial", params: [["kp", String(kpId)]] });
  }

  if (imdbId) {
    attempts.push({ name: "imdb_movie", item: "movie", params: [["imdb", imdbId]] });
    attempts.push({ name: "imdb_serial", item: "serial", params: [["imdb", imdbId]] });
  }

  if (!attempts.length) {
    return new Response(JSON.stringify({ error: "No identifiers provided" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // Cache only the base iframe URL resolution (kp/imdb -> iframe), not the per-request params like start/subtitle.
  // This reduces latency for repeat opens and for switching players.
  const key = getCacheKey({
    kpId: Number.isFinite(kpId) && kpId > 0 ? kpId : null,
    imdbId: imdbId || null,
  });
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    if (cached.iframeUrl) {
      let iframeUrl: URL;
      try {
        iframeUrl = new URL(cached.iframeUrl);
      } catch {
        cache.delete(key);
        // fall through to fetch
        iframeUrl = null as never;
      }

      if (iframeUrl) {
        if (subtitle) iframeUrl.searchParams.set("subtitle", subtitle);
        if (defaultAudio) iframeUrl.searchParams.set("default_audio", defaultAudio);
        if (autostart) iframeUrl.searchParams.set("autostart", autostart);
        if (start) iframeUrl.searchParams.set("start", start);

        return new Response(JSON.stringify({ iframeUrl: iframeUrl.toString(), strategy: cached.strategy ?? "cache" }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
    }

    return new Response(JSON.stringify({ iframeUrl: null, strategy: cached.strategy ?? "cache" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const apiBase = getVideoseedApiBase();

  let lastError: { status: number; body: string } | null = null;

  async function resolveAttempt(attempt: { name: string; item: "movie" | "serial"; params: Array<[string, string]> }) {
    const apiUrl = new URL(apiBase);
    apiUrl.searchParams.set("token", token);
    apiUrl.searchParams.set("item", attempt.item);
    apiUrl.searchParams.set("items", "1");
    for (const [k, v] of attempt.params) apiUrl.searchParams.set(k, v);

    try {
      const fetched = await fetchJson(apiUrl.toString());

      if (fetched.res.status === 403) {
        return { ok: false as const, status: 502, body: "Upstream token rejected", attempt };
      }

      if (!fetched.res.ok) {
        return { ok: false as const, status: 502, body: fetched.text || `HTTP ${fetched.res.status}`, attempt };
      }

      const payload = fetched.json ?? fetched.text;
      const first = pickFirstDataItem(payload) ?? payload;
      const iframeUrlRaw = pickIframeUrl(first);
      if (!iframeUrlRaw) {
        return { ok: false as const, status: 404, body: "No iframe", attempt };
      }

      return { ok: true as const, iframeUrlRaw, attempt };
    } catch {
      return { ok: false as const, status: 502, body: "Upstream fetch failed", attempt };
    }
  }

  const limited = attempts.slice(0, 4);
  const attemptPromises = limited.map((a) => resolveAttempt(a));
  const successPromises = attemptPromises.map((p) =>
    p.then((r) => {
      if (r.ok) return r;
      throw r;
    }),
  );

  let winner:
    | { ok: true; iframeUrlRaw: string; attempt: { name: string; item: "movie" | "serial"; params: Array<[string, string]> } }
    | null = null;
  try {
    winner = (await Promise.any(successPromises)) as any;
  } catch {
    winner = null;
  }

  if (winner) {
    let iframeUrl: URL;
    try {
      iframeUrl = new URL(winner.iframeUrlRaw);
    } catch {
      // fall through as not found
      iframeUrl = null as never;
    }

    if (iframeUrl) {
      if (subtitle) iframeUrl.searchParams.set("subtitle", subtitle);
      if (defaultAudio) iframeUrl.searchParams.set("default_audio", defaultAudio);
      if (autostart) iframeUrl.searchParams.set("autostart", autostart);
      if (start) iframeUrl.searchParams.set("start", start);

      cache.set(key, { iframeUrl: winner.iframeUrlRaw, expiresAt: now + 15 * 60 * 1000, strategy: winner.attempt.name });

      return new Response(JSON.stringify({ iframeUrl: iframeUrl.toString(), strategy: winner.attempt.name }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const settled = await Promise.allSettled(attemptPromises);
  const resolved = settled
    .map((s) => (s.status === "fulfilled" ? s.value : null))
    .filter(Boolean) as Array<
    | { ok: true; iframeUrlRaw: string; attempt: { name: string; item: "movie" | "serial"; params: Array<[string, string]> } }
    | { ok: false; status: number; body: string; attempt: { name: string; item: "movie" | "serial"; params: Array<[string, string]> } }
  >;

  const err = resolved.find((r) => !r.ok && r.status === 502) as
    | { ok: false; status: number; body: string; attempt: { name: string; item: "movie" | "serial"; params: Array<[string, string]> } }
    | undefined;
  if (err) {
    lastError = { status: err.status, body: err.body };
  }

  if (lastError) {
    cache.set(key, { iframeUrl: null, expiresAt: now + 60 * 1000, strategy: "error" });
    return new Response(JSON.stringify({ error: "Upstream error", status: lastError.status, body: lastError.body }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  cache.set(key, { iframeUrl: null, expiresAt: now + 60 * 1000, strategy: "not_found" });
  return new Response(JSON.stringify({ iframeUrl: null }), {
    status: 404,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
