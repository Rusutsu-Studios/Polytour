import { expect, test } from "@playwright/test";
import type { PublicState, Seat } from "../src/shared/engine/index.js";

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
  await expect(page.getByLabel("Temps de décision")).toHaveValue("30");
  // Give the screenshot-heavy regression enough time on software-rendered CI.
  await page.getByLabel("Temps de décision").selectOption("60");
  await expect(page.getByLabel("Victoire par ligne complète")).toBeChecked();
  await expect(page.getByLabel("Victoire par trois collections")).toBeChecked();
  await expect(page.getByLabel("Lancers de dés")).toHaveCount(0);
  await expect(page.locator(".settings-fields")).not.toContainText("drand");
  await expect(page.locator(".settings-fields")).toContainText(
    "aléa cryptographique généré directement sur Cloudflare",
  );
  await page.getByRole("button", { name: "Jouer avec 3 bots" }).click();
  await expect(page.locator(".player-card")).toHaveCount(4);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  const roll = page.getByRole("button", {
    name: "Lancer les dés",
    exact: true,
  });
  await expect(roll).toBeEnabled({ timeout: 60_000 });
  await page
    .getByRole("button", { name: "À propos des dés", exact: true })
    .click();
  await expect(page.locator(".proof-panel")).toContainText(
    "Chaque face a une chance sur six",
  );
  await expect(page.locator(".proof-panel")).not.toContainText("drand");
  await expect(
    page.getByRole("button", { name: "Télécharger la preuve" }),
  ).toHaveCount(0);
  await page.screenshot({ path: ".local/verification/server-dice-panel.png" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "À propos des dés", exact: true }),
  ).toBeFocused();
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
  // The board and the four corner HUDs fit the supported PC viewports.
  // Every secondary panel starts closed; a match needs no page scrolling.
  await expect(page.locator(".journal")).not.toBeVisible();
  await expect(page.locator(".inspector")).not.toBeVisible();
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator(".board-stage")).toHaveCSS(
      "height",
      `${size.height}px`,
    );
    const layout = await page.evaluate(() => {
      const bounds = [
        ...document.querySelectorAll(".player-card, .decision-panel"),
      ].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
        };
      });
      return {
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        height: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        bounds,
      };
    });
    expect(layout.scrollWidth).toBe(layout.width);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height);
    for (const rect of layout.bounds) {
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(size.width);
      expect(rect.bottom).toBeLessThanOrEqual(size.height);
    }
    await page.screenshot({
      path: `.local/verification/desktop-match-${size.width}.png`,
    });
  }
  // Synthetic presentation fixture: development levels and a five-choice buy
  // decision. The Worker remains untouched; restore its snapshot before rolling.
  const presentationBase = await page.evaluate(async () => {
    const modulePath = "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const snapshot = director.getSnapshot().serverState as PublicState | null;
    if (!snapshot) throw new Error("Expected an active snapshot");
    const samples: Record<
      number,
      { owner: Seat; level: 0 | 1 | 2 | 3 | 4 | 5 }
    > = {
      4: { owner: 0, level: 1 },
      7: { owner: 1, level: 2 },
      11: { owner: 2, level: 3 },
      15: { owner: 3, level: 4 },
      20: { owner: 0, level: 5 },
      25: { owner: 1, level: 4 },
      30: { owner: 2, level: 5 },
      31: { owner: 3, level: 3 },
    };
    const properties = snapshot.properties.map((property) => ({
      ...property,
      owner: samples[property.tile]?.owner ?? null,
      level: samples[property.tile]?.level ?? 0,
    }));
    director.reset({
      ...snapshot,
      activeSeat: 0,
      pending: {
        kind: "buy",
        seat: 0,
        tile: 1,
        maxLevel: 4,
        deadline: Date.now() + 60_000,
      },
      properties,
      players: snapshot.players.map((player) => ({
        ...player,
        cash: 2_000_000,
        laps: 1,
        position: [1, 12, 24, 31][player.seat],
        properties: properties
          .filter((property) => property.owner === player.seat)
          .map((property) => property.tile),
      })),
    });
    return snapshot;
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator(".decision-actions button")).toHaveCount(6);
  await expect(page.locator(".decision-panel")).toContainText("Roubaix");
  const overlap = await page.evaluate(() => {
    const action = document
      .querySelector(".decision-panel")
      ?.getBoundingClientRect();
    if (!action) throw new Error("Expected a purchase decision");
    return [...document.querySelectorAll(".player-card")].some((card) => {
      const rect = card.getBoundingClientRect();
      return (
        action.left < rect.right &&
        action.right > rect.left &&
        action.top < rect.bottom &&
        action.bottom > rect.top
      );
    });
  });
  expect(overlap).toBe(false);
  await page.screenshot({
    path: ".local/verification/desktop-developed-fixture.png",
  });
  await page.evaluate(async (snapshot) => {
    const modulePath = "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.reset(snapshot);
  }, presentationBase);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "Vue et animations", exact: true })
    .click();
  await expect(page.getByLabel("Réduire les animations")).toBeChecked();
  await page.getByLabel("Vitesse des animations").selectOption("2");
  await expect(page.getByLabel("Vitesse des animations")).toHaveValue("2");
  await page.getByLabel("Réduire les animations").uncheck();
  await expect(page.getByLabel("Réduire les animations")).not.toBeChecked();
  await page.getByLabel("Réduire les animations").check();
  await expect(
    page.getByRole("button", { name: "Terminer l’animation en cours" }),
  ).toBeDisabled();
  await page.getByLabel("Réduire les animations").uncheck();
  await page.getByLabel("Vitesse des animations").press("Escape");
  await expect(
    page.getByRole("button", { name: "Vue et animations", exact: true }),
  ).toBeFocused();
  const previousTime = await page.locator(".match-clock").innerText();
  await expect
    .poll(() => page.locator(".match-clock").innerText())
    .not.toBe(previousTime);
  await roll.click();
  await page
    .getByRole("button", { name: "Passer l’animation ↗", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Carnet de voyage", exact: true })
    .click();
  await expect(page.locator(".journal")).toContainText("Raimundo lance", {
    timeout: 20_000,
  });
  await page
    .getByRole("button", { name: "À propos des dés", exact: true })
    .click();
  await expect(page.locator(".proof-result")).toContainText("Dernier lancer :");
  await page
    .getByRole("button", { name: "Explorer le plateau", exact: true })
    .click();
  await page.getByLabel("Explorer une case").selectOption("31");
  await expect(page.locator("#inspector-title")).toHaveText("Tokyo");
  await expect(page.locator(".property-numbers")).toContainText("400 k");
  // An explicitly inspected city stays selected when another pawn moves.
  // Presentation-only snapshot, restored before the real reconnect below.
  const beforeMovement = await page.evaluate(async () => {
    const modulePath = "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const snapshot = (director.getSnapshot().viewState ??
      director.getSnapshot().serverState) as PublicState | null;
    if (!snapshot) throw new Error("Expected the current match snapshot");
    director.reset({
      ...snapshot,
      players: snapshot.players.map((player) => ({
        ...player,
        position:
          player.seat === snapshot.activeSeat
            ? player.position === 8
              ? 24
              : 8
            : player.position,
      })),
    });
    return snapshot;
  });
  await expect(page.getByLabel("Explorer une case")).toHaveValue("31");
  await expect(page.locator("#inspector-title")).toHaveText("Tokyo");
  await expect(page.locator(".property-numbers")).toContainText("400 k");
  await page.evaluate(async (snapshot) => {
    const modulePath = "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.reset(snapshot);
  }, beforeMovement);
  await page.getByLabel("Explorer une case").press("Escape");
  await expect(page.locator(".inspector")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Explorer le plateau", exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(page.locator(".player-card")).toHaveCount(4);
  await expect(page.locator(".match-connection")).toContainText("En ligne");
  await expect(
    page.getByRole("button", { name: "Quitter la partie", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Comment jouer" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.getByRole("button", { name: "C’est parti" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("desktop room controls fit, create and join preserve the host settings", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Alice");
  await page.locator(".settings-disclosure summary").click();
  await expect(page.getByLabel("Lancers de dés")).toHaveCount(0);
  await expect(page.locator(".settings-fields")).not.toContainText("drand");
  await page.getByLabel("Durée de partie").selectOption("20");
  await page
    .getByRole("button", { name: "Créer une salle entre amis" })
    .click();
  await expect(page.locator(".lobby-seats")).toBeVisible();
  const code = await page.locator(".room-code-block strong").innerText();
  const friend = await browser.newContext({
    viewport: { width: 1280, height: 720 },
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
    ).toBe(1280);
    await page.screenshot({
      path: ".local/verification/desktop-room-controls.png",
      fullPage: true,
    });
  } finally {
    await friend.close();
  }
});
