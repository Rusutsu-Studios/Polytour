import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  type Action,
  applyEvent,
  botAction,
  botDecisionAt,
  type PublicState,
} from "../src/shared/engine/index.js";
import type {
  ClientMessage,
  LobbyState,
  RoomCredentials,
  ServerMessage,
} from "../src/shared/protocol/index.js";

type TestWindow = Window & { polytourPauseSocket?: WebSocket };
type Actor = {
  page: Page;
  credentials: RoomCredentials;
  locale: "fr" | "en";
  seq: number;
  state: PublicState | null;
  lobby: LobbyState | null;
  received: ServerMessage[];
  sent: ClientMessage[];
  gaps: string[];
  errors: string[];
};

const desktopSizes = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

function label(actor: Actor, fr: string, en: string) {
  return actor.locale === "fr" ? fr : en;
}

async function createRoom(request: APIRequestContext, bots = 0) {
  const response = await request.post("/api/rooms", {
    data: { name: "Camille", bots, config: { decisionSeconds: 60 } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as RoomCredentials;
}

async function joinRoom(
  request: APIRequestContext,
  roomCode: string,
  name: string,
) {
  const response = await request.post(`/api/rooms/${roomCode}/join`, {
    data: { name },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as RoomCredentials;
}

async function enterRoom(
  browser: Browser,
  credentials: RoomCredentials,
  locale: "fr" | "en",
  viewport: (typeof desktopSizes)[number] = desktopSizes[1],
) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: viewport.width === 1440 ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const actor: Actor = {
    page,
    credentials,
    locale,
    seq: 0,
    state: null,
    lobby: null,
    received: [],
    sent: [],
    gaps: [],
    errors: [],
  };
  page.on("pageerror", (error) => actor.errors.push(error.message));
  page.on("websocket", (socket) => {
    if (!socket.url().includes(`/ws/room/${credentials.roomCode}`)) return;
    socket.on("framesent", ({ payload }) => {
      if (!String(payload).startsWith("{")) return;
      actor.sent.push(JSON.parse(String(payload)) as ClientMessage);
    });
    socket.on("framereceived", ({ payload }) => {
      if (!String(payload).startsWith("{")) return;
      const message = JSON.parse(String(payload)) as ServerMessage;
      actor.received.push(message);
      if (message.type === "welcome") {
        actor.seq = message.seq;
        actor.state = message.snapshot;
        actor.lobby = message.lobby;
      } else if (message.type === "lobby") {
        actor.lobby = message.lobby;
      } else if (message.type === "events") {
        if (message.fromSeq !== actor.seq + 1)
          actor.gaps.push(`${actor.seq} -> ${message.fromSeq}`);
        for (const event of message.events) {
          if (event.type === "GameCreated") actor.state = event.state;
          else if (actor.state) actor.state = applyEvent(actor.state, event);
        }
        actor.seq = message.toSeq;
      }
    });
  });
  // Record the UI's real socket; setup actions use the ordinary authenticated
  // protocol, while every pause request, vote and resume below uses the UI.
  await page.addInitScript(
    ({ session, language }) => {
      localStorage.setItem("polytour.locale", language);
      sessionStorage.setItem("polytour-room-v1", JSON.stringify(session));
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (String(url).includes("/ws/room/"))
            (window as unknown as TestWindow).polytourPauseSocket = this;
        }
      };
    },
    { session: credentials, language: locale },
  );
  await page.goto("/");
  await expect(page.locator(".lobby-connection")).toHaveText(
    label(actor, "Salle connectée", "Room connected"),
  );
  return actor;
}

async function sendSetup(
  actor: Actor,
  message: ClientMessage & { id: string },
) {
  await actor.page.evaluate((frame) => {
    const socket = (window as unknown as TestWindow).polytourPauseSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN)
      throw new Error("Expected the UI's authenticated room socket");
    socket.send(JSON.stringify(frame));
  }, message);
  await expect
    .poll(() =>
      actor.received.find((frame) => "id" in frame && frame.id === message.id),
    )
    .toMatchObject({ type: "ack" });
}

async function startGame(host: Actor, actors: Actor[], playerCount: number) {
  await host.page
    .getByRole("button", {
      name: label(host, "Démarrer la partie", "Start game"),
      exact: true,
    })
    .click();
  for (const actor of actors) {
    await expect(actor.page.locator(".player-card")).toHaveCount(playerCount);
    await expect(actor.page.locator(".canvas-layer")).toHaveAttribute(
      "data-scene-ready",
      "true",
    );
    await expect.poll(() => actor.state?.status).toBe("active");
    // The opening wheel owns focus until its bounded reveal finishes.
    await expect(actor.page.locator(".start-order-dialog[open]")).toHaveCount(
      0,
      {
        timeout: 10_000,
      },
    );
  }
}

async function openPause(actor: Actor, keyboard = false) {
  const trigger = actor.page.getByRole("button", {
    name: label(actor, "Menu pause", "Pause menu"),
    exact: true,
  });
  if (keyboard) await trigger.press("Enter");
  else await trigger.click();
  await expect(actor.page.locator(".pause-dialog")).toBeVisible();
}

function pausedNote(actor: Actor) {
  return label(
    actor,
    "La partie est en pause. Les tours et les chronomètres sont arrêtés.",
    "The game is paused. Turns and clocks are stopped.",
  );
}

function resumeButton(actor: Actor) {
  return actor.page.locator(".pause-dialog").getByRole("button", {
    name: label(actor, "Reprendre la partie", "Resume game"),
    exact: true,
  });
}

function expectClean(actors: Actor[]) {
  for (const actor of actors) {
    expect(actor.gaps).toEqual([]);
    expect(actor.errors).toEqual([]);
    expect(actor.received.filter((frame) => frame.type === "reject")).toEqual(
      [],
    );
  }
}

async function findBotTimer(actor: Actor) {
  // A shuffled first turn may belong to Camille. Advance only the human's
  // setup decisions until a bot has enough presentation time left to pause.
  for (let count = 0; count < 30; count += 1) {
    const state = actor.state;
    if (!state?.pending) throw new Error("Expected an active pending decision");
    const nextAt = botDecisionAt(state);
    const isBot =
      state.players.find((player) => player.seat === state.pending?.seat)
        ?.control === "bot";
    if (isBot && nextAt !== null && nextAt > Date.now() + 2500) return nextAt;
    const previousSeq = actor.seq;
    if (!isBot) {
      const action: Action = botAction(state, state.pending.seat, "medium");
      await sendSetup(actor, {
        type: "intent",
        id: randomUUID(),
        atSeq: actor.seq,
        action,
      });
    }
    await expect
      .poll(() => actor.seq, { timeout: 20_000 })
      .toBeGreaterThan(previousSeq);
  }
  throw new Error("Expected a bot decision with presentation time remaining");
}

for (const viewport of desktopSizes) {
  test(`solo pause freezes real bot timers and clocks, then resumes at ${viewport.width}×${viewport.height}`, async ({
    browser,
    request,
  }) => {
    const credentials = await createRoom(request, 1);
    const actor = await enterRoom(
      browser,
      credentials,
      viewport.width === 1440 ? "en" : "fr",
      viewport,
    );
    try {
      await startGame(actor, [actor], 2);
      const scheduledBotAt = await findBotTimer(actor);
      // Native keyboard activation avoids waiting for a moving pointer target
      // while the real bot alarm approaches. This still opens the normal UI.
      await openPause(actor, true);
      await expect.poll(() => actor.state?.pause?.kind).toBe("paused");
      expect(
        actor.state?.players.find(
          (player) => player.seat === actor.state?.pending?.seat,
        )?.control,
      ).toBe("bot");
      await expect(actor.page.locator(".pause-dialog")).toHaveAttribute(
        "aria-describedby",
        /-note$/,
      );
      await expect(actor.page.locator(".pause-note")).toHaveText(
        pausedNote(actor),
      );
      await expect
        .poll(() =>
          actor.page.evaluate(() => ({
            activeElement: document.activeElement?.outerHTML,
            resumeFocused:
              document.activeElement ===
              document.querySelector(".pause-dialog .pause-primary"),
            openDialogs: [...document.querySelectorAll("dialog[open]")].map(
              (dialog) => dialog.className,
            ),
          })),
        )
        .toMatchObject({ resumeFocused: true });
      await expect(actor.page.locator(".decision-popup[open]")).toHaveCount(0);
      const pausedState = structuredClone(actor.state);
      const pausedSeq = actor.seq;
      const frozenClock = await actor.page.locator(".match-clock").innerText();
      const heldUntil = Math.max(scheduledBotAt + 250, Date.now() + 2100);
      await expect
        .poll(() => Date.now(), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(heldUntil);
      expect(actor.seq).toBe(pausedSeq);
      expect(actor.state).toEqual(pausedState);
      await expect(actor.page.locator(".match-clock")).toHaveText(frozenClock);
      const layout = await actor.page
        .locator(".pause-dialog")
        .evaluate((dialog) => {
          const bounds = dialog.getBoundingClientRect();
          return {
            inside:
              bounds.left >= 0 &&
              bounds.top >= 0 &&
              bounds.right <= innerWidth &&
              bounds.bottom <= innerHeight,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
      expect(layout).toEqual({ inside: true, overflow: false });
      await actor.page.screenshot({
        path: `.local/verification/game-paused-${viewport.width}.png`,
      });
      const resumeMessagesAt = actor.received.length;
      if (viewport.width === 1280) await resumeButton(actor).click();
      else if (viewport.width === 1440)
        await actor.page
          .getByRole("button", { name: "Back to the board", exact: true })
          .click();
      else await actor.page.keyboard.press("Escape");
      await expect(actor.page.locator(".pause-dialog")).toHaveCount(0);
      await expect.poll(() => actor.state?.pause).toBeNull();
      const resumedFrame = actor.received
        .slice(resumeMessagesAt)
        .find(
          (message) =>
            message.type === "events" &&
            message.events.some((event) => event.type === "GameResumed"),
        );
      if (resumedFrame?.type !== "events")
        throw new Error("Expected an authoritative resume event");
      const resumed = resumedFrame.events.find(
        (event) => event.type === "GameResumed",
      );
      if (!pausedState?.pending || !resumed?.pending)
        throw new Error("Expected the bot's decision to survive the pause");
      expect(resumed.pending.seat).toBe(pausedState.pending.seat);
      expect(resumed.pending.deadline).toBeGreaterThan(
        pausedState.pending.deadline,
      );
      expect(resumed.matchDeadline ?? 0).toBeGreaterThan(
        pausedState.matchDeadline ?? 0,
      );
      // The bot can act before a slow browser finishes its UI assertions.
      // Anchor progress to the resume frame, rather than that later sample.
      await expect
        .poll(() => actor.seq, { timeout: 20_000 })
        .toBeGreaterThan(resumedFrame.toSeq);
      expect(
        actor.sent.filter(
          (message) =>
            message.type === "intent" && message.action.type === "RequestPause",
        ),
      ).toHaveLength(1);
      expect(
        actor.sent.filter(
          (message) =>
            message.type === "intent" && message.action.type === "ResumeGame",
        ),
      ).toHaveLength(1);
      expectClean([actor]);
    } finally {
      await actor.page.context().close();
    }
  });
}

test("a second solo view keeps an external pause until deliberate resume and does not create a pause loop", async ({
  browser,
  request,
}) => {
  const credentials = await createRoom(request, 1);
  const first = await enterRoom(browser, credentials, "fr");
  const second = await enterRoom(browser, credentials, "en");
  const actors = [first, second];
  try {
    await startGame(first, actors, 2);
    await openPause(first);
    await expect
      .poll(() => actors.map((actor) => actor.state?.pause?.kind))
      .toEqual(["paused", "paused"]);
    await expect(first.page.locator(".pause-note")).toHaveText(
      pausedNote(first),
    );
    await expect(second.page.locator(".pause-dialog")).toHaveCount(0);
    await expect(
      second.page.getByText("Game paused", { exact: true }),
    ).toBeVisible();
    const pausedSeq = second.seq;
    const heldUntil = Date.now() + 1200;
    await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(heldUntil);
    expect(second.seq).toBe(pausedSeq);
    expect(
      second.sent.filter(
        (message) =>
          message.type === "intent" && message.action.type === "ResumeGame",
      ),
    ).toHaveLength(0);
    await openPause(second);
    await expect(second.page.locator(".pause-note")).toHaveText(
      pausedNote(second),
    );
    await resumeButton(second).click();
    await expect
      .poll(() => actors.map((actor) => actor.state?.pause))
      .toEqual([null, null]);
    const resumedUntil = Date.now() + 1200;
    await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(resumedUntil);
    expect(first.state?.pause).toBeNull();
    expect(
      actors.flatMap((actor) =>
        actor.sent.filter(
          (message) =>
            message.type === "intent" && message.action.type === "RequestPause",
        ),
      ),
    ).toHaveLength(1);
    expect(
      second.sent.filter(
        (message) =>
          message.type === "intent" && message.action.type === "ResumeGame",
      ),
    ).toHaveLength(1);
    expectClean(actors);
  } finally {
    for (const actor of actors) await actor.page.context().close();
  }
});

test("an off-turn human requests a multiplayer vote, decline keeps play running and blocks a new request", async ({
  browser,
  request,
}) => {
  const hostCredentials = await createRoom(request);
  const guestCredentials = await joinRoom(
    request,
    hostCredentials.roomCode,
    "Milo",
  );
  const host = await enterRoom(browser, hostCredentials, "fr");
  const guest = await enterRoom(browser, guestCredentials, "en");
  const actors = [host, guest];
  try {
    await startGame(host, actors, 2);
    const activeSeat = host.state?.activeSeat;
    const requester = actors.find(
      (actor) => actor.credentials.seat !== activeSeat,
    );
    const voter = actors.find((actor) => actor.credentials.seat === activeSeat);
    if (!requester || !voter) throw new Error("Expected two distinct humans");
    await openPause(requester);
    expect(requester.state?.pause).toBeNull();
    const beforeRequestSeq = requester.seq;
    await requester.page
      .getByRole("button", {
        name: label(requester, "Demander une pause", "Request pause"),
        exact: true,
      })
      .click();
    await expect
      .poll(() => voter.state?.pause)
      .toMatchObject({
        kind: "vote",
        requestedBy: requester.credentials.seat,
        requiredSeats: [0, 1],
        acceptedSeats: [requester.credentials.seat],
      });
    await expect.poll(() => requester.seq).toBeGreaterThan(beforeRequestSeq);
    expect(voter.state?.activeSeat).toBe(activeSeat);
    await expect(voter.page.locator(".pause-dialog")).toBeVisible();
    await expect(voter.page.locator(".pause-dialog")).toContainText(
      /1\s*\/\s*2/,
    );
    const previousTime = await voter.page.locator(".match-clock").innerText();
    await expect
      .poll(() => voter.page.locator(".match-clock").innerText())
      .not.toBe(previousTime);
    const voterName = voter.credentials.seat === 0 ? "Camille" : "Milo";
    await voter.page
      .getByRole("button", {
        name: label(
          voter,
          `Refuser la pause pour ${voterName}`,
          `Decline pause for ${voterName}`,
        ),
        exact: true,
      })
      .click();
    await expect
      .poll(() => actors.map((actor) => actor.state?.pause))
      .toEqual([null, null]);
    expect(host.state?.pauseCooldownUntil).toBeGreaterThan(
      Date.now() + 290_000,
    );
    for (const actor of actors) {
      await expect(actor.page.locator(".pause-dialog")).toContainText(
        label(actor, "Nouvelle demande dans", "Next request in"),
      );
      await expect(
        actor.page.getByRole("button", {
          name: label(actor, "Demander une pause", "Request pause"),
          exact: true,
        }),
      ).toBeDisabled();
      await actor.page.keyboard.press("Escape");
      await openPause(actor);
      await expect(
        actor.page.getByRole("button", {
          name: label(actor, "Demander une pause", "Request pause"),
          exact: true,
        }),
      ).toBeDisabled();
    }
    expect(
      actors.flatMap((actor) =>
        actor.sent.filter(
          (message) =>
            message.type === "intent" && message.action.type === "RequestPause",
        ),
      ),
    ).toHaveLength(1);
    expectClean(actors);
  } finally {
    for (const actor of actors) await actor.page.context().close();
  }
});

test("each local human must accept, and a unanimous paused snapshot survives reload until any human resumes", async ({
  browser,
  request,
}) => {
  const hostCredentials = await createRoom(request);
  const guestCredentials = await joinRoom(
    request,
    hostCredentials.roomCode,
    "Milo",
  );
  const host = await enterRoom(browser, hostCredentials, "fr");
  const guest = await enterRoom(browser, guestCredentials, "en");
  const actors = [host, guest];
  try {
    await sendSetup(host, {
      type: "lobby",
      id: randomUUID(),
      op: { type: "add-local", seat: 2, name: "Sora" },
    });
    await expect.poll(() => host.lobby?.seats[2]?.controller).toBe(0);
    await startGame(host, actors, 3);
    await openPause(guest);
    await guest.page
      .getByRole("button", { name: "Request pause", exact: true })
      .click();
    await expect(host.page.locator(".pause-dialog")).toBeVisible();
    await expect(
      host.page.getByRole("button", {
        name: "Accepter la pause pour Camille",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      host.page.getByRole("button", {
        name: "Accepter la pause pour Sora",
        exact: true,
      }),
    ).toBeVisible();
    await host.page
      .getByRole("button", {
        name: "Accepter la pause pour Camille",
        exact: true,
      })
      .click();
    await expect
      .poll(() => host.state?.pause)
      .toMatchObject({
        kind: "vote",
        requiredSeats: [0, 1, 2],
        acceptedSeats: [1, 0],
      });
    await expect(host.page.locator(".pause-dialog")).toContainText(
      /2\s*\/\s*3/,
    );
    await host.page
      .getByRole("button", { name: "Réglages", exact: true })
      .click();
    await host.page.keyboard.press("Escape");
    await expect(
      host.page.getByRole("button", { name: "Réglages", exact: true }),
    ).toBeFocused();
    const finalConsent = host.page.getByRole("button", {
      name: "Accepter la pause pour Sora",
      exact: true,
    });
    await finalConsent.focus();
    await host.page.keyboard.press("Enter");
    await expect
      .poll(() => actors.map((actor) => actor.state?.pause?.kind))
      .toEqual(["paused", "paused"]);
    await expect(resumeButton(host)).toBeFocused();
    for (const actor of actors)
      await expect(actor.page.locator(".pause-note")).toHaveText(
        pausedNote(actor),
      );
    expect(
      host.sent.filter(
        (message) =>
          message.type === "intent" && message.action.type === "VotePause",
      ),
    ).toEqual([
      expect.objectContaining({
        seat: 0,
        action: { type: "VotePause", accept: true },
      }),
      expect.objectContaining({
        seat: 2,
        action: { type: "VotePause", accept: true },
      }),
    ]);
    const pausedState = structuredClone(guest.state);
    const welcomes = guest.received.filter(
      (message) => message.type === "welcome",
    ).length;
    await guest.page.reload();
    await expect(guest.page.locator(".player-card")).toHaveCount(3);
    await expect
      .poll(
        () =>
          guest.received.filter((message) => message.type === "welcome").length,
      )
      .toBe(welcomes + 1);
    expect(guest.state).toEqual(pausedState);
    if (!(await guest.page.locator(".pause-dialog").isVisible()))
      await openPause(guest);
    await expect(guest.page.locator(".pause-note")).toHaveText(
      pausedNote(guest),
    );
    await guest.page.keyboard.press("Escape");
    await expect(guest.page.locator(".pause-dialog")).toHaveCount(0);
    expect(guest.state?.pause?.kind).toBe("paused");
    await openPause(guest);
    await resumeButton(guest).click();
    await expect
      .poll(() => actors.map((actor) => actor.state?.pause))
      .toEqual([null, null]);
    expect(host.state?.pending?.deadline ?? 0).toBeGreaterThan(
      pausedState?.pending?.deadline ?? 0,
    );
    await expect(guest.page.locator(".pause-dialog")).toHaveCount(0);
    expect(
      guest.sent.filter(
        (message) =>
          message.type === "intent" && message.action.type === "RequestPause",
      ),
    ).toHaveLength(1);
    expect(
      guest.sent.filter(
        (message) =>
          message.type === "intent" && message.action.type === "ResumeGame",
      ),
    ).toHaveLength(1);
    expectClean(actors);
  } finally {
    for (const actor of actors) await actor.page.context().close();
  }
});
