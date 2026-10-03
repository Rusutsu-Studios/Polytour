# Search and link previews

Polytour's public address is `https://polytour.fun/`. The initial HTML carries a
French title, description, canonical URL, Open Graph metadata, a Twitter large
image card and JSON-LD describing the playable browser game. Crawlers and link
preview services can read these without running React. The share image is the
1200 × 630 PNG at `/social-card.png`; its URL is absolute in the metadata.

The same HTML includes readable introductory content inside `#root`, followed
by a JavaScript requirement notice for browsers with scripting disabled. React
replaces the introductory content with the interactive lobby when it starts.
The static content uses the same supported game features as the UI: two to four
players, city purchases, construction, private games and server bots.

## Language

French is the default. English remains a local display preference stored in
`polytour.locale`; both languages use the same URL. `src/client/seo.ts` updates
the document language, title, description and localized social metadata with
the language choice, including on a later visit or a browser storage change.
Canonical and share URLs stay fixed. There are no separate indexed language
pages or `hreflang` routes. Social services that fetch the original HTML receive
the French metadata.

## Crawl policy

The Worker recognizes only the exact production origin `https://polytour.fun`
as indexable. Its `/robots.txt` allows site HTML, excludes API and WebSocket
paths, and points to `/sitemap.xml`. The sitemap contains only the public
homepage. Private room and invitation pages remain crawlable so a search engine
can fetch and respect their HTTP noindex directive.

On every other origin, including Worker Previews and local development,
`/robots.txt` also allows HTML to be fetched so crawlers can see the authoritative
`X-Robots-Tag: noindex, nofollow` header on Worker responses. It excludes API and
WebSocket paths and advertises no sitemap; `/sitemap.xml` responds with 404.
On production, private
room and invitation HTML (`/rooms/:roomCode` and `/?room=…`) carries the same
directive and `Cache-Control: no-store`. API and WebSocket routes stay excluded
from indexing. These directives control crawler behavior; room access continues
to use the existing room protocol and seat capabilities. HTTP noindex remains
effective when the common app HTML contains an index directive: crawlers apply
the more restrictive rule. See Google's [robots directive documentation](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).

The Worker serves the homepage and legacy room routes as app HTML, redirects
`/index.html` to `/` with 308 while preserving its query, and returns 404 for
unknown pages. Static assets use Cloudflare's asset handler directly. The
`not_found_handling: "none"` setting prevents a missing image, icon or arbitrary
path from receiving a successful HTML fallback. The app HTML also advertises
the canonical homepage in its HTTP `Link` header.

## Icons

The four city tiles used by the lobby's existing brand mark also identify the
browser tab. `/favicon.svg` is the scalable icon; `/favicon.ico` supplies raster
sizes for older favicon consumers. `/apple-touch-icon.png` is 180 × 180.
`/site.webmanifest` names Polytour and references 192 × 192 and 512 × 512 PNG
icons in `/icons/`. The manifest provides app identity and icons; offline
gameplay and a service worker are not implemented.

## Verification

`e2e/seo.spec.ts` runs against the built Worker with the production Playwright
project. It checks the original HTML and visible content with JavaScript
disabled, canonical and social URLs, structured data, language changes and
persistence, crawler endpoint behavior, private-room headers, missing-resource
404s and the existing connection diagnostic asset. It fetches the PNG and ICO
files and checks their binary formats and dimensions, so an HTML fallback cannot
pass as a working image.

Worker tests exercise the exact production origin separately from local and
preview origins. Run the required type, lint and test checks, then
`pnpm test:e2e` and `pnpm check:wrangler` after changing the app shell or routing.
Local checks do not establish that a production deployment has completed or
that a search engine has refreshed its index or a social service its cache.
