"use client";

import { useEffect, useMemo, useState } from "react";

export type PlayerSource = {
  id: string;
  label: string;
  url: string;
};

export function MoviePlayerSwitcher({
  storageKey,
  title,
  sources,
}: {
  storageKey: string;
  title: string;
  sources: PlayerSource[];
}) {
  const safeSources = useMemo(() => sources.filter((s) => !!s.url), [sources]);
  const defaultId = safeSources[0]?.id ?? "";

  const [selectedId, setSelectedId] = useState<string>(defaultId);

  useEffect(() => {
    if (!defaultId) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && safeSources.some((s) => s.id === saved)) {
        setSelectedId(saved);
      } else {
        setSelectedId(defaultId);
      }
    } catch {
      setSelectedId(defaultId);
    }
  }, [defaultId, safeSources, storageKey]);

  const selected = safeSources.find((s) => s.id === selectedId) ?? safeSources[0];

  function select(id: string) {
    setSelectedId(id);
    try {
      window.localStorage.setItem(storageKey, id);
    } catch {
    }
  }

  if (!selected || safeSources.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--muted)]">
        Плеер недоступен.
      </div>
    );
  }

  return (
    <div>
      {safeSources.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {safeSources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                selectedId === s.id
                  ? "bg-[color:var(--accent)] text-black"
                  : "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-black">
        <div className="relative aspect-video w-full">
          <iframe
            src={selected.url}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            title={title}
          />
        </div>
      </div>
    </div>
  );
}
