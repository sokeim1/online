export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET(req: Request, ctx: { params: Promise<{ part: string }> }) {
  const { part: partRaw } = await ctx.params;
  const part = Number.parseInt(partRaw, 10);

  if (!Number.isFinite(part) || part < 1 || part > 5000) {
    return new Response("Invalid part", { status: 400 });
  }

  const siteUrlRaw = process.env.SITE_URL?.trim() ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const base = siteUrlRaw
    ? siteUrlRaw.replace(/\/+$/, "")
    : (() => {
        const proto = req.headers.get("x-forwarded-proto") ?? "https";
        const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
        if (host) return `${proto}://${host}`;
        try {
          return new URL(req.url).origin;
        } catch {
          return "https://localhost";
        }
      })();

  return Response.redirect(`${base}/sitemaps/sitemap-movies-${part}.xml`, 308);
}
