import { expect, test } from "@playwright/test";
import { DESKTOP_SIZES } from "./desktop-sizes.js";

test.use({ reducedMotion: "no-preference" });

test("the shared personal panel fits desktop sizes and supports tab keys", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const gear = page.locator(".personal-settings-trigger");
  await gear.press("Enter");
  const video = page.getByRole("tab", { name: "Vidéo", exact: true });
  await video.focus();
  await video.press("ArrowRight");
  const accessibility = page.getByRole("tab", {
    name: "Accessibilité",
    exact: true,
  });
  await expect(accessibility).toBeFocused();
  await expect(accessibility).toHaveAttribute("aria-selected", "true");
  await accessibility.press("Home");
  await expect(video).toBeFocused();
  for (const viewport of DESKTOP_SIZES.slice(0, 3)) {
    await page.setViewportSize(viewport);
    for (const [name, tab] of [
      ["video", video],
      ["accessibility", accessibility],
    ] as const) {
      await tab.click();
      const layout = await page.locator(".pause-dialog").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          pageWidth: document.documentElement.scrollWidth,
          panelWidth: element.querySelector(".pause-dialog-body")?.clientWidth,
          panelScrollWidth:
            element.querySelector(".pause-dialog-body")?.scrollWidth,
        };
      });
      expect(layout.top).toBeGreaterThanOrEqual(0);
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(viewport.width);
      expect(layout.bottom).toBeLessThanOrEqual(viewport.height);
      expect(layout.pageWidth).toBe(viewport.width);
      expect(layout.panelScrollWidth).toBe(layout.panelWidth);
      await page.screenshot({
        path: `.local/verification/settings-${testInfo.project.name}-${name}-${viewport.width}.png`,
      });
    }
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  await expect(gear).toBeFocused();
});

test("legacy preferences migrate intact and shared settings update another open tab", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("polytour.locale", "en");
    localStorage.setItem("polytour.lowGraphics", "true");
    localStorage.setItem("polytour.reducedMotion", "false");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await page.locator(".personal-settings-trigger").click();
  await expect(
    page.getByRole("radio", { name: "Low", exact: true }),
  ).toBeChecked();
  await page.getByRole("tab", { name: "Accessibility", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Off", exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(() => ({
      saved: JSON.parse(localStorage.getItem("polytour.settings.v1") ?? "null"),
      locale: localStorage.getItem("polytour.locale"),
      graphics: localStorage.getItem("polytour.lowGraphics"),
      motion: localStorage.getItem("polytour.reducedMotion"),
    })),
  ).toEqual({
    saved: {
      version: 1,
      locale: "en",
      graphics: "low",
      boardZoom: 1,
      reducedMotion: "off",
    },
    locale: "en",
    graphics: "true",
    motion: "false",
  });

  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await otherTab.locator(".personal-settings-trigger").click();
  await expect(
    otherTab.getByRole("radio", { name: "Low", exact: true }),
  ).toBeChecked();
  await otherTab.getByRole("radio", { name: "High", exact: true }).check();
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "High", exact: true }),
  ).toBeChecked();
  await otherTab.getByLabel("Language", { exact: true }).selectOption("fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByLabel("Langue", { exact: true })).toHaveValue("fr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.locator(".personal-settings-trigger").click();
  await expect(
    page.getByRole("radio", { name: "Élevé", exact: true }),
  ).toBeChecked();
  await otherTab.close();
});

test("System follows operating-system motion changes while explicit answers survive reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".personal-settings-trigger").click();
  await page.getByRole("tab", { name: "Accessibilité", exact: true }).click();
  const motion = page.getByRole("group", {
    name: "Réduire les animations",
    exact: true,
  });
  await expect(
    motion.getByRole("radio", { name: "Système", exact: true }),
  ).toBeChecked();
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await motion.getByRole("radio", { name: "Désactivé", exact: true }).check();
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await page.locator(".personal-settings-trigger").click();
  await page.getByRole("tab", { name: "Accessibilité", exact: true }).click();
  await expect(
    motion.getByRole("radio", { name: "Désactivé", exact: true }),
  ).toBeChecked();
  await motion.getByRole("radio", { name: "Activé", exact: true }).check();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await motion.getByRole("radio", { name: "Système", exact: true }).check();
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
});

test("Video enters and exits the browser fullscreen mode", async ({ page }) => {
  await page.goto("/");
  await page.locator(".personal-settings-trigger").click();
  const fullscreen = page.getByRole("button", {
    name: "Plein écran",
    exact: true,
  });
  if (!(await page.evaluate(() => document.fullscreenEnabled))) {
    await expect(fullscreen).toBeDisabled();
    return;
  }
  await fullscreen.click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  const exit = page.getByRole("button", {
    name: "Quitter le plein écran",
    exact: true,
  });
  await expect(exit).toHaveAttribute("aria-pressed", "true");
  await exit.click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false");
});

test("production exposes Debug and network diagnostics only with the debug flag", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "production",
    "Checks the production bundle, where DEV is false.",
  );
  let probes = 0;
  await page.route("**/connection-probe.txt**", (route) => {
    probes += 1;
    return route.fulfill({
      status: 200,
      body: "polytour-connection-probe-v1",
      contentType: "text/plain",
    });
  });
  await page.goto("/");
  await expect(page.locator(".lobby-network")).toHaveCount(0);
  await page.locator(".personal-settings-trigger").click();
  await expect(page.getByRole("tab")).toHaveText([
    "Vidéo",
    "Accessibilité",
    "Audio",
  ]);
  await expect(page.locator(".pause-debug")).toHaveCount(0);
  expect(probes).toBe(0);
  await page.goto("/?debug");
  await expect(page.locator(".lobby-network")).toBeVisible();
  await page.locator(".personal-settings-trigger").click();
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect(page.locator(".pause-debug")).toBeVisible();
  await expect.poll(() => probes).toBeGreaterThan(0);
});
