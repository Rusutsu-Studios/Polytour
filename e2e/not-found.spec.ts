import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`missing pages offer a keyboard-accessible way home at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() =>
      localStorage.setItem("polytour.locale", "en"),
    );
    const response = await page.goto(
      size.width === 1280 ? "/rooms/ABC234/" : "/a-wrong-turn",
    );
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", {
        name: "You've taken a wrong turn",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/404/);
    await expect(page.locator(".not-found-car")).toHaveCSS(
      "animation-name",
      "none",
    );
    const home = page.getByRole("link", { name: "Back home" });
    await home.focus();
    await expect(home).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight > innerHeight,
      ),
    ).toBe(false);
    await page.screenshot({ path: `.local/not-found-${size.width}.png` });
    await home.press("Enter");
    await expect(
      page.getByRole("heading", { name: "New game", exact: true }),
    ).toBeVisible();
  });
}
