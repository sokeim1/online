import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-black/60 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-500" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Doramy Online</div>
            <div className="text-xs text-white/60">Смотри бесплатно фильмы</div>
          </div>
        </Link>
        <div className="text-xs text-white/60">/movie/{"{kpId}"}</div>
      </div>
    </header>
  );
}
