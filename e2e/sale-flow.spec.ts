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

test.use({ reducedMotion: "reduce" });

const credentials = {
  roomCode: "SALE23",
  seat: 0,
  token: "test-sale-capability-not-real",
};
type Intent = Extract<ClientMessage, { type: "intent" }>;

function saleGame(allProperties = false): GameState {
  const now = Date.now();
  const base = createGame(
    {
      ...DEFAULT_GAME_CONFIG,
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
      property.tile === 1 || property.tile === 25
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

async function enterSaleRoom(page: Page, allProperties = false) {
  let state = saleGame(allProperties);
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
  await page
    .getByRole("button", { name: "Créer une salle entre amis" })
    .click();
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
  await expect(page.locator(".inspector")).not.toBeVisible();
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
  await expect(page.locator(".inspector")).not.toBeVisible();
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
      const receivesPointer = await target.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return button === hit || (hit !== null && button.contains(hit));
      });
      expect(receivesPointer).toBe(true);
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
      const clickable = await target.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return hit !== null && (button === hit || button.contains(hit));
      });
      expect(clickable, `Sale quote ${tile} at ${size.width}px`).toBe(true);
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
  await expect(page.locator(".inspector")).toBeVisible();
  await expect(page.locator(".inspector")).toContainText("Porto");
  await page.keyboard.press("Escape");
  await expect(page.locator(".inspector")).not.toBeVisible();
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
