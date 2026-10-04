import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  type GameEvent,
  type PublicState,
  toPublic,
} from "../src/shared/engine/index.js";
import {
  PROTOCOL_VERSION,
  RoomConfigSchema,
  type ServerMessage,
} from "../src/shared/protocol/index.js";
import { clickBoardSpace } from "./board-interactions.js";

test.use({ reducedMotion: "reduce" });

for (const entry of ["play", "join", "invitation"] as const) {
  test(`${entry} keeps loading inline without a popup before or after the response`, async ({
    page,
  }) => {
    let requests = 0;
    let respond: () => void = () => {};
    const response = new Promise<void>((resolve) => {
      respond = resolve;
    });
    await page.route("**/api/rooms**", async (route) => {
      requests += 1;
      await response;
      await route.fulfill({
        status: 503,
        json: { error: "room-service-unavailable" },
      });
    });
    await page.goto(entry === "invitation" ? "/?room=ABCD23" : "/");
    await page.getByLabel("Votre nom de joueur").fill("Loading fixture");
    if (entry === "join")
      await page.getByLabel("Vous avez un code ?").fill("ABCD23");
    const button = page.locator(
      entry === "join" ? ".join-form .button.ink" : ".welcome-play",
    );
    try {
      await button.click();
      await expect.poll(() => requests).toBe(1);
      await expect(button).toBeDisabled();
      await button.hover();
      await button.focus();
      await expect(page.getByRole("tooltip")).not.toBeVisible();
      await page.screenshot({
        path: `.local/verification/loading-${entry}.png`,
      });
      await button.press("Enter");
      expect(requests).toBe(1);
    } finally {
      respond();
    }
    await expect(page.getByRole("alert")).toContainText("HTTP 503");
    await expect(button).toBeEnabled();
    await expect(page.getByRole("tooltip")).not.toBeVisible();
  });
}

async function decisionRoom(page: Page, cash = 2_000_000) {
  const now = Date.now();
  const base = toPublic(
    createGame(
      { ...DEFAULT_GAME_CONFIG, decisionSeconds: 60, festivalCount: 0 },
      [
        { playerId: "ui-test-0", name: "Camille", control: "human" },
        { playerId: "ui-test-1", name: "Atlas", control: "bot" },
      ],
      35,
      { now },
    ).state,
  );
  const snapshot: PublicState = {
    ...base,
    activeSeat: 0,
    players: base.players.map((player) =>
      player.seat === 0 ? { ...player, cash, position: 1, laps: 0 } : player,
    ),
    pending: {
      kind: "buy",
      seat: 0,
      tile: 1,
      maxLevel: 2,
      deadline: now + 60_000,
    },
  };
  let socket: WebSocketRoute | undefined;
  let seq = 0;
  const intents: string[] = [];
  await page.route("**/api/rooms", (route) =>
    route.fulfill({
      status: 201,
      json: {
        roomCode: "ABCD35",
        seat: 0,
        token: "ui-test-capability-not-real",
      },
    }),
  );
  await page.routeWebSocket("**/ws/room/**", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      if (String(raw).startsWith("{")) {
        const message = JSON.parse(String(raw)) as { type: string };
        if (message.type === "intent") intents.push(String(raw));
        if (message.type === "sync")
          ws.send(
            JSON.stringify({
              type: "welcome",
              protocolVersion: PROTOCOL_VERSION,
              you: { seat: 0, member: null },
              seq,
              snapshot,
              randomness: null,
              lobby: {
                roomCode: "ABCD35",
                hostSeat: 0,
                locked: false,
                waiting: [],
                status: "playing",
                config: RoomConfigSchema.parse({ decisionSeconds: 60 }),
                boardRule: DEFAULT_GAME_CONFIG.boardRule,
                economyRule: DEFAULT_GAME_CONFIG.economyRule,
                hotelPurchaseRule: DEFAULT_GAME_CONFIG.hotelPurchaseRule,
                sellBackPercent: DEFAULT_GAME_CONFIG.sellBackPercent,
                worldTourRule: DEFAULT_GAME_CONFIG.worldTourRule,
                fourResortRent: DEFAULT_GAME_CONFIG.fourResortRent,
                buildAfterBuyout: DEFAULT_GAME_CONFIG.buildAfterBuyout,
                chanceRule: DEFAULT_GAME_CONFIG.chanceRule,
                seats: ([0, 1, 2, 3] as const).map((seat) => ({
                  seat,
                  name:
                    snapshot.players.find((player) => player.seat === seat)
                      ?.name ?? "",
                  control:
                    snapshot.players.find((player) => player.seat === seat)
                      ?.control ?? null,
                  controller: null,
                  online: true,
                })),
              },
            } satisfies ServerMessage),
          );
      }
    });
  });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Camille");
  await page.getByRole("button", { name: "Jouer", exact: true }).click();
  await expect(page.locator(".decision-popup[open]")).toBeVisible();
  return {
    intents,
    send(events: GameEvent[]) {
      if (!socket) throw new Error("Expected fixture socket");
      const fromSeq = seq + 1;
      seq += events.length;
      socket.send(
        JSON.stringify({ type: "events", fromSeq, toSeq: seq, events }),
      );
    },
  };
}

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`disabled explanations and minimized decision at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const room = await decisionRoom(page);
    const hotel = page
      .locator('.construction-choice[data-locked="true"]')
      .last();
    await expect(hotel).toBeDisabled();
    await hotel.hover();
    const hint = page.getByRole("tooltip");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("3 maisons, un tour complet");
    const box = await hint.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height);
    await page.screenshot({
      path: `.local/verification/disabled-hint-${size.width}.png`,
    });
    await hotel.focus();
    await hotel.press("Enter");
    expect(room.intents).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(hint).not.toBeVisible();
    await expect(page.locator(".decision-popup[open]")).toBeVisible();
    await page.locator(".construction-choice").nth(3).focus();
    await expect(hint).toContainText(
      "3 maisons après votre premier tour complet",
    );
    const twoHouses = page.locator(".construction-choice").nth(2);
    await twoHouses.click();
    await page
      .getByRole("button", { name: "Réduire le choix", exact: true })
      .click();
    const dock = page.getByRole("button", { name: /Reprendre le choix/ });
    await expect(dock).toBeFocused();
    await expect(page.locator(".decision-popup[open]")).toHaveCount(0);
    await expect(dock).toContainText(/\d+s/);
    await page.screenshot({
      path: `.local/verification/minimized-decision-${size.width}.png`,
    });
    expect(room.intents).toEqual([]);
    await dock.press("Enter");
    await expect(twoHouses).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#decision-heading")).toBeFocused();
    await page.keyboard.press("Escape");
    await clickBoardSpace(page, 1);
    await expect(page.locator(".city-card-dialog[open]")).toBeVisible();
    await page.keyboard.press("Escape");
    await clickBoardSpace(page, 4);
    await expect(
      page.locator(".city-card-dialog[open] .city-card-note"),
    ).toContainText("ni festival");
    await expect(
      page.locator(".city-card-dialog[open] .city-card-boost"),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("cash shortages have their own explanation", async ({ page }) => {
  await decisionRoom(page, 60_000);
  const house = page.locator(".construction-choice").nth(1);
  await house.focus();
  await expect(page.getByRole("tooltip")).toContainText("Pas assez d’argent");
  await expect(house).toBeDisabled();
});

test("globe and language text switch directly on click and keyboard and persist", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.locator(".language-trigger");
  await expect(trigger).toHaveText("FR");
  await expect(trigger).toHaveAccessibleName("FR · Passer en anglais");
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await expect(trigger.locator("svg")).toBeVisible();
    const help = await page
      .getByRole("button", { name: "Comment jouer", exact: true })
      .boundingBox();
    const language = await trigger.boundingBox();
    expect(language).not.toBeNull();
    expect(help).not.toBeNull();
    expect(Math.abs((language?.y ?? 0) - (help?.y ?? 0))).toBeLessThan(2);
    expect(
      (help?.x ?? 0) - ((language?.x ?? 0) + (language?.width ?? 0)),
    ).toBeLessThan(25);
    await page.screenshot({
      path: `.local/verification/language-button-${size.width}.png`,
    });
  }
  await trigger.hover();
  await expect(trigger).toHaveText("FR");
  await trigger.click();
  await expect(trigger).toHaveText("EN");
  await expect(trigger).toHaveAccessibleName("EN · Switch to French");
  await expect(trigger).toBeFocused();
  await trigger.press("Space");
  await expect(trigger).toHaveText("FR");
  await trigger.press("Enter");
  await expect(trigger).toHaveText("EN");
  await page.reload();
  await expect(trigger).toHaveText("EN");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("own and opponent cards and taxes keep readable holds and cancel on recovery", async ({
  page,
}) => {
  // Install and freeze on the empty page, before the app creates any timers.
  const clockTime = Date.now();
  await page.clock.install({ time: clockTime - 60 * 60_000 });
  await page.clock.pauseAt(clockTime);
  const room = await decisionRoom(page);
  await page.keyboard.press("Escape");
  for (const seat of [0, 1] as const) {
    room.send([{ type: "CardDrawn", seat, card: "Windfall", kept: false }]);
    await expect(page.locator(".chance-dialog[open]")).toBeVisible();
    await page.clock.runFor(4000);
    await expect(page.locator("#chance-title")).toHaveText("Bonne fortune");
    await expect(page.locator(".chance-card header")).toContainText(
      seat === 0 ? "Camille" : "Atlas",
    );
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await expect(page.locator(".chance-dialog")).toHaveCount(0);
    room.send([
      {
        type: "MoneyTransferred",
        from: seat,
        to: null,
        amount: 50_000,
        reason: "Tax",
      },
    ]);
    await expect(
      page.locator('.chance-dialog[data-moment="tax"][open]'),
    ).toBeVisible();
    await page.clock.runFor(4000);
    await expect(page.locator("#chance-title")).toHaveText(
      "Paiement des impôts",
    );
    await expect(page.locator(".chance-impact")).toContainText("50 k");
    await page.screenshot({ path: `.local/verification/tax-seat-${seat}.png` });
    await page.clock.runFor(2100);
    await expect(page.locator(".chance-dialog")).toHaveCount(0);
  }
  room.send([
    { type: "CardDrawn", seat: 1, card: "Guardian Angel", kept: true },
  ]);
  await expect(page.locator(".chance-dialog[open]")).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".chance-dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Menu pause", exact: true }).click();
  await page.getByRole("button", { name: "Réglages", exact: true }).click();
  await page
    .locator(".pause-dialog")
    .getByLabel("Langue", { exact: true })
    .selectOption("en");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  room.send([
    {
      type: "MoneyTransferred",
      from: 1,
      to: null,
      amount: 100_000,
      reason: "Tax",
    },
  ]);
  await expect(page.locator("#chance-title")).toHaveText("Tax payment");
  await expect(page.locator(".chance-impact")).toContainText("100 k");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".chance-dialog")).toHaveCount(0);
});
