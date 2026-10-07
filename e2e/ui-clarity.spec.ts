import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { ruleEconomy } from "../src/shared/board/index.js";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  economyRule,
  type GameEvent,
  type PublicState,
  type SeatInfo,
  toPublic,
} from "../src/shared/engine/index.js";
import {
  PROTOCOL_VERSION,
  RoomConfigSchema,
  type ServerMessage,
} from "../src/shared/protocol/index.js";
import { clickBoardSpace } from "./board-interactions.js";
import { DESKTOP_SIZES } from "./desktop-sizes.js";

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
  names = ["Camille", "Atlas"],
) {
  const now = Date.now();
  const base = toPublic(
    createGame(
      { ...DEFAULT_GAME_CONFIG, decisionSeconds: 60, festivalCount: 0 },
      names.map(
        (name, seat): SeatInfo => ({
          playerId: `ui-test-${seat}`,
          name,
          control: seat === 0 ? "human" : "bot",
        }),
      ),
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
  await page.getByLabel(/Votre nom de joueur|Player name/).fill(names[0]);
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

for (const locale of ["fr", "en"] as const) {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    test(`held cards use current art and fit every HUD in ${locale} at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.addInitScript((language) => {
        localStorage.setItem("polytour.locale", language);
      }, locale);
      const missingImages: string[] = [];
      page.on("response", (response) => {
        if (response.url().includes("/cards/") && response.status() >= 400)
          missingImages.push(response.url());
      });
      await decisionRoom(
        page,
        2_000_000,
        (state) => ({
          ...state,
          players: state.players.map((player) => ({
            ...player,
            heldCards: ["Guardian Angel", "Coupon", "Escape"],
          })),
          properties: state.properties.map((property) =>
            property.tile === 1
              ? { ...property, owner: 0, level: 0 }
              : property,
          ),
        }),
        ["Camille", "Atlas", "Noémie", "Bo"],
      );
      await page.keyboard.press("Escape");
      await expect(page.locator("main")).toHaveAttribute(
        "data-reduced-motion",
        "true",
      );
      await expect(page.locator(".held-mini")).toHaveCount(12);
      await expect(page.locator(".player-held-cards")).toHaveText([
        "×3",
        "×3",
        "×3",
        "×3",
      ]);
      const titles =
        locale === "fr"
          ? ["Ange gardien", "Bon de réduction", "Carte d’évasion"]
          : ["Guardian angel", "Rent coupon", "Escape card"];
      for (const hud of await page.locator(".player-card").all()) {
        for (const [index, chip] of (
          await hud.locator(".held-mini").all()
        ).entries()) {
          await chip.focus();
          const preview = page.getByRole("tooltip");
          await expect(preview).toBeVisible();
          await expect(preview.locator("strong")).toHaveText(titles[index]);
          await expect(preview.locator("svg")).toBeVisible();
          await expect(preview.locator("img")).toHaveCount(0);
          const bounds = await preview.boundingBox();
          expect(bounds).not.toBeNull();
          if (!bounds) throw new Error("Expected held-card preview bounds");
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
          await chip.press("Escape");
          await expect(preview).not.toBeVisible();
          await expect(chip).toBeFocused();
        }
      }
      const top = page.locator(
        '.player-card[data-seat="1"] .held-mini[data-card="Escape"]',
      );
      await top.hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await page.screenshot({
        path: `.local/verification/held-cards-${locale}-${size.width}.png`,
      });
      expect(missingImages).toEqual([]);
    });
  }
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
    await expect(dialog.locator("svg.decision-island-art")).toBeVisible();
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
    "Keep it: leave the Island for free.",
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

for (const size of DESKTOP_SIZES.slice(0, 3)) {
  test(`a city beyond the player's cash says so at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const room = await decisionRoom(page, 40_000);
    const dialog = page.locator('.decision-popup[data-kind="buy"][open]');
    await expect(dialog).toHaveAttribute("data-short", "true");
    const notice = dialog.locator(".decision-shortfall");
    await expect(notice).toContainText("Pas assez d’argent");
    await expect(notice).toContainText("Le terrain coûte 60 k");
    await expect(notice).toContainText("il vous reste 40 k");
    await expect(dialog.locator(".decision-preview-name")).toHaveText(
      "Terrain",
    );
    await expect(dialog.locator(".ledger-main dd")).toHaveText("60 k");
    await expect(dialog.locator(".ledger-balance dd")).toHaveText("20 k");
    // Every level stays visible and locked; none of them can be confirmed.
    await expect(dialog.locator(".construction-choice")).toHaveCount(5);
    await expect(
      dialog.locator('.construction-choice:not([data-locked="true"])'),
    ).toHaveCount(0);
    const confirm = dialog.locator(".decision-confirm");
    await expect(confirm).toHaveText("Passer");
    await expect(confirm).toBeEnabled();
    const bounds = await dialog.boundingBox();
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
      size.height,
    );
    await page.screenshot({
      path: `.local/verification/buy-shortfall-${size.width}.png`,
    });
    await confirm.click();
    expect(room.intents).toHaveLength(1);
    expect(JSON.parse(room.intents[0]).action).toEqual({ type: "Decline" });
  });
}

test("an unaffordable beach keeps a card with its price", async ({ page }) => {
  const room = await decisionRoom(page, 150_000, (state) => ({
    ...state,
    players: state.players.map((player) =>
      player.seat === 0 ? { ...player, position: 4 } : player,
    ),
    pending: {
      kind: "buy",
      seat: 0,
      tile: 4,
      maxLevel: 0,
      deadline: Date.now() + 60_000,
    },
  }));
  const dialog = page.locator('.decision-popup[data-kind="buy"][open]');
  await expect(dialog).toHaveAttribute("data-short", "true");
  await expect(dialog.locator(".construction-choice")).toHaveCount(0);
  await expect(dialog.locator(".decision-shortfall")).toContainText(
    "Cette plage coûte 200 k",
  );
  await expect(dialog.locator(".decision-preview-name")).toHaveText("Plage");
  await expect(dialog.locator(".ledger-balance dd")).toHaveText("50 k");
  const confirm = dialog.locator(".decision-confirm");
  await expect(confirm).toHaveText("Passer");
  await page.screenshot({ path: ".local/verification/beach-shortfall.png" });
  await confirm.click();
  expect(room.intents).toHaveLength(1);
  expect(JSON.parse(room.intents[0]).action).toEqual({ type: "Decline" });
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`optional game log stays above the lower-left player at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const room = await decisionRoom(page);
    await page.keyboard.press("Escape");
    const trigger = page.getByRole("button", {
      name: "Carnet de voyage",
      exact: true,
    });
    const journal = page.locator(".tool-drawer--journal");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(journal).toHaveCount(0);
    await expect(page.locator(".match-caption")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /Explorer le plateau|Explore the board|Rechercher|Search/,
      }),
    ).toHaveCount(0);

    await trigger.focus();
    await trigger.press("Enter");
    await expect(journal).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const close = journal.getByRole("button", {
      name: "Fermer les outils",
      exact: true,
    });
    await expect(close).toBeFocused();
    await expect(journal).toContainText("Lancez les dés pour commencer.");

    room.send(
      Array.from({ length: 45 }, (_, index) => ({
        type: "MoneyTransferred" as const,
        from: null,
        to: 0 as const,
        amount: (index + 1) * 1000,
        reason: "Fixture",
      })),
    );
    const rows = journal.locator("li");
    await expect(rows).toHaveCount(40);
    await expect(rows.first()).toHaveText("La banque verse 45 k à Camille");
    await expect(rows.last()).toHaveText("La banque verse 6 k à Camille");
    const box = await journal.boundingBox();
    const player = await page
      .locator('.player-card[data-seat="0"]')
      .boundingBox();
    expect(box).not.toBeNull();
    expect(player).not.toBeNull();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(Math.abs((box?.x ?? 0) - (player?.x ?? 0))).toBeLessThan(3);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThan(size.width / 2);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(player?.y ?? 0);
    expect(box?.height).toBeLessThan(size.height / 2);
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last()).toBeInViewport();
    expect(
      await journal
        .locator(".journal")
        .evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    room.send([
      {
        type: "MoneyTransferred",
        from: null,
        to: 0,
        amount: 46_000,
        reason: "Fixture",
      },
    ]);
    await expect(rows).toHaveCount(40);
    await expect(rows.first()).toHaveText("La banque verse 46 k à Camille");
    await rows.first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.local/verification/game-log-${size.width}.png`,
    });

    await page.keyboard.press("Escape");
    await expect(journal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Space");
    await expect(journal).toBeVisible();
    await trigger.focus();
    await trigger.press("Space");
    await expect(journal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await close.click();
    await expect(journal).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.getByRole("button", { name: "Menu pause", exact: true }).click();
    await page.getByRole("button", { name: "Réglages", exact: true }).click();
    await page
      .locator(".pause-dialog")
      .getByLabel("Langue", { exact: true })
      .selectOption("en");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Game log", exact: true }).click();
    await expect(journal.getByRole("heading")).toHaveText("Game log");
    await expect(rows.first()).toHaveText("The bank pays 46 k to Camille");
    await journal
      .getByRole("button", { name: "Close tools", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Game log", exact: true }),
    ).toBeFocused();
  });
}

for (const locale of ["fr", "en"] as const) {
  test(`game log uses action icons, dice totals and seat colors in ${locale}`, async ({
    page,
  }) => {
    const names = ["Test", "Nova", "Nova", "<b>Nova</b> & Test"];
    const room = await decisionRoom(page, 2_000_000, undefined, names);
    await page.keyboard.press("Escape");
    if (locale === "en") {
      await page
        .getByRole("button", { name: "Menu pause", exact: true })
        .click();
      await page.getByRole("button", { name: "Réglages", exact: true }).click();
      await page
        .locator(".pause-dialog")
        .getByLabel("Langue", { exact: true })
        .selectOption("en");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }
    await page
      .getByRole("button", {
        name: locale === "fr" ? "Carnet de voyage" : "Game log",
        exact: true,
      })
      .click();
    room.send([
      {
        type: "DiceRolled",
        seat: 0,
        dice: [4, 5],
        isDouble: false,
        purpose: "move",
      },
      {
        type: "DiceRolled",
        seat: 2,
        dice: [5, 5],
        isDouble: true,
        purpose: "move",
      },
      { type: "PropertyBought", seat: 1, tile: 1, level: 0, amount: 60_000 },
      { type: "SalaryPaid", seat: 3, amount: 400_000, cash: 2_400_000 },
      {
        type: "MoneyTransferred",
        from: null,
        to: 1,
        amount: 30_000,
        reason: "Fixture",
      },
      {
        type: "MoneyTransferred",
        from: 2,
        to: 0,
        amount: 10_000,
        reason: "Fixture",
      },
      { type: "RentPaid", seat: 2, owner: 0, tile: 1, amount: 20_000 },
    ]);
    const rows = page.locator(".tool-drawer--journal li");
    await expect(rows).toHaveCount(7);
    const ordinary = rows.filter({ hasText: "4 + 5 = 9" });
    const double = rows.filter({ hasText: "5 + 5 = 10" });
    await expect(ordinary).toHaveCount(1);
    await expect(double).toHaveCount(1);
    await expect(double).toContainText(
      locale === "fr" ? "· Double !" : "· Doubles!",
    );
    await expect(ordinary.locator('svg[data-icon="dice"]')).toHaveCount(1);
    await expect(double.locator('svg[data-icon="dice"]')).toHaveCount(1);
    await expect(
      rows.filter({ hasText: "60 k" }).locator('svg[data-icon="buy"]'),
    ).toHaveCount(1);
    await expect(
      rows.filter({ hasText: "400 k" }).locator('svg[data-icon="bank"]'),
    ).toHaveCount(1);
    const bankPayment = rows.filter({ hasText: "30 k" });
    await expect(bankPayment.locator('svg[data-icon="bank"]')).toHaveCount(1);
    await expect(bankPayment.locator(".journal-player")).toHaveCount(1);
    await expect(bankPayment.locator(".journal-player")).toHaveAttribute(
      "data-seat",
      "1",
    );
    for (const amount of ["10 k", "20 k"]) {
      const payment = rows.filter({ hasText: amount });
      await expect(payment.locator('svg[data-icon="people"]')).toHaveCount(1);
      await expect(payment.locator(".journal-player")).toHaveText([
        "Nova",
        "Test",
      ]);
      expect(
        await payment
          .locator(".journal-player")
          .evaluateAll((players) =>
            players.map((player) => player.getAttribute("data-seat")),
          ),
      ).toEqual(["2", "0"]);
    }
    await expect(rows.locator("svg")).toHaveCount(7);
    for (const icon of await rows.locator("svg").all())
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    for (const [seat, color] of [
      [0, "rgb(190, 61, 36)"],
      [1, "rgb(35, 108, 206)"],
      [2, "rgb(129, 81, 181)"],
      [3, "rgb(38, 118, 76)"],
    ] as const) {
      const players = rows.locator(`.journal-player[data-seat="${seat}"]`);
      await expect(players.first()).toHaveText(names[seat]);
      for (const player of await players.all())
        await expect(player).toHaveCSS("color", color);
    }
    // Duplicate and embedded names keep their seat identity; markup stays text.
    await expect(
      rows.filter({ hasText: "60 k" }).locator(".journal-player"),
    ).toHaveAttribute("data-seat", "1");
    await expect(
      rows.filter({ hasText: "400 k" }).locator(".journal-player"),
    ).toHaveCount(1);
    await expect(rows.locator(".journal-player b")).toHaveCount(0);
    await page.screenshot({
      path: `.local/verification/game-log-actions-${locale}.png`,
    });
  });
}

test("the lobby settings gear groups personal controls and restores keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.locator(".personal-settings-trigger");
  await expect(trigger).toHaveAccessibleName("Réglages");
  await expect(trigger).toHaveText("Réglages");
  await expect(page.locator(".language-trigger")).toHaveCount(0);
  await expect(page.locator(".topbar-right .graphics-quality")).toHaveCount(0);
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await expect(trigger.locator("svg")).toBeVisible();
    await expect(trigger.locator("svg + span")).toBeVisible();
    const help = await page
      .getByRole("button", { name: "Comment jouer", exact: true })
      .boundingBox();
    const settings = await trigger.boundingBox();
    expect(settings).not.toBeNull();
    expect(help).not.toBeNull();
    expect(
      Math.abs(
        (settings?.y ?? 0) +
          (settings?.height ?? 0) / 2 -
          ((help?.y ?? 0) + (help?.height ?? 0) / 2),
      ),
    ).toBeLessThan(2);
    await page.screenshot({
      path: `.local/verification/settings-button-${size.width}.png`,
    });
  }
  await trigger.press("Enter");
  await page
    .locator(".pause-dialog")
    .getByLabel("Langue", { exact: true })
    .selectOption("en");
  await expect(
    page.getByRole("tab", { name: "Video", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAccessibleName("Settings");
  await expect(trigger).toHaveText("Settings");
  await expect(trigger.locator("svg + span")).toBeVisible();
  for (const viewport of DESKTOP_SIZES.slice(0, 3)) {
    await page.setViewportSize(viewport);
    await expect(trigger.locator("svg + span")).toBeVisible();
    await page.screenshot({
      path: `.local/verification/settings-button-en-${viewport.width}.png`,
    });
  }
  await page.reload();
  await expect(trigger).toHaveAccessibleName("Settings");
  await expect(trigger).toHaveText("Settings");
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
