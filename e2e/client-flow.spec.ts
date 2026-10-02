import { expect, type Page, test } from "@playwright/test";
import type {
  GameEvent,
  PublicState,
  Seat,
} from "../src/shared/engine/index.js";
import { DESKTOP_SIZES } from "./desktop-sizes.js";

test.use({ reducedMotion: "reduce" });

async function minimizeOwnDecision(page: Page) {
  // Director completion and React's native dialog opening are separate steps.
  // Wait for the current decision to be represented before opening a board tool.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const modulePath =
            performance
              .getEntriesByType("resource")
              .find((entry) =>
                entry.name.includes("/src/client/director/director.ts"),
              )?.name ?? "/src/client/director/director.ts";
          const { director } = await import(modulePath);
          const snapshot = director.getSnapshot();
          if (snapshot.busy || !snapshot.viewState) return false;
          const pending = (snapshot.viewState as PublicState).pending;
          // A bot's quiet decision can be followed immediately by the human's
          // popup. Menus are checked during a stable human decision instead.
          if (pending?.seat !== 0) return false;
          if (pending.kind === "roll")
            return Boolean(
              document.querySelector(
                '.decision-compact[data-kind="roll"][data-own="true"][data-busy="false"]',
              ),
            );
          const key = `${pending.kind}:${pending.seat}:${pending.deadline}:${"tile" in pending ? pending.tile : ""}`;
          return (
            document
              .querySelector(".decision-popup[open]")
              ?.getAttribute("data-decision") === key
          );
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  if (await page.locator(".decision-popup[open]").count()) {
    await page.keyboard.press("Escape");
    await expect(page.locator(".decision-popup[open]")).toHaveCount(0);
  }
}

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
  await page.locator(".settings-trigger").click();
  await expect(
    page
      .locator(".settings-dialog")
      .getByRole("slider", { name: "Capital de départ", exact: true }),
  ).toHaveValue("2000000");
  await expect(
    page
      .locator(".settings-dialog")
      .getByRole("slider", { name: "Salaire au départ", exact: true }),
  ).toHaveValue("400000");
  await expect(
    page
      .getByRole("group", { name: "Durée de partie" })
      .getByRole("radio", { name: "120 min" }),
  ).toBeChecked();
  await expect(
    page
      .locator(".settings-dialog")
      .getByRole("slider", { name: "Festivals initiaux", exact: true }),
  ).toHaveValue("3");
  await expect(
    page
      .getByRole("group", { name: "Temps de décision" })
      .getByRole("radio", { name: "30 s", exact: true }),
  ).toBeChecked();
  // Give the screenshot-heavy regression enough time on software-rendered CI.
  await page
    .getByRole("group", { name: "Temps de décision" })
    .getByRole("radio", { name: "60 s", exact: true })
    .check();
  await expect(page.getByLabel("Victoire par ligne complète")).toBeChecked();
  await expect(page.getByLabel("Victoire par trois collections")).toBeChecked();
  await expect(page.getByLabel("Lancers de dés")).toHaveCount(0);
  await expect(
    page.locator(".settings-dialog .room-settings"),
  ).not.toContainText("drand");
  await expect(page.locator(".settings-dialog .room-settings")).toContainText(
    "Les deux dés sont tirés sur le serveur avec un générateur cryptographique.",
  );
  await page.getByRole("button", { name: "Appliquer les réglages" }).click();
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
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
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
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.reset(snapshot);
  }, original);
  // The board and the four corner HUDs fit the supported PC viewports.
  // Every secondary panel starts closed; a match needs no page scrolling.
  await expect(page.locator(".journal")).not.toBeVisible();
  await expect(page.locator(".inspector")).not.toBeVisible();
  for (const size of DESKTOP_SIZES) {
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
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const snapshot = director.getSnapshot().serverState as PublicState | null;
    if (!snapshot) throw new Error("Expected an active snapshot");
    const samples: Record<
      number,
      { owner: Seat; level: 0 | 1 | 2 | 3 | 4 | 5 }
    > = {
      3: { owner: 0, level: 1 },
      7: { owner: 1, level: 2 },
      11: { owner: 2, level: 3 },
      15: { owner: 3, level: 4 },
      19: { owner: 0, level: 5 },
      26: { owner: 1, level: 4 },
      29: { owner: 2, level: 5 },
      31: { owner: 3, level: 3 },
    };
    const properties = snapshot.properties.map((property) => ({
      ...property,
      owner: samples[property.tile]?.owner ?? null,
      level: samples[property.tile]?.level ?? 0,
    }));
    director.reset({
      ...snapshot,
      config: { ...snapshot.config, hotelPurchaseRule: "legacy-lap" },
      activeSeat: 0,
      pending: {
        kind: "buy",
        seat: 0,
        tile: 1,
        maxLevel: 4,
        deadline: Date.now() + 60_000,
      },
      properties,
      festivalTiles: [1, 17, 23],
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
  await expect(
    page.locator(".decision-actions .construction-choice"),
  ).toHaveCount(5);
  await expect(page.getByRole("button", { name: /^Acheter ·/ })).toBeEnabled();
  await expect(page.locator(".decision-panel")).toContainText("Roubaix");
  await expect(page.locator(".construction-choice")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: /^Terrain · 60 k/ }),
  ).toContainText("Loyer 24 k");
  const popupBounds = await page
    .locator(".decision-popup")
    .evaluate((popup) => {
      const rect = popup.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        center: rect.x + rect.width / 2,
      };
    });
  expect(popupBounds.x).toBeGreaterThan(0);
  expect(popupBounds.y).toBeGreaterThan(0);
  expect(popupBounds.right).toBeLessThan(1280);
  expect(popupBounds.bottom).toBeLessThan(720);
  expect(popupBounds.center).toBeCloseTo(640, 0);
  await page.getByRole("button", { name: /^3 maisons/ }).click();
  await expect(page.getByRole("button", { name: /^Acheter ·/ })).toContainText(
    "210 k",
  );
  await expect(page.locator(".ledger-balance")).toContainText("1,79 M");
  await expect(
    page.locator(".construction-choice[aria-pressed='true']"),
  ).toContainText("3 maisons");
  await page.keyboard.press("Escape");
  await expect(page.locator(".decision-popup")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reprendre le choix" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Reprendre le choix" }).click();
  await expect(page.locator(".decision-popup")).toBeVisible();
  await page.screenshot({
    path: ".local/verification/desktop-developed-fixture.png",
  });
  // Current staged construction: even after a lap, an unowned city stops at
  // three houses. A stale permissive decision must not hide the explanation.
  await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const snapshot = director.getSnapshot().serverState as PublicState | null;
    if (snapshot?.pending?.kind !== "buy")
      throw new Error("Expected the purchase fixture");
    director.reset({
      ...snapshot,
      config: { ...snapshot.config, hotelPurchaseRule: "staged-hotels" },
      pending: { ...snapshot.pending, maxLevel: 4 },
    });
  });
  // The hotel stays visible but locked; its rule is on hover, not in a note.
  await expect(page.locator(".construction-choice")).toHaveCount(5);
  const lockedHotel = page
    .locator(".decision-actions")
    .getByRole("button", { name: /^Hôtel/ });
  await expect(lockedHotel).toBeDisabled();
  await expect(lockedHotel).toHaveAttribute("data-locked", "true");
  await expect(lockedHotel).toHaveAttribute(
    "title",
    /3 maisons, un tour complet, puis revenir ici/,
  );
  await expect(
    page.locator(".construction-choice[data-locked='true']"),
  ).toHaveCount(1);
  await page.screenshot({
    path: ".local/verification/desktop-staged-purchase.png",
  });
  // The explicit custom rule can unlock Hotel immediately; no misleading lock
  // explanation remains. These are only presentation snapshots, never intents.
  await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const snapshot = director.getSnapshot().serverState as PublicState | null;
    if (snapshot?.pending?.kind !== "buy")
      throw new Error("Expected the purchase fixture");
    director.reset({
      ...snapshot,
      config: { ...snapshot.config, hotelsDirectly: true },
      pending: { ...snapshot.pending, tile: 31, maxLevel: 4 },
      properties: snapshot.properties.map((property) =>
        property.tile === 31
          ? { ...property, owner: null, level: 0 }
          : property,
      ),
      players: snapshot.players.map((player) => ({
        ...player,
        properties: player.properties.filter((tile) => tile !== 31),
      })),
    });
  });
  await expect(
    page.locator(".decision-actions").getByRole("button", { name: /^Hôtel/ }),
  ).toBeEnabled();
  await expect(
    page.locator(".construction-choice[data-locked='true']"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Hôtel · 1,5 M/ }),
  ).toContainText("Loyer 1,12 M");
  const constructionOverflow = await page
    .locator(".construction-choice")
    .evaluateAll((buttons) =>
      buttons.some((button) => button.scrollWidth > button.clientWidth),
    );
  expect(constructionOverflow).toBe(false);
  await page.screenshot({
    path: ".local/verification/desktop-custom-hotel-tokyo.png",
  });
  // A collection winner may not have the largest wealth. Preserve the server's
  // winner and its final standings rather than deriving a winner from wealth.
  const winnerName = await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const snapshot = director.getSnapshot().serverState as PublicState | null;
    if (!snapshot) throw new Error("Expected the current match");
    director.reset({
      ...snapshot,
      status: "finished",
      pending: null,
      result: {
        winner: 2,
        kind: "line-monopoly",
        standings: [
          { seat: 2, netWorth: 2_000_000 },
          { seat: 0, netWorth: 3_000_000 },
          { seat: 1, netWorth: 1_000_000 },
          { seat: 3, netWorth: 0 },
        ],
      },
    });
    return snapshot.players.find((player) => player.seat === 2)?.name;
  });
  await expect(page.locator("#winner-heading")).toContainText(winnerName ?? "");
  await expect(page.locator(".winner-wealth")).toContainText("2 M");
  await expect(page.locator(".standings li").first()).toContainText(
    winnerName ?? "",
  );
  await expect(page.locator(".standings li").nth(1)).toContainText("Raimundo");
  await expect(page.locator(".standings-label")).toContainText(
    "Classement final",
  );
  for (const size of DESKTOP_SIZES) {
    await page.setViewportSize(size);
    const resultBounds = await page
      .locator(".match-end-panel")
      .evaluate((panel) => {
        const rect = panel.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          overflow: panel.scrollHeight > panel.clientHeight,
        };
      });
    expect(resultBounds.top).toBeGreaterThanOrEqual(0);
    expect(resultBounds.bottom).toBeLessThanOrEqual(size.height);
    expect(resultBounds.left).toBeGreaterThanOrEqual(0);
    expect(resultBounds.right).toBeLessThanOrEqual(size.width);
    expect(resultBounds.overflow).toBe(false);
    await page.screenshot({
      path: `.local/verification/desktop-result-${size.width}.png`,
    });
  }
  await page.evaluate(async (snapshot) => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
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
  // Keep the speed setting regression; the separate controlled queue test
  // verifies Skip without racing the duration of a random real roll.
  await page.getByLabel("Vitesse des animations").selectOption("1");
  await expect(page.getByLabel("Vitesse des animations")).toHaveValue("1");
  await page.getByLabel("Vitesse des animations").press("Escape");
  await expect(
    page.getByRole("button", { name: "Vue et animations", exact: true }),
  ).toBeFocused();
  const previousTime = await page.locator(".match-clock").innerText();
  await expect
    .poll(() => page.locator(".match-clock").innerText())
    .not.toBe(previousTime);
  const previousDeadline = await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    return director.getSnapshot().serverState?.pending?.deadline as
      | number
      | undefined;
  });
  await roll.click();
  await expect
    .poll(
      async () =>
        page.evaluate(async (deadline) => {
          const modulePath =
            performance
              .getEntriesByType("resource")
              .find((entry) =>
                entry.name.includes("/src/client/director/director.ts"),
              )?.name ?? "/src/client/director/director.ts";
          const { director } = await import(modulePath);
          const snapshot = director.getSnapshot();
          const state = snapshot.viewState as PublicState | null;
          return (
            !snapshot.busy &&
            state?.pending != null &&
            state.pending.seat === 0 &&
            state.pending.deadline !== deadline &&
            snapshot.history.some(
              (event: GameEvent) =>
                event.type === "DiceRolled" && event.seat === 0,
            )
          );
        }, previousDeadline),
      { timeout: 30_000 },
    )
    .toBe(true);
  // Native decisions protect focus; minimize without sending a gameplay action.
  await minimizeOwnDecision(page);
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
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
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
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
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
  // A healthy connection is silent; only its state attribute shows it.
  await expect(page.locator(".match-connection")).toHaveAttribute(
    "data-state",
    "online",
  );
  await expect(page.locator(".match-connection")).toHaveText("");
  await expect(
    page.getByRole("button", { name: "Quitter la partie", exact: true }),
  ).toBeVisible();
  await minimizeOwnDecision(page);
  await page.getByRole("button", { name: "Comment jouer" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.getByRole("button", { name: "C’est parti" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("a real pointer click skips a controlled presentation queue synchronously", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Skip QA");
  await page.getByRole("button", { name: "Jouer avec 3 bots" }).click();
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  // Only this tab's presentation changes. Six normal movement events provide a
  // stable pointer window without changing the server or a real roll's timing.
  const original = await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const snapshot = director.getSnapshot().serverState as PublicState | null;
    if (!snapshot) throw new Error("Expected the current match snapshot");
    window.addEventListener(
      "click",
      (event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest(".match-caption button")
        )
          return;
        const current = director.getSnapshot();
        document.documentElement.dataset.skipSynced = String(
          !current.busy && current.viewState === current.serverState,
        );
      },
      { once: true },
    );
    const player = snapshot.players.find((candidate) => candidate.seat === 0);
    if (!player) throw new Error("Expected the human seat");
    director.setReducedMotion(false);
    director.setSpeed(1);
    director.receive(
      Array.from(
        { length: 6 },
        (_, index): GameEvent => ({
          type: "PlayerMoved",
          seat: 0,
          from: (player.position + index * 16) % 32,
          position: (player.position + (index + 1) * 16) % 32,
          steps: 16,
          laps: player.laps,
        }),
      ),
    );
    return snapshot;
  });
  const skip = page.getByRole("button", {
    name: "Passer l’animation ↗",
    exact: true,
  });
  await expect(skip).toBeEnabled();
  expect(
    await skip.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return hit !== null && button.contains(hit);
    }),
  ).toBe(true);
  await skip.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-skip-synced",
    "true",
  );
  await expect(page.locator(".match-caption button")).toBeDisabled();
  await page.evaluate(async (snapshot) => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.reset(snapshot);
    director.setReducedMotion(true);
  }, original);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
});

test("desktop room controls fit, create and join preserve the host settings", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Alice");
  await page.locator(".settings-trigger").click();
  // No intermediate blur or render wait: switching from a slider to the exact
  // field must preserve the entered amount, even while a draft sync is pending.
  const capital = page.locator(".settings-dialog").getByRole("slider", {
    name: "Capital de départ",
    exact: true,
  });
  await capital.focus();
  await capital.press("ArrowRight");
  await page
    .getByRole("spinbutton", { name: "Capital de départ : valeur exacte" })
    .fill("2000000");
  await expect(page.getByLabel("Lancers de dés")).toHaveCount(0);
  await expect(
    page.locator(".settings-dialog .room-settings"),
  ).not.toContainText("drand");
  await page
    .getByRole("group", { name: "Durée de partie" })
    .getByRole("radio", { name: "20 min", exact: true })
    .check();
  await page.getByRole("button", { name: "Appliquer les réglages" }).click();
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
    await second.locator(".settings-trigger").click();
    await expect(
      second.getByRole("slider", { name: "Capital de départ", exact: true }),
    ).toHaveValue("2000000");
    await expect(
      second
        .getByRole("group", { name: "Durée de partie" })
        .getByRole("radio", { name: "20 min", exact: true }),
    ).toBeChecked();
    await expect(
      second
        .getByRole("group", { name: "Durée de partie" })
        .getByRole("radio", { name: "20 min", exact: true }),
    ).toBeDisabled();
    await page.locator(".settings-trigger").click();
    await page
      .getByRole("spinbutton", { name: "Capital de départ : valeur exacte" })
      .fill("1250000");
    await page
      .getByRole("spinbutton", { name: "Capital de départ : valeur exacte" })
      .press("Tab");
    await page
      .getByRole("group", { name: "Durée de partie" })
      .getByRole("radio", { name: "60 min", exact: true })
      .check();
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
    await expect(
      page.getByRole("slider", { name: "Capital de départ", exact: true }),
    ).toHaveValue("1250000");
    await expect(
      second
        .getByRole("group", { name: "Durée de partie" })
        .getByRole("radio", { name: "20 min", exact: true }),
    ).toBeChecked();
    await page
      .getByRole("button", { name: "Enregistrer les réglages" })
      .click();
    await expect(
      second
        .getByRole("group", { name: "Durée de partie" })
        .getByRole("radio", { name: "60 min", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Démarrer la partie" }),
    ).toBeEnabled();
    await page
      .locator(".settings-dialog-footer")
      .getByRole("button", { name: "Fermer les réglages" })
      .click();
    await second.getByRole("button", { name: "Revenir au plateau" }).click();
    // The host seats a bot on the open card, then sends it away again.
    await expect(
      second.getByRole("button", { name: /Ajouter un bot/ }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Ajouter un bot à la place 4" })
      .click();
    await expect(page.locator(".lobby-seats")).toContainText("Atlas");
    await expect(second.locator(".lobby-seats")).toContainText("Atlas");
    await expect(
      second.getByRole("button", { name: "Retirer le bot Atlas" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Retirer le bot Atlas" }).click();
    await expect(
      page.getByRole("button", { name: "Ajouter un bot à la place 4" }),
    ).toBeVisible();
    await expect(second.locator(".lobby-seats")).not.toContainText("Atlas");
    await expect(page.locator(".lobby-count")).toContainText(
      "Partie à 3 joueurs",
    );
    await page.getByRole("button", { name: "Démarrer la partie" }).click();
    // Three players keep their lobby colours; the fourth corner stays empty.
    await expect(page.locator(".player-card")).toHaveCount(3);
    await expect(second.locator(".player-card")).toHaveCount(3);
    await expect(page.locator('.player-card[data-seat="3"]')).toHaveCount(0);
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

test("illustrated cards play in order and cancel safely on skip and reconnect", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Camille");
  await page.locator(".settings-trigger").click();
  await page
    .getByRole("group", { name: "Temps de décision" })
    .getByRole("radio", { name: "60 s", exact: true })
    .check();
  const capital = page.locator(".settings-dialog").getByRole("slider", {
    name: "Capital de départ",
    exact: true,
  });
  await capital.focus();
  await capital.press("ArrowRight");
  await expect(capital).toHaveValue("2010000");
  await capital.press("ArrowLeft");
  await expect(capital).toHaveValue("2000000");
  await page.screenshot({ path: ".local/verification/settings-sliders.png" });
  await page.getByRole("button", { name: "Appliquer les réglages" }).click();
  await page.getByRole("button", { name: "Jouer avec 3 bots" }).click();
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await page
    .getByRole("button", { name: "Lancer les dés", exact: true })
    .focus();
  // Authored presentation events only. This tab never sends these to the Worker.
  const original = await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const state = director.getSnapshot().serverState as PublicState | null;
    if (!state) throw new Error("Expected match snapshot");
    director.setReducedMotion(false);
    director.setSpeed(1);
    director.receive([
      { type: "CardDrawn", seat: 0, card: "Windfall", kept: false },
      {
        type: "MoneyTransferred",
        from: null,
        to: 0,
        amount: 150_000,
        reason: "Windfall",
      },
    ]);
    return state;
  });
  await expect(page.locator("#chance-title")).toHaveText("Bonne fortune");
  await expect(page.locator(".chance-impact")).toHaveText("+ 150 k");
  await expect(page.locator(".chance-art")).toHaveJSProperty(
    "naturalWidth",
    960,
  );
  // Effects await the card presentation; the exact server state already includes them.
  const balances = await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const { viewState, serverState } = director.getSnapshot();
    return [viewState.players[0].cash, serverState.players[0].cash];
  });
  expect(balances).toEqual([2_000_000, 2_150_000]);
  await page.screenshot({ path: ".local/verification/card-fortune.png" });
  await page.getByRole("button", { name: "Continuer", exact: false }).click();
  await expect(page.locator(".chance-dialog")).toHaveCount(0);
  await expect(
    page.locator('.player-card[data-seat="0"] .player-cash'),
  ).toContainText("2,15 M");
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeFocused();
  // A skip resolves the waiting presenter. Its old completion cannot hide a new card.
  await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.receive([
      { type: "CardDrawn", seat: 0, card: "Jet Set", kept: false },
    ]);
  });
  await expect(page.locator("#chance-title")).toHaveText("Jet-set");
  await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.skip();
    director.receive([
      { type: "CardDrawn", seat: 1, card: "Guardian Angel", kept: true },
    ]);
  });
  await expect(page.locator("#chance-title")).toHaveText("Ange gardien");
  await expect(page.locator(".chance-impact")).toHaveText("Gardez cette carte");
  await page.keyboard.press("Escape");
  await expect(page.locator(".chance-dialog")).toHaveCount(0);
  await page.evaluate(async (state) => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.receive([
      { type: "CardDrawn", seat: 0, card: "Contractor", kept: false },
    ]);
    director.reset(state);
    director.setReducedMotion(true);
    director.receive([
      { type: "CardDrawn", seat: 0, card: "Contractor", kept: false },
    ]);
  }, original);
  await expect(page.locator("#chance-title")).toHaveText("Coup de pouce");
  await expect(page.locator(".chance-art")).toHaveJSProperty(
    "naturalWidth",
    960,
  );
  await page.screenshot({ path: ".local/verification/card-construction.png" });
  // Reduced motion keeps the reading moment, with a stationary illustration.
  await expect(page.locator(".chance-reading")).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".player-card")).toHaveCount(4);
  await expect(page.locator(".chance-dialog")).toHaveCount(0);
  // A healthy connection is silent; only its state attribute shows it.
  await expect(page.locator(".match-connection")).toHaveAttribute(
    "data-state",
    "online",
  );
  await expect(page.locator(".match-connection")).toHaveText("");
  expect(errors).toEqual([]);
});

test("travel, rent protections and exchanges show the complete legal choice", async ({
  page,
}) => {
  let intents = 0;
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      if (String(frame.payload).includes('"type":"intent"')) intents += 1;
    }),
  );
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Alex");
  await page.locator(".settings-trigger").click();
  await page
    .getByRole("group", { name: "Temps de décision" })
    .getByRole("radio", { name: "60 s", exact: true })
    .check();
  await page.getByRole("button", { name: "Appliquer les réglages" }).click();
  await page.getByRole("button", { name: "Jouer avec 3 bots" }).click();
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  const original = await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const state = director.getSnapshot().serverState as PublicState | null;
    if (!state) throw new Error("Expected a match");
    director.reset({
      ...state,
      activeSeat: 0,
      pending: {
        kind: "travel",
        seat: 0,
        fee: 50_000,
        targets: [1, 31],
        deadline: Date.now() + 60_000,
      },
    });
    return state;
  });
  // Board choices stay non-modal: nothing travels until a space is picked,
  // on the board or through the keyboard list of the same legal spaces.
  const pick = page.locator(".decision-pick");
  await expect(pick).toContainText("Tour du monde");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(pick.locator(".decision-confirm")).toHaveCount(0);
  await expect(
    pick.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByLabel("Destination", { exact: true })
      .locator("option:not([disabled])"),
  ).toHaveCount(2);
  await page.getByLabel("Destination", { exact: true }).selectOption("31");
  await expect(pick.locator(".decision-confirm")).toContainText(
    "Voyager à Tokyo · 50 k",
  );
  await expect(pick.locator(".ledger-balance")).toContainText("1,95 M");
  await page.screenshot({
    path: ".local/verification/decision-travel-regression.png",
  });
  await page.evaluate(async (state) => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const properties = state.properties.map((property) => ({
      ...property,
      owner: property.tile === 9 ? 1 : property.tile === 11 ? 0 : null,
      level: property.tile === 9 ? 1 : property.tile === 11 ? 2 : 0,
    }));
    director.reset({
      ...state,
      activeSeat: 0,
      properties,
      players: state.players.map((player) => ({
        ...player,
        cash: player.seat === 0 ? 1_000 : player.cash,
        heldCards: player.seat === 0 ? ["Guardian Angel", "Coupon"] : [],
        properties: properties
          .filter((property) => property.owner === player.seat)
          .map((property) => property.tile),
      })),
      pending: {
        kind: "rent-card",
        seat: 0,
        tile: 9,
        owner: 1,
        amount: 101,
        cards: ["Guardian Angel", "Coupon"],
        deadline: Date.now() + 60_000,
      },
    });
  }, original);
  const payment = page.getByText("À payer", { exact: true }).locator("..");
  await expect(payment).toContainText("0");
  await expect(page.locator(".ledger-balance")).toContainText("1 k");
  await page
    .getByRole("button", { name: "Bon de réduction", exact: true })
    .click();
  await expect(payment).toContainText("51");
  await expect(page.locator(".ledger-balance")).toContainText("949");
  await expect(
    page.getByRole("button", { name: /Payer le loyer · 101/ }),
  ).toBeEnabled();
  await page.screenshot({
    path: ".local/verification/decision-coupon-regression.png",
  });
  await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const state = director.getSnapshot().serverState as PublicState;
    director.reset({
      ...state,
      pending: {
        kind: "card-target",
        card: "Land Swap",
        seat: 0,
        sourceTile: 11,
        targets: [9],
        deadline: Date.now() + 60_000,
      },
    });
  });
  await expect(page.locator("#decision-description")).toContainText("Lisbonne");
  await page.getByLabel("Ville ciblée", { exact: true }).selectOption("9");
  await expect(page.locator(".decision-confirm")).toContainText(
    "Échanger Lisbonne contre Faro",
  );
  await page.screenshot({
    path: ".local/verification/decision-exchange-regression.png",
  });
  await page.keyboard.press("Escape");
  expect(intents).toBe(0);
  await page.evaluate(async (state) => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    director.reset(state);
  }, original);
});
