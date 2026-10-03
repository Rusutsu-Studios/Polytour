import type { Page } from "@playwright/test";

export async function chooseLanguage(page: Page, language: "fr" | "en") {
  await page
    .getByRole("button", { name: "Langue / Language", exact: true })
    .click();
  await page
    .locator(".language-menu")
    .getByRole("button", {
      name: language === "fr" ? "Français" : "English",
      exact: true,
    })
    .click();
}
