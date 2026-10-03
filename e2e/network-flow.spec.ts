import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
  PROTOCOL_VERSION,
  RoomConfigSchema,
} from "../src/shared/protocol/index.js";

const credentials = {
  roomCode: "ABCD23",
  seat: 0,
  token: "test-capability-not-real",
};
const welcome = (seq = 0, protocolVersion = PROTOCOL_VERSION) =>
  JSON.stringify({
    type: "welcome",
    protocolVersion,
    you: { seat: 0 },
    seq,
    snapshot: null,
    randomness: null,
    lobby: {
      roomCode: credentials.roomCode,
      hostSeat: 0,
      status: "lobby",
      config: RoomConfigSchema.parse({}),
      seats: [0, 1, 2, 3].map((seat) => ({
        seat,
        name: ["Network fixture", "Milo", "", ""][seat],
        control: seat === 0 ? "human" : seat === 1 ? "bot" : null,
        online: seat === 0,
      })),
    },
  });

async function pauseTimers(page: Page) {
  const time = new Date("2026-10-01T07:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
}

async function enterMockRoom(page: Page) {
  await page.route("**/api/rooms", (route) =>
    route.fulfill({ status: 201, json: credentials }),
  );
  await page.goto("/");
  await page.evaluate(() => {
    const BrowserWebSocket = window.WebSocket;
    let closed = 0;
    window.WebSocket = class extends BrowserWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("close", () => {
          closed += 1;
          document.documentElement.dataset.fixtureSocketClosed = String(closed);
        });
      }
    };
  });
  await page.getByLabel("Votre nom de joueur").fill("Network fixture");
  await page
    .getByRole("button", { name: "Créer une salle entre amis" })
    .click();
}

test("shows an HTTP failure clearly and never stores failed room credentials", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/rooms", (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "Internal Server Error",
    });
  });
  await page.goto("/");
  await page.getByLabel("Votre nom de joueur").fill("Network fixture");
  await page
    .getByRole("button", { name: "Créer une salle entre amis" })
    .click();
  await expect(page.getByRole("alert")).toContainText("HTTP 500");
  await expect(page.getByRole("alert")).not.toContainText("Unexpected token");
  expect(requests).toHaveLength(1);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBeNull();

  await page.route("**/api/rooms/ABCD23/join", (route) =>
    route.fulfill({ status: 409, json: { error: "room-full" } }),
  );
  await page.getByLabel("Vous avez un code ?").fill("ABCD23");
  await page.getByRole("button", { name: "Rejoindre", exact: false }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Cette salle est complète",
  );
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBeNull();
});

test("repeated Enter creates only one pending room request and permits retry after failure", async ({
  page,
}) => {
  let requests = 0;
  let releaseFirst: () => void = () => {};
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route("**/api/rooms", async (route) => {
    requests += 1;
    const first = requests === 1;
    if (first) await firstResponse;
    await route.fulfill({
      status: first ? 500 : 503,
      contentType: "text/plain",
      body: "Internal Server Error",
    });
  });
  await page.goto("/");
  const name = page.getByLabel("Votre nom de joueur");
  await name.fill("Network fixture");
  try {
    await name.press("Enter");
    await expect.poll(() => requests).toBe(1);
    await expect(
      page.getByRole("button", { name: "Créer une salle entre amis" }),
    ).toBeDisabled();
    for (let index = 0; index < 5; index += 1) await name.press("Enter");
    expect(requests).toBe(1);
  } finally {
    releaseFirst();
  }
  await expect(page.getByRole("alert")).toContainText("HTTP 500");
  await expect(
    page.getByRole("button", { name: "Créer une salle entre amis" }),
  ).toBeEnabled();
  await name.press("Enter");
  await expect(page.getByRole("alert")).toContainText("HTTP 503");
  expect(requests).toBe(2);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBeNull();
});

test("stops retrying an accepted socket that repeatedly fails before welcome", async ({
  page,
}) => {
  await pauseTimers(page);
  let attempts = 0;
  await page.routeWebSocket("**/ws/room/**", (ws) => {
    attempts += 1;
    ws.onMessage(
      () => void ws.close({ code: 1011, reason: "Fixture sync failure" }),
    );
  });
  await enterMockRoom(page);
  await expect.poll(() => attempts).toBe(1);
  for (const [index, delay] of [1000, 2000, 4000, 8000, 8000].entries()) {
    // Route callbacks run in Node while reconnect timers run in the browser.
    // Wait for its actual close event before advancing that browser clock.
    await expect(page.locator("html")).toHaveAttribute(
      "data-fixture-socket-closed",
      String(index + 1),
    );
    await page.clock.runFor(delay);
    await expect.poll(() => attempts).toBe(index + 2);
  }
  await expect(page.locator(".connection-dot")).toHaveAttribute(
    "data-state",
    "offline",
  );
  await expect(page.locator(".network-error")).toContainText(
    "La salle ne répond pas",
  );
  await page.clock.runFor(60_000);
  expect(attempts).toBe(6);
});

test("coalesces snapshot recovery, suppresses duplicate commands and clears their timer on disconnect", async ({
  page,
}) => {
  await pauseTimers(page);
  const sockets: WebSocketRoute[] = [];
  const messages: string[][] = [];
  await page.routeWebSocket("**/ws/room/**", (ws) => {
    const index = sockets.length;
    sockets.push(ws);
    messages.push([]);
    ws.onMessage((message) => {
      messages[index].push(String(message));
      if (messages[index].length === 1) ws.send(welcome());
    });
  });
  await enterMockRoom(page);
  await expect(page.locator(".connection-dot")).toHaveAttribute(
    "data-state",
    "online",
  );
  const gap = JSON.stringify({
    type: "events",
    fromSeq: 2,
    toSeq: 2,
    events: [],
  });
  for (let index = 0; index < 4; index += 1) sockets[0].send(gap);
  await expect.poll(() => messages[0].length).toBe(2);
  expect(
    messages[0].map((raw) => (JSON.parse(raw) as { type: string }).type),
  ).toEqual(["sync", "sync"]);
  sockets[0].send(welcome(2));
  await expect(
    page.getByRole("button", { name: "Démarrer la partie" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Démarrer la partie" })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect.poll(() => messages[0].length).toBe(3);
  expect((JSON.parse(messages[0][2]) as { type: string }).type).toBe("lobby");
  await sockets[0].close({ code: 1011, reason: "Fixture reconnect" });
  await page.clock.runFor(1000);
  await expect.poll(() => sockets.length).toBe(2);
  await expect(page.locator(".connection-dot")).toHaveAttribute(
    "data-state",
    "online",
  );
  await page.clock.runFor(10_000);
  expect(messages[1]).toHaveLength(1);
  await expect(page.locator(".network-error")).toHaveCount(0);
});

test("does not retry a room that rejects its socket session", async ({
  page,
}) => {
  await pauseTimers(page);
  let attempts = 0;
  await page.routeWebSocket("**/ws/room/**", (ws) => {
    attempts += 1;
    ws.onMessage(
      () => void ws.close({ code: 1008, reason: "Session missing" }),
    );
  });
  await enterMockRoom(page);
  await expect(page.locator(".connection-dot")).toHaveAttribute(
    "data-state",
    "offline",
  );
  await expect(page.locator(".network-error")).toContainText(
    "La connexion à cette salle a été refusée",
  );
  await page.clock.runFor(60_000);
  expect(attempts).toBe(1);
});

test("requires refresh for a previous protocol and never enables stale game actions", async ({
  page,
}) => {
  await pauseTimers(page);
  let attempts = 0;
  await page.routeWebSocket("**/ws/room/**", (ws) => {
    attempts += 1;
    ws.onMessage(() => ws.send(welcome(0, PROTOCOL_VERSION - 1)));
  });
  await enterMockRoom(page);
  await expect(page.locator(".network-error")).toContainText(
    "Le jeu a été mis à jour. Actualisez la page pour retrouver votre salle.",
  );
  await expect(page.locator(".connection-dot")).toHaveAttribute(
    "data-state",
    "offline",
  );
  await expect(
    page.getByRole("button", { name: "Démarrer la partie" }),
  ).toHaveCount(0);
  await expect(page.locator(".decision-panel")).toHaveCount(0);
  await page.clock.runFor(60_000);
  expect(attempts).toBe(1);
});
