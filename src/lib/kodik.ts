type KodikTranslation = {
  id: number;
  title: string;
  type: "voice" | "subtitles";
};

export type KodikSearchItem = {
  id: string;
  type: string;
  link: string;
  title: string;
  title_orig?: string | null;
  year?: number | null;
  kinopoisk_id?: string | number | null;
  imdb_id?: string | null;
  quality?: string | null;
  translation?: KodikTranslation | null;
  blocked_countries?: string[];
};

type KodikSearchResponse = {
  time?: string;
  total?: number;
  results?: KodikSearchItem[];
};

function normalizePlayerLink(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("//")) return `https:${s}`;
  return s.replace(/^http:\/\//i, "https://");
}

export async function getKodikPlayerByKinopoiskId(
  kinopoiskId: number,
  opts?: {
    year?: number;
    limit?: number;
  },
): Promise<KodikSearchItem | null> {
  const token = (process.env.KODIK_TOKEN ?? "").trim();
  if (!token) return null;

  const url = new URL("https://kodikapi.com/search");
  url.searchParams.set("token", token);
  url.searchParams.set("kinopoisk_id", String(kinopoiskId));
  url.searchParams.set("limit", String(opts?.limit ?? 1));
  if (opts?.year) url.searchParams.set("year", String(opts.year));

  const res = await fetch(url.toString(), {
    next: { revalidate: 60 * 60 },
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as KodikSearchResponse;
  const first = data.results?.[0];
  if (!first?.link) return null;

  return {
    ...first,
    link: normalizePlayerLink(first.link),
  };
}
