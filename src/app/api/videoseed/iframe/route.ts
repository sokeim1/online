export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const token = process.env.VIDEOSEED_TOKEN?.trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "VIDEOSEED_TOKEN is not set" }), {
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

  const apiBase = getVideoseedApiBase();

  let lastError: { status: number; body: string } | null = null;

  for (const attempt of attempts.slice(0, 4)) {
    const apiUrl = new URL(apiBase);
    apiUrl.searchParams.set("token", token);
    apiUrl.searchParams.set("item", attempt.item);
    apiUrl.searchParams.set("items", "1");
    for (const [k, v] of attempt.params) apiUrl.searchParams.set(k, v);

    let fetched;
    try {
      fetched = await fetchJson(apiUrl.toString());
    } catch {
      lastError = { status: 502, body: "Upstream fetch failed" };
      continue;
    }

    if (fetched.res.status === 403) {
      lastError = { status: 502, body: "Upstream token rejected" };
      continue;
    }

    if (!fetched.res.ok) {
      lastError = { status: 502, body: fetched.text || `HTTP ${fetched.res.status}` };
      continue;
    }

    const payload = fetched.json ?? fetched.text;
    const first = pickFirstDataItem(payload) ?? payload;
    const iframeUrlRaw = pickIframeUrl(first);
    if (!iframeUrlRaw) continue;

    let iframeUrl: URL;
    try {
      iframeUrl = new URL(iframeUrlRaw);
    } catch {
      continue;
    }

    if (subtitle) iframeUrl.searchParams.set("subtitle", subtitle);
    if (defaultAudio) iframeUrl.searchParams.set("default_audio", defaultAudio);
    if (autostart) iframeUrl.searchParams.set("autostart", autostart);
    if (start) iframeUrl.searchParams.set("start", start);

    return new Response(JSON.stringify({ iframeUrl: iframeUrl.toString(), strategy: attempt.name }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (lastError) {
    return new Response(JSON.stringify({ error: "Upstream error", status: lastError.status, body: lastError.body }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(JSON.stringify({ iframeUrl: null }), {
    status: 404,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
