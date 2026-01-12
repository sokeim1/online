import { Suspense } from "react";
import { Header } from "@/components/Header";
import { VideosGridClient } from "@/components/VideosGridClient";
import { getVibixVideoLinks } from "@/lib/vibix";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const sp = searchParams ? await searchParams : undefined;

  const qRaw = sp?.q ?? sp?.name;
  const q = typeof qRaw === "string" ? qRaw : "";
  const typeRaw = sp?.type;
  const type = typeof typeRaw === "string" ? typeRaw : "all";
  const pageRaw = sp?.page;
  const page = typeof pageRaw === "string" ? pageRaw : "1";

  const pageNum = Number.parseInt(page, 10);
  const safePage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
  const canSsrList = q.trim().length === 0;

  let initialItems = [] as Awaited<ReturnType<typeof getVibixVideoLinks>>["data"];
  let initialLastPage: number | null = null;
  let initialTotal: number | null = null;

  if (canSsrList) {
    try {
      const data = await getVibixVideoLinks({
        type: type === "movie" || type === "serial" ? type : undefined,
        page: safePage,
        limit: 20,
      });
      initialItems = data.data.filter((v) => v.kp_id != null);
      initialLastPage = data.meta?.last_page ?? null;
      initialTotal = data.meta?.total ?? null;
    } catch {
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <Header />
      <Suspense fallback={null}>
        <VideosGridClient
          initialQ={q}
          initialType={type}
          initialPage={page}
          {...(canSsrList
            ? {
                initialItems,
                initialLastPage,
                initialTotal,
              }
            : null)}
        />
      </Suspense>
    </div>
  );
}
