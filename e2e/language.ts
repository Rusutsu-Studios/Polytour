import { expect, type Page } from "@playwright/test";

export async function chooseLanguage(page: Page, language: "fr" | "en") {
  if ((await page.locator("html").getAttribute("lang")) === language) return;
  const isMatch = await page.locator(".player-card").count();
  if (isMatch) {
    await page
      .getByRole("button", { name: /^(Menu pause|Pause menu)$/ })
      .click();
    await page
      .locator(".pause-dialog")
      .getByRole("button", { name: /^(Réglages|Settings)$/ })
      .click();
  } else {
    await page.locator(".personal-settings-trigger").click();
  }
  await page
    .locator(".pause-dialog")
    .getByLabel(/^(Langue|Language)$/)
    .selectOption(language);
  await page.keyboard.press("Escape");
  if (isMatch) await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}
