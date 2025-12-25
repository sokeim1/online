"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ThemeMode = "dark" | "light";

function setTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export function Header() {
  const router = useRouter();
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof document === "undefined") return "dark";
    const t = document.documentElement.dataset.theme;
    return t === "light" || t === "dark" ? t : "dark";
  });
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("theme") : null;
    const preferred: ThemeMode =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia?.("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";

    setThemeState(preferred);
    setTheme(preferred);
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    setTheme(theme);
    try {
      window.localStorage.setItem("theme", theme);
    } catch {
    }
  }, [isReady, theme]);

  useEffect(() => {
    function syncFromStorage() {
      try {
        const stored = window.localStorage.getItem("theme");
        if (stored === "dark" || stored === "light") {
          setThemeState(stored);
          setTheme(stored);
        }
      } catch {
      }
    }

    function onStorage(e: StorageEvent) {
      if (e.key === "theme") syncFromStorage();
    }

    window.addEventListener("pageshow", syncFromStorage);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("pageshow", syncFromStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function goHome() {
    window.dispatchEvent(new Event("doramy:home"));
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--border)] bg-[color:var(--header-bg)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4">
        <button type="button" onClick={goHome} className="flex items-center gap-2 text-left">
          <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-[color:var(--accent-soft)]">
            <img
              src="https://www.shutterstock.com/image-vector/film-reel-vector-cinema-logo-600nw-2353280887.jpg"
              alt="Logo"
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[color:var(--foreground)]">Doramy Online</div>
            <div className="hidden text-xs text-[color:var(--muted)] sm:block">Смотри бесплатно фильмы</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setThemeState((t) => (t === "dark" ? "light" : "dark"))}
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1.5 text-[11px] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)] sm:px-3 sm:py-2 sm:text-xs"
        >
          {theme === "dark" ? "Светлая" : "Тёмная"}
        </button>
      </div>
    </header>
  );
}
