export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSiteUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl.replace(/\/$/, "");
  }

  const host = url.hostname;
  if (
    host &&
    !host.startsWith("www.") &&
    !host.startsWith("localhost") &&
    !host.startsWith("127.0.0.1") &&
    !host.endsWith(".vercel.app")
  ) {
    url.hostname = `www.${host}`;
  }
  return url.toString().replace(/\/$/, "");
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const siteUrl = normalizeSiteUrl(process.env.SITE_URL ?? origin);

  const body = [
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${siteUrl}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
