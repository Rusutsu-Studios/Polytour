import { expect, type Locator, type Page, test } from "@playwright/test";
import { chooseLanguage } from "./language.js";

test.use({ reducedMotion: "reduce" });

const DESKTOPS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

async function dismissHelp(page: Page, dialog?: Locator) {
  await expect(page.locator("#disabled-action-hint")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#disabled-action-hint")).not.toBeVisible();
  await page.mouse.move(2, 2);
  if (dialog) await expect(dialog).toBeVisible();
}

for (const locale of ["fr", "en"] as const) {
  test(`only bot difficulties explain themselves and quick settings stay spaced in ${locale}`, async ({
    page,
  }) => {
    const words =
      locale === "fr"
        ? {
            cash: "Capital de départ",
            defaults: "Niveau par défaut",
            easy: "Facile",
            medium: "Moyen",
            hard: "Difficile",
            player: "Votre nom de joueur",
            play: "Jouer",
            streamer: "Mode streamer",
            building: "Les bots peuvent construire",
            easyCopy: "profite moins bien de certaines occasions",
            hardCopy: "garde une réserve pour les loyers",
            noBuilding: "Construction désactivée pour tous les niveaux.",
          }
        : {
            cash: "Starting cash",
            defaults: "Default bot difficulty",
            easy: "Easy",
            medium: "Medium",
            hard: "Hard",
            player: "Player name",
            play: "Play",
            streamer: "Streamer mode",
            building: "Bots can build",
            easyCopy: "occasionally misses opportunities",
            hardCopy: "keeps cash for rent",
            noBuilding: "Building is disabled at every level.",
          };
    const popup = page.locator("#disabled-action-hint");
    await page.goto("/");
    await chooseLanguage(page, locale);
    await expect(page.locator('[data-icon="help"], .setting-help')).toHaveCount(
      0,
    );
    const quick = page.locator(".welcome-quick-settings");
    await expect(quick.locator("[data-help-title]")).toHaveCount(3);
    for (const viewport of DESKTOPS) {
      await page.setViewportSize(viewport);
      for (const heading of await quick
        .locator(".room-setting-heading")
        .all()) {
        const label = await heading.locator("label").boundingBox();
        const value = await heading.locator("output").boundingBox();
        if (!label || !value)
          throw new Error("Visible label and value expected");
        expect(value.y - (label.y + label.height)).toBeGreaterThanOrEqual(3);
        expect(value.x).toBeGreaterThanOrEqual(label.x - 1);
      }
      await page.screenshot({
        path: `.local/verification/quick-settings-${locale}-${viewport.width}.png`,
      });
    }
    await quick.getByRole("slider", { name: words.cash, exact: true }).hover();
    await expect(popup).not.toBeVisible();
    const streamer = page.getByRole("button", {
      name: words.streamer,
      exact: true,
    });
    await streamer.hover();
    await streamer.focus();
    await expect(popup).not.toBeVisible();
    await expect(streamer).not.toHaveAttribute("title");
    const quickDefault = quick.getByRole("group", {
      name: words.defaults,
      exact: true,
    });
    const medium = quickDefault.getByRole("radio", {
      name: words.medium,
      exact: true,
    });
    const easy = quickDefault.getByRole("radio", {
      name: words.easy,
      exact: true,
    });
    await medium.locator("..").hover();
    await expect(popup.locator("strong")).toHaveText(words.medium);
    await expect(popup).toContainText(
      locale === "fr" ? "petite réserve" : "small cash reserve",
    );
    await expect(medium).toBeChecked();
    await dismissHelp(page);
    await easy.focus();
    await expect(popup).toContainText(words.easyCopy);
    await expect(easy).toHaveAttribute(
      "aria-describedby",
      /disabled-action-hint/,
    );
    await expect(easy).not.toHaveAttribute("aria-expanded");
    await easy.check();
    await expect(popup).not.toBeVisible();
    await expect(easy).toBeChecked();
    await page.getByLabel(words.player).fill(`Setting help ${locale}`);
    await page.getByRole("button", { name: words.play, exact: true }).click();
    await expect(page.locator(".lobby-seat.bot")).toHaveCount(3);
    await page.locator(".settings-trigger").click();
    const dialog = page.locator(".pause-dialog");
    await expect(
      dialog.locator('.setting-help, [data-icon="help"]'),
    ).toHaveCount(0);
    await expect(dialog.locator("[data-help-title]")).toHaveCount(3);
    await dialog.getByRole("slider", { name: words.cash, exact: true }).focus();
    await expect(popup).not.toBeVisible();
    const building = dialog.getByRole("checkbox", {
      name: words.building,
      exact: true,
    });
    await building.hover();
    await building.focus();
    await expect(popup).not.toBeVisible();
    const defaults = dialog.getByRole("group", {
      name: words.defaults,
      exact: true,
    });
    const hard = defaults.getByRole("radio", { name: words.hard, exact: true });
    await hard.check();
    await building.uncheck();
    for (const viewport of DESKTOPS) {
      await page.setViewportSize(viewport);
      await hard.locator("..").scrollIntoViewIfNeeded();
      await hard.focus();
      await hard.locator("..").hover();
      await expect(popup.locator("strong")).toHaveText(words.hard);
      await expect(popup).toContainText(words.hardCopy);
      await expect(popup).toContainText(words.noBuilding);
      await expect(hard).toBeChecked();
      const bounds = await popup.boundingBox();
      if (!bounds) throw new Error("Visible help popup expected");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({
        path: `.local/verification/settings-help-${locale}-${viewport.width}.png`,
      });
      await dismissHelp(page, dialog);
    }
  });
}
