import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("home sliders, language persistence and readable HTTP failure", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/rooms", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "room-storage-limit" },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Nouvelle partie" }),
  ).toBeVisible();
  await page.getByLabel("Langue / Language").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "New game" })).toBeVisible();
  const quickSettings = page.locator(".welcome-quick-settings");
  await expect(quickSettings.getByRole("slider")).toHaveCount(3);
  const startingCash = quickSettings.getByRole("slider", {
    name: "Starting cash",
    exact: true,
  });
  await expect(startingCash).toHaveValue("2000000");
  await startingCash.focus();
  await page.keyboard.press("ArrowRight");
  await expect(startingCash).toHaveValue("2010000");
  await page.locator(".settings-trigger").click();
  await expect(
    page
      .locator(".settings-dialog")
      .getByRole("slider", { name: "Starting cash", exact: true }),
  ).toHaveValue("2010000");
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-trigger")).toBeFocused();
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator(".welcome-board-preview canvas")).toBeVisible();
    const preview = await page.locator(".welcome-board-preview").boundingBox();
    expect(preview?.height).toBeGreaterThan(340);
    const settingsBounds = await quickSettings.boundingBox();
    expect(settingsBounds?.height).toBeLessThan(220);
    expect(
      (settingsBounds?.x ?? 0) + (settingsBounds?.width ?? 0),
    ).toBeLessThanOrEqual(size.width);
    for (const slider of await quickSettings.getByRole("slider").all()) {
      const rect = await slider.boundingBox();
      expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(
        size.width,
      );
    }
    const bounds = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(bounds.scrollWidth).toBe(bounds.width);
    expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.height);
    await page.screenshot({
      path: `.local/verification/home-en-${size.width}.png`,
    });
  }
  await page.getByLabel("Player name").fill("Language check");
  await page
    .getByRole("button", { name: "Create a room with friends" })
    .click();
  await expect(page.getByRole("alert")).toContainText("Cloudflare");
  await expect(page.getByRole("alert")).not.toContainText("Unexpected token");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "New game" })).toBeVisible();
  await page.getByLabel("Langue / Language").selectOption("fr");
  await expect(
    page.getByRole("heading", { name: "Nouvelle partie" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("English local match switches language without rejoining or changing game state", async ({
  page,
}) => {
  const events: string[] = [];
  let sockets = 0;
  page.on("websocket", (socket) => {
    sockets += 1;
    socket.on("framereceived", (frame) => {
      const message = JSON.parse(String(frame.payload)) as {
        events?: { type: string }[];
      };
      for (const event of message.events ?? []) events.push(event.type);
    });
  });
  await page.goto("/");
  await page.getByLabel("Langue / Language").selectOption("en");
  await page.getByLabel("Player name").fill("English player");
  await page.getByRole("button", { name: "Play with 3 bots" }).click();
  await expect(page.locator(".player-card")).toHaveCount(4);
  // Bots before this seat play their turns at a readable pace first.
  await expect(
    page.getByRole("button", { name: "Roll the dice", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  const before = await page.evaluate(() =>
    sessionStorage.getItem("polytour-room-v1"),
  );
  const url = page.url();
  const socketCount = sockets;
  await page.getByRole("button", { name: "Pause menu", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".pause-dialog")
    .getByLabel("Language", { exact: true })
    .selectOption("fr");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled();
  expect(page.url()).toBe(url);
  expect(sockets).toBe(socketCount);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBe(before);
  await page
    .getByRole("button", { name: "Explorer le plateau", exact: true })
    .click();
  await expect(page.getByLabel("Explorer une case")).toContainText(
    "Grand départ",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Lancer les dés", exact: true })
    .click();
  await expect.poll(() => events.includes("DiceRolled")).toBe(true);
  await expect.poll(() => events.includes("PlayerMoved")).toBe(true);
});
