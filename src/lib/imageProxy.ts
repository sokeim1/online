function shouldProxyHost(hostname: string): boolean {
  const h = hostname.toLowerCase();

  if (h === "ru" || h.endsWith(".ru")) return true;

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

export function proxyImageUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  const normalized = normalizeUrl(input);

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (!shouldProxyHost(url.hostname)) return input;

  return `/api/image-proxy?url=${encodeURIComponent(normalized)}`;
}
