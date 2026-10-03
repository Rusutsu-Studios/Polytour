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
  await actor.page.locator(".settings-trigger").click();
  await expect(
    actor.page.locator(".settings-dialog .room-settings"),
  ).not.toContainText("drand");
  await actor.page
    .getByRole("button", { name: "Appliquer les réglages" })
    .click();
  await actor.page.getByLabel("Votre nom de joueur").fill("Fast after legacy");
  const createdResponse = actor.page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/rooms" &&
      response.request().method() === "POST",
  );
  await actor.page
    .getByRole("button", { name: "Créer une salle entre amis" })
    .click();
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
