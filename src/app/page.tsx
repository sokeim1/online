import { Header } from "@/components/Header";
import { VideosGridClient } from "@/components/VideosGridClient";

export default function Home() {
  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <Header />
      <VideosGridClient />
    </div>
  );
}
