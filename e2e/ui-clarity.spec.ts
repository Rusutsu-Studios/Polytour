import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { ruleEconomy } from "../src/shared/board/index.js";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  economyRule,
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

async function decisionRoom(
  page: Page,
  cash = 2_000_000,
  setup?: (state: PublicState) => PublicState,
) {
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
  const initial: PublicState = {
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
  const snapshot = setup?.(initial) ?? initial;
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
  await page.getByLabel(/Votre nom de joueur|Player name/).fill("Camille");
  await page.getByRole("button", { name: /^(Jouer|Play)$/ }).click();
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

function islandDecision(state: PublicState): PublicState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.seat === 0 ? { ...player, position: 8, onIsland: true } : player,
    ),
    pending: {
      kind: "island",
      seat: 0,
      fee: ruleEconomy(economyRule(state.config)).islandReleaseFee,
      deadline: Date.now() + 60_000,
    },
  };
}

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`Island title, art and unavailable escape card at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const room = await decisionRoom(page, 2_000_000, islandDecision);
    const dialog = page.locator('.decision-popup[data-kind="island"][open]');
    await expect(
      dialog.getByText("Quitter l’île", { exact: true }),
    ).toHaveCount(1);
    await expect(dialog.getByRole("heading")).toHaveCount(1);
    await expect(dialog.locator(".decision-island-art svg")).toBeVisible();
    await expect(dialog.locator(".city-art")).toHaveCount(0);
    await expect(dialog.locator("#decision-description")).toContainText(
      "utilisez votre carte d’évasion ou payez 200 k",
    );
    await expect(dialog.locator("#decision-description")).toContainText(
      "3 lancers ratés supplémentaires",
    );
    const escapeButton = dialog.getByRole("button", {
      name: "Utiliser la carte d’évasion",
      exact: true,
    });
    await expect(escapeButton).toBeDisabled();
    await escapeButton.hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "Vous n’avez pas de carte d’évasion",
    );
    await page.mouse.move(0, 0);
    await dialog.getByRole("heading").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(escapeButton).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText(
      "Obtenez-la sur une case Surprise",
    );
    await escapeButton.press("Enter");
    expect(room.intents).toEqual([]);
    const bounds = await dialog.boundingBox();
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
      size.height,
    );
    await page.screenshot({
      path: `.local/verification/island-escape-${size.width}.png`,
    });
  });
}

for (const scenario of [
  {
    locale: "en",
    economy: "reference",
    escapeCard: true,
    failures: 3,
    fee: "200 k",
  },
  {
    locale: "fr",
    economy: "prototype",
    escapeCard: false,
    failures: 2,
    fee: "100 k",
  },
] as const) {
  test(`Island remaining rolls and description respect ${scenario.economy} rules in ${scenario.locale}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (locale) => localStorage.setItem("polytour.locale", locale),
      scenario.locale,
    );
    const room = await decisionRoom(page, 2_000_000, (state) =>
      islandDecision({
        ...state,
        config: {
          ...state.config,
          economyRule: scenario.economy,
          escapeCard: scenario.escapeCard,
        },
      }),
    );
    const dialog = page.locator('.decision-popup[data-kind="island"][open]');
    const description = dialog.locator("#decision-description");
    const choices = dialog.locator(".decision-other-choices");
    await expect(choices.getByRole("button")).toHaveCount(3);
    await expect(
      choices.getByRole("button", {
        name:
          scenario.locale === "en"
            ? "Use the escape card"
            : "Utiliser la carte d’évasion",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(description).toContainText(scenario.fee);
    for (let failed = 0; failed < scenario.failures; failed++) {
      if (failed > 0)
        room.send([
          { type: "IslandEscapeFailed", seat: 0, islandTurns: failed },
        ]);
      const remaining = scenario.failures - failed;
      await expect(description).toContainText(
        scenario.locale === "en"
          ? `${remaining} more failed roll${remaining === 1 ? "" : "s"}`
          : `${remaining} lancer${remaining === 1 ? "" : "s"} raté${remaining === 1 ? "" : "s"} supplémentaire${remaining === 1 ? "" : "s"}`,
      );
    }
    await page.keyboard.press("Escape");
    await clickBoardSpace(page, 8);
    const rule = page.locator(".city-card .tile-rule");
    await expect(rule).toContainText(scenario.fee);
    if (scenario.escapeCard) {
      await expect(rule).toContainText("use your escape card");
      await expect(rule).toContainText("3 failed rolls");
    } else {
      await expect(rule).not.toContainText("carte d’évasion");
      await expect(rule).toContainText("2 lancers ratés");
    }
  });
}

test("a drawn escape card explains its use and becomes available on the Island", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("polytour.locale", "en"));
  const room = await decisionRoom(page);
  room.send([
    { type: "CardDrawn", seat: 0, card: "Escape", kept: true },
    { type: "SentToIsland", seat: 0, reason: "card" },
    {
      type: "DecisionOpened",
      pending: {
        kind: "island",
        seat: 0,
        fee: 100_000,
        deadline: Date.now() + 60_000,
      },
    },
  ]);
  await expect(page.locator("#chance-title")).toHaveText("Escape card");
  await expect(page.locator("#chance-description")).toContainText(
    "At the start of one of your turns on the Island",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const dialog = page.locator('.decision-popup[data-kind="island"][open]');
  await expect(dialog.getByRole("heading")).toHaveText("Leave the Island");
  const escapeButton = dialog
    .getByRole("group", { name: "Choose how to leave the Island" })
    .getByRole("button", {
      name: "Use the escape card",
      exact: true,
    });
  await expect(escapeButton).toBeEnabled();
  await escapeButton.click();
  await expect(escapeButton).toHaveAttribute("aria-pressed", "true");
  const confirm = dialog.locator(".decision-confirm");
  await expect(confirm).toHaveText("Use the escape card");
  await confirm.click();
  expect(room.intents).toHaveLength(1);
  expect(JSON.parse(room.intents[0]).action).toEqual({ type: "UseEscapeCard" });
});

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
  await page.clock.install();
  const room = await decisionRoom(page);
  await page.keyboard.press("Escape");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
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
