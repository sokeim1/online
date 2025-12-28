function transliterateRuToLat(input: string): string {
  const map: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };

  return input
    .split("")
    .map((ch) => {
      const lower = ch.toLowerCase();
      const repl = map[lower];
      return repl == null ? ch : repl;
    })
    .join("");
}

export function slugifyTitle(input: string): string {
  const s = transliterateRuToLat(input)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();

  return s || "movie";
}

export function movieSlugHtmlPath(kpId: number, title: string): string {
  const slug = slugifyTitle(title);
  return `/movie/${kpId}-${slug}.html`;
}

export function parseKpIdFromMovieParam(raw: string): number | null {
  const m = raw.match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return n;
}
