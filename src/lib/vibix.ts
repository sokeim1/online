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

  const res = await fetch(url, {
    ...init,
    cache: init?.cache ?? "no-store",
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
};

export async function getVibixVideoLinks(query: VibixVideosLinksQuery): Promise<VibixVideoLinksResponse> {
  const sp = new URLSearchParams();
  if (query.type) sp.set("type", query.type);
  if (query.page) sp.set("page", String(query.page));
  if (query.limit) sp.set("limit", String(query.limit));

  const qs = sp.toString();
  return vibixFetch<VibixVideoLinksResponse>(`/api/v1/publisher/videos/links${qs ? `?${qs}` : ""}`);
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
