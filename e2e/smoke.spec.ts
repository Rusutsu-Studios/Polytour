import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test("renders without runtime errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });

    const health = page.waitForResponse("**/api/health");
    await page.goto("/");

    await expect(page).toHaveTitle("Polytour");
    await expect(
      page.getByRole("heading", { level: 1, name: "Polytour" }),
    ).toBeVisible();
    expect((await health).status()).toBe(200);
    await expect(page.getByRole("status")).not.toHaveText(
      "Connecting to game server…",
    );
    expect(errors).toEqual([]);
  });

  test("fits the viewport without horizontal scrolling", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // clientWidth, not innerWidth: mobile Chrome widens innerWidth to fit
    // overflowing content, which would hide exactly what this test looks for.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("serves the app shell for client-side routes", async ({ page }) => {
    const response = await page.goto("/rooms/ABC123");

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Polytour" }),
    ).toBeVisible();
  });
});

test.describe("Worker routing", () => {
  test("answers /api/* from the Worker, never the SPA fallback", async ({
    request,
  }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const missing = await request.get("/api/does-not-exist");
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found" });
  });

  test("upgrades a WebSocket to a GameRoom Durable Object", async ({
    page,
  }) => {
    await page.goto("/");

    const hello = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const url = new URL("/ws/debug/hello", window.location.href);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          const socket = new WebSocket(url);
          socket.addEventListener("message", (event) => {
            resolve(String(event.data));
            socket.close();
          });
          socket.addEventListener("error", () =>
            reject(new Error("WebSocket failed")),
          );
        }),
    );

    expect(JSON.parse(hello)).toEqual({ type: "phase0.hello", status: "ok" });
  });
});
