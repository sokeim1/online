export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET(req: Request) {
  return Response.redirect("/sitemaps/sitemap-static.xml", 308);
}
