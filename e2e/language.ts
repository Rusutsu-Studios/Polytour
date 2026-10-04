import { expect, type Page } from "@playwright/test";

export async function chooseLanguage(page: Page, language: "fr" | "en") {
  const button = page.locator(".language-trigger");
  await expect(button).toHaveText(/^(FR|EN)$/);
  if ((await button.innerText()) !== language.toUpperCase())
    await button.click();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}
