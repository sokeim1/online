export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const siteUrl = (process.env.SITE_URL ?? origin).replace(/\/$/, "");

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
