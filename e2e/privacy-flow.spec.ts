import { expect, test } from "@playwright/test";
import { chooseLanguage } from "./language.js";

test.use({ reducedMotion: "reduce" });

test("enabling streamer mode during a pending room request keeps its code out of the URL", async ({
  page,
}) => {
  let release = () => {};
  let requested = () => {};
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route("**/api/rooms", async (route) => {
    const response = await route.fetch();
    requested();
    await responseGate;
    await route.fulfill({ response });
  });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Pending privacy");
  await page.getByRole("button", { name: "Jouer", exact: true }).click();
  await requestStarted;
  await page
    .getByRole("button", { name: "Mode streamer", exact: true })
    .click();
  release();
  await expect(page.locator(".lobby-seats")).toContainText("Pending privacy");
  await expect(page.locator(".room-code-block")).toContainText("Code masqué");
  expect(new URL(page.url()).searchParams.has("room")).toBe(false);
});

test("streamer mode masks joining, lobby and match codes and survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await chooseLanguage(page, "en");
  const toggle = page.getByRole("button", {
    name: "Streamer mode",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Have a room code?").fill("ABCD23");
  await expect(page.getByLabel("Have a room code?")).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByLabel("Player name").fill("Streamer fixture");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/rooms") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const { roomCode } = (await (await created).json()) as { roomCode: string };
  await expect(page.locator(".lobby-seats")).toContainText("Streamer fixture");
  await expect(page.locator(".room-code-block")).toContainText("Code hidden");
  await expect(page.locator("body")).not.toContainText(roomCode);
  expect(new URL(page.url()).searchParams.has("room")).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          sessionStorage.setItem("test-invite", value);
          return Promise.resolve();
        },
      },
    });
  });
  await page.getByRole("button", { name: "Copy invite", exact: true }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("test-invite"))).toBe(
    `${new URL(page.url()).origin}/?room=${roomCode}`,
  );
  await page.reload();
  await expect(page.locator(".lobby-seats")).toContainText("Streamer fixture");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.locator("body").evaluate((body) => body.outerHTML),
  ).not.toContain(roomCode);
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".game-shell")).toBeVisible();
  await page
    .getByRole("button", { name: "Invite players", exact: true })
    .click();
  await expect(page.locator(".room-tool-code")).toContainText("Code hidden");
  await expect(page.locator("body")).not.toContainText(roomCode);
  const matchToggle = page
    .locator(".game-tools")
    .getByRole("button", { name: "Streamer mode", exact: true });
  const hint = page.locator("#disabled-action-hint");
  await matchToggle.hover();
  await expect(hint).toContainText("Hides the room code");
  await expect(matchToggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(hint).not.toBeVisible();
  await page
    .getByRole("button", { name: "Reset board view", exact: true })
    .focus();
  await matchToggle.focus();
  await expect(hint).toBeVisible();
  await expect(matchToggle).toHaveAttribute(
    "aria-describedby",
    /disabled-action-hint/,
  );
  await expect(page.locator(".game-tools button").first()).toHaveAccessibleName(
    "Streamer mode",
  );
  await expect(matchToggle).toHaveAttribute("aria-pressed", "true");
  await matchToggle.click();
  await expect(hint).not.toBeVisible();
  await expect(matchToggle).not.toHaveAttribute("aria-expanded");
  await expect(matchToggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".room-tool-code")).toContainText(roomCode);
  expect(
    await page.evaluate(() => localStorage.getItem("polytour.streamer")),
  ).toBe("false");
  await page.getByRole("button", { name: "Pause menu", exact: true }).click();
  await page
    .locator(".pause-dialog")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const setting = page
    .locator(".pause-dialog")
    .getByRole("button", { name: "Streamer mode", exact: true });
  await expect(setting).toHaveAttribute("aria-pressed", "false");
  await setting.hover();
  await expect(hint).toContainText("Hides the room code");
  await page.keyboard.press("Escape");
  await expect(page.locator(".pause-dialog")).toBeVisible();
  await page.locator(".pause-dialog").getByRole("tab").first().focus();
  await setting.focus();
  await expect(hint).toBeVisible();
  await setting.click();
  await expect(hint).not.toBeVisible();
  await expect(setting).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(matchToggle).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Invite players", exact: true })
    .click();
  await expect(page.locator(".room-tool-code")).toContainText("Code hidden");
  expect(new URL(page.url()).searchParams.has("room")).toBe(false);
  expect(
    await page.evaluate(() => localStorage.getItem("polytour.streamer")),
  ).toBe("true");
  expect(
    await page.locator("body").evaluate((body) => body.outerHTML),
  ).not.toContain(roomCode);
});

test("streamer invitations keep the code out of markup and the address bar", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/rooms", {
    data: { name: "Invite fixture", bots: 1 },
  });
  expect(response.status()).toBe(201);
  const { roomCode } = (await response.json()) as { roomCode: string };
  await page.addInitScript(() =>
    localStorage.setItem("polytour.streamer", "true"),
  );
  await page.goto(`/?room=${roomCode}`);
  await expect(
    page.getByRole("heading", { name: "Rejoindre la salle", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page.locator("body").evaluate((body) => body.outerHTML),
  ).not.toContain(roomCode);
  await page.getByLabel("Votre nom de joueur").fill("Invited streamer");
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(page.locator(".lobby-seats")).toContainText("Invited streamer");
  await expect(page.locator(".room-code-block")).toContainText("Code masqué");
});
