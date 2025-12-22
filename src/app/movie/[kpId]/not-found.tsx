import Link from "next/link";

import { Header } from "@/components/Header";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#07070b] text-white">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-12">
        <h1 className="text-2xl font-semibold">Фильм не найден</h1>
        <p className="mt-2 text-sm text-white/60">
          Проверь `kpId` или доступ к API.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          Вернуться на главную
        </Link>
      </main>
    </div>
  );
}
