export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET(req: Request) {
  const target = new URL("/sitemaps/sitemap.xml", req.url);
  return Response.redirect(target, 308);
}
