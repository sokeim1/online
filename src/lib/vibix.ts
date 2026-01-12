export type VibixVideoType = "movie" | "serial";

export type VibixVideoLink = {
  id: number;
  name: string;
  name_rus: string | null;
  name_eng: string | null;
  type: VibixVideoType;
  year: number | null;
  kp_id: number | null;
  imdb_id: string | null;
  kp_rating?: number | null;
  imdb_rating?: number | null;
  episodes_count?: number | null;
  iframe_url: string;
  poster_url: string | null;
  quality: string;
  uploaded_at: string;
  genre?: string[] | null;
  country?: string[] | null;
};

export type VibixPaginationLinks = {
  first: string;
  last: string;
  prev: string | null;
  next: string | null;
};

export type VibixPaginationMetaLink = {
  url: string | null;
  label: string;
  active: boolean;
};

export type VibixPaginationMeta = {
  current_page: number;
  from: number | null;
  last_page: number;
  links: VibixPaginationMetaLink[];
  path: string;
  per_page: number;
  to: number | null;
  total: number;
};

export type VibixVideoLinksResponse = {
  data: VibixVideoLink[];
  links: VibixPaginationLinks;
  meta: VibixPaginationMeta;
  success: boolean;
  message: string;
};

export type VibixVoiceover = {
  id: number;
  name: string;
};

export type VibixTag = {
  id: number;
  code: string;
  name: string;
};

export type VibixVideoDetails = {
  id: number;
  name: string;
  name_rus: string | null;
  name_eng: string | null;
  name_original: string | null;
  type: VibixVideoType;
  year: number | null;
  kp_id: number | null;
  kinopoisk_id: number | null;
  imdb_id: string | null;
  kp_rating: number | null;
  imdb_rating: number | null;
  iframe_url: string;
  poster_url: string | null;
  backdrop_url: string | null;
  duration: number | null;
  quality: string;
  genre: string[] | null;
  country: string[] | null;
  description: string | null;
  description_short: string | null;
  voiceovers: VibixVoiceover[] | null;
  tags: VibixTag[] | null;
  uploaded_at: string | null;
};

export type VibixSerialEpisode = {
  id: number;
  name: string;
};

export type VibixSerialSeason = {
  name: string;
  series: VibixSerialEpisode[];
};

export type VibixSerialInfo = {
  id: number;
  name: string;
  seasons: VibixSerialSeason[] | null;
};

export type VibixTaxonomyItem = {
  id: number;
  name: string | null;
  name_eng?: string | null;
  code?: string | null;
};

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

export function getVibixBaseUrl(): string {
  return (process.env.VIBIX_BASE_URL ?? "https://vibix.org").replace(/\/$/, "");
}

export function getVibixApiKey(): string {
  return getEnv("VIBIX_API_KEY");
}

export async function vibixFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getVibixBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;

  const method = (init?.method ?? "GET").toUpperCase();
  const isGetLike = method === "GET" || method === "HEAD";

  const res = await fetch(url, {
    ...init,
    cache: init?.cache ?? (isGetLike ? "force-cache" : "no-store"),
    next: isGetLike
      ? {
          revalidate: 60 * 60,
        }
      : undefined,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${getVibixApiKey()}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vibix API error ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

export type VibixVideosLinksQuery = {
  type?: VibixVideoType;
  page?: number;
  limit?: number;
  categoryIds?: number[];
  years?: number[];
  genreIds?: number[];
  countryIds?: number[];
  tagIds?: number[];
  voiceoverIds?: number[];
};

export async function getVibixVideoLinks(query: VibixVideosLinksQuery): Promise<VibixVideoLinksResponse> {
  const sp = new URLSearchParams();
  if (query.type) sp.set("type", query.type);
  if (query.page) sp.set("page", String(query.page));
  if (query.limit) sp.set("limit", String(query.limit));

  (query.categoryIds ?? []).forEach((id) => sp.append("category[]", String(id)));
  (query.years ?? []).forEach((y) => sp.append("year[]", String(y)));
  (query.genreIds ?? []).forEach((id) => sp.append("genre[]", String(id)));
  (query.countryIds ?? []).forEach((id) => sp.append("country[]", String(id)));
  (query.tagIds ?? []).forEach((id) => sp.append("tag[]", String(id)));
  (query.voiceoverIds ?? []).forEach((id) => sp.append("voiceover[]", String(id)));

  const qs = sp.toString();
  return vibixFetch<VibixVideoLinksResponse>(`/api/v1/publisher/videos/links${qs ? `?${qs}` : ""}`);
}

export async function getVibixGenres(): Promise<VibixTaxonomyItem[]> {
  const res = await vibixFetch<{ data: VibixTaxonomyItem[] }>("/api/v1/publisher/videos/genres");
  return res.data ?? [];
}

export async function getVibixCountries(): Promise<VibixTaxonomyItem[]> {
  const res = await vibixFetch<{ data: VibixTaxonomyItem[] }>("/api/v1/publisher/videos/countries");
  return res.data ?? [];
}

export async function getVibixTags(): Promise<VibixTaxonomyItem[]> {
  const res = await vibixFetch<{ data: VibixTaxonomyItem[] }>("/api/v1/publisher/videos/tags");
  return res.data ?? [];
}

export type VibixVideosSearchQuery = {
  name: string;
  page?: number;
  limit?: number;
};

export async function searchVibixVideosByName(
  query: VibixVideosSearchQuery,
): Promise<VibixVideoLinksResponse> {
  const sp = new URLSearchParams();
  sp.set("name", query.name);
  if (query.page) sp.set("page", String(query.page));
  if (query.limit) sp.set("limit", String(query.limit));

  const qs = sp.toString();
  return vibixFetch<VibixVideoLinksResponse>(`/api/v1/publisher/videos/search?${qs}`, {
    method: "POST",
  });
}

export async function getVibixVideoByKpId(kpId: number): Promise<VibixVideoDetails> {
  return vibixFetch<VibixVideoDetails>(`/api/v1/publisher/videos/kp/${kpId}`);
}

export async function getVibixVideoByImdbId(imdbId: string): Promise<VibixVideoDetails> {
  return vibixFetch<VibixVideoDetails>(`/api/v1/publisher/videos/imdb/${encodeURIComponent(imdbId)}`);
}

export async function getVibixSerialByKpId(kpId: number): Promise<VibixSerialInfo> {
  return vibixFetch<VibixSerialInfo>(`/api/v1/serials/kp/${kpId}`);
}

export async function getVibixSerialByImdbId(imdbId: string): Promise<VibixSerialInfo> {
  return vibixFetch<VibixSerialInfo>(`/api/v1/serials/imdb/${encodeURIComponent(imdbId)}`);
}
