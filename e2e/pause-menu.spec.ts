import {
  expect,
  type Locator,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  type GameEvent,
  type PublicState,
  type Seat,
  toPublic,
} from "../src/shared/engine/index.js";
import {
  RoomConfigSchema,
  type ServerMessage,
} from "../src/shared/protocol/index.js";
import type { WorkerDiagnostics } from "../src/shared/protocol/worker-diagnostics.js";

test.use({ reducedMotion: "reduce" });

const CLOUDFLARE_HEALTH = {
  status: "ok",
  diagnostics: {
    worker: "polytour",
    hostname: "test.polytour.example",
    runtime: "cloudflare",
    cloudflare: {
      colo: "FRA",
      location: "Frankfurt, Germany",
      region: "Europe",
    },
  },
} satisfies { status: "ok"; diagnostics: WorkerDiagnostics };

function diagnosticValue(panel: Locator, label: string) {
  return panel.getByText(label, { exact: true }).locator("..").locator("dd");
}

/** Deterministic authoritative frames; no room or gameplay action is sent to the Worker. */
async function enterMatch(page: Page) {
  const now = Date.now();
  const initial = toPublic(
    createGame(
      {
        ...DEFAULT_GAME_CONFIG,
        gameId: "pause-menu-fixture",
        decisionSeconds: 60,
      },
      [0, 1, 2, 3].map((seat) => ({
        playerId: `fixture-player-${seat}`,
        name: ["Camille", "Milo", "Sora", "Atlas"][seat],
        control: seat === 0 ? ("human" as const) : ("bot" as const),
        seat: seat as Seat,
      })),
      35,
      { now },
    ).state,
  );
  const snapshot: PublicState = {
    ...initial,
    activeSeat: 0,
    pending: { kind: "roll", seat: 0, deadline: now + 60_000 },
  };
  let socket: WebSocketRoute | undefined;
  let connections = 0;
  let sequence = 0;
  const messages: string[] = [];
  await page.route("**/api/rooms", (route) =>
    route.fulfill({
      status: 201,
      json: {
        roomCode: "ABCD35",
        seat: 0,
        token: "pause-menu-test-capability-not-real",
      },
    }),
  );
  await page.routeWebSocket("**/ws/room/**", (ws) => {
    socket = ws;
    connections += 1;
    ws.onMessage((raw) => {
      messages.push(String(raw));
      if ((JSON.parse(String(raw)) as { type: string }).type === "sync") {
        const welcome: ServerMessage = {
          type: "welcome",
          protocolVersion: 1,
          you: { seat: 0 },
          seq: sequence,
          snapshot,
          randomness: null,
          lobby: {
            roomCode: "ABCD35",
            hostSeat: 0,
            status: "playing",
            config: RoomConfigSchema.parse({ decisionSeconds: 60 }),
            seats: snapshot.players.map((player) => ({
              seat: player.seat,
              name: player.name,
              control: player.control,
              online: player.seat === 0,
            })),
          },
        };
        ws.send(JSON.stringify(welcome));
      }
    });
  });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Camille");
  await page.getByRole("button", { name: "Jouer avec 3 bots" }).click();
  await expect(page.locator(".player-card")).toHaveCount(4);
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-scene-ready",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Lancer les dés", exact: true }),
  ).toBeEnabled();
  return {
    snapshot,
    messages,
    connections: () => connections,
    send(events: GameEvent[]) {
      if (!socket) throw new Error("Expected an open match socket");
      const fromSeq = sequence + 1;
      sequence += events.length;
      socket.send(
        JSON.stringify({ type: "events", fromSeq, toSeq: sequence, events }),
      );
    },
  };
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Menu pause", exact: true }).click();
  await page.getByRole("button", { name: "Réglages", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Jeu", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

test("pause keeps the clock and authoritative updates running without losing modal focus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const match = await enterMatch(page);
  await page.getByRole("button", { name: "Menu pause", exact: true }).click();
  const modal = page.locator(".pause-dialog");
  const continueButton = modal.getByRole("button", {
    name: "Continuer",
    exact: true,
  });
  await expect(modal).toBeVisible();
  await expect(continueButton).toBeFocused();
  await page.screenshot({ path: ".local/verification/pause-menu.png" });
  const previousTime = await page.locator(".match-clock").innerText();
  await expect
    .poll(() => page.locator(".match-clock").innerText())
    .not.toBe(previousTime);
  match.send([
    { type: "CardDrawn", seat: 0, card: "Windfall", kept: false },
    {
      type: "MoneyTransferred",
      from: null,
      to: 0,
      amount: 150_000,
      reason: "Windfall",
    },
    {
      type: "DecisionOpened",
      pending: {
        kind: "buy",
        seat: 0,
        tile: 1,
        maxLevel: 3,
        deadline: Date.now() + 60_000,
      },
    },
  ]);
  await expect(page.locator(".chance-dialog[open]")).toHaveCount(0);
  await expect(page.locator(".decision-popup[open]")).toHaveCount(0);
  await expect(continueButton).toBeFocused();
  await expect(
    page.locator('.player-card[data-seat="0"] .player-cash'),
  ).toContainText("2,15 M");
  await expect(continueButton).toBeFocused();
  await continueButton.click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".decision-popup[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Menu pause", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Menu pause", exact: true }),
  ).toBeFocused();
  expect(match.connections()).toBe(1);
  expect(
    match.messages.map((raw) => (JSON.parse(raw) as { type: string }).type),
  ).toEqual(["sync"]);
  expect(errors).toEqual([]);
});

test("settings tabs stay local, keyboard navigation and desktop layouts remain usable", async ({
  page,
}) => {
  let healthRequests = 0;
  await page.route("**/api/health**", (route) => {
    healthRequests += 1;
    return route.fulfill({ json: { status: "ok" } });
  });
  const match = await enterMatch(page);
  const roomCredentials = await page.evaluate(() =>
    sessionStorage.getItem("polytour-room-v1"),
  );
  await openSettings(page);
  const game = page.getByRole("tab", { name: "Jeu", exact: true });
  await game.focus();
  await game.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Vidéo", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Vidéo", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Réduire les animations")).toBeChecked();
  await page.getByLabel("Réduire les animations").uncheck();
  await expect(page.getByLabel("Réduire les animations")).not.toBeChecked();
  await page.getByLabel("Réduire les animations").check();
  await page
    .getByRole("button", { name: "Zoomer le plateau", exact: true })
    .click();
  await page.getByRole("button", { name: "Recentrer", exact: true }).click();
  await expect(page.getByLabel("Vitesse des animations")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Terminer l’animation|Passer l’animation/,
    }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("Bientôt disponible");
  await expect(panel.getByRole("slider")).toHaveCount(0);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
    const layout = await page.locator(".pause-dialog").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(viewport.width);
    expect(layout.bottom).toBeLessThanOrEqual(viewport.height);
    expect(layout.scrollWidth).toBe(viewport.width);
    expect(layout.scrollHeight).toBe(viewport.height);
    await page.screenshot({
      path: `.local/verification/pause-settings-${viewport.width}.png`,
    });
  }
  await game.click();
  await page
    .locator(".pause-dialog")
    .getByLabel("Langue", { exact: true })
    .selectOption("en");
  await expect(
    page.getByRole("tab", { name: "Game", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tab", { name: "Video", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Debug", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page
      .locator(".pause-dialog")
      .getByRole("button", { name: "Settings", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Pause menu", exact: true }),
  ).toBeFocused();
  expect(match.connections()).toBe(1);
  expect(healthRequests).toBe(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBe(roomCredentials);
});

test("Cloudflare HTTP ping runs only in Debug, handles failure, and aborts on timeout or exit", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let aborts = 0;
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/health")) {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborts += 1;
            document.documentElement.dataset.debugPingAborts = String(aborts);
          },
          { once: true },
        );
      }
      return originalFetch(input, init);
    };
  });
  let requests = 0;
  const healthURLs: string[] = [];
  await page.route("**/api/health**", (route) => {
    requests += 1;
    healthURLs.push(route.request().url());
    if (requests === 1) return route.fulfill({ json: CLOUDFLARE_HEALTH });
    if (requests === 2)
      return route.fulfill({
        status: 503,
        json: { error: "fixture-unavailable" },
      });
    // Later measurements wait for the browser's timeout or tab cleanup to abort.
  });
  const match = await enterMatch(page);
  const frozenAt = Date.now();
  await page.clock.install({ time: frozenAt });
  await page.clock.pauseAt(frozenAt + 1000);
  await openSettings(page);
  await page.clock.runFor(30_000);
  expect(requests).toBe(0);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const debugPanel = page.locator(".pause-debug");
  const status = debugPanel.getByRole("status");
  await expect(status).toHaveText(/^\d+ ms$/);
  expect(new URL(healthURLs[0]).searchParams.get("debug")).toBe("1");
  await expect(debugPanel).toHaveAttribute("data-runtime", "cloudflare");
  await expect(debugPanel).toContainText("Ping Worker (HTTP)");
  await expect(
    diagnosticValue(debugPanel, "Point d’entrée Cloudflare"),
  ).toContainText("FRA");
  await expect(
    diagnosticValue(debugPanel, "Point d’entrée Cloudflare"),
  ).toContainText("Frankfurt, Germany");
  await expect(diagnosticValue(debugPanel, "Région")).toHaveText("Europe");
  await expect(diagnosticValue(debugPanel, "Worker")).toHaveText("polytour");
  await expect(diagnosticValue(debugPanel, "Hôte")).toHaveText(
    "test.polytour.example",
  );
  await expect(
    diagnosticValue(debugPanel, "Connexion de la partie"),
  ).toHaveText("Connectée");
  await page.screenshot({ path: ".local/verification/pause-debug.png" });
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    // Resizing clears the WebGL buffer; let the paused animation clock redraw it.
    await page.clock.runFor(250);
    const layout = await page.locator(".pause-dialog").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const body = element.querySelector(".pause-dialog-body");
      return {
        left: rect.left,
        right: rect.right,
        width: document.documentElement.scrollWidth,
        bodyWidth: body?.clientWidth,
        bodyScrollWidth: body?.scrollWidth,
      };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(viewport.width);
    expect(layout.width).toBe(viewport.width);
    expect(layout.bodyScrollWidth).toBe(layout.bodyWidth);
    await page.screenshot({
      path: `.local/verification/pause-debug-${viewport.width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.runFor(10_000);
  await expect(status).toHaveText("Indisponible");
  expect(requests).toBe(2);
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  await page.clock.runFor(30_000);
  expect(requests).toBe(2);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect(status).toHaveText("Mesure en cours…");
  await expect.poll(() => requests).toBe(3);
  await page.clock.runFor(5000);
  await expect(status).toHaveText("Indisponible");
  await expect(page.locator("html")).toHaveAttribute(
    "data-debug-ping-aborts",
    "1",
  );
  await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect.poll(() => requests).toBe(4);
  await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-debug-ping-aborts",
    "2",
  );
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect.poll(() => requests).toBe(5);
  await page
    .getByRole("button", { name: "Revenir au plateau", exact: true })
    .click();
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-debug-ping-aborts",
    "3",
  );
  await page.clock.runFor(30_000);
  expect(requests).toBe(5);
  expect(match.connections()).toBe(1);
});

test("Cloudflare diagnostics translate and distinguish local or older health responses", async ({
  page,
}) => {
  let healthResponse: unknown = CLOUDFLARE_HEALTH;
  const requests: string[] = [];
  await page.route("**/api/health**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ json: healthResponse });
  });
  const match = await enterMatch(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const panel = page.locator(".pause-debug");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  await expect(
    diagnosticValue(panel, "Point d’entrée Cloudflare"),
  ).toContainText("FRA");
  await expect(diagnosticValue(panel, "Région")).toHaveText("Europe");
  await page.getByRole("tab", { name: "Jeu", exact: true }).click();
  await page
    .locator(".pause-dialog")
    .getByLabel("Langue", { exact: true })
    .selectOption("en");
  await page.getByRole("tab", { name: "Debug", exact: true }).click();
  await expect(panel).toHaveAttribute("data-runtime", "cloudflare");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  await expect(diagnosticValue(panel, "Cloudflare entry point")).toContainText(
    "FRA",
  );
  await expect(diagnosticValue(panel, "Cloudflare entry point")).toContainText(
    "Frankfurt, Germany",
  );
  await expect(diagnosticValue(panel, "Region")).toHaveText("Europe");
  await expect(diagnosticValue(panel, "Worker")).toHaveText("polytour");
  await expect(diagnosticValue(panel, "Host")).toHaveText(
    "test.polytour.example",
  );
  healthResponse = {
    status: "ok",
    diagnostics: {
      worker: "polytour",
      hostname: "127.0.0.1",
      runtime: "local",
      cloudflare: null,
    },
  };
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await page.getByRole("tab", { name: "Debug", exact: true }).click();
  await expect(panel).toHaveAttribute("data-runtime", "local");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  await expect(diagnosticValue(panel, "Cloudflare entry point")).toHaveText(
    "Local",
  );
  await expect(diagnosticValue(panel, "Region")).toHaveText("Unavailable");
  await expect(diagnosticValue(panel, "Host")).toHaveText("127.0.0.1");
  await expect(panel).not.toContainText("FRA");
  await expect(panel).not.toContainText("Frankfurt");
  healthResponse = { status: "ok" };
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await page.getByRole("tab", { name: "Debug", exact: true }).click();
  await expect(panel).toHaveAttribute("data-runtime", "unknown");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  for (const label of ["Cloudflare entry point", "Region", "Worker", "Host"])
    await expect(diagnosticValue(panel, label)).toHaveText("Unavailable");
  await expect(panel).not.toContainText("FRA");
  await expect(panel).not.toContainText("127.0.0.1");
  expect(requests.length).toBeGreaterThanOrEqual(4);
  for (const url of requests)
    expect(new URL(url).searchParams.get("debug")).toBe("1");
  expect(match.connections()).toBe(1);
});

test("the rules icon is read only, invitations stay separate, and leaving needs confirmation", async ({
  page,
}) => {
  const match = await enterMatch(page);
  await page
    .getByRole("button", { name: "Réglages de la partie", exact: true })
    .click();
  await expect(page.locator(".match-rules")).toContainText(
    "Les réglages sont fixés pour toute la durée de cette partie.",
  );
  const controls = page.locator(".match-rules").locator("input, select");
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all())
    await expect(control).toBeDisabled();
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Réglages de la partie", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Inviter des joueurs", exact: true })
    .click();
  await expect(page.locator(".room-tool")).toContainText("ABCD35");
  await expect(page.locator(".room-tool").locator("input, select")).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Menu pause", exact: true }).click();
  await page.getByRole("button", { name: "Quitter", exact: true }).click();
  await expect(page.locator(".pause-dialog").getByRole("heading")).toHaveText(
    "Quitter la partie ?",
  );
  await expect(
    page.getByRole("button", { name: "Rester dans la partie", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page
      .locator(".pause-dialog")
      .getByRole("button", { name: "Quitter", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Quitter", exact: true }).click();
  await page
    .getByRole("button", { name: "Rester dans la partie", exact: true })
    .click();
  await expect(page.locator(".pause-dialog").getByRole("heading")).toHaveText(
    "Menu pause",
  );
  await page.getByRole("button", { name: "Quitter", exact: true }).click();
  await page
    .getByRole("button", { name: "Quitter la partie", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Jouer avec 3 bots" }),
  ).toBeVisible();
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBeNull();
  expect(match.connections()).toBe(1);
  expect(
    match.messages.map((raw) => (JSON.parse(raw) as { type: string }).type),
  ).toEqual(["sync"]);
});
