import { expect, type Locator, type Page, test } from "@playwright/test";
import { chooseLanguage } from "./language.js";

test.use({ reducedMotion: "reduce" });

const DESKTOPS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

async function expectPopupBounds(
  popup: Locator,
  width: number,
  height: number,
) {
  const bounds = await popup.boundingBox();
  if (!bounds) throw new Error("Visible help popup expected");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
}

async function dismissHelp(page: Page, dialog?: Locator) {
  await expect(page.locator("#disabled-action-hint")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#disabled-action-hint")).not.toBeVisible();
  await page.mouse.move(2, 2);
  if (dialog) await expect(dialog).toBeVisible();
}

for (const locale of ["fr", "en"] as const) {
  test(`every room setting explains itself without question marks in ${locale}`, async ({
    page,
  }) => {
    const words =
      locale === "fr"
        ? {
            cash: "Capital de départ",
            salary: "Salaire au départ",
            festivals: "Festivals initiaux",
            duration: "Durée de partie",
            timer: "Temps de décision",
            defaults: "Niveau par défaut",
            easy: "Facile",
            medium: "Moyen",
            hard: "Difficile",
            toggles: [
              "Victoire par ligne complète",
              "Victoire par trois collections",
              "Victoire par les quatre plages",
              "Hôtels directement achetables",
              "Rejouer après un double",
              "Troisième double : direction l'île",
              "Les bots peuvent construire",
              "Les cadeaux peuvent causer une faillite",
            ],
            player: "Votre nom de joueur",
            play: "Jouer",
            easyCopy: "profite moins bien de certaines occasions",
            hardCopy: "garde une réserve pour les loyers",
            noBuilding: "Construction désactivée pour tous les niveaux.",
            giftFull: /Anniversaire.*Solidarité.*Mécène.*paiement complet/,
            giftCapped: /limité à l’argent disponible/,
          }
        : {
            cash: "Starting cash",
            salary: "Salary per lap",
            festivals: "Starting festivals",
            duration: "Game duration",
            timer: "Decision timer",
            defaults: "Default bot difficulty",
            easy: "Easy",
            medium: "Medium",
            hard: "Hard",
            toggles: [
              "Win with a full side",
              "Win with three complete sets",
              "Win with all four beaches",
              "Buy hotels directly",
              "Roll again on doubles",
              "Third double goes to the island",
              "Bots can build",
              "Gifts can cause bankruptcy",
            ],
            player: "Player name",
            play: "Play",
            easyCopy: "occasionally misses opportunities",
            hardCopy: "keeps cash for rent",
            noBuilding: "Building is disabled at every level.",
            giftFull: /Birthday.*Charity.*full payment/,
            giftCapped: /capped at available cash/,
          };
    const popup = page.locator("#disabled-action-hint");
    await page.goto("/");
    await chooseLanguage(page, locale);
    await expect(page.locator('[data-icon="help"], .setting-help')).toHaveCount(
      0,
    );
    const quick = page.locator(".welcome-quick-settings");
    const quickCash = quick.getByRole("slider", {
      name: words.cash,
      exact: true,
    });
    await quickCash.hover();
    await expect(popup.locator("strong")).toHaveText(words.cash);
    await dismissHelp(page);
    const quickDefault = quick.getByRole("group", {
      name: words.defaults,
      exact: true,
    });
    const easy = quickDefault.getByRole("radio", {
      name: words.easy,
      exact: true,
    });
    const medium = quickDefault.getByRole("radio", {
      name: words.medium,
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
    const streamer = page.getByRole("button", {
      name: locale === "fr" ? "Mode streamer" : "Streamer mode",
      exact: true,
    });
    await streamer.hover();
    await expect(popup).toContainText(
      locale === "fr" ? "Masque le code" : "Hides the room code",
    );
    await expect(streamer).toHaveAttribute("aria-pressed", "false");
    await dismissHelp(page);
    await streamer.focus();
    await expect(popup).toBeVisible();
    await expect(streamer).toHaveAttribute(
      "aria-describedby",
      /disabled-action-hint/,
    );
    await streamer.press("Enter");
    await expect(popup).not.toBeVisible();
    await expect(streamer).toHaveAttribute("aria-pressed", "true");
    await expect(streamer).not.toHaveAttribute("aria-expanded");

    await page.getByLabel(words.player).fill(`Setting help ${locale}`);
    await page.getByRole("button", { name: words.play, exact: true }).click();
    await expect(page.locator(".lobby-seat.bot")).toHaveCount(3);
    await page.locator(".settings-trigger").click();
    const dialog = page.locator(".pause-dialog");
    await expect(
      dialog.locator('.setting-help, [data-icon="help"]'),
    ).toHaveCount(0);
    const labels = [
      words.cash,
      words.salary,
      words.festivals,
      words.duration,
      words.timer,
      ...words.toggles,
      words.easy,
      words.medium,
      words.hard,
    ];
    const settings = dialog.locator(".room-settings [data-help-title]");
    await expect(settings).toHaveCount(labels.length);
    for (const label of labels) {
      const wrapper = dialog.locator(`[data-help-title="${label}"]`);
      const input = wrapper.locator("input").first();
      await wrapper.scrollIntoViewIfNeeded();
      await input.focus();
      await expect(popup).toBeVisible();
      await expect(popup.locator("strong")).toHaveText(label);
      await expect(popup.locator("p")).toHaveText(/\S/);
      await expect(input).toHaveAttribute(
        "aria-describedby",
        /disabled-action-hint/,
      );
      await expect(input).not.toHaveAttribute("aria-expanded");
      await popup.hover();
      await expect(popup).toBeVisible();
      await dismissHelp(page, dialog);
    }
    for (const label of [words.cash, words.salary, words.festivals])
      await expect(
        dialog.getByRole("slider", { name: label, exact: true }),
      ).toBeEnabled();
    for (const label of [words.duration, words.timer, words.defaults])
      await expect(
        dialog.getByRole("group", { name: label, exact: true }),
      ).toBeVisible();
    for (const label of words.toggles)
      await expect(
        dialog.getByRole("checkbox", { name: label, exact: true }),
      ).toBeEnabled();

    const defaults = dialog.getByRole("group", {
      name: words.defaults,
      exact: true,
    });
    const hard = defaults.getByRole("radio", { name: words.hard, exact: true });
    await hard.check();
    await hard.locator("..").hover();
    await expect(popup).toContainText(words.hardCopy);
    await expect(hard).toBeChecked();
    await dismissHelp(page, dialog);
    const building = dialog.getByRole("checkbox", {
      name: words.toggles[6],
      exact: true,
    });
    await building.uncheck();
    await hard.locator("..").hover();
    await expect(popup).toContainText(words.noBuilding);
    await expect(building).not.toBeChecked();
    await dismissHelp(page, dialog);
    const gift = dialog.getByRole("checkbox", {
      name: words.toggles[7],
      exact: true,
    });
    const giftHelp = gift.locator("..");
    await giftHelp.hover();
    await expect(popup).toContainText(words.giftFull);
    await expect(gift).toBeChecked();
    await expect(
      defaults.getByRole("radio", { name: words.hard, exact: true }),
    ).toBeChecked();
    await dialog.getByRole("heading").first().click();
    await expect(popup).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await gift.uncheck();
    for (const viewport of DESKTOPS) {
      await page.setViewportSize(viewport);
      await giftHelp.scrollIntoViewIfNeeded();
      await gift.focus();
      await giftHelp.hover();
      await expect(popup).toBeVisible();
      await expect(popup).toContainText(words.giftCapped);
      await expect(gift).not.toBeChecked();
      await expectPopupBounds(popup, viewport.width, viewport.height);
      await page.screenshot({
        path: `.local/verification/settings-help-${locale}-${viewport.width}.png`,
      });
      await dismissHelp(page, dialog);
    }
  });
}
