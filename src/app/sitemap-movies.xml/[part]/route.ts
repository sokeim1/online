export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET(req: Request, ctx: { params: Promise<{ part: string }> }) {
  const { part: partRaw } = await ctx.params;
  const part = Number.parseInt(partRaw, 10);

  if (!Number.isFinite(part) || part < 1 || part > 5000) {
    return new Response("Invalid part", { status: 400 });
  }

  const target = new URL(`/sitemaps/sitemap-movies-${part}.xml`, req.url);
  return Response.redirect(target, 308);
}
