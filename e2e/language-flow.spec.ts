import { expect, test } from "@playwright/test";
import { clickBoardSpace } from "./board-interactions.js";
import { DESKTOP_SIZES } from "./desktop-sizes.js";
import { chooseLanguage } from "./language.js";

test.use({ reducedMotion: "reduce" });

for (const scenario of [
  { name: "English regional browser", browser: "en-GB", expected: "en" },
  { name: "French regional browser", browser: "fr-CH", expected: "fr" },
  { name: "unsupported browser", browser: "de-DE", expected: "fr" },
  {
    name: "first supported English preference",
    browser: "fr-CH",
    languages: ["de-DE", "en-US", "fr-CH"],
    expected: "en",
  },
  {
    name: "first supported French preference",
    browser: "en-GB",
    languages: ["es-ES", "fr-BE", "en-US"],
    expected: "fr",
  },
  {
    name: "primary language after unsupported preferences",
    browser: "en-US",
    languages: ["de-DE", "es-ES"],
    expected: "en",
  },
  {
    name: "saved English overrides French browser",
    browser: "fr-CH",
    stored: "en",
    expected: "en",
  },
  {
    name: "saved French overrides English browser",
    browser: "en-GB",
    stored: "fr",
    expected: "fr",
  },
  {
    name: "invalid saved language falls back to browser",
    browser: "en-GB",
    stored: "es",
    expected: "en",
  },
] as const) {
  test.describe(scenario.name, () => {
    test.use({ locale: scenario.browser });
    test("selects the initial interface language", async ({ page }) => {
      await page.addInitScript((settings) => {
        if ("languages" in settings)
          Object.defineProperty(navigator, "languages", {
            get: () => settings.languages,
          });
        if ("stored" in settings && typeof settings.stored === "string")
          localStorage.setItem("polytour.locale", settings.stored);
      }, scenario);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        scenario.expected,
      );
      await expect(
        page.getByRole("heading", {
          name: scenario.expected === "en" ? "New game" : "Nouvelle partie",
        }),
      ).toBeVisible();
    });
  });
}

test.describe("browser storage unavailable", () => {
  test.use({ locale: "en-US" });
  test("detects browser language and permits a manual choice without storage", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException(
            "Storage blocked for this test",
            "SecurityError",
          );
        },
      });
    });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "New game" })).toBeVisible();
    await chooseLanguage(page, "fr");
    await expect(
      page.getByRole("heading", { name: "Nouvelle partie" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "New game" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

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
  await chooseLanguage(page, "en");
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
    const alignment = await page.evaluate(() => {
      const content = document.querySelector(".welcome-grid");
      if (!content) throw new Error("Welcome grid missing");
      const rect = content.getBoundingClientRect();
      const gutter = Number.parseFloat(getComputedStyle(content).paddingLeft);
      return [".topbar .brand", ".lobby-footer"].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`${selector} missing`);
        const box = element.getBoundingClientRect();
        const padding = Number.parseFloat(
          getComputedStyle(element).paddingLeft,
        );
        const zoom = Number.parseFloat(getComputedStyle(element).zoom) || 1;
        return Math.abs(box.x + padding * zoom - (rect.x + gutter));
      });
    });
    for (const offset of alignment) expect(offset).toBeLessThan(2);
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
  await chooseLanguage(page, "fr");
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
  await chooseLanguage(page, "en");
  await page.getByLabel("Player name").fill("English player");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".lobby-seats")).toContainText("Atlas");
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator(".player-card")).toHaveCount(4);
  // Bots before this seat play their turns at a readable pace first.
  await expect(
    page.getByRole("button", { name: "Roll the dice", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  for (const [tile, name] of [
    [13, "Hamburg"],
    [17, "Geneva"],
    [25, "Hawaii"],
  ] as const) {
    await clickBoardSpace(page, tile);
    await expect(page.locator("#city-card-title")).toHaveText(name);
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: ".local/verification/destinations-en.png" });
  const before = await page.evaluate(() =>
    sessionStorage.getItem("polytour-room-v1"),
  );
  const url = page.url();
  const socketCount = sockets;
  await page.getByRole("button", { name: "Pause menu", exact: true }).click();
  await expect(page.locator(".pause-dialog")).not.toContainText(
    "The game keeps running while this menu is open.",
  );
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
  for (const [tile, name] of [
    [13, "Hambourg"],
    [17, "Genève"],
    [25, "Hawaï"],
  ] as const) {
    await clickBoardSpace(page, tile);
    await expect(page.locator("#city-card-title")).toHaveText(name);
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: ".local/verification/destinations-fr.png" });
  await clickBoardSpace(page, 0);
  // The clicked space's deed speaks the new locale.
  const card = page.locator(".city-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-space", "0");
  await expect(page.locator("#city-card-title")).toHaveText("Départ");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Lancer les dés", exact: true })
    .click();
  await expect.poll(() => events.includes("DiceRolled")).toBe(true);
  await expect.poll(() => events.includes("PlayerMoved")).toBe(true);
});
