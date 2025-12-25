import Link from "next/link";

import { Header } from "@/components/Header";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-12">
        <h1 className="text-2xl font-semibold">Фильм не найден</h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">Контент не найден.</p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm text-[color:var(--foreground)] hover:bg-[color:var(--surface-hover)]"
        >
          Вернуться на главную
        </Link>
      </main>
    </div>
  );
}
