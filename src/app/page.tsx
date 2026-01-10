import { Suspense } from "react";
import { Header } from "@/components/Header";
import { VideosGridClient } from "@/components/VideosGridClient";

type HomeProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function Home({ searchParams }: HomeProps) {
  const qRaw = searchParams?.q ?? searchParams?.name;
  const q = typeof qRaw === "string" ? qRaw : "";
  const typeRaw = searchParams?.type;
  const type = typeof typeRaw === "string" ? typeRaw : "all";
  const pageRaw = searchParams?.page;
  const page = typeof pageRaw === "string" ? pageRaw : "1";

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <Header />
      <Suspense fallback={null}>
        <VideosGridClient initialQ={q} initialType={type} initialPage={page} />
      </Suspense>
    </div>
  );
}
