import { Header } from "@/components/Header";
import { VideosGridClient } from "@/components/VideosGridClient";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#07070b] text-white">
      <Header />
      <VideosGridClient />
    </div>
  );
}
