import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";

  if (
    host &&
    !host.startsWith("www.") &&
    !host.startsWith("localhost") &&
    !host.startsWith("127.0.0.1") &&
    !host.endsWith(".vercel.app")
  ) {
    const url = req.nextUrl.clone();
    url.hostname = `www.${url.hostname}`;
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|robots.txt|sitemap.xml).*)",
  ],
};
