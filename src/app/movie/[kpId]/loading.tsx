import { Header } from "@/components/Header";

export default function Loading() {
  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <Header />
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8">
        <div className="h-5 w-40 animate-pulse rounded bg-[color:var(--surface)]" />
        <div className="mt-6 overflow-hidden rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface)]">
          <div className="h-56 w-full animate-pulse bg-[color:var(--surface-hover)] sm:h-72" />
          <div className="-mt-24 flex gap-6 px-5 pb-6 sm:-mt-28 sm:px-6">
            <div className="h-[240px] w-40 animate-pulse rounded-2xl bg-[color:var(--surface-hover)] sm:h-[320px] sm:w-56" />
            <div className="flex-1 pb-2">
              <div className="h-8 w-2/3 animate-pulse rounded bg-[color:var(--surface-hover)]" />
              <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-[color:var(--surface-hover)]" />
              <div className="mt-5 flex gap-2">
                <div className="h-8 w-20 animate-pulse rounded-xl bg-[color:var(--surface-hover)]" />
                <div className="h-8 w-20 animate-pulse rounded-xl bg-[color:var(--surface-hover)]" />
                <div className="h-8 w-20 animate-pulse rounded-xl bg-[color:var(--surface-hover)]" />
              </div>
            </div>
          </div>
          <div className="grid gap-8 px-5 pb-8 sm:px-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <div className="h-5 w-28 animate-pulse rounded bg-[color:var(--surface-hover)]" />
              <div className="mt-3 aspect-video w-full animate-pulse rounded-2xl bg-[color:var(--surface-hover)]" />
            </div>
            <div className="lg:col-span-2">
              <div className="h-5 w-24 animate-pulse rounded bg-[color:var(--surface-hover)]" />
              <div className="mt-3 h-52 w-full animate-pulse rounded-2xl bg-[color:var(--surface-hover)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
