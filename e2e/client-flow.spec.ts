import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("four-seat UI, settings, legal roll, inspection and refresh", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Jouer avec 3 bots" }),
  ).toBeVisible();
  await page.getByLabel("Votre nom de joueur").fill("Raimundo");
  await page.locator(".settings-disclosure summary").click();
  await expect(page.getByLabel("Capital de départ")).toHaveValue("2000000");
  await expect(page.getByLabel("Salaire au départ")).toHaveValue("400000");
  await expect(page.getByLabel("Durée de partie")).toHaveValue("120");
  await expect(page.getByLabel("Festivals initiaux")).toHaveValue("3");
  await expect(page.getByLabel("Victoire par ligne complète")).toBeChecked();
  await expect(page.getByLabel("Victoire par trois collections")).toBeChecked();
  await page.getByLabel("Lancers de dés").selectOption("secure");
  await page.getByRole("button", { name: "Jouer avec 3 bots" }).click();
  await expect(page.locator(".player-card")).toHaveCount(4);
  await expect(page.locator("canvas")).toBeVisible();
  const roll = page.getByRole("button", {
    name: "Lancer les dés",
    exact: true,
  });
  await expect(roll).toBeEnabled({ timeout: 60_000 });
  // UI regression fixture: a Birthday debtor can act during another seat's
  // turn. This only changes this tab's presentation, never Worker state.
  const original = await page.evaluate(async () => {
    const modulePath = "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const snapshot = director.getSnapshot().serverState;
    if (!snapshot) throw new Error("Expected a public snapshot");
    director.reset({
      ...snapshot,
      activeSeat: 1,
      pending: {
        kind: "sell",
        seat: 0,
        targets: [1],
        creditor: 1,
        deadline: Date.now() + 30_000,
      },
      players: snapshot.players.map(
        (player: { seat: number; properties: number[] }) => ({
          ...player,
          properties:
            player.seat === 0
              ? [...player.properties.filter((tile) => tile !== 1), 1]
              : player.properties.filter((tile) => tile !== 1),
        }),
      ),
      properties: snapshot.properties.map((property: { tile: number }) =>
        property.tile === 1 ? { ...property, owner: 0, level: 0 } : property,
      ),
    });
    return snapshot;
  });
  await expect(page.locator(".decision-panel")).toContainText(
    "Votre dette à régler",
  );
  await expect(
    page.locator(".decision-panel").getByRole("button", { name: /Vendre/ }),
  ).toBeEnabled();
  await page.evaluate(async (snapshot) => {
    const modulePath = "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.reset(snapshot);
  }, original);
  await roll.click();
  await expect(page.locator(".journal")).toContainText("Raimundo lance", {
    timeout: 20_000,
  });
  await page.getByLabel("Explorer une case").selectOption("31");
  await expect(page.locator(".inspector")).toContainText("Tokyo");
  await expect(page.locator(".property-numbers")).toContainText("400 k");
  await page.reload();
  await expect(page.locator(".player-card")).toHaveCount(4);
  await expect(page.locator(".match-location")).toContainText("En ligne");
  await expect(
    page.getByRole("button", { name: "Quitter", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Comment jouer" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.getByRole("button", { name: "C’est parti" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile room controls fit, create and join preserve the host settings", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Alice");
  await page.locator(".settings-disclosure summary").click();
  await page.getByLabel("Lancers de dés").selectOption("secure");
  await page.getByLabel("Durée de partie").selectOption("20");
  await page
    .getByRole("button", { name: "Créer une salle entre amis" })
    .click();
  await expect(page.locator(".lobby-seats")).toBeVisible();
  const code = await page.locator(".room-code-block strong").innerText();
  const friend = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  try {
    const second = await friend.newPage();
    await second.goto(`/?room=${code}`);
    await second.getByLabel("Votre nom de joueur").fill("Bo");
    await second
      .getByRole("button", { name: "Rejoindre", exact: false })
      .click();
    await expect(second.locator(".lobby-seats")).toContainText("Alice");
    await expect(page.locator(".lobby-seats")).toContainText("Bo");
    await second.locator(".settings-disclosure summary").click();
    await expect(second.getByLabel("Durée de partie")).toHaveValue("20");
    await expect(second.getByLabel("Durée de partie")).toBeDisabled();
    await page.locator(".settings-disclosure summary").click();
    await page.getByLabel("Capital de départ").fill("1250000");
    await page.getByLabel("Durée de partie").selectOption("60");
    await expect(
      page.getByRole("button", { name: "Démarrer la partie" }),
    ).toBeDisabled();
    // A new room presence must not overwrite the host's unsaved draft.
    await second.evaluate(async (roomCode) => {
      const response = await fetch(`/api/rooms/${roomCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Cam" }),
      });
      if (!response.ok) throw new Error("Expected a third seat");
    }, code);
    await expect(page.locator(".lobby-seats")).toContainText("Cam");
    await expect(page.getByLabel("Capital de départ")).toHaveValue("1250000");
    await expect(second.getByLabel("Durée de partie")).toHaveValue("20");
    await page
      .getByRole("button", { name: "Enregistrer les réglages" })
      .click();
    await expect(second.getByLabel("Durée de partie")).toHaveValue("60");
    await expect(
      page.getByRole("button", { name: "Démarrer la partie" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Démarrer la partie" }).click();
    await expect(page.locator(".player-card")).toHaveCount(4);
    await expect(second.locator(".player-card")).toHaveCount(4);
    await expect(page.locator(".decision-panel")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
    await page.screenshot({
      path: ".local/verification/mobile-client-test.png",
      fullPage: true,
    });
  } finally {
    await friend.close();
  }
});
