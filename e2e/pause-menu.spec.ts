import {
  expect,
  type Locator,
  type Page,
  type Route,
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

test.use({ reducedMotion: "reduce" });

type ProbeResponse = NonNullable<Parameters<Route["fulfill"]>[0]>;
const PROBE_BODY = "polytour-connection-probe-v1";
const FRANKFURT_PROBE = {
  status: 200,
  contentType: "text/plain",
  body: PROBE_BODY,
  headers: { "cf-ray": "0123456789abcdef-FRA" },
} satisfies ProbeResponse;
const ZURICH_PROBE = {
  ...FRANKFURT_PROBE,
  headers: { "cf-ray": "fedcba9876543210-ZRH" },
} satisfies ProbeResponse;

const workerHealthRequests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const requests: string[] = [];
  workerHealthRequests.set(page, requests);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/health")
      requests.push(request.url());
  });
  await page.route("**/api/health**", (route) => route.abort());
});
test.afterEach(async ({ page }) => {
  expect(workerHealthRequests.get(page)).toEqual([]);
});

function diagnosticValue(panel: Locator, label: string) {
  return panel.getByText(label, { exact: true }).locator("..").locator("dd");
}

async function expectSharedPing(panel: Locator, point: string) {
  // Both views can refresh between independent DOM reads. Compare one render.
  await expect
    .poll(() =>
      panel.evaluate((element, entry) => {
        const latency = element.querySelector('[role="status"]')?.textContent;
        return (
          /^\d+ ms$/.test(latency ?? "") &&
          document.querySelector(".match-network")?.textContent ===
            `${entry} · ${latency}`
        );
      }, point),
    )
    .toBe(true);
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
    async disconnect() {
      if (!socket) throw new Error("Expected an open match socket");
      await socket.close({ code: 1011, reason: "Fixture reconnect" });
    },
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

async function freezeClock(page: Page) {
  const frozenAt = Date.now();
  await page.clock.install({ time: frozenAt });
  await page.clock.pauseAt(frozenAt + 1000);
}

async function setBrowserOnline(page: Page, online: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value });
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  }, online);
}

async function setDocumentVisibility(page: Page, visible: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: !value,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: value ? "visible" : "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visible);
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
  let probeRequests = 0;
  await page.route("**/connection-probe.txt**", (route) => {
    probeRequests += 1;
    return route.fulfill(FRANKFURT_PROBE);
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
  expect(probeRequests).toBe(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBe(roomCredentials);
});

test("Cloudflare HTTP ping refreshes each second only in Debug and aborts when leaving", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let aborts = 0;
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/connection-probe.txt")) {
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
  const probeURLs: string[] = [];
  await page.route("**/connection-probe.txt**", (route) => {
    requests += 1;
    probeURLs.push(route.request().url());
    if (requests === 1) return route.fulfill(FRANKFURT_PROBE);
    if (requests === 2)
      return route.fulfill({
        status: 503,
        body: "fixture-unavailable",
      });
    // Later measurements wait for the browser's timeout or tab cleanup to abort.
  });
  const match = await enterMatch(page);
  await freezeClock(page);
  await openSettings(page);
  await page.clock.runFor(30_000);
  expect(requests).toBe(0);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const debugPanel = page.locator(".pause-debug");
  const status = debugPanel.getByRole("status");
  await expect(status).toHaveText(/^\d+ ms$/);
  await expectSharedPing(debugPanel, "FRA");
  expect(new URL(probeURLs[0]).pathname).toBe("/connection-probe.txt");
  await expect(debugPanel).toHaveAttribute("data-runtime", "cloudflare");
  await expect(debugPanel).toContainText("Ping Cloudflare");
  await expect(
    diagnosticValue(debugPanel, "Point d’entrée Cloudflare"),
  ).toContainText("FRA");
  await expect(
    diagnosticValue(debugPanel, "Point d’entrée Cloudflare"),
  ).toContainText("Frankfurt, Germany");
  await expect(diagnosticValue(debugPanel, "Région")).toHaveText("Europe");
  await expect(diagnosticValue(debugPanel, "Service de jeu")).toHaveText(
    "polytour",
  );
  await expect(diagnosticValue(debugPanel, "Hôte")).toHaveText("127.0.0.1");
  await expect(
    diagnosticValue(debugPanel, "Connexion de la partie"),
  ).toHaveText("Connectée");
  await page.screenshot({ path: ".local/verification/pause-debug.png" });
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
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
  await page.clock.runFor(1000);
  await expect(status).toHaveText("Indisponible");
  expect(requests).toBe(2);
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  await page.clock.runFor(30_000);
  expect(requests).toBe(2);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect(status).toHaveText("Mesure en cours…");
  await expect.poll(() => requests).toBe(3);
  await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-debug-ping-aborts",
    "1",
  );
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

test("Debug immediately refreshes the Cloudflare entry after online or network changes and sleeps while hidden", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: new EventTarget(),
    });
  });
  let response: ProbeResponse = FRANKFURT_PROBE;
  let requests = 0;
  await page.route("**/connection-probe.txt**", (route) => {
    requests += 1;
    return route.fulfill(response);
  });
  const match = await enterMatch(page);
  await freezeClock(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const panel = page.locator(".pause-debug");
  const entry = diagnosticValue(panel, "Point d’entrée Cloudflare");
  await expect(entry).toContainText("FRA");
  await expectSharedPing(panel, "FRA");
  expect(requests).toBe(1);
  await page.clock.runFor(999);
  expect(requests).toBe(1);
  await page.clock.runFor(1);
  await expect.poll(() => requests).toBe(2);
  response = ZURICH_PROBE;
  await setBrowserOnline(page, true);
  await expect(entry).toContainText("ZRH");
  await expectSharedPing(panel, "ZRH");
  await expect(diagnosticValue(panel, "Service de jeu")).toHaveText("polytour");
  await expect(diagnosticValue(panel, "Hôte")).toHaveText("127.0.0.1");
  expect(requests).toBe(3);
  response = FRANKFURT_PROBE;
  await page.evaluate(() => {
    const connection = (navigator as Navigator & { connection: EventTarget })
      .connection;
    connection.dispatchEvent(new Event("change"));
  });
  await expect(entry).toContainText("FRA");
  expect(requests).toBe(4);
  await setBrowserOnline(page, false);
  await page.clock.runFor(5000);
  expect(requests).toBe(4);
  response = ZURICH_PROBE;
  await setBrowserOnline(page, true);
  await expect(entry).toContainText("ZRH");
  expect(requests).toBe(5);
  await setDocumentVisibility(page, false);
  await page.clock.runFor(5000);
  expect(requests).toBe(5);
  response = FRANKFURT_PROBE;
  await setDocumentVisibility(page, true);
  await expect(entry).toContainText("FRA");
  expect(requests).toBe(6);
  response = ZURICH_PROBE;
  await match.disconnect();
  await expect(entry).toContainText("ZRH");
  expect(requests).toBe(7);
  await page.clock.runFor(1000);
  await expect.poll(() => match.connections()).toBe(2);
  await expect(diagnosticValue(panel, "Connexion de la partie")).toHaveText(
    "Connectée",
  );
  await expect.poll(() => requests).toBeGreaterThanOrEqual(8);
  const beforeClosing = requests;
  await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
  await setBrowserOnline(page, true);
  await page.evaluate(() =>
    (
      navigator as Navigator & { connection: EventTarget }
    ).connection.dispatchEvent(new Event("change")),
  );
  await page.clock.runFor(5000);
  expect(requests).toBe(beforeClosing);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await setBrowserOnline(page, true);
  await page.clock.runFor(5000);
  expect(requests).toBe(beforeClosing);
  expect(match.connections()).toBe(2);
});

test("an abort-ignoring request cannot latch Debug polling or replace a newer entry point", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let bodiesRead = 0;
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      // Deliberately uncooperative transport: a stale response can arrive after cancellation.
      if (!url.includes("/connection-probe.txt"))
        return originalFetch(input, init);
      const response = await originalFetch(input, {
        ...init,
        signal: undefined,
      });
      const readText = response.text.bind(response);
      response.text = async () => {
        const body = await readText();
        bodiesRead += 1;
        document.documentElement.dataset.debugBodiesRead = String(bodiesRead);
        return body;
      };
      return response;
    };
  });
  const pending: Route[] = [];
  await page.route("**/connection-probe.txt**", (route) => {
    pending.push(route);
  });
  await enterMatch(page);
  await freezeClock(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const panel = page.locator(".pause-debug");
  const entry = diagnosticValue(panel, "Point d’entrée Cloudflare");
  await expect.poll(() => pending.length).toBe(1);
  await page.clock.runFor(4999);
  expect(pending).toHaveLength(1);
  // Timeout must free the slot independently of the first fetch settling.
  await page.clock.runFor(1001);
  await expect.poll(() => pending.length).toBe(2);
  await pending[1].fulfill(ZURICH_PROBE);
  await expect(entry).toContainText("ZRH");
  await pending[0].fulfill(FRANKFURT_PROBE);
  // The obsolete request's body has been parsed before asserting the current UI.
  await expect(page.locator("html")).toHaveAttribute(
    "data-debug-bodies-read",
    "2",
  );
  await expect(entry).toContainText("ZRH");
  await expect(diagnosticValue(panel, "Service de jeu")).toHaveText("polytour");
  await expectSharedPing(panel, "ZRH");
  await page.clock.runFor(1000);
  await expect.poll(() => pending.length).toBe(3);
  await setBrowserOnline(page, true);
  await expect.poll(() => pending.length).toBe(4);
  await pending[3].fulfill(ZURICH_PROBE);
  await expect(entry).toContainText("ZRH");
  await pending[2].fulfill(FRANKFURT_PROBE);
  await expect(page.locator("html")).toHaveAttribute(
    "data-debug-bodies-read",
    "4",
  );
  await expect(entry).toContainText("ZRH");
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  await page.clock.runFor(10_000);
  expect(pending).toHaveLength(4);
});

test("Cloudflare probe details translate and distinguish local or unmapped entry points", async ({
  page,
}) => {
  let probeResponse: ProbeResponse = FRANKFURT_PROBE;
  const requests: string[] = [];
  await page.route("**/connection-probe.txt**", (route) => {
    requests.push(route.request().url());
    return route.fulfill(probeResponse);
  });
  const match = await enterMatch(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const panel = page.locator(".pause-debug");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  await expectSharedPing(panel, "FRA");
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
  await expectSharedPing(panel, "FRA");
  await expect(diagnosticValue(panel, "Cloudflare entry point")).toContainText(
    "FRA",
  );
  await expect(diagnosticValue(panel, "Cloudflare entry point")).toContainText(
    "Frankfurt, Germany",
  );
  await expect(diagnosticValue(panel, "Region")).toHaveText("Europe");
  await expect(diagnosticValue(panel, "Game service")).toHaveText("polytour");
  await expect(diagnosticValue(panel, "Host")).toHaveText("127.0.0.1");
  probeResponse = {
    status: 200,
    contentType: "text/plain",
    body: PROBE_BODY,
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
  await expectSharedPing(panel, "Local");
  await expect(panel).not.toContainText("FRA");
  await expect(panel).not.toContainText("Frankfurt");
  probeResponse = {
    ...FRANKFURT_PROBE,
    headers: { "cf-ray": "0123456789abcdef-ZZZ" },
  };
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await page.getByRole("tab", { name: "Debug", exact: true }).click();
  await expect(panel).toHaveAttribute("data-runtime", "cloudflare");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  await expect(diagnosticValue(panel, "Cloudflare entry point")).toHaveText(
    "ZZZ",
  );
  await expect(diagnosticValue(panel, "Region")).toHaveText("Unavailable");
  await expect(diagnosticValue(panel, "Game service")).toHaveText("polytour");
  await expect(diagnosticValue(panel, "Host")).toHaveText("127.0.0.1");
  await expectSharedPing(panel, "ZZZ");
  await expect(panel).not.toContainText("FRA");
  expect(requests.length).toBeGreaterThanOrEqual(4);
  for (const url of requests)
    expect(new URL(url).pathname).toBe("/connection-probe.txt");
  expect(match.connections()).toBe(1);
});

test("the tiny match badge retains its shared sample outside Debug without more static requests", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/connection-probe.txt**", (route) => {
    requests += 1;
    return route.fulfill(FRANKFURT_PROBE);
  });
  await enterMatch(page);
  await freezeClock(page);
  const badge = page.locator(".match-network");
  await expect(badge).toHaveText("— · — ms");
  expect(requests).toBe(0);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const panel = page.locator(".pause-debug");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  await expectSharedPing(panel, "FRA");
  const measured = await badge.textContent();
  expect(requests).toBe(1);
  await page
    .getByRole("button", { name: "Revenir au plateau", exact: true })
    .click();
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  await page.clock.runFor(3000);
  await expect(badge).toHaveText(measured ?? "");
  expect(requests).toBe(1);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.clock.runFor(250);
    const rect = await badge.boundingBox();
    const rightPlayer = await page
      .locator('.player-card[data-seat="3"]')
      .boundingBox();
    const overlap =
      rect && rightPlayer
        ? Math.max(
            0,
            Math.min(rect.x + rect.width, rightPlayer.x + rightPlayer.width) -
              Math.max(rect.x, rightPlayer.x),
          ) *
          Math.max(
            0,
            Math.min(rect.y + rect.height, rightPlayer.y + rightPlayer.height) -
              Math.max(rect.y, rightPlayer.y),
          )
        : 0;
    await test.info().attach(`badge-layout-${viewport.width}`, {
      body: JSON.stringify({ viewport, badge: rect, rightPlayer, overlap }),
      contentType: "application/json",
    });
    expect(overlap).toBe(0);
    if (rect && rightPlayer)
      expect(rightPlayer.y + rightPlayer.height).toBeLessThanOrEqual(rect.y);
    expect(rect).not.toBeNull();
    expect(rect?.x).toBeGreaterThanOrEqual(0);
    expect(rect?.y).toBeGreaterThanOrEqual(0);
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect((rect?.y ?? 0) + (rect?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width);
    await page.screenshot({
      path: `.local/verification/match-network-${viewport.width}.png`,
    });
    expect(requests).toBe(1);
  }
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
