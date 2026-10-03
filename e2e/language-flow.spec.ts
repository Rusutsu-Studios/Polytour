import { expect, test } from "@playwright/test";
import { clickBoardSpace } from "./board-interactions.js";
import { DESKTOP_SIZES } from "./desktop-sizes.js";

test.use({ reducedMotion: "reduce" });

test("home sliders, language persistence and readable HTTP failure", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const created: { config?: { startingCash?: number } }[] = [];
  await page.route("**/api/rooms", (route) => {
    created.push(route.request().postDataJSON());
    return route.fulfill({
      status: 503,
      json: { error: "room-storage-limit" },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Nouvelle partie" }),
  ).toBeVisible();
  await page.getByLabel("Langue / Language").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "New game" })).toBeVisible();
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  const help = page.locator(".help-dialog");
  await expect(
    help.getByRole("heading", { name: "How to play", exact: true }),
  ).toBeVisible();
  await expect(help.locator(".help-dice")).toContainText(
    "On every roll, the server draws fresh random bytes with Cloudflare’s Web Crypto API. Values that would favor some faces are discarded, giving each face a 1 in 6 chance.",
  );
  await expect(help).not.toContainText(
    /Purchases cannot alter|paid bonuses|still being balanced|still being tuned/,
  );
  const documentation = help.getByRole("link", {
    name: "Cloudflare Web Crypto documentation (opens in a new tab)",
    exact: true,
  });
  await expect(documentation).toBeVisible();
  await expect(documentation).toHaveAttribute(
    "href",
    "https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#methods",
  );
  await expect(documentation).toHaveAttribute("target", "_blank");
  await expect(page.locator(".dice-explanation-link")).toHaveCount(1);
  await help.getByRole("button", { name: "Got it", exact: true }).click();
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
  // The full settings live in the lobby; the home screen keeps quick sliders.
  await expect(page.locator(".settings-trigger")).toHaveCount(0);
  for (const size of DESKTOP_SIZES) {
    await page.setViewportSize(size);
    await expect(page.locator(".welcome-board-preview canvas")).toBeVisible();
    const preview = await page.locator(".welcome-board-preview").boundingBox();
    expect(preview?.height).toBeGreaterThan(340);
    const settingsBounds = await quickSettings.boundingBox();
    // Large screens zoom the panels; compactness is judged at that zoom.
    const uiZoom = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--ui-zoom",
        ),
      ),
    );
    expect(settingsBounds?.height).toBeLessThan(220 * uiZoom);
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
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Cloudflare");
  // A quick slider sets the room the Play button creates.
  expect(created.at(-1)?.config?.startingCash).toBe(2_010_000);
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
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".lobby-seats")).toContainText("Atlas");
  await page.getByRole("button", { name: "Start game" }).click();
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
  await clickBoardSpace(page, 0);
  // The clicked space's deed speaks the new locale.
  const card = page.locator(".city-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-space", "0");
  await expect(page.locator("#city-card-title")).toHaveText("Grand départ");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Lancer les dés", exact: true })
    .click();
  await expect.poll(() => events.includes("DiceRolled")).toBe(true);
  await expect.poll(() => events.includes("PlayerMoved")).toBe(true);
});
