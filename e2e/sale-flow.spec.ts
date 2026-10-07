import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
  LOT_TOP,
  screenPoint,
  tilePoint,
} from "../src/client/scene/board-layout.js";
import {
  applyAction,
  createGame,
  DEFAULT_GAME_CONFIG,
  type GameState,
  propertyRefund,
  toPublic,
} from "../src/shared/engine/index.js";
import {
  type ClientMessage,
  ClientMessageSchema,
  PROTOCOL_VERSION,
  RoomConfigSchema,
} from "../src/shared/protocol/index.js";
import { boardScreenPoint, clickBoardSpace } from "./board-interactions.js";
import { DESKTOP_SIZES } from "./desktop-sizes.js";

test.use({ reducedMotion: "reduce" });

const credentials = {
  roomCode: "SALE23",
  seat: 0,
  token: "test-sale-capability-not-real",
};
type Intent = Extract<ClientMessage, { type: "intent" }>;

function saleGame(allProperties = false, reference = false): GameState {
  const now = Date.now();
  const base = createGame(
    {
      ...DEFAULT_GAME_CONFIG,
      economyRule: reference ? "reference" : "prototype",
      boardRule: reference ? "country" : "legacy",
      sellBackPercent: 100,
      gameId: "sale-fixture-not-real",
      festivalCount: 0,
      decisionSeconds: 60,
    },
    ["Sale fixture", "Birthday host", "Third player", "Fourth player"].map(
      (name, index) => ({
        playerId: `test-sale-player-${index}`,
        name,
        control: "human" as const,
      }),
    ),
    113,
    { now },
  ).state;
  const properties = base.properties.map((property) => ({
    ...property,
    owner:
      allProperties || [1, 11, 25].includes(property.tile)
        ? (0 as const)
        : property.tile === 9
          ? (1 as const)
          : null,
    level:
      property.tile === 1 || (property.tile === 25 && !reference)
        ? (3 as const)
        : property.tile === 11
          ? (4 as const)
          : (0 as const),
  }));
  return {
    ...base,
    activeSeat: 1,
    phase: "resolve",
    properties,
    players: base.players.map((player) => ({
      ...player,
      cash: player.seat === 0 ? -400_000 : player.cash,
      position: [6, 3, 20, 26][player.seat],
      properties: properties
        .filter((property) => property.owner === player.seat)
        .map((property) => property.tile),
    })),
    pending: {
      kind: "sell",
      seat: 0,
      targets: properties
        .filter((property) => property.owner === 0)
        .map((property) => property.tile),
      creditor: 1,
      deadline: now + 60_000,
    },
    resolutionQueue: [{ kind: "finish" }],
  };
}

async function enterSaleRoom(
  page: Page,
  allProperties = false,
  reference = false,
) {
  let state = saleGame(allProperties, reference);
  let seq = 0;
  const intents: Intent[] = [];
  const sockets: WebSocketRoute[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const welcome = () =>
    JSON.stringify({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      you: { seat: 0 },
      seq,
      snapshot: toPublic(state),
      randomness: null,
      lobby: {
        roomCode: credentials.roomCode,
        hostSeat: 0,
        status: "playing",
        config: RoomConfigSchema.parse({}),
        seats: state.players.map((player) => ({
          seat: player.seat,
          name: player.name,
          control: player.control,
          online: true,
        })),
      },
    });
  await page.route("**/api/rooms", (route) =>
    route.fulfill({ status: 201, json: credentials }),
  );
  await page.routeWebSocket("**/ws/room/**", (ws) => {
    sockets.push(ws);
    ws.onMessage((raw) => {
      const message = ClientMessageSchema.parse(
        JSON.parse(String(raw)),
      ) as ClientMessage;
      if (message.type === "sync") ws.send(welcome());
      if (message.type === "intent") intents.push(message);
    });
  });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Sale fixture");
  await page.getByRole("button", { name: "Jouer", exact: true }).click();
  await expect(page.locator(".match-connection")).toHaveAttribute(
    "data-state",
    "online",
  );
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-sale-active",
    "true",
  );
  await expect(page.locator(".decision-sale")).toBeVisible();
  await expect(page.locator(".sale-tile-quote")).toHaveCount(
    state.players[0].properties.length,
  );
  return {
    intents,
    sockets,
    errors,
    state: () => state,
    snapshot: (replacement?: GameState) => {
      if (replacement) state = replacement;
      sockets.at(-1)?.send(welcome());
    },
    commit: (index: number) => {
      const intent = intents[index];
      expect(intent.atSeq).toBe(seq);
      const result = applyAction(state, 0, intent.action, {
        now: Date.now(),
      });
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
      const fromSeq = seq + 1;
      seq += result.events.length;
      const ws = sockets.at(-1);
      if (!ws) throw new Error("Expected the mock room socket");
      ws.send(JSON.stringify({ type: "ack", id: intent.id }));
      ws.send(
        JSON.stringify({
          type: "events",
          fromSeq,
          toSeq: seq,
          events: result.events,
        }),
      );
      return result;
    },
  };
}

const quote = (page: Page, tile: number) =>
  page.locator(`.sale-tile-quote[data-tile="${tile}"]`);

async function boardTileClickPoint(page: Page, tile: number) {
  // Two rendered quote anchors calibrate the board projection. Click the
  // printed city face away from its label, exercising the actual 3D picking.
  const anchors = await Promise.all(
    [1, 11].map(async (index) => {
      const rect = await quote(page, index).boundingBox();
      if (!rect) throw new Error("Expected a board quote anchor");
      const [x, z] = tilePoint(index, 0, 0.3);
      const [worldX, worldY] = screenPoint(x, LOT_TOP + 0.08, z);
      return {
        worldX,
        worldY,
        pixelX: rect.x + rect.width / 2,
        pixelY: rect.y + rect.height / 2,
      };
    }),
  );
  const scale =
    (anchors[1].pixelX - anchors[0].pixelX) /
    (anchors[1].worldX - anchors[0].worldX);
  const [x, z] = tilePoint(tile, 0, -0.35);
  const [worldX, worldY] = screenPoint(x, LOT_TOP + 0.003, z);
  return {
    x: anchors[0].pixelX + (worldX - anchors[0].worldX) * scale,
    y: anchors[0].pixelY - (worldY - anchors[0].worldY) * scale,
  };
}

async function clickBoardTile(page: Page, tile: number) {
  const { x, y } = await boardTileClickPoint(page, tile);
  await page.mouse.click(x, y);
}

test("off-turn debtor selects highlighted cities on the board before confirming a full-value sale", async ({
  page,
}) => {
  const room = await enterSaleRoom(page);
  const confirm = page.locator(".sale-confirm");
  await expect(confirm).toBeDisabled();
  await expect(page.locator(".sale-selection")).toContainText(
    "Choisissez une ville",
  );
  await expect(page.locator(".decision-popup[open]")).toHaveCount(0);
  await expect(page.locator(".decision-sale select")).toHaveCount(0);
  await expect(page.locator(".city-card")).not.toBeVisible();
  expect(room.state().activeSeat).toBe(1);
  expect(room.state().pending?.seat).toBe(0);
  expect(propertyRefund(room.state(), 1)).toBe(210_000);
  expect(propertyRefund(room.state(), 11)).toBe(660_000);
  await expect(quote(page, 1)).toContainText("+210 k");
  await expect(quote(page, 11)).toContainText("+660 k");
  await expect(quote(page, 25)).toContainText("+700 k");
  await expect(quote(page, 9)).toHaveCount(0);
  expect(
    await page
      .locator(".sale-tile-quote")
      .evaluateAll((buttons) =>
        buttons.map((button) => Number(button.getAttribute("data-tile"))),
      ),
  ).toEqual([1, 11, 25]);

  await clickBoardTile(page, 1);
  await expect(quote(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(confirm).toBeEnabled();
  await expect(confirm).toContainText("Vendre · 210 k");
  await expect(page.locator(".sale-ledger")).toContainText("Dette après vente");
  await expect(page.locator(".sale-ledger")).toContainText("190 k");
  await clickBoardTile(page, 9);
  await expect(quote(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".city-card")).not.toBeVisible();
  expect(room.intents).toHaveLength(0);

  await quote(page, 11).focus();
  await page.keyboard.press("Enter");
  await expect(quote(page, 11)).toBeFocused();
  await expect(quote(page, 11)).toHaveAttribute("aria-pressed", "true");
  await expect(quote(page, 1)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".sale-selection")).toContainText("Rome");
  await expect(page.locator(".sale-ledger")).toContainText("260 k");
  // A nonmodal sale keeps keyboard navigation on the board and its tools.
  await page.keyboard.press("Tab");
  await expect(quote(page, 25)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(quote(page, 25)).toHaveAttribute("aria-pressed", "true");
  await quote(page, 11).click();

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    const bounds = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      rectangles: [
        ...document.querySelectorAll(
          ".player-card, .decision-sale, .sale-tile-quote",
        ),
      ].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      }),
    }));
    expect(bounds.scrollWidth).toBe(bounds.width);
    expect(bounds.scrollHeight).toBeLessThanOrEqual(size.height);
    for (const rect of bounds.rectangles) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(size.width);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(size.height);
    }
    for (const target of await page.locator(".sale-tile-quote").all()) {
      // Projected board controls settle on the next render after a resize.
      await expect
        .poll(() =>
          target.evaluate((button) => {
            const rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return button === hit || (hit !== null && button.contains(hit));
          }),
        )
        .toBe(true);
    }
    await page.screenshot({
      path: `.local/verification/sale-board-${size.width}.png`,
    });
  }
  expect(room.intents).toHaveLength(0);
  await confirm.click();
  await expect.poll(() => room.intents.length).toBe(1);
  expect(room.intents[0].action).toEqual({ type: "Sell", tile: 11 });
  await expect(confirm).toBeDisabled();
  await expect(quote(page, 25)).toBeDisabled();
  const sold = room.commit(0);
  expect(sold.events).toContainEqual({
    type: "PropertySold",
    seat: 0,
    tile: 11,
    amount: 660_000,
  });
  await expect(page.locator(".decision-sale")).toHaveCount(0);
  await expect(page.locator(".sale-tile-quote")).toHaveCount(0);
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-sale-active",
    "false",
  );
  expect(room.state().players[0].cash).toBe(260_000);
  expect(room.errors).toEqual([]);
});

test.describe("standard animation playback", () => {
  test.use({ reducedMotion: "no-preference" });

  test("remaining debt and recovered snapshots require a fresh choice", async ({
    page,
  }) => {
    const room = await enterSaleRoom(page);
    const confirm = page.locator(".sale-confirm");
    await quote(page, 1).click();
    room.snapshot();
    await expect(quote(page, 1)).toHaveAttribute("aria-pressed", "false");
    await expect(confirm).toBeDisabled();
    await quote(page, 1).click();
    await confirm.click();
    await expect.poll(() => room.intents.length).toBe(1);
    room.commit(0);
    await expect(quote(page, 1)).toHaveCount(0);
    await expect(page.locator(".sale-tile-quote")).toHaveCount(2);
    await expect(page.locator(".decision-sale")).toBeVisible();
    await expect(page.locator(".sale-selection")).toContainText(
      "Choisissez une ville",
    );
    await expect(confirm).toBeDisabled();
    await expect(page.locator(".sale-ledger")).toContainText("190 k");
    expect(room.state().players[0].cash).toBe(-190_000);

    await quote(page, 11).click();
    await expect(confirm).toBeEnabled();
    await room.sockets[0].close({
      code: 1011,
      reason: "Test sale reconnection",
    });
    await expect.poll(() => room.sockets.length).toBe(2);
    await expect(page.locator(".match-connection")).toHaveAttribute(
      "data-state",
      "online",
    );
    await expect(quote(page, 11)).toHaveAttribute("aria-pressed", "false");
    await expect(confirm).toBeDisabled();
    await quote(page, 25).focus();
    await page.keyboard.press("Enter");
    await expect(confirm).toContainText("Vendre · 700 k");
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.locator(".canvas-layer")).toHaveAttribute(
        "data-sale-active",
        "true",
      );
      await page.screenshot({
        path: `.local/verification/sale-board-normal-motion-${size.width}.png`,
      });
    }
    await confirm.click();
    await expect.poll(() => room.intents.length).toBe(2);
    expect(room.intents[1].action).toEqual({ type: "Sell", tile: 25 });
    room.commit(1);
    await expect(page.locator(".decision-sale")).toHaveCount(0);
    await expect(page.locator(".canvas-layer")).toHaveAttribute(
      "data-sale-active",
      "false",
    );
    expect(room.state().players[0].cash).toBe(510_000);
    expect(room.errors).toEqual([]);
  });
});

test("every city and resort sale quote remains clickable at each desktop size", async ({
  page,
}) => {
  const room = await enterSaleRoom(page, true);
  await expect(page.locator(".sale-tile-quote")).toHaveCount(24);
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    for (const tile of room.state().players[0].properties) {
      const target = quote(page, tile);
      await expect(target).toBeEnabled();
      // Quotes follow the board after a resize, so wait for them to settle
      // rather than hit-testing the frame right after the viewport changes.
      await expect
        .poll(
          () =>
            target.evaluate((button) => {
              const rect = button.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              );
              return hit !== null && (button === hit || button.contains(hit));
            }),
          { message: `Sale quote ${tile} at ${size.width}px` },
        )
        .toBe(true);
      await target.click();
      await expect(target).toHaveAttribute("aria-pressed", "true");
    }
    await page.screenshot({
      path: `.local/verification/sale-all-properties-${size.width}.png`,
    });
  }
  expect(room.intents).toHaveLength(0);
  expect(room.errors).toEqual([]);
});

test("a recovered snapshot leaving liquidation restores normal board inspection", async ({
  page,
}) => {
  const room = await enterSaleRoom(page);
  await quote(page, 11).click();
  const opponentCity = await boardTileClickPoint(page, 9);
  const saleState = room.state();
  room.snapshot({
    ...saleState,
    phase: "roll",
    pending: {
      kind: "roll",
      seat: saleState.activeSeat,
      deadline: Date.now() + 60_000,
    },
    players: saleState.players.map((player) => ({
      ...player,
      cash: player.seat === 0 ? 100_000 : player.cash,
    })),
    resolutionQueue: [],
  });
  await expect(page.locator(".decision-sale")).toHaveCount(0);
  await expect(page.locator(".sale-tile-quote")).toHaveCount(0);
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-sale-active",
    "false",
  );
  await page.mouse.click(opponentCity.x, opponentCity.y);
  await expect(page.locator(".city-card")).toBeVisible();
  await expect(page.locator("#city-card-title")).toHaveText("Porto");
  await page.keyboard.press("Escape");
  await expect(page.locator(".city-card")).not.toBeVisible();
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await page.screenshot({
      path: `.local/verification/sale-contrast-restored-${size.width}.png`,
    });
  }
  expect(room.intents).toHaveLength(0);
  expect(room.errors).toEqual([]);
});

test("combined country and reference sale targets stay usable through 4K", async ({
  page,
}) => {
  const room = await enterSaleRoom(page, true, true);
  await expect(page.locator(".sale-tile-quote")).toHaveCount(24);
  for (const size of DESKTOP_SIZES) {
    await page.setViewportSize(size);
    for (const tile of [3, 4, 19, 25, 29, 31]) {
      const target = quote(page, tile);
      await target.click();
      await expect(target).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".sale-confirm")).toBeEnabled();
    }
    await page.screenshot({
      path: `.local/verification/combined-reference-sale-${size.width}.png`,
    });
  }
  expect(room.intents).toHaveLength(0);
  expect(room.errors).toEqual([]);
});

test("country travel and championship pick the same legal targets on the board and by keyboard", async ({
  page,
}) => {
  const room = await enterSaleRoom(page, true, true);
  const base = room.state();
  const state = {
    ...base,
    activeSeat: 0 as const,
    players: base.players.map((player) => ({ ...player, cash: 1_000_000 })),
    resolutionQueue: [] as const,
  };
  for (const size of DESKTOP_SIZES) {
    await page.setViewportSize(size);
    // Calibrate against the sale labels before changing the decision overlay.
    room.snapshot(base);
    await expect(quote(page, 3)).toBeVisible();
    const city = await boardTileClickPoint(page, 3);
    const resort = await boardTileClickPoint(page, 4);
    room.snapshot({
      ...state,
      pending: {
        kind: "travel",
        seat: 0,
        fee: 0,
        targets: [3, 4],
        deadline: Date.now() + 60_000,
      },
    });
    const destination = page.getByLabel("Destination", { exact: true });
    await expect(destination.locator("option:not([disabled])")).toHaveCount(2);
    await page.mouse.click(city.x, city.y);
    await expect(destination).toHaveValue("3");
    await expect(page.locator(".decision-confirm")).toContainText("Paris");
    await page.mouse.click(resort.x, resort.y);
    await expect(destination).toHaveValue("4");
    await expect(page.locator(".decision-confirm")).toContainText("Seychelles");
    await destination.selectOption("3");
    await expect(page.locator(".decision-confirm")).toContainText("Paris");
    if (size.width === 1440) {
      const diceTool = page.getByRole("button", {
        name: "À propos des dés",
        exact: true,
      });
      await diceTool.click();
      await page
        .getByRole("button", {
          name: "Comment fonctionnent les dés ?",
          exact: true,
        })
        .click();
      await expect(page.locator(".help-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".help-dialog")).not.toBeVisible();
      await expect(diceTool).toBeFocused();
      await expect(destination).toHaveValue("3");
      await expect(page.locator(".decision-confirm")).toContainText("Paris");
    }
    expect(room.intents).toHaveLength(0);
  }
  // The server owns the target list. Selecting a host remains reversible until
  // confirmation, then the same action is accepted by the authoritative engine.
  const city = await (async () => {
    room.snapshot(base);
    await expect(quote(page, 3)).toBeVisible();
    return boardTileClickPoint(page, 3);
  })();
  room.snapshot({
    ...state,
    championshipHost: null,
    pending: {
      kind: "host",
      seat: 0,
      targets: [3],
      deadline: Date.now() + 60_000,
    },
  });
  await expect(page.getByLabel("Ville hôte", { exact: true })).toBeVisible();
  await page.mouse.click(city.x, city.y);
  await expect(page.getByLabel("Ville hôte", { exact: true })).toHaveValue("3");
  expect(room.intents).toHaveLength(0);
  await page.locator(".decision-confirm").click();
  await expect.poll(() => room.intents.length).toBe(1);
  room.commit(0);
  expect(room.state().championshipHost?.tile).toBe(3);
  expect(room.errors).toEqual([]);
});

test("roll button and informative timer remain usable through 4K and reduced motion", async ({
  page,
}) => {
  const room = await enterSaleRoom(page, false, true);
  const game = room.state();
  room.snapshot({
    ...game,
    activeSeat: 0,
    phase: "roll",
    pending: { kind: "roll", seat: 0, deadline: Date.now() + 60_000 },
    players: game.players.map((player) => ({ ...player, cash: 1_000_000 })),
    resolutionQueue: [],
  });
  const roll = page.getByRole("button", {
    name: "Lancer les dés",
    exact: true,
  });
  await expect(roll).toBeEnabled();
  const timer = page.locator('.player-card[data-seat="0"] .player-timer-fill');
  await expect(timer).toHaveCount(1);
  const duration = await timer.evaluate((el) =>
    parseFloat(getComputedStyle(el).animationDuration),
  );
  expect(duration).toBeGreaterThan(0);
  for (const size of DESKTOP_SIZES) {
    await page.setViewportSize(size);
    await expect(roll).toBeInViewport();
    await expect
      .poll(() =>
        roll.evaluate((button) => {
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
          return hit !== null && (button === hit || button.contains(hit));
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: `.local/verification/combined-roll-${size.width}.png`,
    });
  }
  const sample = () =>
    timer.evaluate((el) => {
      const animation = el.getAnimations()[0];
      return {
        time: Number(animation?.currentTime ?? 0),
        delay: parseFloat(getComputedStyle(el).animationDelay) * 1000,
        wall: performance.now(),
      };
    });
  const before = await sample();
  await clickBoardSpace(page, 9);
  await expect(page.locator(".city-card")).toBeVisible();
  await page.keyboard.press("Escape");
  const after = await sample();
  expect(
    Math.abs(
      after.time -
        after.delay -
        (before.time - before.delay) -
        (after.wall - before.wall),
    ),
  ).toBeLessThan(500);
  expect(room.errors).toEqual([]);
});

// One test per viewport: a single pass over every desktop size outgrew the
// 120 s budget on CI, where WebGL is software rendered.
for (const viewport of DESKTOP_SIZES) {
  test(`forced-sale quotes follow the actual board view after zoom, rotation and pan at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() =>
      localStorage.setItem("polytour.lowGraphics", "true"),
    );
    const room = await enterSaleRoom(page);
    const board = page.locator(".canvas-layer");
    for (const zoom of [0.8, 2]) {
      await page
        .getByRole("button", { name: "Menu pause", exact: true })
        .click();
      await page.getByRole("button", { name: "Réglages", exact: true }).click();
      await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
      await page
        .getByRole("slider", { name: "Zoom du plateau", exact: true })
        .press(zoom === 2 ? "End" : "Home");
      await expect(board).toHaveAttribute("data-board-zoom", String(zoom));
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      if (zoom === 2) {
        const center = await boardScreenPoint(page, { x: 0, y: LOT_TOP, z: 0 });
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
        await page.mouse.move(center.x + 60, center.y + 12, { steps: 6 });
        await page.mouse.up();
        await expect
          .poll(
            async () => Number(await board.getAttribute("data-board-yaw")),
            { timeout: 20_000 },
          )
          .not.toBe(0);
        const shifted = await boardScreenPoint(page, {
          x: 0,
          y: LOT_TOP,
          z: 0,
        });
        await page.mouse.move(shifted.x, shifted.y);
        await page.keyboard.down("Shift");
        await page.mouse.down();
        await page.mouse.move(shifted.x + 100, shifted.y + 50, { steps: 6 });
        await page.mouse.up();
        await page.keyboard.up("Shift");
        await expect
          .poll(
            async () => Number(await board.getAttribute("data-board-pan-x")),
            { timeout: 20_000 },
          )
          .not.toBe(0);
      }
      const world = [1, 11, 25].map((tile) => {
        const [x, z] = tilePoint(tile, 0, 0.3);
        return { tile, x, y: LOT_TOP + 0.08, z };
      });
      await expect
        .poll(
          async () =>
            page.evaluate(async (points) => {
              const modulePath = performance
                .getEntriesByType("resource")
                .find((entry) =>
                  entry.name.includes("/@react-three_fiber.js"),
                )?.name;
              if (!modulePath)
                throw new Error("Expected the loaded R3F module");
              const { _roots } = (await import(
                modulePath
              )) as typeof import("@react-three/fiber");
              const canvas = document.querySelector<HTMLCanvasElement>(
                ".canvas-layer canvas",
              );
              const scene = canvas && _roots.get(canvas)?.store.getState();
              if (!canvas || !scene)
                throw new Error("Expected the mounted board");
              const rect = canvas.getBoundingClientRect();
              return Math.max(
                ...points.map(({ tile, x, y, z }) => {
                  const point = scene.camera.position.clone().set(x, y, z);
                  const view = scene.scene.getObjectByName("board-user-view");
                  if (view) {
                    view.updateWorldMatrix(true, false);
                    point.applyMatrix4(view.matrixWorld);
                  }
                  point.project(scene.camera);
                  const quote = document.querySelector<HTMLElement>(
                    `.sale-tile-quote[data-tile="${tile}"]`,
                  );
                  if (!quote) throw new Error("Expected the sale quote");
                  const position = quote.getBoundingClientRect();
                  return Math.max(
                    Math.abs(
                      position.x +
                        position.width / 2 -
                        rect.x -
                        ((point.x + 1) * rect.width) / 2,
                    ),
                    Math.abs(
                      position.y +
                        position.height / 2 -
                        rect.y -
                        ((1 - point.y) * rect.height) / 2,
                    ),
                  );
                }),
              );
            }, world),
          { timeout: 20_000 },
        )
        .toBeLessThan(1);
      await page.screenshot({
        path: `.local/verification/board-zoom-sale-${viewport.width}-${zoom}.png`,
      });
    }
    expect(room.intents).toHaveLength(0);
    expect(room.errors).toEqual([]);
  });
}
