export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCdnmoviesApiBase(): string {
  return process.env.CDNMOVIES_API_BASE?.trim() || "https://api.cdnmovies.net";
}

function getCdnmoviesPlayerDomain(): string {
  return process.env.CDNMOVIES_PLAYER_DOMAIN?.trim() || "cdnmovies-stream.online";
}

function pickContentId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const anyPayload = payload as any;
  const data = anyPayload.data;
  const list = Array.isArray(data) ? data : null;
  if (!list || list.length === 0) return null;

  const first = list[0];
  if (!first || typeof first !== "object") return null;

  const id = (first as any).id;
  const contentId = (first as any).content_id;

  const candidate = typeof id === "string" ? id : typeof contentId === "string" ? contentId : null;
  if (!candidate) return null;

  return candidate;
}

export async function GET(req: Request) {
  const token = process.env.CDNMOVIES_TOKEN?.trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "CDNMOVIES_TOKEN is not set" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const url = new URL(req.url);
  const kpIdRaw = url.searchParams.get("kpId");
  const contentTypeRaw = url.searchParams.get("contentType");
  const posterRaw = url.searchParams.get("poster");

  const kpId = kpIdRaw ? Number.parseInt(kpIdRaw, 10) : NaN;
  if (!Number.isFinite(kpId) || kpId <= 0) {
    return new Response("Invalid kpId", { status: 400 });
  }

  const contentType = contentTypeRaw ? Number.parseInt(contentTypeRaw, 10) : null;

  const apiBase = getCdnmoviesApiBase();
  const apiUrl = new URL(`${apiBase.replace(/\/$/, "")}/v1/contents`);
  apiUrl.searchParams.set("token", token);
  apiUrl.searchParams.set("kinopoisk_id", String(kpId));
  if (contentType != null && Number.isFinite(contentType)) {
    apiUrl.searchParams.set("content_type", String(contentType));
  }

  let res: Response;
  try {
    res = await fetch(apiUrl.toString(), {
      headers: {
        "Accept": "application/json",
      },
      cache: "no-store",
    });
  } catch {
    return new Response(JSON.stringify({ error: "Upstream fetch failed" }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (res.status === 403) {
    return new Response(JSON.stringify({ error: "Upstream token rejected" }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (res.status === 404) {
    return new Response(JSON.stringify({ iframeUrl: null }), {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: "Upstream error",
        status: res.status,
        body: body ? body.slice(0, 4000) : undefined,
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid upstream JSON" }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const contentId = pickContentId(payload);
  if (!contentId) {
    return new Response(JSON.stringify({ iframeUrl: null }), {
      status: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const playerDomain = getCdnmoviesPlayerDomain();
  const iframeUrl = new URL(`https://${playerDomain}/content/${encodeURIComponent(contentId)}/iframe`);

  const geoAllow = process.env.CDNMOVIES_GEO_ALLOW?.trim();
  const geoBlock = process.env.CDNMOVIES_GEO_BLOCK?.trim();
  if (geoAllow) iframeUrl.searchParams.set("geo_allow", geoAllow);
  if (geoBlock) iframeUrl.searchParams.set("geo_block", geoBlock);
  if (posterRaw) {
    const origin = new URL(req.url).origin;
    const poster = posterRaw.startsWith("/") ? `${origin}${posterRaw}` : posterRaw;
    iframeUrl.searchParams.set("poster", poster);
  }

  return new Response(JSON.stringify({ iframeUrl: iframeUrl.toString(), contentId }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
