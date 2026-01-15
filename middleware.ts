import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const hostname = req.nextUrl.hostname;

  const isLocalhost =
    hostname.startsWith("localhost") ||
    hostname.startsWith("127.0.0.1") ||
    hostname === "0.0.0.0";

  const isVercelPreview = hostname.endsWith(".vercel.app");

  if (hostname && !isLocalhost && !isVercelPreview) {
    const parts = hostname.split(".");

    // Handle mobile subdomain: m.example.com -> example.com
    if (parts[0] === "m") {
      parts.shift();
    }
    // Handle accidental www.m.example.com -> www.example.com
    if (parts[0] === "www" && parts[1] === "m") {
      parts.splice(1, 1);
    }

    // Enforce www on root domains
    if (parts[0] !== "www") {
      parts.unshift("www");
    }

    const canonicalHostname = parts.join(".");
    if (canonicalHostname !== hostname) {
      const url = req.nextUrl.clone();
      url.hostname = canonicalHostname;
      return NextResponse.redirect(url, 308);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)",
  ],
};
