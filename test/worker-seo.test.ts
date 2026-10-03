import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker/index.js";
import { PRODUCTION_ORIGIN } from "../src/worker/seo.js";

const NO_INDEX = "noindex, nofollow";
const CANONICAL_LINK = `<${PRODUCTION_ORIGIN}/>; rel="canonical"`;

async function request(
  url: string,
  bindings = {} as Env,
  options: RequestInit<IncomingRequestCfProperties> = {},
) {
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(url, options),
    bindings,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

function appAssets() {
  const fetch = vi.fn().mockImplementation((input: Request) => {
    expect(new URL(input.url).pathname).toBe("/");
    return new Response("<!doctype html><title>Polytour</title>", {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
        ETag: '"test-app"',
      },
    });
  });
  return { fetch, bindings: { ASSETS: { fetch } } as unknown as Env };
}

describe("Search engine crawl endpoints", () => {
  it("advertises only the canonical homepage and lets crawlers read private-page noindex headers", async () => {
    const robots = await request(`${PRODUCTION_ORIGIN}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(robots.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await robots.text()).toBe(
      "User-agent: *\nAllow: /\nDisallow: /api\nDisallow: /ws\n\nSitemap: https://polytour.fun/sitemap.xml\n",
    );

    const sitemap = await request(`${PRODUCTION_ORIGIN}/sitemap.xml`);
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("Content-Type")).toBe(
      "application/xml; charset=utf-8",
    );
    const xml = await sitemap.text();
    expect(xml.match(/<loc>/g)).toHaveLength(1);
    expect(xml).toContain("<loc>https://polytour.fun/</loc>");
    expect(xml).not.toMatch(/room|workers\.dev|localhost/);
  });

  it.each([
    "https://polytour.rusutsu.workers.dev",
    "https://seo-preview-polytour.rusutsu.workers.dev",
    "http://localhost:5173",
    "http://polytour.fun",
    "https://polytour.fun.attacker.test",
  ])(
    "lets crawlers read noindex without advertising a sitemap on %s",
    async (origin) => {
      const robots = await request(`${origin}/robots.txt`, {} as Env, {
        headers: { "X-Forwarded-Host": "polytour.fun", Host: "polytour.fun" },
      });
      expect(robots.status).toBe(200);
      expect(await robots.text()).toBe(
        "User-agent: *\nAllow: /\nDisallow: /api\nDisallow: /ws\n",
      );
      expect(robots.headers.get("X-Robots-Tag")).toBe(NO_INDEX);
      const sitemap = await request(`${origin}/sitemap.xml`);
      expect(sitemap.status).toBe(404);
      expect(sitemap.headers.get("X-Robots-Tag")).toBe(NO_INDEX);
      expect(await sitemap.text()).not.toContain("<urlset");
    },
  );

  it.each(["robots.txt", "sitemap.xml"])(
    "supports HEAD /%s without a response body",
    async (path) => {
      const response = await request(
        `${PRODUCTION_ORIGIN}/${path}`,
        {} as Env,
        { method: "HEAD" },
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    },
  );
});

describe("Document indexing and routing", () => {
  it("keeps the production homepage indexable with a fixed canonical URL", async () => {
    const assets = appAssets();
    const response = await request(
      `${PRODUCTION_ORIGIN}/?utm_source=test`,
      assets.bindings,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
    expect(response.headers.get("Link")).toBe(CANONICAL_LINK);
    expect(response.headers.get("ETag")).toBe('"test-app"');
    expect(assets.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    "https://polytour.rusutsu.workers.dev/",
    "https://seo-preview-polytour.rusutsu.workers.dev/",
    "http://localhost:5173/",
  ])("marks app HTML on %s as noindex before scripts run", async (url) => {
    const response = await request(url, appAssets().bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe(NO_INDEX);
    expect(response.headers.get("Link")).toBe(CANONICAL_LINK);
  });

  it.each([
    "/?room=ABC234",
    "/?utm_source=test&room=ABC234",
    "/?room=",
    "/rooms/ABC123",
  ])(
    "preserves private navigation %s without indexing or caching it",
    async (path) => {
      const assets = appAssets();
      const response = await request(
        `${PRODUCTION_ORIGIN}${path}`,
        assets.bindings,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Robots-Tag")).toBe(NO_INDEX);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Link")).toBe(CANONICAL_LINK);
      expect(await response.text()).toContain("Polytour");
    },
  );

  it("redirects the duplicate index document while retaining invitation parameters", async () => {
    const response = await request(
      `${PRODUCTION_ORIGIN}/index.html?room=ABC234`,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("/?room=ABC234");
    expect(response.headers.get("X-Robots-Tag")).toBe(NO_INDEX);
  });

  it.each(["/does-not-exist", "/en", "/rooms/ABC234/details", "/missing.png"])(
    "returns a real 404 for unmatched Worker navigation %s",
    async (path) => {
      const assets = appAssets();
      const response = await request(
        `${PRODUCTION_ORIGIN}${path}`,
        assets.bindings,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
      expect(response.headers.get("X-Robots-Tag")).toBe(NO_INDEX);
      expect(assets.fetch).not.toHaveBeenCalled();
    },
  );
});

describe("Service crawl directives", () => {
  it.each([
    "/api/health",
    "/api/version",
    "/api/rooms/ABC234/health",
    "/api/missing",
    "/ws/room/ABC234",
  ])("keeps %s out of the index, including errors", async (path) => {
    const response = await request(`${PRODUCTION_ORIGIN}${path}`);
    expect(response.headers.get("X-Robots-Tag")).toBe(NO_INDEX);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("retains the WebSocket upgrade and its room-service headers", async () => {
    const pair = new WebSocketPair();
    pair[1].accept();
    const bindings = {
      GAME_ROOM: {
        getByName: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(
            new Response(null, {
              status: 101,
              webSocket: pair[0],
              headers: { "Sec-WebSocket-Protocol": "test-protocol" },
            }),
          ),
        }),
      },
    } as unknown as Env;
    const response = await request(
      `${PRODUCTION_ORIGIN}/ws/room/ABC234`,
      bindings,
      {
        headers: { Origin: PRODUCTION_ORIGIN, Upgrade: "websocket" },
      },
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).toBe(pair[0]);
    expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(
      "test-protocol",
    );
    expect(response.headers.get("X-Robots-Tag")).toBe(NO_INDEX);
    response.webSocket?.accept();
    response.webSocket?.close(1000);
    pair[1].close(1000);
  });
});
