import { expect, type Locator, type Page, test } from "@playwright/test";
import type {
  GameEvent,
  PublicState,
  Seat,
} from "../src/shared/engine/index.js";
import { APP_VERSION } from "../src/shared/version.js";
import { clickBoardSpace } from "./board-interactions.js";
import { DESKTOP_SIZES } from "./desktop-sizes.js";
import { chooseLanguage } from "./language.js";

test.use({ reducedMotion: "reduce" });

async function expectDiceHelp(panel: Locator) {
  await expect(
    panel.getByRole("heading", { name: "Comment jouer", exact: true }),
  ).toBeVisible();
  const dice = panel.locator(".help-dice");
  await expect(dice).toBeVisible();
  await expect(dice).toContainText(
    "À chaque lancer, le serveur tire de nouveaux octets aléatoires avec l’API Web Crypto de Cloudflare. Les valeurs qui favoriseraient certaines faces sont écartées : chaque face a une chance sur six.",
  );
  await expect(panel).not.toContainText(
    /Aucun achat|bonus payant|équilibrage|loyers à ajuster/,
  );
  const documentation = dice.getByRole("link", {
    name: "Documentation Web Crypto de Cloudflare (nouvel onglet)",
    exact: true,
  });
  await expect(documentation).toBeVisible();
  await expect(documentation).toHaveAttribute(
    "href",
    "https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#methods",
  );
  await expect(documentation).toHaveAttribute("target", "_blank");
}

// Play opens a lobby with three bots; the room starts once its leader says so.
// The full settings live in that lobby; the home screen keeps quick sliders.
async function openLobby(page: Page) {
  await page.getByRole("button", { name: "Jouer", exact: true }).click();
  await expect(page.locator(".lobby-seats")).toContainText("Atlas");
}
async function playWithBots(page: Page) {
  await openLobby(page);
  await page.getByRole("button", { name: "Démarrer la partie" }).click();
}

// The Worker broadcasts room changes before acknowledging the command.
// Observing a changed lobby alone does not mean the sender can act again.
function observeRoomCommands(screen: Page) {
  const operations = new Map<string, string>();
  const replies = new Map<string, string[]>();
  screen.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      try {
        const message = JSON.parse(String(frame.payload)) as {
          type?: string;
          id?: string;
          op?: { type?: string };
        };
        if (message.type === "lobby" && message.id && message.op?.type)
          operations.set(message.id, message.op.type);
      } catch {
        // Diagnostic ping frames are plain text.
      }
    });
    socket.on("framereceived", (frame) => {
      try {
        const message = JSON.parse(String(frame.payload)) as {
          type?: string;
          id?: string;
        };
        const operation = message.id && operations.get(message.id);
        if (operation && (message.type === "ack" || message.type === "reject"))
          replies.set(operation, [
            ...(replies.get(operation) ?? []),
            message.type,
          ]);
      } catch {
        // Diagnostic pong frames are plain text.
      }
    });
  });
  return async (operation: string, perform: () => Promise<void>) => {
    const completed = replies.get(operation)?.length ?? 0;
    await perform();
    await expect.poll(() => replies.get(operation)?.[completed]).toBe("ack");
  };
}

/** Saves the leader's settings draft for the room, then closes the sheet. */
async function saveSettings(page: Page) {
  await page.getByRole("button", { name: "Enregistrer les réglages" }).click();
  await expect(page.locator(".room-settings-save")).toHaveText(
    "Réglages enregistrés",
  );
  await page
    .locator(".settings-dialog-footer")
    .getByRole("button", { name: "Fermer les réglages" })
    .click();
}

async function minimizeOwnDecision(page: Page, timeout = 30_000) {
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
      { timeout },
    )
    .toBe(true);
  if (await page.locator(".decision-popup[open]").count()) {
    await page.keyboard.press("Escape");
    await expect(page.locator(".decision-popup[open]")).toHaveCount(0);
  }
}

test.describe("low graphics", () => {
  test.use({ deviceScaleFactor: 1.5, reducedMotion: "no-preference" });

  test("persists, changes render cost in place and supports a real roll and reconnect", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    async function rendering(sampleIdle = false) {
      return page.evaluate(async (sample) => {
        const modulePath = performance
          .getEntriesByType("resource")
          .find((entry) => entry.name.includes("/@react-three_fiber.js"))?.name;
        if (!modulePath) throw new Error("Expected the loaded R3F module");
        const { _roots } = (await import(
          modulePath
        )) as typeof import("@react-three/fiber");
        const canvas = document.querySelector("canvas");
        const scene = canvas && _roots.get(canvas)?.store.getState();
        if (!scene) throw new Error("Expected the mounted board");
        const camera = scene.camera as import("three").OrthographicCamera;
        let shadowLights = 0;
        scene.scene.traverse((object) => {
          if (object.type === "DirectionalLight" && object.castShadow)
            shadowLights += 1;
        });
        let idleFrames = 0;
        if (sample) {
          const before = scene.gl.info.render.frame;
          // Sample actual draws without imposing an FPS target on CI hardware.
          await new Promise((resolve) => setTimeout(resolve, 300));
          idleFrames = scene.gl.info.render.frame - before;
        }
        return {
          dpr: scene.viewport.dpr,
          shadows: scene.gl.shadowMap.enabled,
          shadowLights,
          idleFrames,
          width: canvas.width,
          height: canvas.height,
          frustum: [camera.left, camera.right, camera.top, camera.bottom],
        };
      }, sampleIdle);
    }

    await page.goto("/");
    const highLabel = "Graphismes : Élevés. Passer aux graphismes faibles.";
    const lowLabel = "Graphismes : Faibles. Passer aux graphismes élevés.";
    const homeGraphics = page.locator(".topbar-right [data-graphics-quality]");
    await expect(homeGraphics).toHaveAttribute("data-graphics-quality", "high");
    await expect(homeGraphics).toHaveAccessibleName(highLabel);
    await expect(homeGraphics).toHaveText("Élevés");
    await homeGraphics.click();
    await page.reload();
    await expect(homeGraphics).toHaveAttribute("data-graphics-quality", "low");
    await expect(homeGraphics).toHaveAccessibleName(lowLabel);
    await chooseLanguage(page, "en");
    await expect(homeGraphics).toHaveAccessibleName(
      "Graphics: Low. Switch to High.",
    );
    await expect(homeGraphics).toHaveText("Low");
    await chooseLanguage(page, "fr");
    await page.getByLabel("Votre nom de joueur").fill("Graphics QA");
    await openLobby(page);
    await page.locator(".settings-trigger").click();
    await page
      .getByRole("group", { name: "Temps de décision" })
      .getByRole("radio", { name: "60 s", exact: true })
      .check();
    await saveSettings(page);
    await page.getByRole("button", { name: "Démarrer la partie" }).click();
    const scene = page.locator(".canvas-layer");
    await expect(scene).toHaveAttribute("data-scene-ready", "true");
    await expect(scene).toHaveAttribute("data-low-graphics", "true");
    const roll = page.getByRole("button", {
      name: "Lancer les dés",
      exact: true,
    });
    await expect(roll).toBeEnabled({ timeout: 60_000 });
    const low = await rendering();
    expect(low).toMatchObject({ dpr: 1, shadows: false, shadowLights: 0 });
    await expect.poll(() => rendering(true)).toMatchObject({ idleFrames: 0 });
    expect(low.frustum[1] - low.frustum[0]).toBeGreaterThan(10);
    expect(low.frustum[1] - low.frustum[0]).toBeLessThan(50);
    const original = await page.locator("canvas").evaluateHandle((element) => {
      const canvas = element as HTMLCanvasElement;
      return { canvas, context: canvas.getContext("webgl2") };
    });
    const toolbarGraphics = page.locator(
      "nav.game-tools [data-graphics-quality]",
    );
    await expect(toolbarGraphics).toHaveCount(0);
    await page.getByRole("button", { name: "Menu pause", exact: true }).click();
    await page
      .locator(".pause-dialog")
      .getByRole("button", { name: "Réglages", exact: true })
      .click();
    await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
    const graphics = page.getByRole("group", {
      name: "Graphismes",
      exact: true,
    });
    const highGraphics = graphics.getByRole("radio", {
      name: "Élevé",
      exact: true,
    });
    const lowGraphics = graphics.getByRole("radio", {
      name: "Faible",
      exact: true,
    });
    await expect(graphics.getByRole("radio")).toHaveCount(2);
    await expect(lowGraphics).toBeChecked();
    await expect(highGraphics).not.toBeChecked();
    const highBox = await highGraphics.locator("..").boundingBox();
    const lowBox = await lowGraphics.locator("..").boundingBox();
    expect(highBox).not.toBeNull();
    expect(lowBox).not.toBeNull();
    expect(highBox?.y).toBe(lowBox?.y);
    expect((highBox?.x ?? 0) + (highBox?.width ?? 0)).toBeLessThan(
      lowBox?.x ?? 0,
    );
    await lowGraphics.focus();
    await lowGraphics.press("ArrowLeft");
    await expect(highGraphics).toBeChecked();
    await expect(lowGraphics).not.toBeChecked();
    await expect.poll(rendering).toMatchObject({
      dpr: 1.5,
      shadows: true,
      shadowLights: 1,
      frustum: low.frustum,
    });
    const standard = await rendering();
    expect((await rendering(true)).idleFrames).toBeGreaterThan(0);
    expect(standard.width).toBe(Math.floor(low.width * 1.5));
    expect(standard.height).toBe(Math.floor(low.height * 1.5));
    expect(standard.frustum).toEqual(low.frustum);
    await highGraphics.press("ArrowRight");
    await expect(lowGraphics).toBeChecked();
    await expect(highGraphics).not.toBeChecked();
    await expect(toolbarGraphics).toHaveCount(0);
    await expect.poll(rendering).toEqual(low);
    await expect.poll(() => rendering(true)).toMatchObject({ idleFrames: 0 });
    expect(
      await page.evaluate((previous) => {
        const canvas = document.querySelector("canvas");
        return (
          canvas === previous.canvas &&
          canvas?.getContext("webgl2") === previous.context
        );
      }, original),
    ).toBe(true);
    await original.dispose();
    await lowGraphics.press("Escape");
    await expect(
      page
        .locator(".pause-dialog")
        .getByRole("button", { name: "Réglages", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pause-dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Menu pause", exact: true }),
    ).toBeFocused();
    await roll.click();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const modulePath = performance
              .getEntriesByType("resource")
              .find((entry) =>
                entry.name.includes("/src/client/director/director.ts"),
              )?.name;
            if (!modulePath) throw new Error("Expected the loaded Director");
            const { director } = await import(modulePath);
            const snapshot = director.getSnapshot();
            return (
              !snapshot.busy &&
              snapshot.history.some(
                (event: GameEvent) =>
                  event.type === "DiceRolled" && event.seat === 0,
              )
            );
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.reload();
    await expect(scene).toHaveAttribute("data-scene-ready", "true");
    await expect(scene).toHaveAttribute("data-low-graphics", "true");
    await expect(toolbarGraphics).toHaveCount(0);
    await expect(page.locator(".match-connection")).toHaveAttribute(
      "data-state",
      "online",
    );
    await expect.poll(rendering).toMatchObject({
      dpr: 1,
      shadows: false,
      shadowLights: 0,
    });
    expect(errors).toEqual([]);
  });
});

test("room lobby board fills its preview across desktop sizes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Lobby preview");
  await openLobby(page);
  const preview = page.locator(".room-preview");
  const scene = preview.locator(".canvas-layer");
  await expect(scene).toHaveAttribute("data-scene-ready", "true");
  for (const size of DESKTOP_SIZES) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const container = await preview.boundingBox();
        const canvas = await scene.locator("canvas").boundingBox();
        return Math.abs((canvas?.height ?? 0) - (container?.height ?? 0));
      })
      .toBeLessThan(2);
    const canvas = await scene.locator("canvas").boundingBox();
    expect(canvas?.height).toBeGreaterThan(500);
    expect((canvas?.x ?? 0) + (canvas?.width ?? 0)).toBeLessThanOrEqual(
      size.width,
    );
    await page.screenshot({
      path: `.local/verification/lobby-board-${size.width}.png`,
      fullPage: true,
    });
  }
  await page.locator(".settings-trigger").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".settings-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-trigger")).toBeFocused();
});

test("win conditions follow the settings draft and saved rules in both languages", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await chooseLanguage(page, "en");
  await page.getByLabel("Player name").fill("Rules check");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".lobby-seats")).toContainText("Atlas");
  await page.locator(".settings-trigger").click();
  const dialog = page.locator(".settings-dialog");
  const wins = dialog.getByRole("region", {
    name: "How to win with these settings",
  });
  await expect(wins.getByRole("listitem")).toHaveCount(6);
  await expect(wins).toContainText("Own all four resorts.");
  await expect(wins).toContainText("Zero cash alone is not bankruptcy");
  await expect(wins).toContainText("10000-round limit");
  await dialog.getByLabel("Win with a full side", { exact: true }).uncheck();
  await expect(wins).not.toContainText("one side of the board");
  await expect(wins).toContainText("three complete country sets");
  await dialog
    .getByLabel("Win with three complete sets", { exact: true })
    .uncheck();
  await expect(wins.getByRole("listitem")).toHaveCount(4);
  await dialog.getByRole("radio", { name: "20 min", exact: true }).check();
  await expect(wins).toContainText("after 20 min");
  await expect(wins).not.toContainText("120 min");
  const gifts = dialog.getByLabel("Gifts can cause bankruptcy", {
    exact: true,
  });
  await expect(gifts).toHaveAccessibleDescription(
    /Birthday and Charity cards.*full payment/,
  );
  await gifts.uncheck();
  await expect(gifts).toHaveAccessibleDescription(/capped at available cash/);
  await gifts.check();
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await wins.scrollIntoViewIfNeeded();
    const layout = await dialog.evaluate((element) => {
      const body = element.querySelector(
        ".settings-dialog-body",
      ) as HTMLElement;
      const summary = element.querySelector(
        ".room-settings-wins",
      ) as HTMLElement;
      const save = element.querySelector(".room-settings-save") as HTMLElement;
      const rect = element.getBoundingClientRect();
      const footer = element.querySelector(
        ".settings-dialog-footer",
      ) as HTMLElement;
      return {
        top: rect.top,
        bottom: rect.bottom,
        footerBottom: footer.getBoundingClientRect().bottom,
        overflow: body.scrollWidth > body.clientWidth,
        ordered:
          summary.getBoundingClientRect().bottom <=
          save.getBoundingClientRect().top,
      };
    });
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom).toBeLessThanOrEqual(size.height);
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.bottom);
    expect(layout.overflow).toBe(false);
    expect(layout.ordered).toBe(true);
    await page.screenshot({
      path: `.local/verification/win-settings-en-${size.width}.png`,
    });
  }
  await dialog
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(dialog.locator(".room-settings-save")).toHaveText(
    "Settings saved",
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".lobby-seats")).toBeVisible();
  await chooseLanguage(page, "fr");
  await page.locator(".settings-trigger").click();
  const frenchWins = dialog.getByRole("region", {
    name: "Comment gagner avec ces réglages",
  });
  await expect(frenchWins.getByRole("listitem")).toHaveCount(4);
  await expect(frenchWins).toContainText("après 20 min");
  await expect(frenchWins).toContainText("quatre stations touristiques");
  await dialog
    .getByLabel("Victoire par ligne complète", { exact: true })
    .check();
  await dialog
    .getByLabel("Victoire par trois collections", { exact: true })
    .check();
  await expect(frenchWins.getByRole("listitem")).toHaveCount(6);
  await expect(frenchWins).toContainText("trois collections de pays complètes");
  await page.setViewportSize({ width: 1280, height: 720 });
  await frenchWins.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".local/verification/win-settings-fr-1280.png",
  });
  await saveSettings(page);
  await page.getByRole("button", { name: "Démarrer la partie" }).click();
  await expect(page.locator(".player-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Lancer les dés", exact: true })
    .waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: "Réglages de la partie", exact: true })
    .click();
  const matchRules = page.locator(".match-rules");
  await expect(
    matchRules
      .getByRole("region", { name: "Comment gagner avec ces réglages" })
      .getByRole("listitem"),
  ).toHaveCount(6);
  await expect(
    matchRules.getByLabel("Victoire par ligne complète", { exact: true }),
  ).toBeDisabled();
});

test("four-seat UI, settings, legal roll, inspection and refresh", async ({
  page,
}) => {
  // Real bot rounds and the five desktop viewport checks share this budget.
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Jouer", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Comment jouer", exact: true })
    .click();
  await expectDiceHelp(page.locator(".help-dialog"));
  await expect(page.locator(".dice-explanation-link")).toHaveCount(1);
  await page.getByRole("button", { name: "C’est parti" }).click();
  await page.getByLabel("Votre nom de joueur").fill("Raimundo");
  await openLobby(page);
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
  await expect(
    page.locator(".settings-dialog .room-settings-fairness"),
  ).toHaveCount(0);
  await expect(
    page.locator(".settings-dialog .room-settings"),
  ).not.toContainText("Web Crypto");
  await saveSettings(page);
  await page.getByRole("button", { name: "Démarrer la partie" }).click();
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
  await expect(page.locator(".proof-panel")).not.toContainText("Web Crypto");
  await expect(
    page.locator('.proof-panel a[href*="developers.cloudflare.com"]'),
  ).toHaveCount(0);
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
  await expect(page.locator(".decision-sale")).toContainText("Dette");
  await expect(page.locator(".sale-confirm")).toBeDisabled();
  await page.locator('.sale-tile-quote[data-tile="1"]').click();
  await expect(page.locator(".sale-confirm")).toBeEnabled();
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
      // Landmarks exist only in saved prototype rooms (rules versions 2–3).
      config: {
        ...snapshot.config,
        hotelPurchaseRule: "legacy-lap",
        economyRule: "prototype",
      },
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
    "data-disabled-reason",
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
  await page.getByRole("button", { name: "Menu pause", exact: true }).click();
  await page.getByRole("button", { name: "Réglages", exact: true }).click();
  await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
  await expect(page.getByLabel("Réduire les animations")).toBeChecked();
  await page.getByLabel("Réduire les animations").uncheck();
  await expect(page.getByLabel("Réduire les animations")).not.toBeChecked();
  await page.getByLabel("Réduire les animations").check();
  await expect(page.getByLabel("Vitesse des animations")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Menu pause", exact: true }),
  ).toBeFocused();
  const previousTime = await page.locator(".match-clock").innerText();
  await expect
    .poll(() => page.locator(".match-clock").innerText())
    .not.toBe(previousTime);
  const previousOwnRolls = await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    return director
      .getSnapshot()
      .history.filter(
        (event: GameEvent) => event.type === "DiceRolled" && event.seat === 0,
      ).length;
  });
  await roll.click();
  await expect
    .poll(
      async () =>
        page.evaluate(async (ownRolls) => {
          const modulePath =
            performance
              .getEntriesByType("resource")
              .find((entry) =>
                entry.name.includes("/src/client/director/director.ts"),
              )?.name ?? "/src/client/director/director.ts";
          const { director } = await import(modulePath);
          const snapshot = director.getSnapshot();
          return (
            !snapshot.busy &&
            snapshot.history.filter(
              (event: GameEvent) =>
                event.type === "DiceRolled" && event.seat === 0,
            ).length > ownRolls
          );
        }, previousOwnRolls),
      // Keep main's server-paced roll allowance; the next own decision is
      // checked separately below when this roll hands the turn to the bots.
      { timeout: 60_000 },
    )
    .toBe(true);
  // A legal roll may hand the turn to the bots. Let their server-paced turns
  // finish before checking tools during the next stable human decision.
  await minimizeOwnDecision(page, 120_000);
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
  await expect(
    page.getByRole("button", { name: "Explorer le plateau", exact: true }),
  ).toHaveCount(0);
  const pauseTrigger = page.getByRole("button", {
    name: "Menu pause",
    exact: true,
  });
  await pauseTrigger.focus();
  await clickBoardSpace(page, 31);
  await expect(page.locator(".city-card")).toHaveAttribute("data-space", "31");
  await expect(page.locator("#city-card-title")).toHaveText("Tokyo");
  await expect(
    page.getByRole("button", { name: /Case précédente|Case suivante/ }),
  ).toHaveCount(0);
  // The deed lists every building level with its cost and its rent.
  const deedRows = page.locator(".city-card-table tbody tr");
  await expect(deedRows).toHaveCount(5);
  await expect(deedRows.first()).toContainText("400 k");
  await expect(deedRows.nth(4)).toContainText("+500 k");
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
  await expect(page.locator(".city-card")).toHaveAttribute("data-space", "31");
  await expect(page.locator("#city-card-title")).toHaveText("Tokyo");
  await expect(deedRows.first()).toContainText("400 k");
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
  await page
    .getByRole("button", { name: "Fermer l’inspection", exact: true })
    .press("Escape");
  await expect(page.locator(".city-card")).not.toBeVisible();
  await expect(pauseTrigger).toBeFocused();
  await page.reload();
  await expect(page.locator(".player-card")).toHaveCount(4);
  // A healthy connection is silent; only its state attribute shows it.
  await expect(page.locator(".match-connection")).toHaveAttribute(
    "data-state",
    "online",
  );
  await expect(page.locator(".match-connection")).toHaveText("");
  await expect(
    page.getByRole("button", { name: "Menu pause", exact: true }),
  ).toBeVisible();
  await minimizeOwnDecision(page, 120_000);
  await page.getByRole("button", { name: "Comment jouer" }).click();
  await expectDiceHelp(page.locator(".help-dialog"));
  await expect(page.locator(".dice-explanation-link")).toHaveCount(1);
  await page.getByRole("button", { name: "C’est parti" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("returning to a visible tab synchronously recovers an unfinished presentation queue", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Recovery QA");
  await playWithBots(page);
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  // Only this tab's presentation changes. Six normal movement events leave a
  // queue to recover without changing the server or a real roll's timing.
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
    const player = snapshot.players.find((candidate) => candidate.seat === 0);
    if (!player) throw new Error("Expected the human seat");
    director.setReducedMotion(false);
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
  const recovered = await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const before = director.getSnapshot();
    const queued = before.busy && before.viewState !== before.serverState;
    document.dispatchEvent(new Event("visibilitychange"));
    const after = director.getSnapshot();
    return {
      queued,
      synced: !after.busy && after.viewState === after.serverState,
    };
  });
  expect(recovered).toEqual({ queued: true, synced: true });
  await expect(page.locator(".match-caption button")).toHaveCount(0);
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
  const hostCommand = observeRoomCommands(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Alice");
  await openLobby(page);
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
  await hostCommand("settings", () => saveSettings(page));
  await expect(page.locator(".lobby-seats")).toBeVisible();
  const code = await page.locator(".room-code-block strong").innerText();
  const friend = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  const newcomer = await browser.newContext({
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
    const third = await newcomer.newPage();
    await third.goto(`/?room=${code}`);
    await third.getByLabel("Votre nom de joueur").fill("Cam");
    await third
      .getByRole("button", { name: "Rejoindre", exact: false })
      .click();
    await expect(third.locator(".lobby-seats")).toContainText("Alice");
    await expect(page.locator(".lobby-seats")).toContainText("Cam");
    await expect(
      page.getByRole("slider", { name: "Capital de départ", exact: true }),
    ).toHaveValue("1250000");
    await expect(
      second
        .getByRole("group", { name: "Durée de partie" })
        .getByRole("radio", { name: "20 min", exact: true }),
    ).toBeChecked();
    await hostCommand("settings", () =>
      page.getByRole("button", { name: "Enregistrer les réglages" }).click(),
    );
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
    // Friends took the first two bots' places. Only the leader sends the last
    // bot away or seats one again on the open card.
    await expect(second.locator(".lobby-seats")).toContainText("Atlas");
    await expect(
      second.getByRole("button", { name: "Retirer le bot Atlas" }),
    ).toHaveCount(0);
    await hostCommand("remove-bot", () =>
      page.getByRole("button", { name: "Retirer le bot Atlas" }).click(),
    );
    await expect(second.locator(".lobby-seats")).not.toContainText("Atlas");
    await expect(
      second.getByRole("button", { name: /Ajouter un bot/ }),
    ).toHaveCount(0);
    await hostCommand("add-bot", () =>
      page.getByRole("button", { name: "Ajouter un bot à la place 4" }).click(),
    );
    await expect(page.locator(".lobby-seats")).toContainText("Atlas");
    await expect(second.locator(".lobby-seats")).toContainText("Atlas");
    await hostCommand("remove-bot", () =>
      page.getByRole("button", { name: "Retirer le bot Atlas" }).click(),
    );
    await expect(
      page.getByRole("button", { name: "Ajouter un bot à la place 4" }),
    ).toBeVisible();
    await expect(second.locator(".lobby-seats")).not.toContainText("Atlas");
    await expect(page.locator(".lobby-count")).toContainText(
      "Partie à 3 joueurs",
    );
    await hostCommand("start", () =>
      page.getByRole("button", { name: "Démarrer la partie" }).click(),
    );
    // Three players keep their lobby colours; the fourth corner stays empty.
    await expect(page.locator(".player-card")).toHaveCount(3);
    await expect(second.locator(".player-card")).toHaveCount(3);
    await expect(third.locator(".player-card")).toHaveCount(3);
    await expect(page.locator('.player-card[data-seat="3"]')).toHaveCount(0);
    // The first player is randomized; only that player's tab owns the choice.
    const activeSeat = Number(
      await page.locator(".player-card.active").getAttribute("data-seat"),
    );
    expect([0, 1, 2]).toContain(activeSeat);
    const players = [page, second, third];
    const names = ["Alice", "Bo", "Cam"];
    for (const [seat, participant] of players.entries()) {
      await expect(participant.locator(".player-card.active")).toHaveAttribute(
        "data-seat",
        String(activeSeat),
      );
      const roll = participant.getByRole("button", {
        name: "Lancer les dés",
        exact: true,
      });
      if (seat === activeSeat) {
        await expect(
          participant.locator('.decision-panel[data-own="true"]'),
        ).toBeVisible();
        await expect(roll).toBeEnabled();
      } else {
        await expect(
          participant.locator('.contextual-action [role="status"]'),
        ).toHaveText(`${names[activeSeat]} joue`);
        await expect(roll).toHaveCount(0);
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(1280);
    await page.screenshot({
      path: ".local/verification/desktop-room-controls.png",
      fullPage: true,
    });
  } finally {
    await friend.close();
    await newcomer.close();
  }
});

test("illustrated cards play in order and cancel safely on recovery and reconnect", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Camille");
  await openLobby(page);
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
  await saveSettings(page);
  await page.getByRole("button", { name: "Démarrer la partie" }).click();
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
  // Keep the bounded reading timer from expiring during assertions and screenshots.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 2000));
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
  await page.clock.runFor(750);
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
  // Bots may transfer cash before the human's first turn (for example Birthday).
  // This presentation check measures Windfall against the captured live balance.
  const cashBeforeCard = original.players[0].cash;
  const cashAfterCard = cashBeforeCard + 150_000;
  expect(balances).toEqual([cashBeforeCard, cashAfterCard]);
  await page.screenshot({ path: ".local/verification/card-fortune.png" });
  await page.getByRole("button", { name: "Continuer", exact: false }).click();
  await page.clock.runFor(1500);
  await expect(page.locator(".chance-dialog")).toHaveCount(0);
  await expect(
    page.locator('.player-card[data-seat="0"] .player-cash'),
  ).toContainText(
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(
      cashAfterCard,
    ),
  );
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeFocused();
  // Visibility recovery resolves the presenter. Its old completion cannot hide a new card.
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
  await page.clock.runFor(750);
  await expect(page.locator("#chance-title")).toHaveText("Jet-set");
  await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    document.dispatchEvent(new Event("visibilitychange"));
    director.receive([
      { type: "CardDrawn", seat: 1, card: "Guardian Angel", kept: true },
    ]);
  });
  await page.clock.runFor(750);
  // Cross the skipped card's old deadline while the new card is still reading.
  await page.clock.runFor(2000);
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
  await page.clock.resume();
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
  await openLobby(page);
  await page.locator(".settings-trigger").click();
  await page
    .getByRole("group", { name: "Temps de décision" })
    .getByRole("radio", { name: "60 s", exact: true })
    .check();
  await saveSettings(page);
  await page.getByRole("button", { name: "Démarrer la partie" }).click();
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
    const snapshot = director.getSnapshot().serverState as PublicState | null;
    if (!snapshot) throw new Error("Expected a match");
    // Authored legacy snapshots exercise retained prices and travel fees.
    // Selection never sends these presentation fixtures to the server.
    const state = {
      ...snapshot,
      config: {
        ...snapshot.config,
        boardRule: "legacy" as const,
        economyRule: "prototype" as const,
      },
    };
    director.reset({
      ...state,
      activeSeat: 0,
      // The traveller waits on World Tour, so space 1 lies past Start.
      players: state.players.map((player) =>
        player.seat === 0
          ? { ...player, position: 24, travelPending: true }
          : player,
      ),
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
  await expect(pick).toContainText("Choisissez votre destination");
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
  await expect(pick.locator(".ledger-balance")).not.toContainText("départ");
  await page.screenshot({
    path: ".local/verification/decision-travel-regression.png",
  });
  // A flight to a space behind World Tour goes on round and collects salary.
  await page.getByLabel("Destination", { exact: true }).selectOption("1");
  await expect(pick.locator(".ledger-balance")).toContainText("2,35 M");
  await expect(pick.locator(".ledger-balance")).toContainText(
    "+400 k au départ",
  );
  // A reference room charges to move the championship and lets a player pass.
  await page.evaluate(async (state) => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const owned = [1, 31];
    const properties = state.properties.map((property) => ({
      ...property,
      owner: owned.includes(property.tile) ? (0 as const) : null,
      level: property.tile === 31 ? (3 as const) : (0 as const),
    }));
    director.reset({
      ...state,
      config: { ...state.config, economyRule: "reference" },
      activeSeat: 0,
      properties,
      championshipHost: { tile: 31, multiplier: 3 },
      festivalTiles: [],
      players: state.players.map((player) => ({
        ...player,
        cash: player.seat === 0 ? 1_000_000 : player.cash,
        properties: player.seat === 0 ? owned : [],
      })),
      pending: {
        kind: "host",
        seat: 0,
        targets: owned,
        deadline: Date.now() + 60_000,
      },
    });
  }, original);
  await expect(page.locator(".decision-pick")).toContainText("Championnat");
  await expect(
    page.getByRole("button", { name: "Passer", exact: true }),
  ).toBeEnabled();
  const hostCity = page.getByLabel("Ville hôte", { exact: true });
  await expect(hostCity.locator("option:not([disabled])")).toHaveText([
    "Roubaix · ×4 · 50 k",
    "Tokyo · ×4",
  ]);
  await hostCity.selectOption("31");
  await expect(page.locator(".decision-confirm")).toContainText(
    "Renouveler le championnat",
  );
  // Tokyo with three houses: 600 k, with a ×4 championship.
  await expect(page.locator(".decision-ledger")).toContainText("2,4 M");
  await hostCity.selectOption("1");
  await expect(page.locator(".decision-confirm")).toContainText(
    "Organiser le championnat · 50 k",
  );
  await expect(page.locator(".ledger-balance")).toContainText("950 k");
  await page.screenshot({
    path: ".local/verification/decision-championship.png",
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
  await expect(page.locator("#decision-description")).toContainText("Rome");
  await page.getByLabel("Ville ciblée", { exact: true }).selectOption("9");
  await expect(page.locator(".decision-confirm")).toContainText(
    "Échanger Rome contre Porto",
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

test("the room leader seats a local player, admits a friend, hands over during play and brings everyone back", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const hostCommand = observeRoomCommands(page);
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Alice");
  await page.getByRole("button", { name: "Jouer", exact: true }).click();
  const seats = page.locator(".lobby-seats");
  await expect(seats).toContainText("Milo");
  await expect(seats.locator(".host-label")).toHaveCount(1);
  // Someone next to Alice takes Milo's place on this screen.
  await hostCommand("remove-bot", () =>
    page.getByRole("button", { name: "Retirer le bot Milo" }).click(),
  );
  await page
    .getByRole("button", {
      name: "Ajouter un joueur sur ce PC à la place 2",
    })
    .click();
  await page.getByLabel("Joueur sur ce PC").fill("Bea");
  await hostCommand("add-local", () =>
    page.getByRole("button", { name: "Ajouter", exact: true }).click(),
  );
  const local = page.locator(".lobby-seat[data-local]");
  await expect(local).toContainText("Bea");
  await expect(local).toContainText("Sur votre PC");
  await hostCommand("lock", () =>
    page.getByLabel(/Verrouiller la salle/).check(),
  );
  await expect(page.getByLabel(/Verrouiller la salle/)).toBeChecked();
  const code = await page.locator(".room-code-block strong").innerText();
  const friendContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  try {
    const friend = await friendContext.newPage();
    const friendCommand = observeRoomCommands(friend);
    await friend.goto(`/?room=${code}`);
    await friend.getByLabel("Votre nom de joueur").fill("Cora");
    await friend
      .getByRole("button", { name: "Rejoindre", exact: false })
      .click();
    // A locked room keeps the newcomer waiting until the leader decides.
    await expect(friend.locator(".waiting-notice")).toContainText(
      "Alice doit accepter votre entrée.",
    );
    await expect(friend.locator(".lobby-seats")).toContainText("Bea");
    await hostCommand("admit", () =>
      page.getByRole("button", { name: "Accepter Cora" }).click(),
    );
    await expect(friend.locator(".waiting-host")).toContainText(
      "En attente du démarrage par Alice.",
    );
    await expect(seats).toContainText("Cora");
    await expect(seats).not.toContainText("Nova");
    // The role goes to Cora, then back to Alice.
    await hostCommand("transfer-host", () =>
      page.getByRole("button", { name: "Nommer Cora chef de salle" }).click(),
    );
    await expect(
      friend.getByRole("button", { name: "Démarrer la partie" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Démarrer la partie" }),
    ).toHaveCount(0);
    await friendCommand("transfer-host", () =>
      friend
        .getByRole("button", { name: "Nommer Alice chef de salle" })
        .click(),
    );
    await hostCommand("start", () =>
      page.getByRole("button", { name: "Démarrer la partie" }).click(),
    );
    await expect(page.locator(".player-card")).toHaveCount(4);
    await expect(page.locator('.player-card[data-seat="1"]')).toContainText(
      "Ce PC",
    );
    await expect(friend.locator('.player-card[data-seat="2"]')).toContainText(
      "Vous",
    );
    // The room keeps every player's avatar visible, with only independent
    // human players eligible to receive the leader role.
    await page
      .getByRole("button", { name: "Inviter des joueurs", exact: true })
      .click();
    const picker = page.locator(".room-leader-picker");
    const choices = picker.locator(".room-leader-choice");
    await expect(choices).toHaveCount(4);
    await expect(picker.locator(".player-avatar")).toHaveCount(4);
    await expect(picker).toContainText("Alice");
    await expect(picker).toContainText("Bea");
    await expect(picker).toContainText("Cora");
    await expect(picker).toContainText("Atlas");
    const aliceChoice = picker.locator('.room-leader-choice[data-seat="0"]');
    const coraChoice = picker.locator('.room-leader-choice[data-seat="2"]');
    await expect(aliceChoice).toHaveAttribute("aria-pressed", "true");
    await expect(aliceChoice).toBeDisabled();
    await expect(
      picker.locator('.room-leader-choice[data-seat="1"]'),
    ).toBeDisabled();
    await expect(
      picker.locator('.room-leader-choice[data-seat="3"]'),
    ).toBeDisabled();
    await expect(coraChoice).toBeEnabled();
    await expect(coraChoice).toHaveAccessibleName("Nommer Cora chef de salle");
    for (const size of DESKTOP_SIZES.slice(0, 3)) {
      await page.setViewportSize(size);
      const bounds = await picker.evaluate((element) => {
        const grid = element.querySelector("ul");
        if (!grid) throw new Error("Expected the room leader avatar grid");
        const rect = grid.getBoundingClientRect();
        return {
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          gridWidth: grid.clientWidth,
          gridScrollWidth: grid.scrollWidth,
          left: rect.left,
          right: rect.right,
        };
      });
      expect(bounds.scrollWidth).toBe(bounds.width);
      expect(bounds.gridScrollWidth).toBe(bounds.gridWidth);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(size.width);
      await page.screenshot({
        path: `${process.env.POLYTOUR_SCREENSHOT_DIR ?? ".local/verification"}/room-leader-match-${size.width}.png`,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await friend
      .getByRole("button", { name: "Inviter des joueurs", exact: true })
      .click();
    const friendPicker = friend.locator(".room-leader-picker");
    await expect(friendPicker.locator(".room-leader-choice")).toHaveCount(4);
    await expect(
      friendPicker.locator('.room-leader-choice:not([aria-disabled="true"])'),
    ).toHaveCount(0);

    // Hold the outgoing transfer briefly to observe the pending state, then
    // release that same frame to the real Worker for authorization/broadcasts.
    await page.evaluate(() => {
      const originalSend = WebSocket.prototype.send;
      let release: (() => void) | null = null;
      const surface = window as Window & { releaseLeaderTransfer?: () => void };
      WebSocket.prototype.send = function (data) {
        if (typeof data === "string") {
          try {
            const message = JSON.parse(data) as {
              type?: string;
              op?: { type?: string };
            };
            if (
              !release &&
              message.type === "lobby" &&
              message.op?.type === "transfer-host"
            ) {
              release = () => originalSend.call(this, data);
              return;
            }
          } catch {
            // Diagnostic ping frames are plain text and pass through.
          }
        }
        originalSend.call(this, data);
      };
      surface.releaseLeaderTransfer = () => {
        WebSocket.prototype.send = originalSend;
        delete surface.releaseLeaderTransfer;
        if (!release) throw new Error("Expected the pending leader transfer");
        release();
      };
    });
    await coraChoice.click();
    await expect(
      picker.locator(".room-leader-choice:not([aria-disabled='true'])"),
    ).toHaveCount(0);
    await expect(aliceChoice).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => {
      const surface = window as Window & { releaseLeaderTransfer?: () => void };
      if (!surface.releaseLeaderTransfer)
        throw new Error("Expected the held leader transfer frame");
      surface.releaseLeaderTransfer();
    });
    await expect(coraChoice).toHaveAttribute("aria-pressed", "true");
    await expect(
      picker.locator(".room-leader-choice:not([aria-disabled='true'])"),
    ).toHaveCount(0);
    await expect(page.getByLabel(/Verrouiller la salle/)).toHaveCount(0);
    await expect(
      friendPicker.locator('.room-leader-choice[data-seat="2"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(friend.getByLabel(/Verrouiller la salle/)).toBeEnabled();
    await friendCommand("transfer-host", () =>
      friendPicker
        .getByRole("button", { name: "Nommer Alice chef de salle" })
        .click(),
    );
    await expect(aliceChoice).toHaveAttribute("aria-pressed", "true");
    await expect(coraChoice).toBeEnabled();
    await expect(
      friendPicker.locator(".room-leader-choice:not([aria-disabled='true'])"),
    ).toHaveCount(0);
    await expect(page.getByLabel(/Verrouiller la salle/)).toBeEnabled();

    // Ending the match asks first, then every screen returns to the lobby.
    await page
      .getByRole("button", { name: "Ramener tout le monde au salon" })
      .click();
    const end = page.getByRole("button", {
      name: "Terminer et revenir au salon",
    });
    await expect(end).toBeFocused();
    await end.click();
    await expect(seats).toContainText("Bea");
    await expect(friend.locator(".lobby-seats")).toContainText("Alice");
    await expect(page.getByLabel(/Verrouiller la salle/)).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Démarrer la partie" }),
    ).toBeEnabled();
    for (const size of DESKTOP_SIZES) {
      await page.setViewportSize(size);
      const bounds = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(bounds.scrollWidth).toBe(bounds.width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: ".local/verification/room-leader-lobby.png",
      fullPage: true,
    });
  } finally {
    await friendContext.close();
  }
  expect(errors).toEqual([]);
});

const LUCK_CARD_TITLES = {
  fr: [
    "Grand tour",
    "Naufrage",
    "Jet-set",
    "Direction le championnat",
    "Bonne fortune",
    "Stationnement",
    "Anniversaire",
    "Contrôle fiscal",
    "Ange gardien",
    "Bon de réduction",
    "Tremblement de terre",
    "Échange de terrain",
    "Détour",
    "Coup de pouce",
    "Liberté",
    "Solidarité",
  ],
  en: [
    "Grand Tour",
    "Stranded",
    "Jet Set",
    "Championship call",
    "Windfall",
    "Parking fine",
    "Birthday",
    "Tax audit",
    "Guardian angel",
    "Rent coupon",
    "Earthquake",
    "Land swap",
    "Detour",
    "Contractor",
    "Jailbreak",
    "Charity",
  ],
} as const;

for (const locale of ["fr", "en"] as const) {
  test(`the ${locale} luck-card catalogue explains all cards and preserves keyboard focus`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await chooseLanguage(page, locale);
    const helpTrigger = page.getByRole("button", {
      name: locale === "fr" ? "Comment jouer" : "How to play",
      exact: true,
    });
    await helpTrigger.click();
    const help = page.locator(".help-dialog");
    const catalogue = help.locator(".help-cards");
    await expect(
      catalogue.getByRole("heading", {
        name: locale === "fr" ? "Cartes Surprise" : "Luck cards",
        exact: true,
      }),
    ).toBeVisible();
    await expect(catalogue.locator(".luck-card-button")).toHaveCount(16);
    const detail = page.locator(".luck-card-dialog");
    const closeCard = detail.locator(".luck-card-close");
    const backToCards = detail.locator(".luck-card-back");
    const backLabel = locale === "fr" ? "Retour aux cartes" : "Back to cards";
    for (const title of LUCK_CARD_TITLES[locale]) {
      const card = catalogue
        .locator(".luck-card-button")
        .filter({ hasText: title });
      await expect(card).toHaveCount(1);
      await card.click();
      await expect(detail).toBeVisible();
      await expect(
        detail.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(detail.locator(".luck-card-impact")).not.toBeEmpty();
      await expect(detail.locator(".luck-card-description")).not.toBeEmpty();
      await expect(detail.locator(".luck-card-notes")).not.toBeEmpty();
      await expect(closeCard).toHaveAccessibleName(backLabel);
      await expect(backToCards).toHaveAccessibleName(backLabel);
      await closeCard.click();
      await expect(detail).not.toBeVisible();
      await expect(help).toBeVisible();
      await expect(card).toBeFocused();
    }

    const firstCard = catalogue.locator(".luck-card-button").first();
    await firstCard.focus();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await expect(
      detail.getByRole("heading", {
        name: LUCK_CARD_TITLES[locale][0],
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(backToCards).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeCard).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(backToCards).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(detail).not.toBeVisible();
    await expect(help).toBeVisible();
    await expect(firstCard).toBeFocused();

    // A second Escape closes the parent. Reopening starts on the catalogue.
    await page.keyboard.press("Escape");
    await expect(help).not.toBeVisible();
    await expect(helpTrigger).toBeFocused();
    await helpTrigger.click();
    await expect(help).toBeVisible();
    await expect(detail).not.toBeVisible();
    await expect(catalogue.locator(".luck-card-button")).toHaveCount(16);
    const lastCard = catalogue.locator(".luck-card-button").last();
    await lastCard.click();
    await expect(
      detail.getByRole("heading", {
        name: LUCK_CARD_TITLES[locale][15],
        exact: true,
      }),
    ).toBeVisible();
    await backToCards.click();
    await expect(lastCard).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("match card help uses the active salary and saved economy rather than welcome defaults", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Card help match");
  await playWithBots(page);
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  // A legacy presentation fixture differs deliberately from welcome settings.
  // It does not modify the authoritative room or send a game action.
  await page.evaluate(async () => {
    const modulePath =
      performance
        .getEntriesByType("resource")
        .find((entry) =>
          entry.name.includes("/src/client/director/director.ts"),
        )?.name ?? "/src/client/director/director.ts";
    const { director } = await import(modulePath);
    const state = director.getSnapshot().serverState as PublicState | null;
    if (!state) throw new Error("Expected a match for card help");
    director.reset({
      ...state,
      config: {
        ...state.config,
        startSalary: 760_000,
        economyRule: "prototype",
        boardRule: "legacy",
      },
      activeSeat: 0,
      pending: {
        kind: "roll",
        seat: 0,
        deadline: Date.now() + 60_000,
      },
    });
  });
  await page
    .getByRole("button", { name: "Comment jouer", exact: true })
    .click();
  const help = page.locator(".help-dialog");
  const catalogue = help.locator(".help-cards");
  await expect(catalogue.locator(".luck-card-button")).toHaveCount(16);
  const detail = page.locator(".luck-card-dialog");
  await catalogue
    .locator(".luck-card-button")
    .filter({ hasText: "Grand tour" })
    .click();
  await expect(detail.locator(".luck-card-description")).toContainText("760 k");
  await expect(detail.locator(".luck-card-description")).not.toContainText(
    "400 k",
  );
  await page.keyboard.press("Escape");
  await catalogue
    .locator(".luck-card-button")
    .filter({ hasText: "Tremblement de terre" })
    .click();
  await expect(detail.locator(".luck-card-description")).toContainText(
    "monuments",
  );
  await expect(detail.locator(".luck-card-description")).not.toContainText(
    "hôtels compris",
  );
  await page.keyboard.press("Escape");
  await catalogue
    .locator(".luck-card-button")
    .filter({ hasText: "Échange de terrain" })
    .click();
  await expect(detail.locator(".luck-card-description")).toContainText(
    "hors monuments",
  );
  await page.keyboard.press("Escape");
  await expect(help).toBeVisible();
});

for (const locale of ["fr", "en"] as const) {
  test(`the ${locale} footer opens release notes with keyboard dismissal and readable layouts`, async ({
    page,
  }) => {
    await page.addInitScript(
      (language) => localStorage.setItem("polytour.locale", language),
      locale,
    );
    await page.goto("/");
    const trigger = page.getByRole("button", {
      name:
        locale === "fr"
          ? `Version ${APP_VERSION} : voir les nouveautés`
          : `Version ${APP_VERSION}: view changelog`,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: locale === "fr" ? "Nouveautés" : "What's new",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: `v${APP_VERSION}`, exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "The Championship corner is now a stadium",
    );
    await expect(
      dialog.getByRole("heading", { name: "v0.1.0", exact: true }),
    ).toHaveCount(1);
    await expect(
      dialog
        .getByRole("heading", {
          name: locale === "fr" ? "Modifications" : "Changed",
          exact: true,
        })
        .first(),
    ).toBeVisible();
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error("Release dialog has no bounds");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
      await page.screenshot({
        path: `.local/verification/changelog-${locale}-${size.width}.png`,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const history = dialog.getByRole("region");
    await history.focus();
    await page.keyboard.press("End");
    await expect
      .poll(() => history.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog
      .getByRole("button", {
        name: locale === "fr" ? "Fermer les nouveautés" : "Close changelog",
      })
      .click();
    await expect(trigger).toBeFocused();
  });
}
