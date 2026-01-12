"use client";

import { useMemo, useState } from "react";

import type { VibixTag, VibixVoiceover } from "@/lib/vibix";

type Tab = "voice" | "subs";

export function MovieMediaTabs({
  voiceovers,
  tags,
}: {
  voiceovers: VibixVoiceover[] | null | undefined;
  tags: VibixTag[] | null | undefined;
}) {
  const [tab, setTab] = useState<Tab>("voice");

  const voiceNames = useMemo(
    () => (voiceovers ?? []).map((v) => v?.name).filter(Boolean) as string[],
    [voiceovers],
  );

  const subTagNames = useMemo(() => {
    const all = (tags ?? []).map((t) => t?.name).filter(Boolean) as string[];
    return all.filter((t) => {
      const s = t.toLowerCase();
      return s.includes("sub") || s.includes("суб");
    });
  }, [tags]);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--border)] pb-3">
        <div className="text-sm font-semibold text-[color:var(--foreground)]">Дорама</div>
        <div className="text-sm text-[color:var(--muted)]">Другие озвучки</div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("voice")}
          className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
            tab === "voice"
              ? "bg-[color:var(--accent)] text-black"
              : "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
          }`}
        >
          Озвучка
        </button>
        <button
          type="button"
          onClick={() => setTab("subs")}
          className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
            tab === "subs"
              ? "bg-[color:var(--accent)] text-black"
              : "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
          }`}
        >
          Субтитры
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
        {tab === "voice" ? (
          voiceNames.length ? (
            <div className="flex flex-wrap gap-2">
              {voiceNames.map((name) => (
                <span
                  key={`vo-${name}`}
                  className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-1 text-xs text-[color:var(--foreground)]"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[color:var(--muted)]">Озвучки не указаны.</div>
          )
        ) : subTagNames.length ? (
          <div className="flex flex-wrap gap-2">
            {subTagNames.map((name) => (
              <span
                key={`sub-${name}`}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-hover)] px-3 py-1 text-xs text-[color:var(--foreground)]"
              >
                {name}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[color:var(--muted)]">Субтитры не указаны.</div>
        )}
      </div>
    </div>
  );
}
