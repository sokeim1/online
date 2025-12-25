import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return true;
  if (h.endsWith(".localhost")) return true;
  return false;
}

function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "ru" || h.endsWith(".ru")) return true;
  if (h === "yandex.net" || h.endsWith(".yandex.net")) return true;
  if (h === "yandex.ru" || h.endsWith(".yandex.ru")) return true;
  if (h === "kinopoisk.ru" || h.endsWith(".kinopoisk.ru")) return true;
  return false;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("url") ?? "").trim();

  if (!raw) {
    return NextResponse.json(
      { success: false, message: "Missing query param: url" },
      { status: 400 },
    );
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid url" },
      { status: 400 },
    );
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json(
      { success: false, message: "Unsupported protocol" },
      { status: 400 },
    );
  }

  if (isBlockedHost(target.hostname)) {
    return NextResponse.json(
      { success: false, message: "Blocked host" },
      { status: 400 },
    );
  }

  if (!isAllowedHost(target.hostname)) {
    return NextResponse.json(
      { success: false, message: "Host not allowed" },
      { status: 400 },
    );
  }

  const requestInit: RequestInit = {
    cache: "no-store",
    headers: {
      Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
    },
  };

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), requestInit);
  } catch {
    const fallbackUrl = `https://images.weserv.nl/?url=${encodeURIComponent(target.toString().replace(/^https?:\/\//, ""))}`;
    upstream = await fetch(fallbackUrl, requestInit);
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const body = await upstream.arrayBuffer();

  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
