import { expect, test } from "@playwright/test";
import { chooseLanguage } from "./language.js";

const CANONICAL_URL = "https://polytour.fun/";
const SOCIAL_IMAGE_URL = `${CANONICAL_URL}social-card.png`;
const FR_TITLE = "Polytour — Jeu de plateau multijoueur en ligne";
const EN_TITLE = "Polytour — Online Multiplayer Board Game";
const FR_DESCRIPTION =
  "Jouez à Polytour, un jeu de plateau immobilier pour 2 à 4 joueurs. Achetez des villes, construisez et jouez entre amis ou contre des bots dans votre navigateur.";
const EN_DESCRIPTION =
  "Play Polytour, a property-trading board game for 2–4 players. Buy cities, build and play with friends or bots in your browser.";

function expectPng(bytes: Buffer, width: number, height: number) {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect(bytes.readUInt32BE(16)).toBe(width);
  expect(bytes.readUInt32BE(20)).toBe(height);
}

test("keeps production crawl URLs separate from previews and private rooms", async ({
  request,
}) => {
  const homepage = await request.get("/");
  const isProduction =
    new URL(homepage.url()).origin === "https://polytour.fun";
  expect(homepage.headers().link).toBe(`<${CANONICAL_URL}>; rel="canonical"`);
  expect(homepage.headers()["x-robots-tag"]).toBe(
    isProduction ? undefined : "noindex, nofollow",
  );
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  const robotsText = await robots.text();
  expect(robotsText).toContain("User-agent: *");
  expect(robotsText).toContain("Allow: /\n");
  expect(robotsText).toContain("Disallow: /api");
  expect(robotsText).toContain("Disallow: /ws");
  expect(robotsText).not.toMatch(/^Disallow:\s*\/$/m);
  expect(robotsText).not.toContain("Disallow: /rooms");
  expect(robotsText).not.toContain("Disallow: /*?room=");
  const sitemap = await request.get("/sitemap.xml");
  if (isProduction) {
    expect(robotsText).toContain(`Sitemap: ${CANONICAL_URL}sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toContain("xml");
    expect(await sitemap.text()).toContain(`<loc>${CANONICAL_URL}</loc>`);
    expect((await sitemap.text()).match(/<loc>/g)).toHaveLength(1);
  } else {
    expect(robotsText).not.toContain("Sitemap:");
    expect(sitemap.status()).toBe(404);
  }
  for (const path of ["/?room=ABC123", "/rooms/ABC123"]) {
    const privatePage = await request.get(path);
    expect(privatePage.status()).toBe(200);
    expect(privatePage.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(privatePage.headers()["cache-control"]).toBe("no-store");
  }
  const index = await request.get("/index.html", { maxRedirects: 0 });
  expect(index.status()).toBe(308);
  expect(new URL(index.headers().location, homepage.url()).pathname).toBe("/");
  const unknown = await request.get("/not-a-page");
  expect(unknown.status()).toBe(404);
  const missingImage = await request.get("/missing-seo-image.png");
  expect(missingImage.status()).toBe(404);
  const probe = await request.get("/connection-probe.txt");
  expect(probe.status()).toBe(200);
  expect(probe.headers()["content-type"]).toContain("text/plain");
  expect(await probe.text()).not.toContain("<html");
});

test.describe("crawlable production HTML", () => {
  test.use({ javaScriptEnabled: false });

  test("serves metadata, structured data and readable content before JavaScript", async ({
    page,
    request,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    const html = await response.text();
    expect(html).toContain(FR_TITLE);
    expect(html).toContain(FR_DESCRIPTION);
    expect(html).toContain('type="application/ld+json"');
    await page.goto("/");
    await expect(page).toHaveTitle(FR_TITLE);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      FR_DESCRIPTION,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      CANONICAL_URL,
    );
    await expect(page.locator("link[hreflang]")).toHaveCount(0);
    for (const [property, content] of [
      ["og:type", "website"],
      ["og:site_name", "Polytour"],
      ["og:title", FR_TITLE],
      ["og:description", FR_DESCRIPTION],
      ["og:url", CANONICAL_URL],
      ["og:image", SOCIAL_IMAGE_URL],
      ["og:image:width", "1200"],
      ["og:image:height", "630"],
      ["og:locale", "fr_FR"],
      ["og:locale:alternate", "en_GB"],
    ]) {
      await expect(
        page.locator(`meta[property="${property}"]`),
      ).toHaveAttribute("content", content);
    }
    for (const [name, content] of [
      ["twitter:card", "summary_large_image"],
      ["twitter:title", FR_TITLE],
      ["twitter:description", FR_DESCRIPTION],
      ["twitter:image", SOCIAL_IMAGE_URL],
    ]) {
      await expect(page.locator(`meta[name="${name}"]`)).toHaveAttribute(
        "content",
        content,
      );
    }
    const structuredData = JSON.parse(
      (await page
        .locator('script[type="application/ld+json"]')
        .textContent()) ?? "null",
    ) as {
      "@context": string;
      "@type": string[];
      name: string;
      url: string;
      image: string;
      description: string;
      inLanguage: string[];
      numberOfPlayers: { minValue: number; maxValue: number };
    };
    expect(structuredData).toMatchObject({
      "@context": "https://schema.org",
      name: "Polytour",
      url: CANONICAL_URL,
      image: SOCIAL_IMAGE_URL,
      numberOfPlayers: { minValue: 2, maxValue: 4 },
    });
    expect(structuredData.description).toContain("2 à 4 joueurs");
    expect(structuredData["@type"]).toEqual(
      expect.arrayContaining(["VideoGame", "WebApplication"]),
    );
    expect(structuredData.inLanguage).toEqual(
      expect.arrayContaining(["fr", "en"]),
    );
    await expect(
      page.getByRole("heading", { name: "Polytour", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#root")).toContainText("2 à 4 joueurs");
    const notice = page.locator("noscript p");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(
      "Activez JavaScript pour ouvrir le jeu et rejoindre une partie.",
    );
    await page.screenshot({ path: ".local/verification/seo-no-js.png" });
  });
});

test("serves real favicons, touch icons and share images", async ({
  request,
  page,
}) => {
  const social = await request.get("/social-card.png");
  expect(social.status()).toBe(200);
  expect(social.headers()["content-type"]).toContain("image/png");
  expectPng(await social.body(), 1200, 630);

  const svg = await request.get("/favicon.svg");
  expect(svg.status()).toBe(200);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  expect(await svg.text()).toMatch(/<svg[^>]+viewBox=/);
  expect(await svg.text()).not.toContain("<html");

  const favicon = await request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toMatch(
    /image\/(?:x-icon|vnd\.microsoft\.icon)/,
  );
  const ico = await favicon.body();
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  const iconCount = ico.readUInt16LE(4);
  expect(iconCount).toBeGreaterThan(0);
  const iconSizes: number[] = [];
  for (let index = 0; index < iconCount; index++) {
    const entryOffset = 6 + index * 16;
    const width = ico[entryOffset] || 256;
    const height = ico[entryOffset + 1] || 256;
    expect(width).toBe(height);
    iconSizes.push(width);
    const byteLength = ico.readUInt32LE(entryOffset + 8);
    const imageOffset = ico.readUInt32LE(entryOffset + 12);
    expect(byteLength).toBeGreaterThan(0);
    expect(imageOffset).toBeGreaterThanOrEqual(6 + iconCount * 16);
    expect(imageOffset + byteLength).toBeLessThanOrEqual(ico.length);
  }
  expect(iconSizes).toContain(32);

  const manifestResponse = await request.get("/site.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toMatch(
    /(?:application\/manifest\+json|application\/json)/,
  );
  const manifest = (await manifestResponse.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    icons: { src: string; sizes: string; type: string }[];
  };
  expect(manifest.name).toBe("Polytour");
  expect(manifest.short_name).toBe("Polytour");
  expect(manifest.start_url).toBe("/");
  for (const [path, size] of [
    ["/apple-touch-icon.png", 180],
    ["/icons/icon-192.png", 192],
    ["/icons/icon-512.png", 512],
  ] as const) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    expectPng(await response.body(), size, size);
    if (size !== 180) {
      expect(manifest.icons).toContainEqual(
        expect.objectContaining({
          src: path,
          sizes: `${size}x${size}`,
          type: "image/png",
        }),
      );
    }
  }
  await page.goto("/");
  const decodedImages = await page.evaluate(async () => {
    const paths = [
      "/favicon.svg",
      "/favicon.ico",
      "/apple-touch-icon.png",
      "/social-card.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
    ];
    return Promise.all(
      paths.map(async (path) => {
        const image = new Image();
        image.src = path;
        await image.decode();
        return { path, width: image.naturalWidth, height: image.naturalHeight };
      }),
    );
  });
  for (const decoded of decodedImages) {
    expect(decoded.width).toBeGreaterThan(0);
    expect(decoded.height).toBeGreaterThan(0);
  }
});

test("keeps locale metadata and saved language aligned on the same canonical URL", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(FR_TITLE);
  await expect(
    page.getByRole("button", { name: "Jouer", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('link[rel="icon"][type="image/svg+xml"]'),
  ).toHaveAttribute("href", "/favicon.svg");
  await expect(
    page.locator('link[rel="icon"][href="/favicon.ico"]'),
  ).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/apple-touch-icon.png",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/site.webmanifest",
  );
  const originalURL = page.url();
  await chooseLanguage(page, "en");
  await expect(page).toHaveTitle(EN_TITLE);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  for (const selector of [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ]) {
    await expect(page.locator(selector)).toHaveAttribute(
      "content",
      EN_DESCRIPTION,
    );
  }
  for (const selector of [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
  ]) {
    await expect(page.locator(selector)).toHaveAttribute("content", EN_TITLE);
  }
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "en_GB",
  );
  await expect(
    page.locator('meta[property="og:locale:alternate"]'),
  ).toHaveAttribute("content", "fr_FR");
  for (const selector of [
    'meta[property="og:image:alt"]',
    'meta[name="twitter:image:alt"]',
  ]) {
    await expect(page.locator(selector)).toHaveAttribute(
      "content",
      "Polytour game board with cities and player tokens",
    );
  }
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    CANONICAL_URL,
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    CANONICAL_URL,
  );
  expect(page.url()).toBe(originalURL);
  await page.reload();
  await expect(page).toHaveTitle(EN_TITLE);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await chooseLanguage(page, "fr");
  await expect(page).toHaveTitle(FR_TITLE);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    FR_DESCRIPTION,
  );
});
