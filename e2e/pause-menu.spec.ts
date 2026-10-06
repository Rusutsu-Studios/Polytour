import {
  expect,
  type Locator,
  type Page,
  type Route,
  test,
  type WebSocketRoute,
} from "@playwright/test";
import { DECISION_TIMING } from "../src/shared/board/index.js";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  type GameEvent,
  type PublicState,
  type Seat,
  toPublic,
} from "../src/shared/engine/index.js";
import {
  PROTOCOL_VERSION,
  RoomConfigSchema,
  type ServerMessage,
} from "../src/shared/protocol/index.js";
import {
  DEBUG_PING_REQUEST,
  DEBUG_PING_RESPONSE,
  type RoomDiagnostics,
} from "../src/shared/protocol/room-diagnostics.js";
import { DESKTOP_SIZES } from "./desktop-sizes.js";

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
const FRANKFURT_ROOM = {
  worker: {
    worker: "polytour",
    hostname: "127.0.0.1",
    runtime: "cloudflare",
    cloudflare: {
      colo: "FRA",
      location: "Frankfurt, Germany",
      region: "Europe",
    },
  },
  room: {
    className: "GameRoom",
    storage: "sqlite",
    location: null,
    jurisdiction: "eu",
  },
  peers: [
    {
      seat: 0,
      colo: "FRA",
      location: "Frankfurt, Germany",
      region: "Europe",
    },
    {
      seat: 1,
      colo: "IAD",
      location: "Ashburn, United States",
      region: "North America",
    },
  ],
} satisfies RoomDiagnostics;

type MatchFixtureOptions = {
  roomDiagnostics?: () => RoomDiagnostics;
  observePongs?: boolean;
};

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

async function expectSharedPing(
  panel: Locator,
  point: string,
  badge = ".match-network",
) {
  // Both views can refresh between independent DOM reads. Compare one render.
  await expect
    .poll(() =>
      panel.evaluate(
        (element, { entry, selector }) => {
          const latency = element.querySelector('[role="status"]')?.textContent;
          return (
            /^\d+ ms$/.test(latency ?? "") &&
            document.querySelector(selector)?.textContent ===
              `${entry} · ${latency}`
          );
        },
        { entry: point, selector: badge },
      ),
    )
    .toBe(true);
}

/** Deterministic authoritative frames; no room or gameplay action is sent to the Worker. */
async function enterMatch(page: Page, options: MatchFixtureOptions = {}) {
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
        control: seat < 2 ? ("human" as const) : ("bot" as const),
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
  const debugPings: WebSocketRoute[] = [];
  let metadataRequests = 0;
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
      if (String(raw) === DEBUG_PING_REQUEST) {
        debugPings.push(ws);
        return;
      }
      const message = JSON.parse(String(raw)) as { type: string };
      if (message.type === "debug-info") {
        metadataRequests += 1;
        if (options.roomDiagnostics) {
          ws.send(
            JSON.stringify({
              type: "room-diagnostics",
              value: options.roomDiagnostics(),
            } satisfies ServerMessage),
          );
        }
      }
      if (message.type === "sync") {
        const welcome: ServerMessage = {
          type: "welcome",
          protocolVersion: PROTOCOL_VERSION,
          you: { seat: 0, member: null },
          seq: sequence,
          snapshot,
          randomness: null,
          ...(options.roomDiagnostics ? { roomDebugVersion: 1 } : {}),
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
            seats: snapshot.players.map((player) => ({
              seat: player.seat,
              name: player.name,
              control: player.control,
              online: player.seat === 0,
              controller: null,
            })),
          },
        };
        ws.send(JSON.stringify(welcome));
      }
    });
  });
  // Track timers before the shared home/match probe creates its first cadence.
  await page.clock.install({ time: Date.now() });
  await page.goto("/?debug");
  if (options.observePongs) {
    // The route mock is installed during navigation; observe it before joining.
    await page.evaluate((pong) => {
      const NativeSocket = window.WebSocket;
      let received = 0;
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener("message", (event) => {
            if (event.data !== pong) return;
            received += 1;
            document.documentElement.dataset.roomPongsReceived =
              String(received);
          });
        }
      };
    }, DEBUG_PING_RESPONSE);
  }
  await page.getByLabel("Votre nom de joueur").fill("Camille");
  await page.getByRole("button", { name: "Jouer", exact: true }).click();
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
    metadataRequests: () => metadataRequests,
    pingRequests: () => debugPings.length,
    pong(index: number) {
      const pingSocket = debugPings[index];
      if (!pingSocket) throw new Error(`No fixture ping at index ${index}`);
      pingSocket.send(DEBUG_PING_RESPONSE);
    },
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
    page.getByRole("tab", { name: "Vidéo", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

async function freezeClock(page: Page) {
  // A loaded runner can outrun the margin; retry from a fresh reading.
  for (let attempt = 0; ; attempt += 1) {
    const now = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(now + 1000);
      return;
    } catch (error) {
      if (attempt >= 4) throw error;
    }
  }
}

async function completeProbe(page: Page, trigger: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (value) => new URL(value.url()).pathname === "/connection-probe.txt",
  );
  await trigger();
  await (await response).finished();
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

for (const viewport of DESKTOP_SIZES.slice(0, 3)) {
  test(`home network status opens shared Debug without a room at ${viewport.width}`, async ({
    page,
  }) => {
    const roomRequests: string[] = [];
    const sockets: string[] = [];
    let probes = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/rooms"))
        roomRequests.push(request.url());
    });
    page.on("websocket", (socket) => {
      if (new URL(socket.url()).pathname.startsWith("/ws/room/"))
        sockets.push(socket.url());
    });
    await page.route("**/connection-probe.txt**", (route) => {
      probes += 1;
      return route.fulfill(FRANKFURT_PROBE);
    });
    await page.setViewportSize(viewport);
    await page.clock.install({ time: Date.now() });
    await page.goto("/?debug");
    const badge = page.locator(".lobby-network");
    await expect(badge).toHaveAccessibleName("Débogage réseau");
    await expect(badge).toHaveText(/^FRA · \d+ ms$/);
    await expect(page.locator(".lobby-credit")).toContainText(
      "Crée par Poli & GJJS",
    );
    await freezeClock(page);
    const beforeOpening = probes;
    await badge.press("Enter");
    const modal = page.locator(".pause-dialog");
    const panel = modal.locator(".pause-debug");
    await expect(
      modal.getByRole("tab", { name: "Débogage", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expectSharedPing(panel, "FRA", ".lobby-network");
    expect(probes).toBe(beforeOpening);
    await page.screenshot({
      path: `.local/verification/home-network-${viewport.width}.png`,
    });
    await expect(
      diagnosticValue(panel, "Point d’entrée Cloudflare"),
    ).toContainText("Frankfurt, Germany");
    await expect(diagnosticValue(panel, "Région")).toHaveText("Europe");
    await expect(diagnosticValue(panel, "Hôte")).toHaveText("127.0.0.1");
    await expect(
      modal.locator(
        ".pause-menu-actions, .pause-request, .pause-vote, .pause-note, .pause-debug-bank, .room-debug-route",
      ),
    ).toHaveCount(0);
    await expect(modal).not.toHaveAttribute("aria-describedby", /.+/);
    await expect(
      panel.getByText("Connexion de la partie", { exact: true }),
    ).toHaveCount(0);
    await completeProbe(page, () => page.clock.runFor(5000));
    expect(probes).toBe(beforeOpening + 1);
    await expectSharedPing(panel, "FRA", ".lobby-network");
    await modal.getByLabel("Langue", { exact: true }).selectOption("en");
    await modal.getByRole("tab", { name: "Debug", exact: true }).click();
    await expect(badge).toHaveAccessibleName("Network debug");
    await expectSharedPing(panel, "FRA", ".lobby-network");
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(badge).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(roomRequests).toEqual([]);
    expect(sockets).toEqual([]);
    expect(
      await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
    ).toBeNull();
  });
}

test("the match network button opens Debug directly without requesting a multiplayer pause", async ({
  page,
}) => {
  await page.route("**/connection-probe.txt**", (route) =>
    route.fulfill(FRANKFURT_PROBE),
  );
  const match = await enterMatch(page, {
    roomDiagnostics: () => FRANKFURT_ROOM,
  });
  await freezeClock(page);
  const badge = page.locator(".match-network");
  await expect(badge).toHaveAccessibleName("Débogage réseau");
  await badge.press("Enter");
  const modal = page.locator(".pause-dialog");
  await expect(
    modal.getByRole("tab", { name: "Débogage", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expectSharedPing(modal.locator(".pause-debug"), "FRA");
  // Debug is active on mount; development StrictMode may mount it twice.
  await expect.poll(() => match.metadataRequests()).toBeGreaterThanOrEqual(1);
  await expect.poll(() => match.pingRequests()).toBe(match.metadataRequests());
  await expect(modal.locator(".room-debug-route")).toContainText("GameRoom");
  const previousTime = await page.locator(".match-clock").innerText();
  await page.clock.runFor(1000);
  await expect(page.locator(".match-clock")).not.toHaveText(previousTime);
  await page.keyboard.press("Escape");
  const gear = modal.getByRole("button", { name: "Réglages", exact: true });
  await expect(gear).toBeFocused();
  await expect(gear).toHaveText("Réglages");
  await expect(gear.locator("svg + span")).toBeVisible();
  await expect(gear.locator("svg")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(badge).toBeFocused();
  expect(
    match.messages
      .filter((raw) => raw.startsWith("{"))
      .map((raw) => (JSON.parse(raw) as { type: string }).type),
  ).toEqual(["sync", ...Array(match.metadataRequests()).fill("debug-info")]);
  expect(match.connections()).toBe(1);
});

test("opening a multiplayer pause menu keeps clocks and authoritative updates running without losing modal focus", async ({
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
  await expect(modal).not.toContainText(
    /The game keeps running|La partie continue/,
  );
  await expect(modal).not.toHaveAttribute("aria-describedby", /.+/);
  await expect(continueButton).toBeFocused();
  const settingsGear = modal.getByRole("button", {
    name: "Réglages",
    exact: true,
  });
  await expect(settingsGear).toHaveText("Réglages");
  await expect(settingsGear.locator("svg + span")).toBeVisible();
  await expect(settingsGear.locator("svg")).toBeVisible();
  await page.screenshot({ path: ".local/verification/pause-menu.png" });
  for (const viewport of DESKTOP_SIZES.slice(0, 3)) {
    await page.setViewportSize(viewport);
    await expect(settingsGear.locator("svg + span")).toBeVisible();
    await page.screenshot({
      path: `.local/verification/pause-menu-settings-fr-${viewport.width}.png`,
    });
  }
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
        maxLevel: 2,
        deadline: Date.now() + 60_000,
      },
    },
  ]);
  await expect(page.locator(".chance-dialog[open]")).toHaveCount(0);
  await expect(page.locator(".decision-popup[open]")).toHaveCount(0);
  await expect(continueButton).toBeFocused();
  await expect(
    page.locator('.player-card[data-seat="0"] .player-cash'),
  ).toContainText(/2\s150\s000/, {
    timeout:
      DECISION_TIMING.cardAnimation + DECISION_TIMING.moneyAnimation + 2_000,
  });
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
  const video = page.getByRole("tab", { name: "Vidéo", exact: true });
  await video.focus();
  await video.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Accessibilité", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Accessibilité", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await video.click();
  const graphics = page.locator(".pause-dialog .graphics-quality");
  await expect(graphics).toHaveAccessibleName("Graphismes");
  const highGraphics = graphics.getByRole("radio", {
    name: "Élevé",
    exact: true,
  });
  const lowGraphics = graphics.getByRole("radio", {
    name: "Faible",
    exact: true,
  });
  await expect(graphics.getByRole("radio")).toHaveCount(2);
  await expect(highGraphics).toBeChecked();
  await expect(lowGraphics).not.toBeChecked();
  await lowGraphics.press("Space");
  await expect(lowGraphics).toBeChecked();
  await expect(highGraphics).not.toBeChecked();
  await expect(page.locator(".canvas-layer")).toHaveAttribute(
    "data-low-graphics",
    "true",
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("polytour.settings.v1") ?? "null"),
    ),
  ).toMatchObject({ graphics: "low" });
  await page
    .getByRole("button", { name: "Zoomer le plateau", exact: true })
    .click();
  await page.getByRole("button", { name: "Recentrer", exact: true }).click();
  await page.getByRole("tab", { name: "Accessibilité", exact: true }).click();
  const motion = page.getByRole("group", {
    name: "Réduire les animations",
    exact: true,
  });
  await expect(
    motion.getByRole("radio", { name: "Système", exact: true }),
  ).toBeChecked();
  await motion.getByRole("radio", { name: "Désactivé", exact: true }).check();
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await motion.getByRole("radio", { name: "Activé", exact: true }).check();
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
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
  for (const viewport of DESKTOP_SIZES) {
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
  await page
    .locator(".pause-dialog")
    .getByLabel("Langue", { exact: true })
    .selectOption("en");
  await expect(
    page.getByRole("tab", { name: "Video", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tab", { name: "Video", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Debug", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Video", exact: true }).click();
  await expect(graphics).toHaveAccessibleName("Graphics");
  await expect(
    graphics.getByRole("radio", { name: "Low", exact: true }),
  ).toBeChecked();
  await expect(
    graphics.getByRole("radio", { name: "High", exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  const settings = page
    .locator(".pause-dialog")
    .getByRole("button", { name: "Settings", exact: true });
  await expect(settings).toHaveText("Settings");
  await expect(settings.locator("svg + span")).toBeVisible();
  for (const viewport of DESKTOP_SIZES.slice(0, 3)) {
    await page.setViewportSize(viewport);
    await expect(settings.locator("svg + span")).toBeVisible();
    await page.screenshot({
      path: `.local/verification/pause-menu-settings-en-${viewport.width}.png`,
    });
  }
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
  expect(probeRequests).toBeGreaterThanOrEqual(1);
  expect(match.metadataRequests()).toBe(0);
  expect(match.pingRequests()).toBe(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBe(roomCredentials);
});

test("Cloudflare HTTP ping refreshes every five seconds throughout a visible online match", async ({
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
  let response: ProbeResponse | null = FRANKFURT_PROBE;
  const probeURLs: string[] = [];
  await page.route("**/connection-probe.txt**", (route) => {
    requests += 1;
    probeURLs.push(route.request().url());
    if (response) return route.fulfill(response);
    // A held measurement lets suspension and leaving exercise cancellation.
  });
  const match = await enterMatch(page);
  const badge = page.locator(".match-network");
  await expect(badge).toHaveText(/^FRA · \d+ ms$/);
  await freezeClock(page);
  const initialRequests = requests;
  await completeProbe(page, () => page.clock.runFor(5000));
  await expect.poll(() => requests).toBe(initialRequests + 1);
  await expect(badge).toHaveText(/^FRA · \d+ ms$/);
  await openSettings(page);
  await completeProbe(page, () => page.clock.runFor(5000));
  await expect.poll(() => requests).toBe(initialRequests + 2);
  await expect(badge).toHaveText(/^FRA · \d+ ms$/);
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  await completeProbe(page, () => page.clock.runFor(5000));
  await expect.poll(() => requests).toBe(initialRequests + 3);
  await expect(badge).toHaveText(/^FRA · \d+ ms$/);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const debugPanel = page.locator(".pause-debug");
  const status = debugPanel.getByRole("status");
  await expect(status).toHaveText(/^\d+ ms$/);
  await expectSharedPing(debugPanel, "FRA");
  await expect(page.locator(".room-debug-route")).toContainText(
    "Informations de la salle indisponibles.",
  );
  await expect(page.locator(".room-debug-chart")).toHaveCount(0);
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
  for (const viewport of [...DESKTOP_SIZES, { width: 390, height: 844 }]) {
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
  response = { status: 503, body: "fixture-unavailable" };
  const beforeFailure = requests;
  await completeProbe(page, () => page.clock.runFor(5000));
  await expect.poll(() => requests).toBe(beforeFailure + 1);
  await expect(status).toHaveText("Indisponible");
  response = null;
  const beforeHeld = requests;
  await page.clock.runFor(5000);
  await expect.poll(() => requests).toBe(beforeHeld + 1);
  const aborts = () =>
    page
      .locator("html")
      .evaluate((element) =>
        Number((element as HTMLElement).dataset.debugPingAborts ?? "0"),
      );
  const beforeClosing = await aborts();
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  await page
    .getByRole("button", { name: "Revenir au plateau", exact: true })
    .click();
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  expect(await aborts()).toBe(beforeClosing);
  await setDocumentVisibility(page, false);
  await expect.poll(aborts).toBe(beforeClosing + 1);
  const whileHidden = requests;
  await page.clock.runFor(20_000);
  expect(requests).toBe(whileHidden);
  await setDocumentVisibility(page, true);
  await expect.poll(() => requests).toBe(whileHidden + 1);
  await setBrowserOnline(page, false);
  await expect.poll(aborts).toBe(beforeClosing + 2);
  const whileOffline = requests;
  await page.clock.runFor(20_000);
  expect(requests).toBe(whileOffline);
  response = FRANKFURT_PROBE;
  await setBrowserOnline(page, true);
  await expect.poll(() => requests).toBe(whileOffline + 1);
  await expect(badge).toHaveText(/^FRA · \d+ ms$/);
  response = null;
  await setBrowserOnline(page, true);
  await expect.poll(() => requests).toBe(whileOffline + 2);
  const beforeLeaving = requests;
  response = FRANKFURT_PROBE;
  await page.getByRole("button", { name: "Menu pause", exact: true }).click();
  await page.getByRole("button", { name: "Quitter", exact: true }).click();
  await page
    .getByRole("button", { name: "Quitter la partie", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Jouer", exact: true }),
  ).toBeVisible();
  await expect.poll(aborts).toBe(beforeClosing + 3);
  await expect(page.locator(".lobby-network")).toHaveText(/^FRA · \d+ ms$/);
  await expect.poll(() => requests).toBe(beforeLeaving + 1);
  const afterLeaving = requests;
  await completeProbe(page, () => page.clock.runFor(5000));
  await expect.poll(() => requests).toBe(afterLeaving + 1);
  await expect(page.locator(".lobby-network")).toHaveText(/^FRA · \d+ ms$/);
  expect(match.connections()).toBe(1);
  expect(
    match.messages.map((raw) =>
      raw.startsWith("{") ? (JSON.parse(raw) as { type: string }).type : raw,
    ),
  ).toEqual(["sync"]);
});

test("the shared probe refreshes after network and room connection changes and pauses while hidden or offline", async ({
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
  let expectedRequests = requests;
  await completeProbe(page, () => page.clock.runFor(5000));
  expectedRequests += 1;
  await expect.poll(() => requests).toBe(expectedRequests);
  response = ZURICH_PROBE;
  await completeProbe(page, () => setBrowserOnline(page, true));
  await expect(entry).toContainText("ZRH");
  await expectSharedPing(panel, "ZRH");
  await expect(diagnosticValue(panel, "Service de jeu")).toHaveText("polytour");
  await expect(diagnosticValue(panel, "Hôte")).toHaveText("127.0.0.1");
  expectedRequests += 1;
  expect(requests).toBe(expectedRequests);
  response = FRANKFURT_PROBE;
  await completeProbe(page, () =>
    page.evaluate(() => {
      const connection = (navigator as Navigator & { connection: EventTarget })
        .connection;
      connection.dispatchEvent(new Event("change"));
    }),
  );
  await expect(entry).toContainText("FRA");
  expectedRequests += 1;
  expect(requests).toBe(expectedRequests);
  await setBrowserOnline(page, false);
  await page.clock.runFor(20_000);
  expect(requests).toBe(expectedRequests);
  response = ZURICH_PROBE;
  await completeProbe(page, () => setBrowserOnline(page, true));
  await expect(entry).toContainText("ZRH");
  expectedRequests += 1;
  expect(requests).toBe(expectedRequests);
  await setDocumentVisibility(page, false);
  await page.clock.runFor(20_000);
  expect(requests).toBe(expectedRequests);
  response = FRANKFURT_PROBE;
  await completeProbe(page, () => setDocumentVisibility(page, true));
  await expect(entry).toContainText("FRA");
  expectedRequests += 1;
  expect(requests).toBe(expectedRequests);
  response = ZURICH_PROBE;
  await completeProbe(page, () => match.disconnect());
  expectedRequests += 1;
  await expect.poll(() => requests).toBe(expectedRequests);
  await expect(diagnosticValue(panel, "Connexion de la partie")).toHaveText(
    "Reconnexion en cours…",
  );
  await expect(entry).toContainText("ZRH");
  await page.clock.runFor(999);
  expect(requests).toBe(expectedRequests);
  await completeProbe(page, () => page.clock.runFor(1));
  await expect.poll(() => match.connections()).toBe(2);
  await expect(diagnosticValue(panel, "Connexion de la partie")).toHaveText(
    "Connectée",
  );
  expectedRequests += 1;
  await expect.poll(() => requests).toBe(expectedRequests);
  await expect(entry).toContainText("ZRH");
  response = FRANKFURT_PROBE;
  await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
  await completeProbe(page, () => setBrowserOnline(page, true));
  await completeProbe(page, () =>
    page.evaluate(() =>
      (
        navigator as Navigator & { connection: EventTarget }
      ).connection.dispatchEvent(new Event("change")),
    ),
  );
  expectedRequests += 2;
  expect(requests).toBe(expectedRequests);
  await completeProbe(page, () => page.clock.runFor(5000));
  expectedRequests += 1;
  expect(requests).toBe(expectedRequests);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  await completeProbe(page, () => setBrowserOnline(page, true));
  expectedRequests += 1;
  await expect(page.locator(".match-network")).toHaveText(/^FRA · \d+ ms$/);
  await completeProbe(page, () => page.clock.runFor(5000));
  expectedRequests += 1;
  expect(requests).toBe(expectedRequests);
  expect(match.connections()).toBe(2);
});

test("an abort-ignoring request cannot latch match polling or replace a newer entry point", async ({
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
  await expect.poll(() => pending.length).toBeGreaterThanOrEqual(1);
  const superseded = pending.length;
  await setBrowserOnline(page, true);
  await expect.poll(() => pending.length).toBe(superseded + 1);
  await page.clock.runFor(4999);
  expect(pending).toHaveLength(superseded + 1);
  // A five-second timeout frees the slot even when abort never settles.
  // The next five-second cadence must start a replacement by ten seconds.
  await page.clock.runFor(5001);
  await expect.poll(() => pending.length).toBe(superseded + 2);
  await pending[superseded + 1].fulfill(ZURICH_PROBE);
  await expect(entry).toContainText("ZRH");
  for (const oldRequest of pending.slice(0, superseded + 1))
    await oldRequest.fulfill(FRANKFURT_PROBE);
  // Every obsolete body has been parsed before asserting the current UI.
  await expect(page.locator("html")).toHaveAttribute(
    "data-debug-bodies-read",
    String(superseded + 2),
  );
  await expect(entry).toContainText("ZRH");
  await expect(diagnosticValue(panel, "Service de jeu")).toHaveText("polytour");
  await expectSharedPing(panel, "ZRH");
  const nextRequest = pending.length;
  await page.clock.runFor(5000);
  await expect.poll(() => pending.length).toBe(nextRequest + 1);
  await setBrowserOnline(page, true);
  await expect.poll(() => pending.length).toBe(nextRequest + 2);
  await pending[nextRequest + 1].fulfill(ZURICH_PROBE);
  await expect(entry).toContainText("ZRH");
  await pending[nextRequest].fulfill(FRANKFURT_PROBE);
  await expect(page.locator("html")).toHaveAttribute(
    "data-debug-bodies-read",
    String(nextRequest + 2),
  );
  await expect(entry).toContainText("ZRH");
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  const outsideDebug = pending.length;
  await page.clock.runFor(5000);
  await expect.poll(() => pending.length).toBe(outsideDebug + 1);
  await setDocumentVisibility(page, false);
  const whileHidden = pending.length;
  await page.clock.runFor(20_000);
  expect(pending).toHaveLength(whileHidden);
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
  await freezeClock(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const panel = page.locator(".pause-debug");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  await expectSharedPing(panel, "FRA");
  await expect(
    diagnosticValue(panel, "Point d’entrée Cloudflare"),
  ).toContainText("FRA");
  await expect(diagnosticValue(panel, "Région")).toHaveText("Europe");
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
  await completeProbe(page, () => setBrowserOnline(page, true));
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
  await completeProbe(page, () => setBrowserOnline(page, true));
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
  expect(requests.length).toBeGreaterThanOrEqual(3);
  for (const url of requests)
    expect(new URL(url).pathname).toBe("/connection-probe.txt");
  expect(match.connections()).toBe(1);
});

test("the tiny match badge refreshes its shared sample every five seconds outside Debug", async ({
  page,
}) => {
  let requests = 0;
  let response: ProbeResponse = FRANKFURT_PROBE;
  await page.route("**/connection-probe.txt**", (route) => {
    requests += 1;
    return route.fulfill(response);
  });
  const match = await enterMatch(page);
  const badge = page.locator(".match-network");
  await expect(badge).toHaveText(/^FRA · \d+ ms$/);
  await freezeClock(page);
  const initialRequests = requests;
  response = ZURICH_PROBE;
  await completeProbe(page, () => page.clock.runFor(5000));
  await expect.poll(() => requests).toBe(initialRequests + 1);
  await expect(badge).toHaveText(/^ZRH · \d+ ms$/);
  expect(match.metadataRequests()).toBe(0);
  expect(match.pingRequests()).toBe(0);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const panel = page.locator(".pause-debug");
  await expect(panel.getByRole("status")).toHaveText(/^\d+ ms$/);
  await expectSharedPing(panel, "ZRH");
  const beforeClosing = requests;
  await page
    .getByRole("button", { name: "Revenir au plateau", exact: true })
    .click();
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  response = FRANKFURT_PROBE;
  await completeProbe(page, () => page.clock.runFor(5000));
  await expect.poll(() => requests).toBe(beforeClosing + 1);
  await expect(badge).toHaveText(/^FRA · \d+ ms$/);
  const beforeScreenshots = requests;
  for (const viewport of [...DESKTOP_SIZES, { width: 390, height: 844 }]) {
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
  }
  expect(requests - beforeScreenshots).toBeLessThanOrEqual(1);
  expect(match.metadataRequests()).toBe(0);
  expect(match.pingRequests()).toBe(0);
});

test("room diagnostics show connected ingress routes and SQLite with bounded measured latency history", async ({
  page,
}) => {
  await page.route("**/connection-probe.txt**", (route) =>
    route.fulfill(FRANKFURT_PROBE),
  );
  const match = await enterMatch(page, {
    roomDiagnostics: () => FRANKFURT_ROOM,
  });
  await freezeClock(page);
  await openSettings(page);
  expect(match.metadataRequests()).toBe(0);
  expect(match.pingRequests()).toBe(0);
  const previousTime = await page.locator(".match-clock").innerText();
  const debugTab = page.getByRole("tab", { name: "Débogage", exact: true });
  await debugTab.click();
  const route = page.locator(".room-debug-route");
  const latency = page.locator(".room-debug-latency");
  const measuredLatency = latency.locator(".room-debug-latency-heading strong");
  const chart = latency.getByRole("img", {
    name: /Historique du ping de la partie/,
  });
  await expect(route).toContainText("GameRoom");
  await expect.poll(() => match.pingRequests()).toBe(1);
  expect(match.metadataRequests()).toBe(1);
  await expect(route.locator('[data-own="true"]')).toContainText("Vous");
  await expect(route.locator('[data-own="true"]')).toContainText("FRA");
  await expect(route.locator('[data-own="true"]')).toContainText("Europe");
  await expect(route.locator('[data-own="false"]')).toContainText("IAD");
  await expect(route.locator('[data-own="false"]')).toContainText(
    "Amérique du Nord",
  );
  await expect(route.locator(".room-debug-object")).toContainText(
    "SQLite dans cet objet",
  );
  await expect(diagnosticValue(route, "Endpoint Worker")).toContainText(
    new URL(page.url()).hostname,
  );
  await expect(diagnosticValue(route, "Votre entrée WebSocket")).toContainText(
    "FRA",
  );
  await expect(route.getByText("Juridiction", { exact: true })).toHaveCount(0);
  await expect(
    route.getByText("Hôte / centre de données", { exact: true }),
  ).toHaveCount(0);
  await expect(route.locator(".room-debug-object")).not.toContainText("IAD");
  await page.clock.runFor(120);
  match.pong(0);
  await expect(measuredLatency).toHaveText("120 ms");
  await page.clock.runFor(4880);
  await expect.poll(() => match.pingRequests()).toBe(2);
  await page.clock.runFor(80);
  match.pong(1);
  await expect(measuredLatency).toHaveText("80 ms");
  await page.clock.runFor(4920);
  await expect.poll(() => match.pingRequests()).toBe(3);
  await page.clock.runFor(200);
  match.pong(2);
  await expect(measuredLatency).toHaveText("200 ms");
  await expect(chart).toHaveAccessibleName(/3 mesures/);
  await expect(chart.locator("circle")).toHaveCount(3);
  await expect(diagnosticValue(latency, "Min")).toHaveText("80 ms");
  await expect(diagnosticValue(latency, "Moyenne")).toHaveText("133 ms");
  await expect(diagnosticValue(latency, "Max")).toHaveText("200 ms");
  await expect(chart.locator("polyline")).toHaveCount(1);
  await setDocumentVisibility(page, false);
  await page.clock.runFor(20_000);
  expect(match.pingRequests()).toBe(3);
  await setDocumentVisibility(page, true);
  await expect.poll(() => match.pingRequests()).toBe(4);
  await page.clock.runFor(60);
  match.pong(3);
  await expect(measuredLatency).toHaveText("60 ms");
  await expect(chart.locator("circle")).toHaveCount(4);
  await expect(chart.locator("polyline")).toHaveCount(2);
  expect(match.metadataRequests()).toBe(1);
  await expect(debugTab).toBeFocused();
  await expect(page.locator(".match-clock")).not.toHaveText(previousTime);
  for (const viewport of [...DESKTOP_SIZES, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.clock.runFor(50);
    const layout = await page
      .locator(".pause-dialog-body")
      .evaluate((body) => ({
        clientWidth: body.clientWidth,
        scrollWidth: body.scrollWidth,
        pageWidth: document.documentElement.scrollWidth,
      }));
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.pageWidth).toBe(viewport.width);
    await expect(debugTab).toBeFocused();
    await page.screenshot({
      path: `.local/verification/room-debug-${viewport.width}.png`,
    });
    if (viewport.width === 390) {
      await latency.locator(".room-debug-statistics").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: ".local/verification/room-debug-latency-390.png",
      });
    }
  }
  // The chart retains at most sixty actual replies, even after a long open menu.
  let sinceLastCadence = 60 + (DESKTOP_SIZES.length + 1) * 50;
  for (let pingIndex = 4; pingIndex < 64; pingIndex += 1) {
    await page.clock.runFor(5000 - sinceLastCadence);
    await expect.poll(() => match.pingRequests()).toBe(pingIndex + 1);
    await page.clock.runFor(40);
    match.pong(pingIndex);
    await expect(chart.locator("circle")).toHaveCount(
      Math.min(pingIndex + 1, 60),
    );
    sinceLastCadence = 40;
  }
  await expect(chart).toHaveAccessibleName(/60 mesures/);
  await expect(chart.locator("circle")).toHaveCount(60);
  expect(match.metadataRequests()).toBe(1);
  expect(match.connections()).toBe(1);
  await page
    .locator(".pause-dialog")
    .getByLabel("Langue", { exact: true })
    .selectOption("en");
  await page.getByRole("tab", { name: "Debug", exact: true }).click();
  await expect(route).toContainText("Connected player routes");
  await expect(route.locator('[data-own="true"]')).toContainText("You");
  await expect(route.locator('[data-own="false"]')).toContainText(
    "North America",
  );
  await expect(route.locator(".room-debug-object")).toContainText(
    "SQLite inside this object",
  );
  await expect(route.getByText("Jurisdiction", { exact: true })).toHaveCount(0);
  await expect(
    route.getByText("Host / data center", { exact: true }),
  ).toHaveCount(0);
  await expect(
    latency.getByRole("img", { name: /Game ping history/ }),
  ).toHaveAccessibleName(/60 samples/);
  expect(match.connections()).toBe(1);
});

test("room diagnostics use the game socket only while Debug is visible and refresh metadata on reconnect", async ({
  page,
}) => {
  await page.route("**/connection-probe.txt**", (route) =>
    route.fulfill(FRANKFURT_PROBE),
  );
  let diagnostics: RoomDiagnostics = FRANKFURT_ROOM;
  const match = await enterMatch(page, {
    roomDiagnostics: () => diagnostics,
  });
  await freezeClock(page);
  await openSettings(page);
  await page.clock.runFor(10_000);
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  await page.clock.runFor(10_000);
  expect(match.metadataRequests()).toBe(0);
  expect(match.pingRequests()).toBe(0);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  const route = page.locator(".room-debug-route");
  const measuredLatency = page.locator(".room-debug-latency-heading strong");
  await expect(route).toContainText("GameRoom");
  await expect.poll(() => match.pingRequests()).toBe(1);
  expect(match.metadataRequests()).toBe(1);
  await page.clock.runFor(25);
  match.pong(0);
  await expect(measuredLatency).toHaveText("25 ms");
  await page.clock.runFor(4975);
  await expect.poll(() => match.pingRequests()).toBe(2);
  await setDocumentVisibility(page, false);
  await page.clock.runFor(20_000);
  expect(match.pingRequests()).toBe(2);
  expect(match.metadataRequests()).toBe(1);
  await setDocumentVisibility(page, true);
  await expect.poll(() => match.pingRequests()).toBe(3);
  // The outstanding reply from before hiding consumes its expired FIFO slot.
  match.pong(1);
  await page.clock.runFor(50);
  match.pong(2);
  await expect(measuredLatency).toHaveText("50 ms");
  expect(match.metadataRequests()).toBe(1);
  await setBrowserOnline(page, false);
  await page.clock.runFor(20_000);
  expect(match.pingRequests()).toBe(3);
  await setBrowserOnline(page, true);
  await expect.poll(() => match.pingRequests()).toBe(4);
  await page.clock.runFor(35);
  match.pong(3);
  await expect(measuredLatency).toHaveText("35 ms");
  expect(match.metadataRequests()).toBe(1);
  await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
  await setBrowserOnline(page, true);
  await page.clock.runFor(20_000);
  expect(match.pingRequests()).toBe(4);
  expect(match.metadataRequests()).toBe(1);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect.poll(() => match.pingRequests()).toBe(5);
  await expect.poll(() => match.metadataRequests()).toBe(2);
  await page.clock.runFor(45);
  match.pong(4);
  await expect(measuredLatency).toHaveText("45 ms");
  await page.getByRole("button", { name: "Revenir au plateau" }).click();
  await setBrowserOnline(page, true);
  await setDocumentVisibility(page, true);
  await page.clock.runFor(20_000);
  expect(match.pingRequests()).toBe(5);
  expect(match.metadataRequests()).toBe(2);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect.poll(() => match.pingRequests()).toBe(6);
  await expect.poll(() => match.metadataRequests()).toBe(3);
  await page.clock.runFor(55);
  match.pong(5);
  await expect(measuredLatency).toHaveText("55 ms");
  diagnostics = {
    ...FRANKFURT_ROOM,
    worker: {
      ...FRANKFURT_ROOM.worker,
      cloudflare: {
        colo: "ZRH",
        location: "Zurich, Switzerland",
        region: "Europe",
      },
    },
    peers: [
      {
        ...FRANKFURT_ROOM.peers[0],
        colo: "ZRH",
        location: "Zurich, Switzerland",
      },
      FRANKFURT_ROOM.peers[1],
    ],
  };
  await match.disconnect();
  await expect(page.locator(".room-debug-chart")).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect.poll(() => match.connections()).toBe(2);
  await expect.poll(() => match.metadataRequests()).toBe(4);
  await expect.poll(() => match.pingRequests()).toBe(7);
  await expect(diagnosticValue(route, "Votre entrée WebSocket")).toContainText(
    "ZRH",
  );
  await expect(route.locator('[data-own="true"]')).toContainText("ZRH");
  await expect(diagnosticValue(route, "Endpoint Worker")).toContainText(
    new URL(page.url()).hostname,
  );
  await expect(
    diagnosticValue(page.locator(".pause-debug"), "Point d’entrée Cloudflare"),
  ).toContainText("FRA");
  await page.clock.runFor(65);
  match.pong(6);
  await expect(measuredLatency).toHaveText("65 ms");
  await expect(page.locator(".room-debug-chart circle")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await setBrowserOnline(page, true);
  await page.clock.runFor(20_000);
  expect(match.pingRequests()).toBe(7);
  expect(match.metadataRequests()).toBe(4);
  const ordinaryMessages = match.messages.filter(
    (raw) =>
      raw !== DEBUG_PING_REQUEST && JSON.parse(raw).type !== "debug-info",
  );
  expect(ordinaryMessages.map((raw) => JSON.parse(raw).type)).toEqual([
    "sync",
    "sync",
  ]);
});

test("late room pongs from timed out or closed Debug cannot become a fresh latency sample", async ({
  page,
}) => {
  await page.route("**/connection-probe.txt**", (route) =>
    route.fulfill(FRANKFURT_PROBE),
  );
  const match = await enterMatch(page, {
    roomDiagnostics: () => FRANKFURT_ROOM,
    observePongs: true,
  });
  await freezeClock(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect.poll(() => match.pingRequests()).toBe(1);
  await page.clock.runFor(5000);
  await expect.poll(() => match.pingRequests()).toBe(2);
  await page.getByRole("button", { name: "Revenir au plateau" }).click();
  await page.clock.runFor(1000);
  expect(match.pingRequests()).toBe(2);
  await openSettings(page);
  await page.getByRole("tab", { name: "Débogage", exact: true }).click();
  await expect.poll(() => match.pingRequests()).toBe(3);
  await expect.poll(() => match.metadataRequests()).toBe(2);
  const measuredLatency = page.locator(".room-debug-latency-heading strong");
  await page.clock.runFor(100);
  match.pong(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-room-pongs-received",
    "1",
  );
  await expect(measuredLatency).toHaveText("-");
  await expect(page.locator(".room-debug-chart")).toHaveCount(0);
  await page.clock.runFor(100);
  match.pong(1);
  await expect(page.locator("html")).toHaveAttribute(
    "data-room-pongs-received",
    "2",
  );
  await expect(measuredLatency).toHaveText("-");
  await expect(page.locator(".room-debug-chart")).toHaveCount(0);
  await page.clock.runFor(100);
  match.pong(2);
  await expect(measuredLatency).toHaveText("300 ms");
  await expect(page.locator(".room-debug-chart circle")).toHaveCount(1);
  match.pong(2);
  await page.clock.runFor(100);
  await expect(page.locator("html")).toHaveAttribute(
    "data-room-pongs-received",
    "4",
  );
  await expect(measuredLatency).toHaveText("300 ms");
  await expect(page.locator(".room-debug-chart circle")).toHaveCount(1);
  expect(match.connections()).toBe(1);
});

test("the rules icon is read only, invitations stay separate, and leaving needs confirmation", async ({
  page,
}) => {
  const match = await enterMatch(page);
  await page
    .getByRole("button", { name: "Règles de la partie", exact: true })
    .click();
  await expect(page.locator(".pause-rules")).toContainText(
    "Les réglages sont fixés pour toute la durée de cette partie.",
  );
  const controls = page.locator(".pause-rules").locator("input, select");
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all())
    await expect(control).toBeDisabled();
  await expect(page.locator(".pause-dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(
    page
      .locator(".pause-dialog")
      .getByRole("button", { name: "Réglages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pause-dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Règles de la partie", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Inviter des joueurs", exact: true })
    .click();
  await expect(page.locator(".room-tool")).toContainText("ABCD35");
  // No match settings here: the room leader's lock is the panel's only control.
  const roomControls = page.locator(".room-tool").locator("input, select");
  await expect(roomControls).toHaveCount(1);
  await expect(roomControls).toHaveAccessibleName(/Verrouiller la salle/);
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
    page.getByRole("button", { name: "Jouer", exact: true }),
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

test("a reduced-motion answer outlasts a reload and outranks the system setting", async ({
  page,
}) => {
  await enterMatch(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Accessibilité", exact: true }).click();
  const motion = page.getByRole("group", {
    name: "Réduire les animations",
    exact: true,
  });
  // The system preference applies until a personal override is selected.
  await expect(
    motion.getByRole("radio", { name: "Système", exact: true }),
  ).toBeChecked();
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await motion.getByRole("radio", { name: "Désactivé", exact: true }).check();
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("polytour.settings.v1") ?? "null"),
    ),
  ).toMatchObject({ reducedMotion: "off" });
  await page.reload();
  // The stored answer wins. The system no longer turns the animations off.
  await expect(page.locator("main")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
});
