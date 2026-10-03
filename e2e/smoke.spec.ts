import { expect, test } from "@playwright/test";
import packageMetadata from "../package.json" with { type: "json" };

test.describe("production app shell", () => {
  test("shows the package release version served by the Worker", async ({
    page,
    request,
  }) => {
    const response = await request.get("/api/version");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ version: packageMetadata.version });
    await page.goto("/");
    const version = page
      .locator(".lobby-footer")
      .getByText(`v${packageMetadata.version}`, { exact: true });
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await version.scrollIntoViewIfNeeded();
      await expect(version).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page
      .getByRole("combobox", { name: "Langue / Language" })
      .selectOption("en");
    await expect(version).toHaveText(`v${packageMetadata.version}`);
  });

  test("loads the playable lobby and serves client routes", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page).toHaveTitle("Polytour");
    await expect(
      page.getByRole("button", { name: "Jouer", exact: true }),
    ).toBeVisible();
    const response = await page.goto("/rooms/ABC123");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Jouer", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("Worker routing", () => {
  test("keeps API errors separate from the SPA and does not create unknown rooms", async ({
    request,
  }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    const missing = await request.get("/api/does-not-exist");
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found" });
    const room = await request.get("/api/rooms/ZZZZZZ");
    expect(room.status()).toBe(404);
  });
});
