/** The public site is fixed: request headers must never select its canonical URL. */
export const PRODUCTION_ORIGIN = "https://polytour.fun";
const NO_INDEX = "noindex, nofollow";

export function isProductionOrigin(url: URL): boolean {
  return url.origin === PRODUCTION_ORIGIN;
}

export function robotsResponse(url: URL): Response {
  const body = isProductionOrigin(url)
    ? [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api",
        "Disallow: /ws",
        "",
        `Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`,
        "",
      ].join("\n")
    : "User-agent: *\nAllow: /\nDisallow: /api\nDisallow: /ws\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function sitemapResponse(url: URL): Response {
  if (!isProductionOrigin(url))
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${PRODUCTION_ORIGIN}/</loc></url>\n</urlset>\n`,
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}

/** HTTP directives also protect crawlers that do not execute the app's scripts. */
export function withSeoHeaders(request: Request, response: Response): Response {
  const url = new URL(request.url);
  const isHtml = response.headers.get("Content-Type")?.includes("text/html");
  const isPrivate =
    url.searchParams.has("room") ||
    /^\/(?:api|ws|rooms)(?:\/|$)/.test(url.pathname);
  const headers = new Headers(response.headers);
  if (!isProductionOrigin(url) || isPrivate || response.status >= 400)
    headers.set("X-Robots-Tag", NO_INDEX);
  if (isHtml) {
    headers.set("Link", `<${PRODUCTION_ORIGIN}/>; rel="canonical"`);
    if (isPrivate) headers.set("Cache-Control", "no-store");
  }
  // Explicitly retain the socket when the room service returns an upgrade.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    webSocket: response.webSocket,
  });
}
