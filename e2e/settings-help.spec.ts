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
  if (dialog) await expect(dialog).toBeVisible();
}

for (const locale of ["fr", "en"] as const) {
  test(`every room setting has separate accessible help in ${locale}`, async ({
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
    const helpName = (label: string) =>
      locale === "fr" ? `À propos de ${label}` : `About ${label}`;
    const popup = page.locator("#disabled-action-hint");
    await page.goto("/");
    await chooseLanguage(page, locale);
    const quick = page.locator(".welcome-quick-settings");
    await expect(quick.locator("button[data-help-title]")).toHaveCount(4);
    await expect(
      quick.locator(".room-setting-bot-description, .room-setting-bot-rules"),
    ).toHaveCount(0);
    await quick
      .getByRole("button", { name: helpName(words.cash), exact: true })
      .hover();
    await expect(popup.locator("strong")).toHaveText(words.cash);
    await dismissHelp(page);
    const quickDefault = quick.getByRole("group", {
      name: words.defaults,
      exact: true,
    });
    await quickDefault
      .getByRole("radio", { name: words.easy, exact: true })
      .check();
    const quickHelp = quickDefault.getByRole("button", {
      name: helpName(words.defaults),
      exact: true,
    });
    await quickHelp.focus();
    await expect(popup).toContainText(words.easyCopy);
    await quickHelp.press("Enter");
    await expect(popup).toBeVisible();
    await expect(quickHelp).toHaveAttribute("aria-expanded", "true");
    await quickHelp.press("Enter");
    await expect(popup).not.toBeVisible();
    await expect(quickHelp).toHaveAttribute("aria-expanded", "false");
    await quickHelp.press("Enter");
    await expect(
      quickDefault.getByRole("radio", { name: words.easy, exact: true }),
    ).toBeChecked();
    await dismissHelp(page);

    await page.getByLabel(words.player).fill(`Setting help ${locale}`);
    await page.getByRole("button", { name: words.play, exact: true }).click();
    await expect(page.locator(".lobby-seat.bot")).toHaveCount(3);
    await page.locator(".settings-trigger").click();
    const dialog = page.locator(".pause-dialog");
    const cashHelp = dialog.getByRole("button", {
      name: helpName(words.cash),
      exact: true,
    });
    await cashHelp.hover();
    await expect(popup).toBeVisible();
    await expect(popup.locator("strong")).toHaveText(words.cash);
    await popup.hover({ timeout: 5_000 });
    await expect(cashHelp).toHaveAttribute("aria-expanded", "true");
    await dismissHelp(page, dialog);
    await expect(cashHelp).toHaveAttribute("aria-expanded", "false");
    const labels = [
      words.cash,
      words.salary,
      words.festivals,
      words.duration,
      words.timer,
      words.defaults,
      ...words.toggles,
      words.easy,
      words.medium,
      words.hard,
    ];
    await expect(dialog.locator("button[data-help-title]")).toHaveCount(
      labels.length,
    );
    for (const label of labels) {
      const help = dialog.getByRole("button", {
        name: helpName(label),
        exact: true,
      });
      await expect(help).toBeEnabled();
      await help.scrollIntoViewIfNeeded();
      await help.focus();
      await expect(popup).toBeVisible();
      await expect(popup.locator("strong")).toHaveText(label);
      await expect(popup.locator("p")).toHaveText(/\S/);
      await expect(help).toHaveAttribute("aria-expanded", "true");
      await dismissHelp(page, dialog);
      await expect(help).toHaveAttribute("aria-expanded", "false");
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
    const defaultHelp = defaults.getByRole("button", {
      name: helpName(words.defaults),
      exact: true,
    });
    await defaults
      .getByRole("radio", { name: words.hard, exact: true })
      .check();
    await defaultHelp.click();
    await expect(popup).toContainText(words.hardCopy);
    await expect(
      defaults.getByRole("radio", { name: words.hard, exact: true }),
    ).toBeChecked();
    await dismissHelp(page, dialog);
    const building = dialog.getByRole("checkbox", {
      name: words.toggles[6],
      exact: true,
    });
    await building.uncheck();
    await defaultHelp.click();
    await expect(popup).toContainText(words.noBuilding);
    await expect(building).not.toBeChecked();
    await dismissHelp(page, dialog);
    const gift = dialog.getByRole("checkbox", {
      name: words.toggles[7],
      exact: true,
    });
    const giftHelp = dialog.getByRole("button", {
      name: helpName(words.toggles[7]),
      exact: true,
    });
    await giftHelp.click();
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
      await giftHelp.click();
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
