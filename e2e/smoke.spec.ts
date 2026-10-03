import { expect, test } from "@playwright/test";

test.describe("production app shell", () => {
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
