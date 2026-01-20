export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickDomain(req: Request): string {
  const site = process.env.SITE_URL?.trim();
  if (site) {
    try {
      const u = new URL(site);
      if (u.hostname) {
        const parts = u.hostname.split(".");
        if (parts[0] === "m") parts.shift();
        if (parts[0] === "www" && parts[1] === "m") parts.splice(1, 1);
        if (parts[0] === "www") parts.shift();
        return parts.join(".");
      }
    } catch {
    }
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const rawHost = host.split(":")[0] || "localhost";
  const parts = rawHost.split(".");
  if (parts[0] === "m") parts.shift();
  if (parts[0] === "www" && parts[1] === "m") parts.splice(1, 1);
  if (parts[0] === "www") parts.shift();
  return parts.join(".") || "localhost";
}

function buildPlayerUrl({ kpId, imdbId, domain }: { kpId: number | null; imdbId: string | null; domain: string }): string {
  const base = "https://player0.flixcdn.space";

  if (kpId != null && Number.isFinite(kpId) && kpId > 0) {
    return `${base}/show/kinopoisk/${kpId}?domain=${encodeURIComponent(domain)}`;
  }

  const imdb = String(imdbId ?? "").trim();
  if (/^tt\d+$/i.test(imdb)) {
    return `${base}/show/imdb/${encodeURIComponent(imdb)}?domain=${encodeURIComponent(domain)}`;
  }

  return `${base}/?domain=${encodeURIComponent(domain)}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const kpIdRaw = url.searchParams.get("kpId");
  const imdbIdRaw = url.searchParams.get("imdbId");

  const kpId = kpIdRaw ? Number.parseInt(kpIdRaw, 10) : NaN;
  const imdbId = imdbIdRaw ? imdbIdRaw.trim() : "";

  const domain = pickDomain(req);

  const hasKp = Number.isFinite(kpId) && kpId > 0;
  const hasImdb = /^tt\d+$/i.test(imdbId);
  if (!hasKp && !hasImdb) {
    return new Response("Missing kpId or imdbId", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const playerUrl = buildPlayerUrl({ kpId: hasKp ? kpId : null, imdbId: hasImdb ? imdbId : null, domain });

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "img-src data:",
    "style-src 'unsafe-inline'",
    "frame-src https://*.flixcdn.space",
  ].join("; ");

  const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Player</title>
    <style>
      html, body { height: 100%; margin: 0; background: #000; }
      .wrap { position: fixed; inset: 0; }
      iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <iframe
        src="${playerUrl}"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="fullscreen; picture-in-picture; encrypted-media"
        allowfullscreen
        loading="eager"
        title="Player"
      ></iframe>
    </div>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": csp,
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
