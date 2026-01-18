function shouldProxyHost(hostname: string): boolean {
  const h = hostname.toLowerCase();

  if (h === "ru" || h.endsWith(".ru")) return true;

  if (h === "videoseed.tv" || h.endsWith(".videoseed.tv")) return true;

  if (h === "yandex.net" || h.endsWith(".yandex.net")) return true;
  if (h === "yandex.ru" || h.endsWith(".yandex.ru")) return true;
  if (h === "kinopoisk.ru" || h.endsWith(".kinopoisk.ru")) return true;

  return false;
}

function normalizeUrl(input: string): string {
  const s = input.trim();
  if (s.startsWith("//")) return `https:${s}`;
  if (/^https?:\/\//i.test(s)) return s;

  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) {
    return `https://${s}`;
  }

  return s;
}

function upgradeVideoseedPosterUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  const h = url.hostname.toLowerCase();
  const isVideoseed = h === "api.videoseed.tv" || h.endsWith(".videoseed.tv") || h.includes("kinoserial") || h.includes("kinoserials");
  if (!isVideoseed) return input;

  const p = url.pathname;
  const upgraded = p
    .replace(/\/posters\/240x320\//i, "/posters/480x720/")
    .replace(/\/posters\/360x540\//i, "/posters/720x1080/")
    .replace(/\/240x320\//i, "/480x720/")
    .replace(/\/360x540\//i, "/720x1080/");
  if (upgraded !== p) {
    url.pathname = upgraded;
    return url.toString();
  }
  return input;
}

export function proxyImageUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  const normalized = upgradeVideoseedPosterUrl(normalizeUrl(input));

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (!shouldProxyHost(url.hostname)) return normalized;

  return `/api/image-proxy?url=${encodeURIComponent(normalized)}`;
}
