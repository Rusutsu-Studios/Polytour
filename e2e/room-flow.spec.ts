import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import type { PublicState } from "../src/shared/engine/index.js";
import { applyEvent, botAction } from "../src/shared/engine/index.js";
import type {
  ClientMessage,
  RoomCredentials,
  ServerMessage,
} from "../src/shared/protocol/index.js";
import { resolveDice } from "../src/worker/randomness.js";

type TestWindow = Window & {
  polytourTestSocket: WebSocket;
  onRoomMessage: (message: ServerMessage) => Promise<void>;
};
type Actor = {
  page: Page;
  credentials: RoomCredentials;
  seq: number;
  state: PublicState | null;
  messages: ServerMessage[];
  gaps: string[];
  commitmentReceivedAt: number | null;
};

async function connect(
  browser: Browser,
  credentials: RoomCredentials,
): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const actor: Actor = {
    page,
    credentials,
    seq: 0,
    state: null,
    messages: [],
    gaps: [],
    commitmentReceivedAt: null,
  };
  await page.exposeFunction("onRoomMessage", (message: ServerMessage) => {
    actor.messages.push(message);
    if (message.type === "randomness" && message.status === "committed") {
      actor.commitmentReceivedAt = Date.now();
    }
    if (message.type === "welcome") {
      actor.seq = message.seq;
      actor.state = message.snapshot;
    }
    if (message.type === "events") {
      if (message.fromSeq !== actor.seq + 1)
        actor.gaps.push(`${actor.seq} -> ${message.fromSeq}`);
      for (const event of message.events) {
        if (event.type === "GameCreated") actor.state = event.state;
        else if (actor.state) actor.state = applyEvent(actor.state, event);
      }
      actor.seq = message.toSeq;
    }
  });
  await page.goto("/");
  await page.evaluate((session) => {
    const surface = window as unknown as TestWindow;
    surface.polytourTestSocket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/room/${session.roomCode}`,
      ["polytour", `seat.${session.token}`],
    );
    surface.polytourTestSocket.onmessage = (event) => {
      void surface.onRoomMessage(JSON.parse(event.data) as ServerMessage);
    };
    surface.polytourTestSocket.onopen = () =>
      surface.polytourTestSocket.send(
        JSON.stringify({ type: "sync", lastSeq: null }),
      );
  }, credentials);
  await expect
    .poll(() => actor.messages.some((message) => message.type === "welcome"))
    .toBe(true);
  return actor;
}

async function send(actor: Actor, message: ClientMessage) {
  await actor.page.evaluate(
    (frame) =>
      (window as unknown as TestWindow).polytourTestSocket.send(
        JSON.stringify(frame),
      ),
    message,
  );
}

test("an invitation joins the existing production room and refresh resumes the same guest seat", async ({
  page,
  browser,
  request,
}) => {
  const created = await request.post("/api/rooms", {
    data: { name: "Invitation host" },
  });
  expect(created.status()).toBe(201);
  const hostCredentials: RoomCredentials = await created.json();
  const host = await connect(browser, hostCredentials);
  const roomRequests: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.method() === "POST")
      roomRequests.push(new URL(outgoing.url()).pathname);
  });
  await page.goto(
    `/?room=${encodeURIComponent(` ${hostCredentials.roomCode.toLowerCase()} `)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Rejoindre la salle" }),
  ).toBeVisible();
  await expect(page.getByLabel("Votre nom de joueur")).toBeFocused();
  await expect(page.getByLabel("Vous avez un code ?")).toHaveCount(0);
  await page.getByLabel("Votre nom de joueur").fill("Invitation guest");
  const joinedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/rooms/${hostCredentials.roomCode}/join` &&
      response.request().method() === "POST",
  );
  await page.getByLabel("Votre nom de joueur").press("Enter");
  const joined = await joinedResponse;
  expect(joined.status()).toBe(200);
  expect(joined.request().postDataJSON()).toEqual({ name: "Invitation guest" });
  const guestCredentials: RoomCredentials = await joined.json();
  expect(guestCredentials.roomCode).toBe(hostCredentials.roomCode);
  expect(guestCredentials.seat).toBe(1);
  await expect(page.locator(".waiting-host")).toBeVisible();
  await expect(page.locator(".lobby-seat.filled.human")).toHaveCount(2);
  await expect(page.locator(".lobby-seats")).toContainText("Invitation host");
  await expect(page.locator(".lobby-seats")).toContainText("Invitation guest");
  await expect(page.locator(".lobby-seat.filled.bot")).toHaveCount(0);
  expect(host.state).toBeNull();
  expect(roomRequests).toEqual([`/api/rooms/${hostCredentials.roomCode}/join`]);
  const savedCredentials = await page.evaluate(() =>
    sessionStorage.getItem("polytour-room-v1"),
  );
  expect(JSON.parse(savedCredentials ?? "null")).toEqual(guestCredentials);
  await page.reload();
  await expect(page.locator(".waiting-host")).toBeVisible();
  await expect(page.locator(".lobby-seat.filled.human")).toHaveCount(2);
  await expect(page.locator(".invitation-entry")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("polytour-room-v1")),
  ).toBe(savedCredentials);
  expect(roomRequests).toEqual([`/api/rooms/${hostCredentials.roomCode}/join`]);
  expect(host.state).toBeNull();
  await page.getByRole("button", { name: "Quitter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nouvelle partie" }),
  ).toBeVisible();
  await expect(page.getByLabel("Vous avez un code ?")).toHaveValue("");
  expect(new URL(page.url()).search).toBe("");
  await host.page.context().close();
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`leaving the real lobby frees the seat and transfers host controls at ${viewport.width}×${viewport.height}`, async ({
    browser,
    request,
  }) => {
    const created = await request.post("/api/rooms", {
      data: { name: "Departing host", config: { decisionSeconds: 60 } },
    });
    expect(created.status()).toBe(201);
    const host: RoomCredentials = await created.json();
    const joined = await request.post(`/api/rooms/${host.roomCode}/join`, {
      data: { name: "Next host" },
    });
    expect(joined.status()).toBe(200);
    const guest: RoomCredentials = await joined.json();
    const hostContext = await browser.newContext({
      viewport,
      reducedMotion: viewport.width === 1440 ? "reduce" : "no-preference",
    });
    const guestContext = await browser.newContext({
      viewport,
      reducedMotion: viewport.width === 1440 ? "reduce" : "no-preference",
    });
    const errors: string[] = [];
    try {
      const hostPage = await hostContext.newPage();
      const guestPage = await guestContext.newPage();
      const hostSockets: { closed: boolean }[] = [];
      hostPage.on("websocket", (socket) => {
        if (!socket.url().includes(`/ws/room/${host.roomCode}`)) return;
        const connection = { closed: false };
        hostSockets.push(connection);
        socket.on("close", () => {
          connection.closed = true;
        });
      });
      for (const [page, credentials] of [
        [hostPage, host],
        [guestPage, guest],
      ] as const) {
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/");
        await page.evaluate((session) => {
          localStorage.setItem("polytour.locale", "en");
          sessionStorage.setItem("polytour-room-v1", JSON.stringify(session));
        }, credentials);
        await page.reload();
        await expect(page.locator(".lobby-connection")).toHaveText(
          "Room connected",
        );
        await expect(page.locator(".lobby-seat.filled.human")).toHaveCount(2);
      }
      await expect(
        hostPage.getByRole("button", { name: "Start game", exact: true }),
      ).toBeEnabled();
      await expect(guestPage.locator(".waiting-host")).toBeVisible();

      // A normal socket interruption keeps the guest's reconnectable seat.
      await guestPage.reload();
      await expect(guestPage.locator(".lobby-connection")).toHaveText(
        "Room connected",
      );
      await expect(guestPage.locator(".lobby-seat.filled.human")).toHaveCount(
        2,
      );
      await expect(guestPage.locator(".waiting-host")).toBeVisible();
      await hostPage.screenshot({
        path: `.local/verification/lobby-before-leave-${viewport.width}.png`,
      });

      const leaveResponse = hostPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/rooms/${host.roomCode}/leave` &&
          response.request().method() === "POST",
      );
      const leaveButton = hostPage.getByRole("button", {
        name: "Leave",
        exact: true,
      });
      if (viewport.width === 1280) {
        await leaveButton.focus();
        await expect(leaveButton).toBeFocused();
        await hostPage.keyboard.press("Enter");
      } else {
        await leaveButton.click();
      }
      expect((await leaveResponse).status()).toBe(200);
      await expect(
        hostPage.getByRole("heading", { name: "New game", exact: true }),
      ).toBeVisible();
      expect(
        await hostPage.evaluate(() =>
          sessionStorage.getItem("polytour-room-v1"),
        ),
      ).toBeNull();
      expect(hostSockets.length).toBeGreaterThan(0);
      await expect
        .poll(() => hostSockets.every((connection) => connection.closed))
        .toBe(true);

      await expect(guestPage.locator(".lobby-seat.filled.human")).toHaveCount(
        1,
      );
      await expect(guestPage.locator(".lobby-seat.filled.human")).toContainText(
        "Next host",
      );
      await expect(guestPage.locator(".host-label")).toHaveCount(1);
      await expect(guestPage.locator(".waiting-host")).toHaveCount(0);
      await expect(
        guestPage.getByRole("button", { name: "Add a bot to seat 1" }),
      ).toBeEnabled();
      // The promoted host and freed seat must survive snapshot recovery too.
      await guestPage.reload();
      await expect(guestPage.locator(".lobby-connection")).toHaveText(
        "Room connected",
      );
      await expect(
        guestPage.getByRole("button", { name: "Add a bot to seat 1" }),
      ).toBeEnabled();

      const replacementResponse = await request.post(
        `/api/rooms/${host.roomCode}/join`,
        { data: { name: "New occupant" } },
      );
      expect(replacementResponse.status()).toBe(200);
      const replacement: RoomCredentials = await replacementResponse.json();
      expect(replacement.seat).toBe(host.seat);
      expect(replacement.token).not.toBe(host.token);
      const staleLeave = await request.post(
        `/api/rooms/${host.roomCode}/leave`,
        { headers: { Authorization: `Bearer ${host.token}` } },
      );
      expect(staleLeave.status()).toBe(401);
      expect(await staleLeave.json()).toEqual({ error: "unauthorized" });
      await expect(guestPage.locator(".lobby-seat.filled.human")).toHaveCount(
        2,
      );
      await expect(
        guestPage.locator(".lobby-seat").filter({ hasText: "New occupant" }),
      ).not.toContainText("Leader");
      await expect(
        guestPage.locator(".lobby-seat").filter({ hasText: "Next host" }),
      ).toContainText("Leader");

      await guestPage.locator(".settings-trigger").click();
      const settings = guestPage.locator(".settings-dialog");
      const salary = settings.getByRole("spinbutton", {
        name: "Salary per lap: exact value",
        exact: true,
      });
      await expect(salary).toBeEnabled();
      await salary.fill("450000");
      await settings
        .getByRole("button", { name: "Save settings", exact: true })
        .click();
      await expect(
        settings.getByRole("button", { name: "Settings saved", exact: true }),
      ).toBeDisabled();
      await guestPage.keyboard.press("Escape");
      await expect(guestPage.locator(".settings-trigger")).toBeFocused();
      await guestPage
        .getByRole("button", { name: "Add a bot to seat 3" })
        .click();
      await expect(guestPage.locator(".lobby-seat.filled.bot")).toHaveCount(1);
      const start = guestPage.getByRole("button", {
        name: "Start game",
        exact: true,
      });
      await expect(start).toBeEnabled();
      await guestPage.screenshot({
        path: `.local/verification/lobby-promoted-host-${viewport.width}.png`,
      });
      await start.click();
      await expect(guestPage.locator(".game-shell")).toBeVisible();
      await expect(guestPage.locator(".player-card")).toHaveCount(3);
      await expect(guestPage.locator("canvas")).toBeVisible();
      await expect(guestPage.locator(".canvas-layer")).toHaveAttribute(
        "data-scene-ready",
        "true",
      );
      await guestPage.screenshot({
        path: `.local/verification/lobby-promoted-host-game-${viewport.width}.png`,
      });
      if (viewport.width === 1440) {
        const saved = await guestPage.evaluate(() =>
          sessionStorage.getItem("polytour-room-v1"),
        );
        await guestPage.route(
          `**/api/rooms/${host.roomCode}/leave`,
          (route) =>
            route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "room-service-unavailable" }),
            }),
          { times: 1 },
        );
        await guestPage
          .getByRole("button", { name: "Pause menu", exact: true })
          .click();
        await guestPage
          .locator(".pause-dialog")
          .getByRole("button", { name: "Leave", exact: true })
          .click();
        await guestPage
          .locator(".pause-dialog")
          .getByRole("button", { name: "Leave the game", exact: true })
          .click();
        await expect(guestPage.locator(".pause-dialog")).toHaveCount(0);
        await expect(guestPage.locator(".network-error")).toContainText(
          "Your departure was not confirmed. Check your connection and try again.",
        );
        await expect(guestPage.locator(".network-error")).toBeVisible();
        await expect(guestPage.locator(".game-shell")).toBeVisible();
        expect(
          await guestPage.evaluate(() =>
            sessionStorage.getItem("polytour-room-v1"),
          ),
        ).toBe(saved);
        const retry = guestPage.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/rooms/${host.roomCode}/leave` &&
            response.request().method() === "POST",
        );
        await guestPage
          .getByRole("button", { name: "Pause menu", exact: true })
          .click();
        await guestPage
          .locator(".pause-dialog")
          .getByRole("button", { name: "Leave", exact: true })
          .click();
        await guestPage
          .locator(".pause-dialog")
          .getByRole("button", { name: "Leave the game", exact: true })
          .click();
        expect((await retry).status()).toBe(200);
        await expect(
          guestPage.getByRole("heading", { name: "New game", exact: true }),
        ).toBeVisible();
        expect(
          await guestPage.evaluate(() =>
            sessionStorage.getItem("polytour-room-v1"),
          ),
        ).toBeNull();
      }
      expect(errors).toEqual([]);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
}

test("four isolated browser seats finish a real authoritative match and reconnect", async ({
  browser,
  request,
}) => {
  const response = await request.post("/api/rooms", {
    data: {
      name: "Alice",
      config: {
        startingCash: 2_000_000,
        startSalary: 400_000,
        roundLimit: 5,
        decisionSeconds: 60,
        timeLimitMinutes: 120,
        festivalCount: 3,
        lineMonopoly: true,
        tripleMonopoly: true,
      },
    },
  });
  expect(response.status()).toBe(201);
  const credentials: RoomCredentials[] = [await response.json()];
  for (const name of ["Bruno", "Chloé", "Dario"]) {
    const joined = await request.post(
      `/api/rooms/${credentials[0].roomCode}/join`,
      { data: { name } },
    );
    expect(joined.status()).toBe(200);
    credentials.push(await joined.json());
  }
  const actors: Actor[] = [];
  for (const credential of credentials)
    actors.push(await connect(browser, credential));
  await send(actors[0], {
    type: "lobby",
    id: randomUUID(),
    op: { type: "start", fillBots: false },
  });
  await expect
    .poll(() => actors.every((actor) => actor.state?.players.length === 4))
    .toBe(true);
  expect(JSON.stringify(actors[0].state)).not.toMatch(
    /rngState|"deck"|resolutionQueue|token_hash/,
  );
  const lastActor = actors[3];
  await lastActor.page.evaluate(() =>
    (window as unknown as TestWindow).polytourTestSocket.close(),
  );
  await lastActor.page.context().close();
  actors[3] = await connect(browser, credentials[3]);
  await expect
    .poll(() => actors[3].state?.gameId)
    .toBe(credentials[0].roomCode);

  let decisions = 0;
  while (actors[0].state?.status === "active" && decisions < 600) {
    const state = actors[0].state;
    const seat = state.pending?.seat ?? state.activeSeat;
    const actor = actors[seat];
    await expect.poll(() => actor.seq).toBe(actors[0].seq);
    const previousSeq = actor.seq;
    const id = randomUUID();
    const action = botAction(state, seat, "medium");
    await send(actor, { type: "intent", id, atSeq: actor.seq, action });
    await expect.poll(() => actors[0].seq).toBeGreaterThan(previousSeq);
    decisions += 1;
  }
  expect(actors[0].state?.status).toBe("finished");
  const finalSeq = actors[0].seq;
  await expect
    .poll(() => actors.every((actor) => actor.seq === finalSeq))
    .toBe(true);
  for (const actor of actors) {
    expect(actor.gaps).toEqual([]);
    expect(actor.state).toEqual(actors[0].state);
    expect(
      actor.messages.filter((message) => message.type === "reject"),
    ).toEqual([]);
  }
  expect(actors[0].state?.result?.standings).toHaveLength(4);
  for (const actor of actors) await actor.page.context().close();
});

test("@live legacy drand publishes a future commitment, verifies a live beacon, and restores its proof", async ({
  browser,
  request,
}) => {
  const response = await request.post("/api/rooms", {
    data: {
      name: "Drand check",
      config: {
        startingCash: 2_000_000,
        startSalary: 400_000,
        roundLimit: 5,
        decisionSeconds: 60,
        timeLimitMinutes: 120,
        festivalCount: 3,
        randomnessMode: "drand",
      },
    },
  });
  expect(response.status()).toBe(201);
  const credential: RoomCredentials = await response.json();
  const credentials = [credential];
  for (const name of ["Drand two", "Drand three", "Drand four"]) {
    const joined = await request.post(
      `/api/rooms/${credential.roomCode}/join`,
      { data: { name } },
    );
    credentials.push((await joined.json()) as RoomCredentials);
  }
  const actors: Actor[] = [];
  for (const session of credentials)
    actors.push(await connect(browser, session));
  const actor = actors[0];
  await send(actor, {
    type: "lobby",
    id: randomUUID(),
    op: { type: "start", fillBots: false },
  });
  await expect
    .poll(() => actor.state?.pending !== null && actor.state !== null)
    .toBe(true);
  const rollingSeat = actor.state?.pending?.seat ?? 0;
  await send(actors[rollingSeat], {
    type: "intent",
    id: randomUUID(),
    atSeq: actor.seq,
    action: { type: "Roll" },
  });
  await expect
    .poll(
      () =>
        actor.messages.some(
          (message) =>
            message.type === "randomness" && message.status === "resolved",
        ),
      { timeout: 25_000 },
    )
    .toBe(true);
  const resolved = actor.messages.find(
    (message) => message.type === "randomness" && message.status === "resolved",
  );
  if (resolved?.type !== "randomness" || !resolved.proof)
    throw new Error("Expected live drand proof");
  const proof = resolved.proof;
  expect(proof.verified).toBe(true);
  expect(proof.mode).toBe("drand");
  expect(actor.commitmentReceivedAt).not.toBeNull();
  expect(actor.commitmentReceivedAt ?? Infinity).toBeLessThan(
    proof.availableAt - 500,
  );
  const independentlyVerified = await resolveDice(proof);
  expect(independentlyVerified.dice).toEqual(proof.dice);
  expect(actor.state?.lastRoll?.dice).toEqual(proof.dice);
  // Re-sync immediately before another bot has time to roll.
  await send(actor, { type: "sync", lastSeq: null });
  await expect
    .poll(
      () =>
        actor.messages.filter((message) => message.type === "welcome").length,
    )
    .toBe(2);
  const welcome = actor.messages
    .filter((message) => message.type === "welcome")
    .at(-1);
  expect(
    welcome?.type === "welcome" ? welcome.randomness?.proof : null,
  ).toEqual(proof);
  // Resume the actual UI and check that the downloadable proof is the same
  // verified beacon, rather than a presentation-only verification badge.
  await actor.page.evaluate((session) => {
    sessionStorage.setItem("polytour-room-v1", JSON.stringify(session));
  }, credential);
  await actor.page.reload();
  await expect(actor.page.locator(".player-card")).toHaveCount(4);
  if (await actor.page.locator(".decision-popup").isVisible())
    await actor.page.keyboard.press("Escape");
  await actor.page
    .getByRole("button", { name: "Dés et preuve", exact: true })
    .click();
  await expect(actor.page.locator(".proof-panel")).toContainText(
    "Signature vérifiée par le serveur",
  );
  const downloadEvent = actor.page.waitForEvent("download");
  await actor.page
    .getByRole("button", { name: "Télécharger la preuve" })
    .click();
  const download = await downloadEvent;
  const proofPath = await download.path();
  if (!proofPath) throw new Error("Expected a downloaded proof file");
  expect(JSON.parse(await readFile(proofPath, "utf8"))).toEqual(proof);
  await actor.page.screenshot({
    path: ".local/verification/live-drand-ui.png",
    fullPage: true,
  });
  // Leaving a legacy room must not carry its hidden mode into a new UI room.
  await actor.page.keyboard.press("Escape");
  await actor.page.getByRole("button", { name: "Menu pause" }).click();
  await actor.page
    .getByRole("button", { name: "Quitter", exact: true })
    .click();
  await actor.page
    .getByRole("button", { name: "Quitter la partie", exact: true })
    .click();
  await actor.page.getByLabel("Votre nom de joueur").fill("Fast after legacy");
  const createdResponse = actor.page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/rooms" &&
      response.request().method() === "POST",
  );
  await actor.page.getByRole("button", { name: "Jouer", exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  expect(created.request().postDataJSON().config.randomnessMode).toBe("secure");
  const fresh = await connect(
    browser,
    (await created.json()) as RoomCredentials,
  );
  const newRoom = fresh.messages.find((message) => message.type === "welcome");
  expect(
    newRoom?.type === "welcome" && newRoom.lobby.config.randomnessMode,
  ).toBe("secure");
  await fresh.page.context().close();
  for (const participant of actors) await participant.page.context().close();
});
