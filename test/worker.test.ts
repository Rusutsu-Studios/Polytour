import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_TIMING,
  DECISION_TIMING,
  getBoard,
  isCityTile,
  isResortTile,
} from "../src/shared/board/index.js";
import type {
  GameEvent,
  GameState,
  PublicState,
  Seat,
} from "../src/shared/engine/index.js";
import {
  applyEvent,
  botDecisionAt,
  CHANCE_CARDS,
  propertyRent,
  toPublic,
} from "../src/shared/engine/index.js";
import type {
  LobbyState,
  RoomCredentials,
  ServerMessage,
} from "../src/shared/protocol/index.js";

const origin = "https://example.test";
const activeSockets: WebSocket[] = [];
class Inbox {
  readonly socket: WebSocket;
  readonly messages: ServerMessage[] = [];
  readonly received: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      this.messages.push(message);
      this.received.push(message);
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.accept();
    activeSockets.push(socket);
  }
  send(value: unknown): void {
    this.socket.send(JSON.stringify(value));
  }
  async next<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const index = this.messages.findIndex((message) => message.type === type);
      if (index >= 0)
        return this.messages.splice(index, 1)[0] as Extract<
          ServerMessage,
          { type: T }
        >;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}
function createRoom(body: Record<string, unknown>): Promise<Response> {
  return exports.default.fetch(
    new Request(`${origin}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    }),
  );
}
async function create(
  mode?: "secure" | "drand",
  bots?: number,
): Promise<RoomCredentials & { seat: Seat }> {
  const response = await createRoom({
    name: "Alex",
    ...(mode === undefined ? {} : { config: { randomnessMode: mode } }),
    ...(bots === undefined ? {} : { bots }),
  });
  expect(response.status).toBe(201);
  const credentials = await response.json<RoomCredentials>();
  if (credentials.seat === null) throw new Error("Creator seat expected");
  return { ...credentials, seat: credentials.seat };
}
async function lobbyOf(code: string): Promise<LobbyState> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/rooms/${code}`),
  );
  return (await response.json<{ lobby: LobbyState }>()).lobby;
}
/** Resolves with "ack" or the rejection reason for one room message. */
async function answer(inbox: Inbox, id: string): Promise<string> {
  for (;;) {
    const reply = inbox.messages.find(
      (message) =>
        (message.type === "ack" || message.type === "reject") &&
        message.id === id,
    );
    if (reply) {
      inbox.messages.splice(inbox.messages.indexOf(reply), 1);
      return reply.type === "reject" ? reply.reason : "ack";
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function roomOp(
  inbox: Inbox,
  id: string,
  op: Record<string, unknown>,
): Promise<string> {
  inbox.send({ type: "lobby", id, op });
  return answer(inbox, id);
}
async function eventsWith(
  inbox: Inbox,
  type: GameEvent["type"],
): Promise<Extract<ServerMessage, { type: "events" }>> {
  for (;;) {
    const message = await inbox.next("events");
    if (message.events.some((event) => event.type === type)) return message;
  }
}
async function join(code: string, name: string): Promise<RoomCredentials> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/rooms/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json<RoomCredentials>();
}
async function leave(credentials: RoomCredentials): Promise<Response> {
  return exports.default.fetch(
    new Request(`${origin}/api/rooms/${credentials.roomCode}/leave`, {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${credentials.token}` },
    }),
  );
}
async function joinSeated(
  code: string,
  name: string,
): Promise<RoomCredentials & { seat: Seat }> {
  const credentials = await join(code, name);
  if (credentials.seat === null) throw new Error("Seated player expected");
  return { ...credentials, seat: credentials.seat };
}
async function readLobby(code: string): Promise<LobbyState> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/rooms/${code}`),
  );
  expect(response.status).toBe(200);
  return (await response.json<{ lobby: LobbyState }>()).lobby;
}
function waitForClose(inbox: Inbox): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) =>
    inbox.socket.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
      { once: true },
    ),
  );
}
async function expectRevoked(credentials: RoomCredentials): Promise<void> {
  const repeated = await leave(credentials);
  expect(repeated.status).toBe(401);
  expect(await repeated.json()).toEqual({ error: "unauthorized" });
  const reconnect = await exports.default.fetch(
    new Request(`${origin}/ws/room/${credentials.roomCode}`, {
      headers: {
        Upgrade: "websocket",
        Origin: origin,
        "Sec-WebSocket-Protocol": `polytour, seat.${credentials.token}`,
      },
    }),
  );
  expect(reconnect.status).toBe(401);
  expect(await reconnect.json()).toEqual({ error: "unauthorized" });
}
async function connect(
  credentials: RoomCredentials,
  lastSeq: number | null = null,
): Promise<Inbox> {
  const response = await exports.default.fetch(
    new Request(`${origin}/ws/room/${credentials.roomCode}`, {
      headers: {
        Upgrade: "websocket",
        Origin: origin,
        "Sec-WebSocket-Protocol": `polytour, seat.${credentials.token}`,
      },
    }),
  );
  expect(response.status).toBe(101);
  if (!response.webSocket) throw new Error("WebSocket expected");
  const inbox = new Inbox(response.webSocket);
  inbox.send({ type: "sync", lastSeq });
  return inbox;
}
async function startFour(): Promise<{
  credentials: RoomCredentials[];
  inboxes: Inbox[];
  state: PublicState;
  seq: number;
}> {
  const host = await create();
  const credentials = [
    host,
    await join(host.roomCode, "Bo"),
    await join(host.roomCode, "Cam"),
    await join(host.roomCode, "Dee"),
  ];
  const inboxes = await Promise.all(
    credentials.map((credential) => connect(credential)),
  );
  await Promise.all(inboxes.map((inbox) => inbox.next("welcome")));
  inboxes[0].send({
    type: "lobby",
    id: "start",
    op: { type: "start", fillBots: false },
  });
  const events = await inboxes[0].next("events");
  const created = events.events.find((event) => event.type === "GameCreated");
  if (created?.type !== "GameCreated") throw new Error("GameCreated expected");
  const state = events.events.reduce(applyEvent, created.state);
  await Promise.all(inboxes.slice(1).map((inbox) => inbox.next("events")));
  return { credentials, inboxes, state, seq: events.toSeq };
}
async function closeInbox(inbox: Inbox): Promise<void> {
  const closed = new Promise<void>((resolve) =>
    inbox.socket.addEventListener("close", () => resolve(), { once: true }),
  );
  inbox.socket.close(1000);
  await closed;
}
beforeEach(async () => {
  await runInDurableObject(
    env.MATCHMAKER.getByName("room-admission"),
    (_instance, state) => state.storage.delete("room-creation-budget"),
  );
});

afterEach(() => {
  for (const socket of activeSockets.splice(0)) socket.close(1000);
  vi.restoreAllMocks();
});

describe("Authoritative private rooms", () => {
  it("sleeps abandoned matches, retains their deadline and resumes after eviction", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    await Promise.all(game.inboxes.map(closeInbox));
    const dormant = await runInDurableObject(
      stub,
      (_instance, durableState) => {
        const sql = durableState.storage.sql;
        return {
          sockets: durableState.getWebSockets().length,
          state: sql
            .exec<{ seq: number; json: string }>(
              "SELECT seq,json FROM state WHERE id=1",
            )
            .toArray()[0],
          timers: sql
            .exec<{ kind: string; fire_at: number }>(
              "SELECT kind,fire_at FROM timers ORDER BY kind",
            )
            .toArray(),
        };
      },
    );
    expect(dormant.sockets).toBe(0);
    expect(dormant.state.seq).toBe(game.seq);
    expect(dormant.timers.map((timer) => timer.kind)).toEqual([
      "grace:0",
      "grace:1",
      "grace:2",
      "grace:3",
      "match-end",
    ]);
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind LIKE 'grace:%'",
        Date.now() - 1,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const sleeping = await runInDurableObject(
      stub,
      async (_instance, durableState) => ({
        timers: durableState.storage.sql
          .exec<{ kind: string; fire_at: number }>(
            "SELECT kind,fire_at FROM timers",
          )
          .toArray(),
        alarm: await durableState.storage.getAlarm(),
        seq: durableState.storage.sql
          .exec<{ seq: number }>("SELECT seq FROM state WHERE id=1")
          .toArray()[0].seq,
      }),
    );
    expect(sleeping.timers).toEqual([
      { kind: "match-end", fire_at: game.state.matchDeadline },
    ]);
    expect(sleeping.alarm).toBe(game.state.matchDeadline);
    expect(sleeping.seq).toBe(game.seq);
    // An old deployment may leave a due bot timer in an already abandoned room.
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec(
        "INSERT INTO timers(kind,fire_at) VALUES('bot',?)",
        Date.now() - 1,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(
      await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec<{ seq: number }>("SELECT seq FROM state WHERE id=1")
            .toArray()[0].seq,
      ),
    ).toBe(game.seq);
    await evictDurableObject(stub);
    const resumed = await connect(game.credentials[0]);
    const welcome = await resumed.next("welcome");
    expect(welcome.seq).toBe(game.seq);
    expect(welcome.snapshot?.matchDeadline).toBe(game.state.matchDeadline);
    expect(welcome.snapshot?.pending?.deadline).toBe(
      game.state.pending?.deadline,
    );
    expect(
      await runInDurableObject(stub, (_instance, durableState) => ({
        turnTimers: durableState.storage.sql
          .exec("SELECT kind FROM timers WHERE kind IN ('decision','bot')")
          .toArray().length,
        takeover: durableState.storage.sql
          .exec("SELECT v FROM meta WHERE k='takeover:0'")
          .toArray().length,
      })),
    ).toEqual({ turnTimers: 1, takeover: 0 });
  });

  it("expires an abandoned match once without replaying two hours of bot moves", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    await Promise.all(game.inboxes.map(closeInbox));
    await runInDurableObject(stub, (_instance, durableState) => {
      const sql = durableState.storage.sql;
      const row = sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const saved = JSON.parse(row.json) as GameState;
      sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({ ...saved, matchDeadline: Date.now() - 1 }),
      );
      sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('randomness',?)",
        Date.now() - 1,
      );
      sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('bot',?)",
        Date.now() - 1,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const ended = await runInDurableObject(stub, (_instance, durableState) => {
      const sql = durableState.storage.sql;
      const row = sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      return {
        state: JSON.parse(row.json) as GameState,
        events: sql
          .exec<{ json: string }>(
            "SELECT json FROM events WHERE seq>? ORDER BY seq",
            game.seq,
          )
          .toArray()
          .map((event) => JSON.parse(event.json) as { type: string }),
        timers: sql
          .exec<{ kind: string }>("SELECT kind FROM timers ORDER BY kind")
          .toArray()
          .map((timer) => timer.kind),
      };
    });
    expect(ended.state.status).toBe("finished");
    expect(
      ended.events.filter((event) => event.type === "GameOver"),
    ).toHaveLength(1);
    expect(ended.events.some((event) => event.type === "DiceRolled")).toBe(
      false,
    );
    expect(ended.timers).not.toContain("bot");
    expect(ended.timers).not.toContain("decision");
    expect(ended.timers).not.toContain("randomness");
    const resumed = await connect(game.credentials[0]);
    expect((await resumed.next("welcome")).snapshot?.result?.kind).toBe(
      "time-limit",
    );
  });

  it("leaves no application tables after room cleanup and ignores close callbacks", async () => {
    const host = await create();
    const inbox = await connect(host);
    await inbox.next("welcome");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    const closed = new Promise<void>((resolve) =>
      inbox.socket.addEventListener("close", () => resolve(), { once: true }),
    );
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind='cleanup'",
        Date.now() - 1,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await closed;
    const missing = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${host.roomCode}`),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "room-not-found" });
    const missingJoin = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${host.roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: "Late" }),
      }),
    );
    expect(missingJoin.status).toBe(404);
    expect(await missingJoin.json()).toEqual({ error: "room-not-found" });
    const tables = () =>
      runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('meta','seats','state','events','timers','commands')",
          )
          .toArray(),
      );
    expect(await tables()).toEqual([]);
    await evictDurableObject(stub);
    expect((await stub.fetch(`${origin}/missing`)).status).toBe(404);
    expect(await tables()).toEqual([]);
  });

  it("keeps unknown room reads, joins, health checks and alarms storage-free", async () => {
    const stub = env.GAME_ROOM.getByName("UNKNWN");
    const health = await stub.fetch(`${origin}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ kind: "game-room", status: "ok" });
    const missing = await stub.fetch(`${origin}/api/rooms/UNKNWN`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "room-not-found" });
    expect(await stub.join("Visitor")).toEqual({ error: "room-not-found" });
    const upgrade = await stub.fetch(
      new Request(`${origin}/ws/room/UNKNWN`, {
        headers: { Origin: origin, Upgrade: "websocket" },
      }),
    );
    expect(upgrade.status).toBe(404);
    expect(await upgrade.json()).toEqual({ error: "room-not-found" });
    await runInDurableObject(stub, async (instance, durableState) => {
      const room = instance as unknown as { alarm(): Promise<void> };
      await room.alarm();
      expect(
        durableState.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('meta','seats','state','events','timers','commands')",
          )
          .toArray(),
      ).toEqual([]);
      expect(await durableState.storage.getAlarm()).toBeNull();
    });
    await evictDurableObject(stub);
    const afterEviction = await stub.fetch(`${origin}/api/rooms/UNKNWN`);
    expect(afterEviction.status).toBe(404);
    expect(await afterEviction.json()).toEqual({ error: "room-not-found" });
    expect(
      await runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'",
          )
          .toArray(),
      ),
    ).toEqual([]);
  });

  it("broadcasts lobby disconnects without adding grace timers or extending cleanup", async () => {
    const host = await create();
    const guest = await join(host.roomCode, "Bo");
    const hostInbox = await connect(host);
    await hostInbox.next("welcome");
    const guestInbox = await connect(guest);
    await guestInbox.next("welcome");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    const readTimers = () =>
      runInDurableObject(stub, async (_instance, durableState) => ({
        timers: durableState.storage.sql
          .exec<{ kind: string; fire_at: number }>(
            "SELECT kind,fire_at FROM timers ORDER BY kind",
          )
          .toArray(),
        alarm: await durableState.storage.getAlarm(),
      }));
    const before = await readTimers();
    expect(before.timers.map((timer) => timer.kind)).toEqual(["cleanup"]);
    await closeInbox(guestInbox);
    for (;;) {
      const presence = await hostInbox.next("presence");
      if (presence.seat === guest.seat && presence.status === "away") break;
    }
    expect(await readTimers()).toEqual(before);
    const response = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${host.roomCode}`),
    );
    const body = await response.json<{
      lobby: { seats: { online: boolean }[] };
    }>();
    expect(body.lobby.seats[host.seat].online).toBe(true);
    expect(body.lobby.seats[guest.seat].online).toBe(false);
  });

  it("explicitly leaves the lobby and persists host authority on an online remaining human", async () => {
    const host = await create();
    const offlineGuest = await joinSeated(host.roomCode, "Bo");
    const nextHost = await joinSeated(host.roomCode, "Cam");
    const hostInbox = await connect(host);
    await hostInbox.next("welcome");
    const nextHostInbox = await connect(nextHost);
    await nextHostInbox.next("welcome");
    const closed = waitForClose(hostInbox);
    const response = await leave(host);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await closed).toEqual({ code: 1008, reason: "Left room" });
    let announced = (await nextHostInbox.next("lobby")).lobby;
    while (announced.hostSeat !== nextHost.seat)
      announced = (await nextHostInbox.next("lobby")).lobby;
    expect(announced.seats[host.seat]).toMatchObject({
      control: null,
      online: false,
    });
    const rejectedReconnect = await exports.default.fetch(
      new Request(`${origin}/ws/room/${host.roomCode}`, {
        headers: {
          Upgrade: "websocket",
          Origin: origin,
          "Sec-WebSocket-Protocol": `polytour, seat.${host.token}`,
        },
      }),
    );
    expect(rejectedReconnect.status).toBe(401);
    expect(await rejectedReconnect.json()).toEqual({ error: "unauthorized" });
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await closeInbox(nextHostInbox);
    await evictDurableObject(stub);
    const resumed = await connect(nextHost);
    const welcome = await resumed.next("welcome");
    expect(welcome.lobby.hostSeat).toBe(nextHost.seat);
    const guestInbox = await connect(offlineGuest);
    await guestInbox.next("welcome");
    guestInbox.send({
      type: "lobby",
      id: "former-guest-start",
      op: { type: "start", fillBots: false },
    });
    expect((await guestInbox.next("reject")).reason).toBe("host-only");
    resumed.send({
      type: "lobby",
      id: "new-host-settings",
      op: {
        type: "settings",
        config: { ...welcome.lobby.config, startingCash: 3_000_000 },
      },
    });
    expect((await resumed.next("ack")).id).toBe("new-host-settings");
    expect((await readLobby(host.roomCode)).config.startingCash).toBe(
      3_000_000,
    );
    for (const type of ["add-bot", "remove-bot"] as const) {
      resumed.send({ type: "lobby", id: type, op: { type, seat: 0 } });
      expect((await resumed.next("ack")).id).toBe(type);
    }
    resumed.send({
      type: "lobby",
      id: "new-host-start",
      op: { type: "start", fillBots: false },
    });
    expect((await resumed.next("ack")).id).toBe("new-host-start");
    const events = await resumed.next("events");
    expect(
      events.events.find((event) => event.type === "GameCreated"),
    ).toMatchObject({
      state: {
        players: [
          { seat: offlineGuest.seat, name: "Bo" },
          { seat: nextHost.seat, name: "Cam" },
        ],
      },
    });
  });

  it("keeps the host when a guest quits but retains seats for ordinary lobby disconnections", async () => {
    const host = await create();
    const guest = await joinSeated(host.roomCode, "Bo");
    const hostInbox = await connect(host);
    await hostInbox.next("welcome");
    const guestInbox = await connect(guest);
    await guestInbox.next("welcome");
    await closeInbox(hostInbox);
    const disconnected = await readLobby(host.roomCode);
    expect(disconnected.hostSeat).toBe(host.seat);
    expect(disconnected.seats[host.seat]).toMatchObject({
      control: "human",
      online: false,
    });
    const resumed = await connect(host);
    await resumed.next("welcome");
    const closed = waitForClose(guestInbox);
    expect((await leave(guest)).status).toBe(200);
    await closed;
    const departed = await readLobby(host.roomCode);
    expect(departed.hostSeat).toBe(host.seat);
    expect(departed.seats[guest.seat]).toMatchObject({
      control: null,
      online: false,
    });
    expect((await join(host.roomCode, "Replacement")).seat).toBe(guest.seat);
    expect((await leave(guest)).status).toBe(401);
  });

  it("closes every tab, clears departed commands and ignores callbacks after the lobby seat is reused", async () => {
    const host = await create();
    const guest = await joinSeated(host.roomCode, "Bo");
    const hostInboxes = [await connect(host), await connect(host)];
    const guestInbox = await connect(guest);
    const welcome = await hostInboxes[0].next("welcome");
    await hostInboxes[1].next("welcome");
    await guestInbox.next("welcome");
    hostInboxes[0].send({
      type: "lobby",
      id: "reused-command",
      op: { type: "settings", config: welcome.lobby.config },
    });
    await hostInboxes[0].next("ack");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (instance, durableState) => {
      (
        instance as unknown as { departedSockets: WebSocket[] }
      ).departedSockets = durableState.getWebSockets(`seat:${host.seat}`);
    });
    const closes = hostInboxes.map(waitForClose);
    expect((await leave(host)).status).toBe(200);
    expect(await Promise.all(closes)).toEqual([
      { code: 1008, reason: "Left room" },
      { code: 1008, reason: "Left room" },
    ]);
    expect(
      await runInDurableObject(stub, (_instance, durableState) => ({
        seats: durableState.storage.sql
          .exec("SELECT seat FROM seats WHERE seat=0")
          .toArray(),
        commands: durableState.storage.sql
          .exec("SELECT id FROM commands WHERE seat=0")
          .toArray(),
      })),
    ).toEqual({ seats: [], commands: [] });
    const replacement = await joinSeated(host.roomCode, "Replacement");
    expect(replacement.seat).toBe(host.seat);
    const stalePresence = await runInDurableObject(stub, async (instance) => {
      const handlers = instance as unknown as {
        departedSockets: WebSocket[];
        webSocketClose(socket: WebSocket): Promise<void>;
        webSocketError(socket: WebSocket): Promise<void>;
        broadcast(message: ServerMessage): void;
      };
      const messages: ServerMessage[] = [];
      const original = handlers.broadcast;
      handlers.broadcast = (message) => messages.push(message);
      try {
        for (const socket of handlers.departedSockets) {
          await handlers.webSocketClose(socket);
          await handlers.webSocketError(socket);
        }
      } finally {
        handlers.broadcast = original;
      }
      return messages.filter((message) => message.type === "presence").length;
    });
    expect(stalePresence).toBe(0);
    const reused = await readLobby(host.roomCode);
    expect(reused.hostSeat).toBe(guest.seat);
    expect(reused.seats[replacement.seat]).toMatchObject({
      name: "Replacement",
      control: "human",
      online: false,
    });
    const replacementInbox = await connect(replacement);
    await replacementInbox.next("welcome");
    const guestClosed = waitForClose(guestInbox);
    expect((await leave(guest)).status).toBe(200);
    await guestClosed;
    replacementInbox.send({
      type: "lobby",
      id: "reused-command",
      op: { type: "settings", config: welcome.lobby.config },
    });
    expect((await replacementInbox.next("ack")).id).toBe("reused-command");
  });

  it("falls back to seat zero for legacy lobbies without persisted host metadata", async () => {
    const host = await create();
    const guest = await join(host.roomCode, "Bo");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec("DELETE FROM meta WHERE k='host'"),
    );
    await evictDurableObject(stub);
    const hostInbox = await connect(host);
    const welcome = await hostInbox.next("welcome");
    expect(welcome.lobby.hostSeat).toBe(host.seat);
    const guestInbox = await connect(guest);
    await guestInbox.next("welcome");
    hostInbox.send({
      type: "lobby",
      id: "legacy-host",
      op: { type: "settings", config: welcome.lobby.config },
    });
    expect((await hostInbox.next("ack")).id).toBe("legacy-host");
    const closed = waitForClose(hostInbox);
    expect((await leave(host)).status).toBe(200);
    await closed;
    expect((await readLobby(host.roomCode)).hostSeat).toBe(guest.seat);
  });

  it("makes the next human host after everyone leaves even when bots occupy earlier seats", async () => {
    const host = await create();
    const guest = await join(host.roomCode, "Bo");
    expect((await leave(host)).status).toBe(200);
    const guestInbox = await connect(guest);
    await guestInbox.next("welcome");
    guestInbox.send({
      type: "lobby",
      id: "earlier-bot",
      op: { type: "add-bot", seat: 0 },
    });
    expect((await guestInbox.next("ack")).id).toBe("earlier-bot");
    expect(
      await roomOp(guestInbox, "last-leader-lock", {
        type: "lock",
        locked: true,
      }),
    ).toBe("ack");
    const closed = waitForClose(guestInbox);
    expect((await leave(guest)).status).toBe(200);
    await closed;
    expect((await readLobby(host.roomCode)).locked).toBe(false);
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await evictDurableObject(stub);
    const replacement = await join(host.roomCode, "Replacement");
    expect(replacement.seat).toBe(1);
    const replacementInbox = await connect(replacement);
    const welcome = await replacementInbox.next("welcome");
    expect(welcome.lobby.hostSeat).toBe(replacement.seat);
    expect(welcome.lobby.seats[0].control).toBe("bot");
    replacementInbox.send({
      type: "lobby",
      id: "new-human-start",
      op: { type: "start", fillBots: false },
    });
    expect((await replacementInbox.next("ack")).id).toBe("new-human-start");
    expect(
      (await replacementInbox.next("events")).events.some(
        (event) => event.type === "GameCreated",
      ),
    ).toBe(true);
  });

  it("rejects unauthenticated, foreign-token and cross-origin departures without changing the room", async () => {
    const host = await create();
    const foreign = await create();
    const inbox = await connect(host);
    await inbox.next("welcome");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    const readStored = () =>
      runInDurableObject(stub, (_instance, durableState) => ({
        meta: durableState.storage.sql
          .exec("SELECT k,v FROM meta ORDER BY k")
          .toArray(),
        seats: durableState.storage.sql
          .exec("SELECT seat,name,control,token_hash FROM seats ORDER BY seat")
          .toArray(),
        timers: durableState.storage.sql
          .exec("SELECT kind,fire_at FROM timers ORDER BY kind")
          .toArray(),
        sockets: durableState
          .getWebSockets()
          .filter((socket) => socket.readyState === WebSocket.OPEN).length,
      }));
    const before = await readStored();
    for (const [headers, status] of [
      [{ Origin: origin }, 401],
      [{ Origin: origin, Authorization: "Bearer test-token-not-real" }, 401],
      [{ Origin: origin, Authorization: `Bearer ${foreign.token}` }, 401],
      [
        { Origin: "https://evil.test", Authorization: `Bearer ${host.token}` },
        403,
      ],
    ] as const) {
      const response = await exports.default.fetch(
        new Request(`${origin}/api/rooms/${host.roomCode}/leave`, {
          method: "POST",
          headers,
        }),
      );
      expect(response.status).toBe(status);
      expect(await readStored()).toEqual(before);
    }
    const missing = await leave({ ...host, roomCode: "ZZYYYY" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "room-not-found" });
  });

  it.each(["active", "finished"] as const)(
    "preserves %s matches and their seat credentials on explicit departure",
    async (status) => {
      const host = await create();
      const hostInbox = await connect(host);
      await hostInbox.next("welcome");
      expect(
        await roomOp(hostInbox, "local-player", {
          type: "add-local",
          seat: 1,
          name: "Sam",
        }),
      ).toBe("ack");
      const guest = await joinSeated(host.roomCode, "Bo");
      const guestInbox = await connect(guest);
      await guestInbox.next("welcome");
      expect(
        await roomOp(hostInbox, "start", { type: "start", fillBots: false }),
      ).toBe("ack");
      await hostInbox.next("events");
      const stub = env.GAME_ROOM.getByName(host.roomCode);
      const secondTab = await connect(host);
      await secondTab.next("welcome");
      if (status === "finished") {
        await runInDurableObject(stub, (_instance, durableState) => {
          const row = durableState.storage.sql
            .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
            .toArray()[0];
          const state = JSON.parse(row.json) as GameState;
          durableState.storage.sql.exec(
            "UPDATE state SET json=? WHERE id=1",
            JSON.stringify({ ...state, matchDeadline: Date.now() - 1 }),
          );
          durableState.storage.sql.exec(
            "UPDATE timers SET fire_at=? WHERE kind='match-end'",
            Date.now() - 1,
          );
        });
        expect(await runDurableObjectAlarm(stub)).toBe(true);
      }
      const readStored = () =>
        runInDurableObject(stub, (_instance, durableState) => ({
          state: durableState.storage.sql
            .exec("SELECT seq,json FROM state WHERE id=1")
            .toArray(),
          seats: durableState.storage.sql
            .exec(
              "SELECT seat,name,control,token_hash FROM seats ORDER BY seat",
            )
            .toArray(),
          commands: durableState.storage.sql
            .exec("SELECT seat,id FROM commands ORDER BY seat,id")
            .toArray(),
          locals: durableState.storage.sql
            .exec("SELECT seat,controller FROM local_seats ORDER BY seat")
            .toArray(),
          host: durableState.storage.sql
            .exec("SELECT v FROM meta WHERE k='host'")
            .toArray(),
        }));
      const before = await readStored();
      const closes = [hostInbox, secondTab].map(waitForClose);
      const leftAt = Date.now();
      expect((await leave(host)).status).toBe(200);
      expect(await Promise.all(closes)).toEqual([
        { code: 1008, reason: "Left room" },
        { code: 1008, reason: "Left room" },
      ]);
      for (const seat of [0, 1]) {
        for (;;) {
          const presence = await guestInbox.next("presence");
          if (presence.seat === seat && presence.status === "away") break;
        }
      }
      expect(await readStored()).toEqual(before);
      const lobby = await readLobby(host.roomCode);
      expect(lobby.hostSeat).toBe(host.seat);
      expect(lobby.seats[host.seat]).toMatchObject({
        control: "human",
        online: false,
      });
      expect(lobby.seats[1]).toMatchObject({
        name: "Sam",
        control: "human",
        online: false,
        controller: host.seat,
      });
      const grace = await runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql
          .exec<{ kind: string; fire_at: number }>(
            "SELECT kind,fire_at FROM timers WHERE kind IN ('grace:0','grace:1') ORDER BY kind",
          )
          .toArray(),
      );
      if (status === "active") {
        expect(grace.map((timer) => timer.kind)).toEqual([
          "grace:0",
          "grace:1",
        ]);
        for (const timer of grace) {
          expect(timer.fire_at).toBeGreaterThanOrEqual(leftAt + 60_000);
          expect(timer.fire_at).toBeLessThanOrEqual(Date.now() + 60_000);
        }
      } else expect(grace).toEqual([]);
      const resumed = await connect(host);
      expect(
        (await resumed.next("welcome")).lobby.seats
          .slice(0, 2)
          .map((seat) => seat.online),
      ).toEqual([true, true]);
      expect(
        await runInDurableObject(stub, (_instance, durableState) =>
          durableState.storage.sql
            .exec("SELECT kind FROM timers WHERE kind IN ('grace:0','grace:1')")
            .toArray(),
        ),
      ).toEqual([]);
    },
  );

  it("starts reconnect grace for humans who left the lobby and lets a bot take over", async () => {
    const host = await create();
    const guest = await join(host.roomCode, "Bo");
    const hostInbox = await connect(host);
    await hostInbox.next("welcome");
    const guestInbox = await connect(guest);
    await guestInbox.next("welcome");
    await closeInbox(guestInbox);
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    expect(
      await runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql
          .exec("SELECT kind FROM timers WHERE kind LIKE 'grace:%'")
          .toArray(),
      ),
    ).toEqual([]);
    hostInbox.send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: true },
    });
    const started = await hostInbox.next("events");
    const created = started.events.find(
      (event) => event.type === "GameCreated",
    );
    if (created?.type !== "GameCreated")
      throw new Error("GameCreated expected");
    const grace = await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql
        .exec<{ kind: string; fire_at: number }>(
          "SELECT kind,fire_at FROM timers WHERE kind LIKE 'grace:%'",
        )
        .toArray(),
    );
    expect(grace).toEqual([
      {
        kind: `grace:${guest.seat}`,
        fire_at: created.state.startedAt + 60_000,
      },
    ]);
    await runInDurableObject(stub, async (instance, durableState) => {
      const sql = durableState.storage.sql;
      const row = sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const saved = JSON.parse(row.json) as GameState;
      // Anchor this case on the absent guest's first roll, regardless of the
      // shuffled starting order; the real connection/grace flow stays intact.
      sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({
          ...saved,
          activeSeat: guest.seat,
          pending: {
            kind: "roll",
            seat: guest.seat,
            deadline: saved.pending?.deadline,
          },
        }),
      );
      const room = instance as unknown as { updateTimers(): Promise<void> };
      await room.updateTimers();
      sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind=?",
        Date.now() - 1,
        `grace:${guest.seat}`,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    for (;;) {
      const presence = await hostInbox.next("presence");
      if (presence.seat === guest.seat && presence.status === "bot") break;
    }
    const takeover = await runInDurableObject(
      stub,
      (_instance, durableState) => {
        const sql = durableState.storage.sql;
        const row = sql
          .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
          .toArray()[0];
        return {
          meta: sql
            .exec<{ v: string }>(
              "SELECT v FROM meta WHERE k=?",
              `takeover:${guest.seat}`,
            )
            .toArray()[0]?.v,
          timers: sql
            .exec<{ kind: string }>(
              "SELECT kind FROM timers WHERE kind IN ('bot','decision')",
            )
            .toArray()
            .map((timer) => timer.kind),
          deadline: (JSON.parse(row.json) as GameState).matchDeadline,
        };
      },
    );
    expect(takeover).toEqual({
      meta: "true",
      timers: ["bot"],
      deadline: created.state.matchDeadline,
    });
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind='bot'",
        Date.now() - 1,
      ),
    );
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const moved = await hostInbox.next("events");
    expect(
      moved.events.some(
        (event) => event.type === "DiceRolled" && event.seat === guest.seat,
      ),
    ).toBe(true);
  });

  it("does not rewrite unchanged timers or postpone a bot when another seat reconnects", async () => {
    const host = await create();
    const inbox = await connect(host);
    await inbox.next("welcome");
    inbox.send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: true },
    });
    await inbox.next("events");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    const timers = await runInDurableObject(
      stub,
      async (instance, durableState) => {
        const sql = durableState.storage.sql;
        const read = () =>
          sql
            .exec<{ kind: string; fire_at: number }>(
              "SELECT kind,fire_at FROM timers ORDER BY kind",
            )
            .toArray();
        const before = read();
        const changesBefore = sql
          .exec<{ changes: number }>("SELECT total_changes() AS changes")
          .toArray()[0].changes;
        const room = instance as unknown as { updateTimers(): Promise<void> };
        await room.updateTimers();
        await room.updateTimers();
        return {
          before,
          after: read(),
          changes:
            sql
              .exec<{ changes: number }>("SELECT total_changes() AS changes")
              .toArray()[0].changes - changesBefore,
        };
      },
    );
    expect(timers.after).toEqual(timers.before);
    expect(timers.changes).toBe(0);
  });

  it("lets a bot act only after the animations of its previous move", async () => {
    const host = await create();
    const inbox = await connect(host);
    await inbox.next("welcome");
    inbox.send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: true },
    });
    await inbox.next("events");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    const result = await runInDurableObject(
      stub,
      async (instance, durableState) => {
        const sql = durableState.storage.sql;
        const row = sql
          .exec<{ seq: number; json: string }>(
            "SELECT seq,json FROM state WHERE id=1",
          )
          .toArray()[0];
        const saved = JSON.parse(row.json) as GameState;
        // A bot followed by another bot: whatever the dice, the next
        // decision belongs to a bot, so it is paced by the bot timer.
        const order = saved.turnOrder;
        const bot = order.find(
          (seat, index) =>
            seat !== host.seat &&
            order[(index + 1) % order.length] !== host.seat,
        );
        if (bot === undefined) throw new Error("Expected two bots in a row");
        sql.exec(
          "UPDATE state SET json=? WHERE id=1",
          JSON.stringify({
            ...saved,
            activeSeat: bot,
            pending: { kind: "roll", seat: bot, deadline: Date.now() + 10_000 },
          }),
        );
        const room = instance as unknown as {
          beginDice(
            seat: Seat,
            action: { type: "Roll" },
            intentId: null,
            atSeq: number,
          ): Promise<void>;
        };
        const rolledAt = Date.now();
        await room.beginDice(bot, { type: "Roll" }, null, row.seq);
        const next = JSON.parse(
          sql
            .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
            .toArray()[0].json,
        ) as GameState;
        return {
          rolledAt,
          next,
          timers: sql
            .exec<{ kind: string; fire_at: number }>(
              "SELECT kind,fire_at FROM timers WHERE kind IN ('bot','decision')",
            )
            .toArray(),
        };
      },
    );
    expect(result.next.pending?.seat).not.toBe(host.seat);
    expect(result.timers).toEqual([
      { kind: "bot", fire_at: botDecisionAt(toPublic(result.next)) },
    ]);
    // At least the dice throw and a pause, not a fixed 900 ms.
    expect(result.timers[0].fire_at - result.rolledAt).toBeGreaterThanOrEqual(
      DECISION_TIMING.diceAnimation + BOT_TIMING.roll,
    );
  });

  it("measures zero SQL row writes for a timer refresh that previously rewrote five rows", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    const measured = await runInDurableObject(
      stub,
      async (instance, durableState) => {
        const sql = durableState.storage.sql;
        const saved = JSON.parse(
          sql
            .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
            .toArray()[0].json,
        ) as GameState;
        if (!saved.pending || saved.matchDeadline === null)
          throw new Error("Timed human decision expected");
        // Execute the exact previous timer write sequence against the same room.
        // Cursor counters include primary-key index writes, not just total_changes().
        const previous = [
          sql.exec("DELETE FROM timers WHERE kind IN ('bot','decision')")
            .rowsWritten,
          sql.exec(
            "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('match-end',?)",
            saved.matchDeadline,
          ).rowsWritten,
          sql.exec(
            "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('decision',?)",
            saved.pending.deadline,
          ).rowsWritten,
        ].reduce((total, count) => total + count, 0);
        const originalExec = sql.exec.bind(sql);
        let current = 0;
        const spy = vi
          .spyOn(sql, "exec")
          .mockImplementation(
            <T extends Record<string, SqlStorageValue>>(
              query: string,
              ...bindings: SqlStorageValue[]
            ) => {
              const cursor = originalExec<T>(query, ...bindings);
              current += cursor.rowsWritten;
              return cursor;
            },
          );
        const room = instance as unknown as { updateTimers(): Promise<void> };
        try {
          await room.updateTimers();
        } finally {
          spy.mockRestore();
        }
        return { previous, current };
      },
    );
    expect(measured).toEqual({ previous: 5, current: 0 });
  });

  it("shares the persisted lobby budget across sockets, reconnects and hibernation", async () => {
    const host = await create();
    const inbox = await connect(host);
    await inbox.next("welcome");
    const second = await connect(host);
    await second.next("welcome");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    // Keep refill time fixed even when CI or eviction takes longer than one second.
    // afterEach restores this clock before the next test.
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    // Actual state changes and accepted no-ops have the same write budget.
    for (let n = 0; n < 20; n++)
      expect(
        await roomOp(n % 2 ? second : inbox, `bounded-${n}`, {
          type: "lock",
          locked: n % 2 === 0,
        }),
      ).toBe("ack");
    expect(
      await roomOp(inbox, "bounded-0", { type: "lock", locked: false }),
    ).toBe("duplicate");
    await closeInbox(second);
    await runInDurableObject(stub, async (instance, durableState) => {
      const spy = vi.spyOn(durableState.storage.sql, "exec");
      try {
        const room = instance as unknown as {
          webSocketMessage(socket: WebSocket, frame: string): Promise<void>;
        };
        await room.webSocketMessage(
          durableState.getWebSockets()[0],
          JSON.stringify({
            type: "lobby",
            id: "budget-exhausted",
            op: { type: "lock", locked: true },
          }),
        );
        expect(spy.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(
          true,
        );
      } finally {
        spy.mockRestore();
      }
    });
    expect(await answer(inbox, "budget-exhausted")).toBe("lobby-rate-limit");
    expect((await lobbyOf(host.roomCode)).locked).toBe(false);
    await closeInbox(inbox);
    await evictDurableObject(stub);
    const resumed = await connect(host);
    await resumed.next("welcome");
    expect(
      await roomOp(resumed, "after-reconnect", { type: "lock", locked: true }),
    ).toBe("lobby-rate-limit");
    const count = await runInDurableObject(stub, (_instance, durableState) => {
      const count = durableState.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM commands")
        .one().count;
      const row = durableState.storage.sql
        .exec<{ v: string }>("SELECT v FROM meta WHERE k='lobbyBudget'")
        .one();
      const budget = JSON.parse(row.v) as { tokens: number; at: number };
      durableState.storage.sql.exec(
        "UPDATE meta SET v=? WHERE k='lobbyBudget'",
        JSON.stringify({ ...budget, at: budget.at - 1_000 }),
      );
      return count;
    });
    expect(count).toBe(20);
    expect(
      await roomOp(resumed, "after-refill", { type: "lock", locked: true }),
    ).toBe("ack");
    expect(
      await roomOp(resumed, "refill-spent", { type: "lock", locked: false }),
    ).toBe("lobby-rate-limit");
  });

  it("charges only accepted lobby operations and retains the budget when returning from a match", async () => {
    const host = await create();
    const inbox = await connect(host);
    const welcome = await inbox.next("welcome");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    // Keep refill time fixed even when CI or eviction takes longer than one second.
    // afterEach restores this clock before the next test.
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    expect(
      await roomOp(inbox, "invalid-bot", { type: "add-bot", seat: host.seat }),
    ).toBe("seat-taken");
    expect(
      await runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql
          .exec("SELECT v FROM meta WHERE k='lobbyBudget'")
          .toArray(),
      ),
    ).toEqual([]);
    expect(
      await roomOp(inbox, "normal-settings", {
        type: "settings",
        config: welcome.lobby.config,
      }),
    ).toBe("ack");
    expect(
      await roomOp(inbox, "normal-start", { type: "start", fillBots: true }),
    ).toBe("ack");
    await inbox.next("events");
    expect(
      await roomOp(inbox, "normal-return", { type: "return-to-lobby" }),
    ).toBe("ack");
    const retained = await runInDurableObject(
      stub,
      (_instance, durableState) =>
        JSON.parse(
          durableState.storage.sql
            .exec<{ v: string }>("SELECT v FROM meta WHERE k='lobbyBudget'")
            .one().v,
        ) as { tokens: number },
    );
    expect(retained.tokens).toBe(17);
  });

  it("answers clock sync without reading or writing SQLite", async () => {
    const host = await create();
    const inbox = await connect(host);
    await inbox.next("welcome");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, async (instance, durableState) => {
      const spy = vi.spyOn(durableState.storage.sql, "exec");
      try {
        const room = instance as unknown as {
          webSocketMessage(socket: WebSocket, frame: string): Promise<void>;
        };
        await room.webSocketMessage(
          durableState.getWebSockets()[0],
          JSON.stringify({ type: "ping", t: 123 }),
        );
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
    expect(await inbox.next("pong")).toMatchObject({ t: 123 });
  });

  it("suspends legacy beacon retries while nobody is connected and keeps the committed round", async () => {
    const host = await create("drand");
    const inbox = await connect(host);
    await inbox.next("welcome");
    inbox.send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: true },
    });
    await inbox.next("events");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, async (instance, durableState) => {
      const row = durableState.storage.sql
        .exec<{ seq: number; json: string }>(
          "SELECT seq,json FROM state WHERE id=1",
        )
        .toArray()[0];
      const saved = JSON.parse(row.json) as GameState;
      const room = instance as unknown as {
        beginDice(
          seat: Seat,
          action: { type: "Roll" },
          intentId: null,
          atSeq: number,
        ): Promise<void>;
      };
      await room.beginDice(saved.activeSeat, { type: "Roll" }, null, row.seq);
    });
    const commitment = (await inbox.next("randomness")).commitment;
    await closeInbox(inbox);
    expect(
      await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec("SELECT kind FROM timers WHERE kind='randomness'")
            .toArray().length,
      ),
    ).toBe(0);
    await evictDurableObject(stub);
    const resumed = await connect(host);
    expect((await resumed.next("welcome")).randomness).toEqual({
      status: "waiting",
      commitment,
    });
    expect(
      await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec("SELECT kind FROM timers WHERE kind='randomness'")
            .toArray().length,
      ),
    ).toBe(1);
  });

  it("defaults new rooms to immediate secure dice without external network calls", async () => {
    const externalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("External network must not be needed"));
    const { credentials, inboxes, state, seq } = await startFour();
    const reconnect = await connect(credentials[0]);
    const welcome = await reconnect.next("welcome");
    expect(welcome.lobby.config.randomnessMode).toBe("secure");

    const current = inboxes[state.activeSeat];
    current.send({
      type: "intent",
      id: "secure-default-roll",
      atSeq: seq,
      action: { type: "Roll" },
    });
    const committed = await current.next("randomness");
    expect(committed.status).toBe("committed");
    expect(committed.commitment).toMatchObject({
      mode: "secure",
      round: null,
      chainHash: null,
    });
    expect(committed.commitment?.availableAt).toBe(
      committed.commitment?.committedAt,
    );
    const events = await current.next("events");
    const rolled = events.events.find((event) => event.type === "DiceRolled");
    if (rolled?.type !== "DiceRolled") throw new Error("DiceRolled expected");
    expect(rolled.dice.every((die) => die >= 1 && die <= 6)).toBe(true);
    expect(events.proofs?.[0].proof).toMatchObject({
      mode: "secure",
      dice: rolled.dice,
      round: null,
      chainHash: null,
      randomness: null,
      signature: null,
      verified: false,
      source: "Web Crypto / server CSPRNG",
    });
    const resolved = await current.next("randomness");
    expect(resolved.status).toBe("resolved");
    expect(resolved.proof).toEqual(events.proofs?.[0].proof);
    expect(externalFetch).not.toHaveBeenCalled();
    const stub = env.GAME_ROOM.getByName(credentials[0].roomCode);
    expect(
      await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec("SELECT v FROM meta WHERE k='pendingDice'")
            .toArray().length,
      ),
    ).toBe(0);
  });

  it("keeps scaffold health checks and rejects the removed debug handshake", async () => {
    const response = await exports.default.fetch(
      new Request(`${origin}/api/health`),
    );
    expect(await response.json()).toEqual({ status: "ok" });
    expect(
      (await exports.default.fetch(new Request(`${origin}/ws/debug/hello`)))
        .status,
    ).toBe(404);
    const room = env.GAME_ROOM.getByName("TESTAA");
    expect(await (await room.fetch(`${origin}/health`)).json()).toEqual({
      kind: "game-room",
      status: "ok",
    });
  });

  it("does not create rooms by connecting and checks origin + seat capability", async () => {
    const missing = await exports.default.fetch(
      new Request(`${origin}/ws/room/ZZZZZZ`, {
        headers: { Upgrade: "websocket", Origin: origin },
      }),
    );
    expect(missing.status).toBe(404);
    const host = await create();
    const badOrigin = await exports.default.fetch(
      new Request(`${origin}/ws/room/${host.roomCode}`, {
        headers: { Upgrade: "websocket", Origin: "https://evil.test" },
      }),
    );
    expect(badOrigin.status).toBe(403);
    const noAuth = await exports.default.fetch(
      new Request(`${origin}/ws/room/${host.roomCode}`, {
        headers: { Upgrade: "websocket", Origin: origin },
      }),
    );
    expect(noAuth.status).toBe(401);
    const foreign = await create();
    const wrong = await exports.default.fetch(
      new Request(`${origin}/ws/room/${host.roomCode}`, {
        headers: {
          Upgrade: "websocket",
          Origin: origin,
          "Sec-WebSocket-Protocol": `polytour, seat.${foreign.token}`,
        },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("uses four seats, validates settings and only allows the host to start", async () => {
    const host = await create();
    const second = await join(host.roomCode, "Bo");
    const hostSocket = await connect(host);
    const secondSocket = await connect(second);
    const welcome = await hostSocket.next("welcome");
    expect(welcome.lobby.seats).toHaveLength(4);
    expect(welcome.you.seat).toBe(0);
    await secondSocket.next("welcome");
    secondSocket.send({
      type: "lobby",
      id: "not-host",
      op: { type: "start", fillBots: true },
    });
    expect((await secondSocket.next("reject")).reason).toBe("host-only");
    hostSocket.send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: true },
    });
    const events = await hostSocket.next("events");
    const created = events.events.find((event) => event.type === "GameCreated");
    expect(
      created?.type === "GameCreated" ? created.state.players.length : 0,
    ).toBe(4);
    // A late arrival waits without a seat: for a bot's place or the next game.
    const lateJoin = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${host.roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: "Late" }),
      }),
    );
    expect(lateJoin.status).toBe(200);
    expect((await lateJoin.json<RoomCredentials>()).seat).toBeNull();
  });

  it("lets the host add and remove bots, then start with only the filled seats", async () => {
    const host = await create();
    const hostSocket = await connect(host);
    await hostSocket.next("welcome");
    await hostSocket.next("lobby");
    const lobbyOp = async (
      id: string,
      op: Record<string, unknown>,
      socket = hostSocket,
    ) => {
      socket.send({ type: "lobby", id, op });
      for (;;) {
        const reply = socket.messages.find(
          (message) =>
            (message.type === "ack" || message.type === "reject") &&
            message.id === id,
        );
        if (reply) {
          socket.messages.splice(socket.messages.indexOf(reply), 1);
          return reply.type === "reject" ? reply.reason : "ack";
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const seats = async () =>
      (await hostSocket.next("lobby")).lobby.seats.map((seat) => [
        seat.name,
        seat.control,
      ]);
    // Alone at the table, the host cannot start without filling seats.
    expect(await lobbyOp("alone", { type: "start", fillBots: false })).toBe(
      "players-required",
    );
    expect(await lobbyOp("bot-2", { type: "add-bot", seat: 2 })).toBe("ack");
    expect(await seats()).toEqual([
      ["Alex", "human"],
      ["Place libre", null],
      ["Nova", "bot"],
      ["Place libre", null],
    ]);
    expect(await lobbyOp("again", { type: "add-bot", seat: 2 })).toBe(
      "seat-taken",
    );
    expect(await lobbyOp("host-seat", { type: "add-bot", seat: 0 })).toBe(
      "seat-taken",
    );
    expect(await lobbyOp("human", { type: "remove-bot", seat: 0 })).toBe(
      "not-a-bot",
    );
    expect(await lobbyOp("empty", { type: "remove-bot", seat: 1 })).toBe(
      "not-a-bot",
    );
    expect(await lobbyOp("bot-3", { type: "add-bot", seat: 3 })).toBe("ack");
    await hostSocket.next("lobby");
    expect(await lobbyOp("drop-2", { type: "remove-bot", seat: 2 })).toBe(
      "ack",
    );
    expect(await seats()).toEqual([
      ["Alex", "human"],
      ["Place libre", null],
      ["Place libre", null],
      ["Atlas", "bot"],
    ]);
    // A friend takes the first free place; only the host manages bots.
    const friend = await join(host.roomCode, "Bo");
    expect(friend.seat).toBe(1);
    await hostSocket.next("lobby");
    const friendSocket = await connect(friend);
    await friendSocket.next("welcome");
    expect(
      await lobbyOp("guest", { type: "add-bot", seat: 2 }, friendSocket),
    ).toBe("host-only");
    expect(await lobbyOp("start", { type: "start", fillBots: false })).toBe(
      "ack",
    );
    const events = await hostSocket.next("events");
    const created = events.events.find((event) => event.type === "GameCreated");
    if (created?.type !== "GameCreated")
      throw new Error("GameCreated expected");
    expect(
      created.state.players.map((player) => [
        player.seat,
        player.name,
        player.control,
      ]),
    ).toEqual([
      [0, "Alex", "human"],
      [1, "Bo", "human"],
      [3, "Atlas", "bot"],
    ]);
    expect([...created.state.turnOrder].sort()).toEqual([0, 1, 3]);
    let started = (await hostSocket.next("lobby")).lobby;
    while (started.status === "lobby")
      started = (await hostSocket.next("lobby")).lobby;
    expect(started.status).toBe("playing");
    expect(started.seats[2].control).toBeNull();
    expect(await lobbyOp("late-bot", { type: "add-bot", seat: 2 })).toBe(
      "game-already-started",
    );
    const lateJoin = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${host.roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: "Late" }),
      }),
    );
    expect(lateJoin.status).toBe(200);
    expect((await lateJoin.json<RoomCredentials>()).seat).toBeNull();
    expect((await lobbyOf(host.roomCode)).waiting).toEqual([
      { id: expect.any(String), name: "Late", approved: true, online: false },
    ]);
  });

  it("starts a one-human room against a single bot and advances its first turn", async () => {
    const host = await create();
    const hostSocket = await connect(host);
    await hostSocket.next("welcome");
    hostSocket.send({
      type: "lobby",
      id: "bot",
      op: { type: "add-bot", seat: 1 },
    });
    await hostSocket.next("ack");
    hostSocket.send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: false },
    });
    const events = await hostSocket.next("events");
    const created = events.events.find((event) => event.type === "GameCreated");
    if (created?.type !== "GameCreated")
      throw new Error("GameCreated expected");
    expect(created.state.players.map((player) => player.seat)).toEqual([0, 1]);
    const seat = created.state.activeSeat;
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) => {
      const row = durableState.storage.sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const state = JSON.parse(row.json) as GameState;
      if (!state.pending) throw new Error("Pending decision expected");
      durableState.storage.sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({
          ...state,
          pending: { ...state.pending, deadline: Date.now() - 1 },
        }),
      );
      expect(
        durableState.storage.sql
          .exec<{ kind: string }>(
            "SELECT kind FROM timers WHERE kind IN ('decision','bot')",
          )
          .toArray()
          .map((timer) => timer.kind),
      ).toEqual([seat === 1 ? "bot" : "decision"]);
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind IN ('decision','bot')",
        Date.now() - 1,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const rolled = await hostSocket.next("events");
    expect(
      rolled.events.some(
        (event) => event.type === "DiceRolled" && event.seat === seat,
      ),
    ).toBe(true);
  });

  it.each(["easy", "medium", "hard"] as const)(
    "persists %s bot difficulty through settings, start, reconnect and alarm",
    async (level) => {
      const host = await create("secure", 1);
      const socket = await connect(host);
      const welcome = await socket.next("welcome");
      socket.send({
        type: "lobby",
        id: "difficulty",
        op: {
          type: "settings",
          config: { ...welcome.lobby.config, botDifficulty: level },
        },
      });
      expect(await answer(socket, "difficulty")).toBe("ack");
      socket.send({
        type: "lobby",
        id: "start-level",
        op: { type: "start", fillBots: false },
      });
      expect(await answer(socket, "start-level")).toBe("ack");
      const stub = env.GAME_ROOM.getByName(host.roomCode);
      await runInDurableObject(stub, async (_instance, durableState) => {
        const row = durableState.storage.sql
          .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
          .toArray()[0];
        const state = JSON.parse(row.json) as GameState;
        expect(state.config.botDifficulty).toBe(level);
        // Reconnect must observe the pending purchase before any alarm runs.
        const alarmAt = Date.now() + 60_000;
        durableState.storage.sql.exec(
          "UPDATE state SET json=? WHERE id=1",
          JSON.stringify({
            ...state,
            activeSeat: 1,
            players: state.players.map((player) =>
              player.seat === 1 ? { ...player, position: 1 } : player,
            ),
            pending: {
              kind: "buy",
              seat: 1,
              tile: 1,
              maxLevel: 2,
              deadline: Date.now() + 30_000,
            },
          }),
        );
        durableState.storage.sql.exec(
          "DELETE FROM timers WHERE kind IN ('bot','decision')",
        );
        durableState.storage.sql.exec(
          "INSERT INTO timers(kind,fire_at) VALUES('bot',?)",
          alarmAt,
        );
        await durableState.storage.setAlarm(alarmAt);
      });
      const resumed = await connect(host);
      const recovered = await resumed.next("welcome");
      expect(recovered.snapshot?.config.botDifficulty).toBe(level);
      await runInDurableObject(stub, async (_instance, durableState) => {
        durableState.storage.sql.exec(
          "UPDATE timers SET fire_at=? WHERE kind='bot'",
          Date.now() - 1,
        );
        // The SQL timer is due, but only the explicit helper may fire the alarm.
        await durableState.storage.setAlarm(Date.now() + 60_000);
      });
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      const batch = await resumed.next("events");
      expect(batch.events).toContainEqual(
        expect.objectContaining({
          type: "PropertyBought",
          seat: 1,
          tile: 1,
          level: level === "easy" ? 0 : 2,
        }),
      );
    },
  );

  it("rejects wrong-seat, malformed and stale intents without changing money or sequence", async () => {
    const { inboxes, state, seq } = await startFour();
    const wrongSeat = ((state.activeSeat + 1) % 4) as Seat;
    inboxes[wrongSeat].send({
      type: "intent",
      id: "wrong",
      atSeq: seq,
      action: { type: "Roll" },
    });
    expect((await inboxes[wrongSeat].next("reject")).reason).toBe(
      "not-your-turn",
    );
    inboxes[state.activeSeat].send({
      type: "intent",
      id: "stale",
      atSeq: seq - 1,
      action: { type: "Roll" },
    });
    expect((await inboxes[state.activeSeat].next("reject")).reason).toBe(
      "stale",
    );
    inboxes[state.activeSeat].send({
      type: "intent",
      id: "forged",
      atSeq: seq,
      action: { type: "Roll", dice: [6, 6] },
    });
    expect((await inboxes[state.activeSeat].next("reject")).reason).toBe(
      "malformed",
    );
    inboxes[state.activeSeat].send({
      type: "intent",
      id: "roll",
      atSeq: seq,
      action: { type: "Roll" },
    });
    const events = await inboxes[state.activeSeat].next("events");
    expect(events.fromSeq).toBe(seq + 1);
    const rolled = events.events.find((event) => event.type === "DiceRolled");
    expect(
      rolled?.type === "DiceRolled"
        ? rolled.dice.every((die) => die >= 1 && die <= 6)
        : false,
    ).toBe(true);
    expect(events.proofs?.[0].proof.mode).toBe("secure");
    expect(JSON.stringify(events)).not.toMatch(/rngState|"deck"|token_hash/);
  });

  it("uses fresh server entropy for a Chance draw from a previously saved seeded deck", async () => {
    const host = await create();
    const original = await connect(host);
    await original.next("welcome");
    original.send({
      type: "lobby",
      id: "start-chance-test",
      op: { type: "start", fillBots: true },
    });
    await original.next("events");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) => {
      const row = durableState.storage.sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const saved = JSON.parse(row.json) as GameState;
      durableState.storage.sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({
          ...saved,
          activeSeat: host.seat,
          deck: CHANCE_CARDS,
          discard: [],
          players: saved.players.map((player) =>
            player.seat === host.seat
              ? { ...player, position: 24, travelPending: true }
              : player,
          ),
          pending: {
            kind: "travel",
            seat: host.seat,
            fee: 0,
            targets: [12],
            deadline: Date.now() + 60_000,
          },
          resolutionQueue: [{ kind: "finish" }],
        }),
      );
    });
    await evictDurableObject(stub);
    const resumed = await connect(host);
    const welcome = await resumed.next("welcome");
    expect(welcome.snapshot?.pending?.kind).toBe("travel");
    const entropy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((
      values: Uint32Array,
    ) => {
      expect(values).toBeInstanceOf(Uint32Array);
      values.fill(5);
      return values;
    }) as typeof crypto.getRandomValues);
    try {
      resumed.send({
        type: "intent",
        id: "secure-chance",
        atSeq: welcome.seq,
        action: { type: "Travel", tile: 12 },
      });
      const drawn = await resumed.next("events");
      expect(drawn.events).toContainEqual({
        type: "CardDrawn",
        seat: host.seat,
        card: CHANCE_CARDS[5],
        kept: false,
      });
      expect(entropy).toHaveBeenCalledOnce();
      expect(JSON.stringify(drawn)).not.toMatch(
        /chanceEntropy|rngState|"deck"/,
      );
      const stored = await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
            .toArray()[0].json,
      );
      expect(stored).not.toContain("chanceEntropy");
      expect((JSON.parse(stored) as GameState).deck).not.toContain(
        CHANCE_CARDS[5],
      );
    } finally {
      entropy.mockRestore();
    }
  });

  it("recovers persisted state after eviction and always welcomes before replay", async () => {
    const { credentials, inboxes, state, seq } = await startFour();
    inboxes[state.activeSeat].send({
      type: "intent",
      id: "roll",
      atSeq: seq,
      action: { type: "Roll" },
    });
    const rolled = await inboxes[state.activeSeat].next("events");
    const stub = env.GAME_ROOM.getByName(credentials[0].roomCode);
    await evictDurableObject(stub);
    const reconnect = await connect(credentials[0], seq);
    const welcome = await reconnect.next("welcome");
    expect(welcome.snapshot).toBeNull();
    expect(welcome.seq).toBe(rolled.toSeq);
    const replay = await reconnect.next("events");
    expect(replay.events).toEqual(rolled.events);
    expect(replay.proofs).toEqual(rolled.proofs);
    expect(reconnect.received[0]?.type).toBe("welcome");
    const fresh = await connect(credentials[1]);
    const snapshot = await fresh.next("welcome");
    expect(snapshot.snapshot?.lastRoll).not.toBeNull();
    expect(JSON.stringify(snapshot)).not.toMatch(/rngState|"deck"|token_hash/);
  });

  it("resumes every seat and its deadline after a deploy restarts a live match", async () => {
    const { credentials, inboxes, state, seq } = await startFour();
    inboxes[state.activeSeat].send({
      type: "intent",
      id: "roll",
      atSeq: seq,
      action: { type: "Roll" },
    });
    const rolled = await Promise.all(
      inboxes.map((inbox) => inbox.next("events")),
    );
    const toSeq = rolled[0].toSeq;
    const played = rolled[0].events.reduce(applyEvent, state);
    const stub = env.GAME_ROOM.getByName(credentials[0].roomCode);
    const readSchedule = () =>
      runInDurableObject(stub, async (_instance, durableState) => ({
        timers: durableState.storage.sql
          .exec<{ kind: string; fire_at: number }>(
            "SELECT kind,fire_at FROM timers ORDER BY kind",
          )
          .toArray(),
        alarm: await durableState.storage.getAlarm(),
      }));
    const before = await readSchedule();
    // Guard the comparison below against an empty table passing vacuously.
    expect(before.timers.map((timer) => timer.kind)).toContain("decision");

    // A deploy restarts every Durable Object and drops every socket at once.
    await evictDurableObject(stub);

    // Half resume from their last sequence and replay, half ask for a snapshot:
    // both recovery paths have to land on the same authoritative state.
    const resumed = await Promise.all(
      credentials.map((credential, seat) =>
        connect(credential, seat < 2 ? seq : null),
      ),
    );
    const welcomes = await Promise.all(
      resumed.map((inbox) => inbox.next("welcome")),
    );
    for (const [seat, welcome] of welcomes.entries()) {
      expect(resumed[seat].received[0]?.type).toBe("welcome");
      expect(welcome.you.seat).toBe(seat);
      expect(welcome.seq).toBe(toSeq);
      expect(welcome.lobby.status).toBe("playing");
      // A deploy reconnect is far shorter than the 60 s grace, so no seat
      // becomes a bot and nobody loses their turn to the restart.
      expect(welcome.lobby.seats.map((entry) => entry.control)).toEqual([
        "human",
        "human",
        "human",
        "human",
      ]);
    }
    for (const inbox of resumed.slice(0, 2)) {
      const replay = await inbox.next("events");
      expect(replay.events).toEqual(rolled[0].events);
      expect(replay.toSeq).toBe(toSeq);
    }
    for (const welcome of welcomes.slice(2))
      expect(welcome.snapshot).toEqual(played);
    expect(
      welcomes.slice(0, 2).every((welcome) => welcome.snapshot === null),
    ).toBe(true);
    // The restart lands on the same decision deadline and the same alarm, so a
    // deploy costs a reconnect and never a turn.
    expect(await readSchedule()).toEqual(before);
  });

  it("rejects a late human roll before a delayed decision alarm commits dice", async () => {
    const { credentials, inboxes, state, seq } = await startFour();
    const stub = env.GAME_ROOM.getByName(credentials[0].roomCode);
    await runInDurableObject(stub, (_instance, durableState) => {
      const row = durableState.storage.sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const saved = JSON.parse(row.json) as GameState;
      if (!saved.pending) throw new Error("Pending roll expected");
      durableState.storage.sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({
          ...saved,
          pending: { ...saved.pending, deadline: Date.now() - 1 },
        }),
      );
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind='decision'",
        Date.now() - 1,
      );
    });
    inboxes[state.activeSeat].send({
      type: "intent",
      id: "too-late",
      atSeq: seq,
      action: { type: "Roll" },
    });
    expect((await inboxes[state.activeSeat].next("reject")).reason).toBe(
      "decision-expired",
    );
    expect(
      await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec("SELECT v FROM meta WHERE k='pendingDice'")
            .toArray().length,
      ),
    ).toBe(0);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const events = await inboxes[state.activeSeat].next("events");
    expect(events.events.some((event) => event.type === "DiceRolled")).toBe(
      true,
    );
    expect(events.proofs?.[0].proof.mode).toBe("secure");
  });

  it("isolates event logs and rejects a fifth human seat", async () => {
    const game = await startFour();
    const other = await create();
    const fifth = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${game.credentials[0].roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: "Five" }),
      }),
    );
    expect(fifth.status).toBe(409);
    const otherSocket = await connect(other);
    const welcome = await otherSocket.next("welcome");
    expect(welcome.seq).toBe(0);
    expect(welcome.snapshot).toBeNull();
    expect(
      welcome.lobby.seats.filter((seat) => seat.control === "human"),
    ).toHaveLength(1);
  });

  it.each(["bot", "decision"] as const)(
    "uses a durable %s alarm to advance the correct seat",
    async (kind) => {
      const host = await create();
      const inbox = await connect(host);
      await inbox.next("welcome");
      inbox.send({
        type: "lobby",
        id: "start",
        op: { type: "start", fillBots: true },
      });
      await inbox.next("events");
      const stub = env.GAME_ROOM.getByName(host.roomCode);
      await runInDurableObject(stub, (_instance, durableState) => {
        const row = durableState.storage.sql
          .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
          .toArray()[0];
        const state = JSON.parse(row.json) as GameState;
        if (!state.pending) throw new Error("Pending decision expected");
        durableState.storage.sql.exec(
          "UPDATE state SET json=? WHERE id=1",
          JSON.stringify({
            ...state,
            pending: { ...state.pending, deadline: Date.now() - 1 },
          }),
        );
        durableState.storage.sql.exec(
          "DELETE FROM timers WHERE kind IN ('decision','bot')",
        );
        durableState.storage.sql.exec(
          "INSERT INTO timers(kind,fire_at) VALUES(?,?)",
          kind,
          Date.now() - 1,
        );
      });
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      const events = await inbox.next("events");
      expect(events.events.some((event) => event.type === "DiceRolled")).toBe(
        true,
      );
      const count = await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec("SELECT kind FROM timers WHERE kind IN ('decision','bot')")
            .toArray().length,
      );
      expect(count).toBe(1);
    },
  );

  it("ends a timed match while drand is pending and discards the unresolved commitment", async () => {
    const host = await create("drand");
    const inbox = await connect(host);
    await inbox.next("welcome");
    inbox.send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: true },
    });
    await inbox.next("events");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) => {
      const row = durableState.storage.sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const state = JSON.parse(row.json) as GameState;
      durableState.storage.sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({ ...state, matchDeadline: Date.now() - 1 }),
      );
      durableState.storage.sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('match-end',?)",
        Date.now() - 1,
      );
      durableState.storage.sql.exec(
        "INSERT OR REPLACE INTO meta(k,v) VALUES('pendingDice',?)",
        JSON.stringify({
          commitment: {
            mode: "drand",
            context: "test",
            availableAt: Date.now() + 60_000,
          },
          seat: state.activeSeat,
          action: { type: "Roll" },
          intentId: "pending",
          atSeq: 1,
        }),
      );
      durableState.storage.sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('randomness',?)",
        Date.now() + 60_000,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const events = await inbox.next("events");
    expect(
      events.events.some(
        (event) => event.type === "GameOver" && event.kind === "time-limit",
      ),
    ).toBe(true);
    expect(
      await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec("SELECT v FROM meta WHERE k='pendingDice'")
            .toArray().length,
      ),
    ).toBe(0);
  });

  it("freezes new rooms on rules version 9 with tax-card movement", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    expect(game.state.config.hotelPurchaseRule).toBe("staged-hotels");
    expect(game.state.config.economyRule).toBe("reference");
    expect(game.state.config.boardRule).toBe("country");
    expect(game.state.config.sellBackPercent).toBe(100);
    expect(game.state.config.worldTourRule).toBe("free-and-own");
    expect(game.state.config.fourResortRent).toBe(true);
    expect(game.state.config.buildAfterBuyout).toBe(true);
    expect(game.state.config.taxCardMovement).toBe(true);
    expect(game.state.config.resortFestivals).toBe(false);
    const cities = getBoard(game.state.config)
      .filter(isCityTile)
      .map((tile) => tile.index);
    expect(game.state.festivalTiles).toHaveLength(3);
    expect(
      game.state.festivalTiles.every((tile) => cities.includes(tile)),
    ).toBe(true);
    expect(game.state.properties.map((property) => property.tile)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22, 23, 25,
      26, 27, 29, 31,
    ]);
    const rules = await runInDurableObject(
      stub,
      (_instance, durableState) =>
        durableState.storage.sql
          .exec<{ v: string }>("SELECT v FROM meta WHERE k='rulesVersion'")
          .toArray()[0]?.v,
    );
    expect(rules).toBe("9");
    await evictDurableObject(stub);
    const resumed = await connect(game.credentials[0]);
    const welcome = await resumed.next("welcome");
    expect(welcome.lobby.resortFestivals).toBe(false);
    expect(welcome.lobby.taxCardMovement).toBe(true);
    expect(welcome.snapshot?.config.resortFestivals).toBe(false);
    expect(welcome.snapshot?.festivalTiles).toEqual(game.state.festivalTiles);
  });

  it.each([8, 9])(
    "loads a version-%s saved Audit and replays its frozen behavior",
    async (version) => {
      const game = await startFour();
      const active = game.state.activeSeat;
      await closeInbox(game.inboxes[active]);
      const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
      await runInDurableObject(stub, (_instance, durableState) => {
        const row = durableState.storage.sql
          .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
          .toArray()[0];
        const saved = JSON.parse(row.json) as GameState;
        const { taxCardMovement: _tax, ...legacyConfig } = saved.config;
        durableState.storage.sql.exec(
          "UPDATE meta SET v=? WHERE k='rulesVersion'",
          JSON.stringify(version),
        );
        durableState.storage.sql.exec(
          "UPDATE state SET json=? WHERE id=1",
          JSON.stringify({
            ...saved,
            config: version === 8 ? legacyConfig : saved.config,
            deck: ["Audit"],
            discard: [],
            properties: saved.properties.map((property) =>
              property.tile === 1 ? { ...property, owner: active } : property,
            ),
            players: saved.players.map((player) =>
              player.seat === active
                ? {
                    ...player,
                    position: 24,
                    travelPending: true,
                    properties: [1],
                  }
                : player,
            ),
            pending: {
              kind: "travel",
              seat: active,
              fee: 0,
              targets: [12],
              deadline: Date.now() + 60_000,
            },
            resolutionQueue: [{ kind: "finish" }],
          }),
        );
      });
      await evictDurableObject(stub);
      const inbox = await connect(game.credentials[active]);
      const welcome = await inbox.next("welcome");
      if (!welcome.snapshot) throw new Error("Expected saved snapshot");
      expect(welcome.snapshot.config.taxCardMovement).toBe(
        version === 9 ? true : undefined,
      );
      inbox.send({
        type: "intent",
        id: `audit-v${version}`,
        atSeq: welcome.seq,
        action: { type: "Travel", tile: 12 },
      });
      const events = await inbox.next("events");
      expect(events.events).toContainEqual({
        type: "CardDrawn",
        seat: active,
        card: "Audit",
        kept: false,
      });
      const next = events.events.reduce(applyEvent, welcome.snapshot);
      expect(
        next.players.find((player) => player.seat === active)?.position,
      ).toBe(version === 9 ? 30 : 12);
      expect(events.events).toContainEqual(
        expect.objectContaining({
          type: "MoneyTransferred",
          reason: version === 9 ? "Tax" : "Audit",
        }),
      );
      expect(JSON.stringify(events)).not.toMatch(
        /chanceEntropy|rngState|"deck"/,
      );
      await closeInbox(inbox);
      await evictDurableObject(stub);
      const recovered = await connect(game.credentials[active]);
      expect((await recovered.next("welcome")).snapshot).toEqual(next);
    },
  );

  it.each([undefined, false, "true"])(
    "rejects version-9 saves with tax selector %s",
    async (marker) => {
      const game = await startFour();
      const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
      await runInDurableObject(stub, (_instance, durableState) => {
        const row = durableState.storage.sql
          .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
          .toArray()[0];
        const saved = JSON.parse(row.json) as GameState;
        durableState.storage.sql.exec(
          "UPDATE state SET json=? WHERE id=1",
          JSON.stringify({
            ...saved,
            config: { ...saved.config, taxCardMovement: marker },
          }),
        );
      });
      const response = await exports.default.fetch(
        new Request(`${origin}/api/rooms/${game.credentials[0].roomCode}`),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "incompatible-saved-match",
      });
      await runInDurableObject(stub, (_instance, durableState) => {
        const row = durableState.storage.sql
          .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
          .toArray()[0];
        const saved = JSON.parse(row.json) as GameState;
        durableState.storage.sql.exec(
          "UPDATE state SET json=? WHERE id=1",
          JSON.stringify({
            ...saved,
            config: { ...saved.config, taxCardMovement: true },
          }),
        );
      });
    },
  );

  it.each([
    // A version-5 save predates the marker: own properties only when none is free.
    { version: "5", marker: false, ownReachable: false },
    { version: "6", marker: true, ownReachable: true },
    { version: "7", marker: true, ownReachable: true },
    { version: "8", marker: true, ownReachable: true },
  ])(
    "opens a version-$version World Tour with the room's frozen destinations",
    async ({ version, marker, ownReachable }) => {
      const game = await startFour();
      const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
      const order = game.state.startingTurnOrder;
      const active = game.state.activeSeat;
      const traveller = order[(order.indexOf(active) + 1) % order.length];
      await runInDurableObject(stub, (_instance, durableState) => {
        const row = durableState.storage.sql
          .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
          .toArray()[0];
        const saved = JSON.parse(row.json) as GameState;
        const {
          taxCardMovement: _tax,
          resortFestivals: _festival,
          worldTourRule: _tour,
          fourResortRent: _four,
          buildAfterBuyout: _build,
          ...bare
        } = saved.config;
        // Versions before 8 predate the resort and buyout markers; before 7 the
        // festival marker, and before 6 the World Tour marker.
        const config =
          version === "8"
            ? { ...saved.config, taxCardMovement: undefined }
            : version === "7"
              ? {
                  ...bare,
                  resortFestivals: saved.config.resortFestivals,
                  worldTourRule: saved.config.worldTourRule,
                }
              : marker
                ? { ...bare, worldTourRule: saved.config.worldTourRule }
                : bare;
        durableState.storage.sql.exec(
          "UPDATE meta SET v=? WHERE k='rulesVersion'",
          version,
        );
        // The active player passes on tile 3; the next player waits on World
        // Tour and owns tile 2.
        durableState.storage.sql.exec(
          "UPDATE state SET json=? WHERE id=1",
          JSON.stringify({
            ...saved,
            config,
            properties: saved.properties.map((property) =>
              property.tile === 2
                ? { ...property, owner: traveller }
                : property,
            ),
            players: saved.players.map((player) =>
              player.seat === active
                ? { ...player, position: 3 }
                : player.seat === traveller
                  ? {
                      ...player,
                      position: 24,
                      travelPending: true,
                      properties: [2],
                    }
                  : player,
            ),
            pending: {
              kind: "buy",
              seat: active,
              tile: 3,
              maxLevel: 2,
              deadline: Date.now() + 30_000,
            },
            resolutionQueue: [{ kind: "finish" }],
          }),
        );
      });
      await evictDurableObject(stub);
      const resumed = await connect(game.credentials[active]);
      const welcome = await resumed.next("welcome");
      expect(welcome.lobby.worldTourRule).toBe(
        marker ? "free-and-own" : "free-first",
      );
      resumed.send({
        type: "intent",
        id: `world-tour-v${version}`,
        atSeq: welcome.seq,
        action: { type: "Decline" },
      });
      const events = await resumed.next("events");
      const opened = events.events.find(
        (event) =>
          event.type === "DecisionOpened" && event.pending.kind === "travel",
      );
      if (opened?.type !== "DecisionOpened" || opened.pending.kind !== "travel")
        throw new Error("Expected the traveller's World Tour decision");
      expect(opened.pending.seat).toBe(traveller);
      expect(opened.pending.targets).toContain(3);
      expect(opened.pending.targets.includes(2)).toBe(ownReachable);
    },
  );

  it("rejects client-supplied internal rule markers at room creation", async () => {
    for (const config of [
      { hotelPurchaseRule: "staged-hotels" },
      { hotelPurchaseRule: "legacy-lap" },
      { economyRule: "reference" },
      { economyRule: "prototype" },
      { boardRule: "country" },
      { boardRule: "legacy" },
      { sellBackPercent: 50 },
      { sellBackPercent: 100 },
      { worldTourRule: "free-and-own" },
      { worldTourRule: "free-first" },
      { fourResortRent: true },
      { fourResortRent: false },
      { buildAfterBuyout: true },
      { buildAfterBuyout: false },
      { taxCardMovement: true },
      { taxCardMovement: false },
      { resortFestivals: true },
      { resortFestivals: false },
    ]) {
      const response = await exports.default.fetch(
        new Request(`${origin}/api/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify({ name: "Alex", config }),
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("loads an existing version-3 active save without a marker on the prototype economy", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    await runInDurableObject(stub, (_instance, durableState) => {
      const row = durableState.storage.sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const saved = JSON.parse(row.json) as GameState;
      const {
        economyRule: _marker,
        boardRule: _board,
        sellBackPercent: _sale,
        worldTourRule: _tour,
        taxCardMovement: _tax,
        fourResortRent: _four,
        buildAfterBuyout: _build,
        ...oldConfig
      } = saved.config;
      durableState.storage.sql.exec(
        "UPDATE meta SET v='3' WHERE k='rulesVersion'",
      );
      durableState.storage.sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({
          ...saved,
          config: oldConfig,
          properties: getBoard("legacy")
            .filter((tile) => isCityTile(tile) || isResortTile(tile))
            .map((tile) => ({ tile: tile.index, owner: null, level: 0 })),
          players: saved.players.map((player) =>
            player.seat === saved.activeSeat
              ? { ...player, position: 4 }
              : player,
          ),
          pending: {
            kind: "buy",
            seat: saved.activeSeat,
            tile: 4,
            maxLevel: 3,
            deadline: Date.now() + 30_000,
          },
          resolutionQueue: [{ kind: "finish" }],
        }),
      );
    });
    await evictDurableObject(stub);
    const resumed = await connect(game.credentials[game.state.activeSeat]);
    const welcome = await resumed.next("welcome");
    expect(welcome.snapshot?.config).not.toHaveProperty("economyRule");
    expect(welcome.snapshot?.config).not.toHaveProperty("boardRule");
    expect(welcome.snapshot?.config).not.toHaveProperty("sellBackPercent");
    expect(
      welcome.snapshot?.properties.map((property) => property.tile),
    ).toEqual([
      1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 17, 18, 20, 21, 22, 23, 25, 26,
      27, 28, 30, 31,
    ]);
    expect(welcome.lobby).toMatchObject({
      boardRule: "legacy",
      economyRule: "prototype",
      sellBackPercent: 50,
    });
    resumed.send({
      type: "intent",
      id: "prototype-land-purchase",
      atSeq: welcome.seq,
      action: { type: "Buy", level: 0 },
    });
    const events = await resumed.next("events");
    // Prototype land on tile 4 costs 90 k; the reference grid charges 80 k.
    expect(events.events).toContainEqual(
      expect.objectContaining({
        type: "PropertyBought",
        tile: 4,
        level: 0,
        amount: 90_000,
      }),
    );
  });

  it.each([5, 6, 7, 8])(
    "starts preexisting version-%s lobbies with their original rules",
    async (version) => {
      const host = await create();
      const stub = env.GAME_ROOM.getByName(host.roomCode);
      await runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql.exec(
          "UPDATE meta SET v=? WHERE k='rulesVersion'",
          JSON.stringify(version),
        ),
      );
      await evictDurableObject(stub);
      const inbox = await connect(host);
      expect((await inbox.next("welcome")).lobby).toMatchObject({
        boardRule: "country",
        economyRule: "reference",
        worldTourRule: version >= 6 ? "free-and-own" : "free-first",
        resortFestivals: version < 7,
        taxCardMovement: false,
      });
      inbox.send({
        type: "lobby",
        id: `version-${version}-lobby-start`,
        op: { type: "start", fillBots: true },
      });
      const events = await inbox.next("events");
      const created = events.events.find(
        (event) => event.type === "GameCreated",
      );
      expect(
        created?.type === "GameCreated" ? created.state.config : null,
      ).toMatchObject({
        boardRule: "country",
        economyRule: "reference",
        worldTourRule: version >= 6 ? "free-and-own" : "free-first",
        resortFestivals: version < 7,
        taxCardMovement: false,
      });
    },
  );

  it("keeps a saved version-6 beach festival and its rent after wake-up and an intent", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    const active = game.state.activeSeat;
    await runInDurableObject(stub, (_instance, durableState) => {
      const row = durableState.storage.sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const saved = JSON.parse(row.json) as GameState;
      const {
        taxCardMovement: _tax,
        resortFestivals: _marker,
        fourResortRent: _four,
        buildAfterBuyout: _build,
        ...oldConfig
      } = saved.config;
      durableState.storage.sql.exec(
        "UPDATE meta SET v='6' WHERE k='rulesVersion'",
      );
      durableState.storage.sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({
          ...saved,
          config: oldConfig,
          festivalTiles: [4],
          properties: saved.properties.map((property) =>
            property.tile === 4 ? { ...property, owner: active } : property,
          ),
          players: saved.players.map((player) =>
            player.seat === active
              ? { ...player, position: 1, properties: [4] }
              : player,
          ),
          pending: {
            kind: "buy",
            seat: active,
            tile: 1,
            maxLevel: 2,
            deadline: Date.now() + 30_000,
          },
          resolutionQueue: [{ kind: "finish" }],
        }),
      );
    });
    await evictDurableObject(stub);
    const inbox = await connect(game.credentials[active]);
    const welcome = await inbox.next("welcome");
    expect(welcome.lobby.resortFestivals).toBe(true);
    if (!welcome.snapshot) throw new Error("Expected saved match snapshot");
    expect(welcome.snapshot.config.resortFestivals).toBeUndefined();
    expect(welcome.snapshot.festivalTiles).toEqual([4]);
    expect(propertyRent(welcome.snapshot, 4)).toBe(50_000);
    inbox.send({
      type: "intent",
      id: "keep-v6-festival",
      atSeq: welcome.seq,
      action: { type: "Decline" },
    });
    const events = await inbox.next("events");
    const next = events.events.reduce(applyEvent, welcome.snapshot);
    expect(next.festivalTiles).toEqual([4]);
    expect(propertyRent(next, 4)).toBe(50_000);
  });

  it("starts preexisting version-7 lobbies without the version-8 rules", async () => {
    const host = await create();
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec(
        "UPDATE meta SET v='7' WHERE k='rulesVersion'",
      ),
    );
    await evictDurableObject(stub);
    const inbox = await connect(host);
    expect((await inbox.next("welcome")).lobby).toMatchObject({
      worldTourRule: "free-and-own",
      resortFestivals: false,
      fourResortRent: false,
      buildAfterBuyout: false,
    });
    inbox.send({
      type: "lobby",
      id: "version-7-lobby-start",
      op: { type: "start", fillBots: true },
    });
    const events = await inbox.next("events");
    const created = events.events.find((event) => event.type === "GameCreated");
    expect(
      created?.type === "GameCreated" ? created.state.config : null,
    ).toMatchObject({ fourResortRent: false, buildAfterBuyout: false });
  });

  it("starts preexisting version-3 lobbies with the prototype economy", async () => {
    const host = await create();
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec(
        "UPDATE meta SET v='3' WHERE k='rulesVersion'",
      ),
    );
    await evictDurableObject(stub);
    const inbox = await connect(host);
    expect((await inbox.next("welcome")).lobby).toMatchObject({
      boardRule: "legacy",
      economyRule: "prototype",
      hotelPurchaseRule: "staged-hotels",
      sellBackPercent: 50,
    });
    inbox.send({
      type: "lobby",
      id: "prototype-lobby-start",
      op: { type: "start", fillBots: true },
    });
    const events = await inbox.next("events");
    const created = events.events.find((event) => event.type === "GameCreated");
    expect(
      created?.type === "GameCreated" ? created.state.config : null,
    ).toMatchObject({
      hotelPurchaseRule: "staged-hotels",
      economyRule: "prototype",
      boardRule: "legacy",
      sellBackPercent: 50,
    });
  });

  it("loads an existing version-2 active save without changing its legal Hotel purchase", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    await runInDurableObject(stub, (_instance, durableState) => {
      const row = durableState.storage.sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      const saved = JSON.parse(row.json) as GameState;
      // A real version-2 save predates both rule markers.
      const {
        hotelPurchaseRule: _marker,
        economyRule: _economy,
        boardRule: _board,
        sellBackPercent: _sale,
        worldTourRule: _tour,
        taxCardMovement: _tax,
        fourResortRent: _four,
        buildAfterBuyout: _build,
        ...oldConfig
      } = saved.config;
      durableState.storage.sql.exec(
        "UPDATE meta SET v='2' WHERE k='rulesVersion'",
      );
      durableState.storage.sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify({
          ...saved,
          config: oldConfig,
          properties: getBoard("legacy")
            .filter((tile) => isCityTile(tile) || isResortTile(tile))
            .map((tile) => ({ tile: tile.index, owner: null, level: 0 })),
          players: saved.players.map((player) =>
            player.seat === saved.activeSeat
              ? { ...player, laps: 1, position: 6 }
              : player,
          ),
          pending: {
            kind: "buy",
            seat: saved.activeSeat,
            tile: 6,
            maxLevel: 4,
            deadline: Date.now() + 30_000,
          },
          resolutionQueue: [{ kind: "finish" }],
        }),
      );
    });
    await evictDurableObject(stub);
    const resumed = await connect(game.credentials[game.state.activeSeat]);
    const welcome = await resumed.next("welcome");
    expect(welcome.snapshot?.config).not.toHaveProperty("hotelPurchaseRule");
    expect(welcome.snapshot?.config).not.toHaveProperty("boardRule");
    expect(welcome.snapshot?.config).not.toHaveProperty("sellBackPercent");
    resumed.send({
      type: "intent",
      id: "legacy-hotel-purchase",
      atSeq: welcome.seq,
      action: { type: "Buy", level: 4 },
    });
    const events = await resumed.next("events");
    expect(
      events.events.some(
        (event) =>
          event.type === "PropertyBought" &&
          event.tile === 6 &&
          event.level === 4,
      ),
    ).toBe(true);
    expect(events.events).toContainEqual(
      expect.objectContaining({
        type: "PropertyBought",
        tile: 6,
        level: 4,
        amount: 460_000,
      }),
    );
    const persisted = await runInDurableObject(
      stub,
      (_instance, durableState) => {
        const row = durableState.storage.sql
          .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
          .toArray()[0];
        return JSON.parse(row.json) as GameState;
      },
    );
    expect(persisted.config).not.toHaveProperty("hotelPurchaseRule");
    expect(
      persisted.properties.find((property) => property.tile === 6),
    ).toMatchObject({ owner: game.state.activeSeat, level: 4 });
  });

  it("starts preexisting version-2 lobbies with their original lap-only hotel rule", async () => {
    const host = await create();
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec(
        "UPDATE meta SET v='2' WHERE k='rulesVersion'",
      ),
    );
    await evictDurableObject(stub);
    const inbox = await connect(host);
    expect((await inbox.next("welcome")).lobby).toMatchObject({
      boardRule: "legacy",
      economyRule: "prototype",
      hotelPurchaseRule: "legacy-lap",
      sellBackPercent: 50,
    });
    inbox.send({
      type: "lobby",
      id: "legacy-lobby-start",
      op: { type: "start", fillBots: true },
    });
    const events = await inbox.next("events");
    const created = events.events.find((event) => event.type === "GameCreated");
    expect(
      created?.type === "GameCreated" ? created.state.config : null,
    ).toMatchObject({
      hotelPurchaseRule: "legacy-lap",
      economyRule: "prototype",
      boardRule: "legacy",
      sellBackPercent: 50,
    });
    const rules = await runInDurableObject(
      stub,
      (_instance, durableState) =>
        durableState.storage.sql
          .exec<{ v: string }>("SELECT v FROM meta WHERE k='rulesVersion'")
          .toArray()[0]?.v,
    );
    expect(rules).toBe("2");
  });

  it("rejects saved games with unsupported or inconsistent frozen rules versions", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    for (const rulesVersion of [2, 3, 5, 6, 7, 8, 999]) {
      // Versions 2 and 3 cannot use this new match's reference markers, version 5
      // cannot carry its World Tour marker, version 6 cannot exclude resort
      // festivals, version 7 the version-8 markers, and 999 is unknown.
      await runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql.exec(
          "UPDATE meta SET v=? WHERE k='rulesVersion'",
          JSON.stringify(rulesVersion),
        ),
      );
      const response = await exports.default.fetch(
        new Request(`${origin}/api/rooms/${game.credentials[0].roomCode}`),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "incompatible-saved-match",
      });
    }
    // Restore the supported rules before socket cleanup.
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec(
        "UPDATE meta SET v='9' WHERE k='rulesVersion'",
      ),
    );
  });

  it.each(["stateVersion", "rulesVersion"])(
    "refuses unknown lobby %s before connections, settings or start can mutate it",
    async (versionKey) => {
      const host = await create();
      const stub = env.GAME_ROOM.getByName(host.roomCode);
      const inbox = await connect(host);
      const welcome = await inbox.next("welcome");
      const readPersisted = () =>
        runInDurableObject(stub, (_instance, durableState) => {
          const sql = durableState.storage.sql;
          return {
            meta: sql.exec("SELECT k,v FROM meta ORDER BY k").toArray(),
            seats: sql
              .exec("SELECT seat,name,control FROM seats ORDER BY seat")
              .toArray(),
            state: sql.exec("SELECT id,seq FROM state").toArray(),
            events: sql.exec("SELECT seq FROM events").toArray(),
            commands: sql
              .exec("SELECT seat,id FROM commands ORDER BY seat,id")
              .toArray(),
            timers: sql
              .exec("SELECT kind,fire_at FROM timers ORDER BY kind")
              .toArray(),
          };
        });
      await runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql.exec(
          "UPDATE meta SET v='999' WHERE k=?",
          versionKey,
        ),
      );
      try {
        const before = await readPersisted();
        expect(before.state).toHaveLength(0);
        const response = await exports.default.fetch(
          new Request(`${origin}/ws/room/${host.roomCode}`, {
            headers: {
              Upgrade: "websocket",
              Origin: origin,
              "Sec-WebSocket-Protocol": `polytour, seat.${host.token}`,
            },
          }),
        );
        if (response.webSocket) {
          response.webSocket.accept();
          activeSockets.push(response.webSocket);
        }
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: "incompatible-saved-match",
        });
        inbox.send({
          type: "lobby",
          id: "incompatible-settings",
          op: {
            type: "settings",
            config: { ...welcome.lobby.config, startingCash: 3_000_000 },
          },
        });
        expect(await inbox.next("reject")).toMatchObject({
          id: "incompatible-settings",
          reason: "incompatible-saved-match",
        });
        expect(await readPersisted()).toEqual(before);
        inbox.send({
          type: "lobby",
          id: "incompatible-start",
          op: { type: "start", fillBots: true },
        });
        expect(await inbox.next("reject")).toMatchObject({
          id: "incompatible-start",
          reason: "incompatible-saved-match",
        });
        expect(await readPersisted()).toEqual(before);
      } finally {
        await runInDurableObject(stub, (_instance, durableState) =>
          durableState.storage.sql.exec(
            "UPDATE meta SET v=? WHERE k=?",
            versionKey === "stateVersion" ? "1" : "5",
            versionKey,
          ),
        );
      }
    },
  );

  it("persists a future drand commitment, blocks actions and retries the identical round", async () => {
    const host = await create("drand");
    const credentials = [
      host,
      await join(host.roomCode, "Bo"),
      await join(host.roomCode, "Cam"),
      await join(host.roomCode, "Dee"),
    ];
    const inboxes = await Promise.all(
      credentials.map((credential) => connect(credential)),
    );
    await Promise.all(inboxes.map((inbox) => inbox.next("welcome")));
    inboxes[0].send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: false },
    });
    const started = await inboxes[0].next("events");
    const created = started.events.find(
      (event) => event.type === "GameCreated",
    );
    if (created?.type !== "GameCreated")
      throw new Error("GameCreated expected");
    const seat = created.state.activeSeat;
    inboxes[seat].send({
      type: "intent",
      id: "roll",
      atSeq: started.toSeq,
      action: { type: "Roll" },
    });
    const committed = await inboxes[seat].next("randomness");
    expect(committed.status).toBe("committed");
    expect(committed.commitment?.availableAt).toBeGreaterThan(
      committed.commitment?.committedAt ?? 0,
    );
    inboxes[seat].send({
      type: "intent",
      id: "again",
      atSeq: started.toSeq,
      action: { type: "Roll" },
    });
    expect((await inboxes[seat].next("reject")).reason).toBe(
      "randomness-pending",
    );
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    const readPending = () =>
      runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec<{ v: string }>("SELECT v FROM meta WHERE k='pendingDice'")
            .toArray()[0].v,
      );
    const before = await readPending();
    await runInDurableObject(stub, async (instance, durableState) => {
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind='randomness'",
        Date.now() - 1,
      );
      // Simulate an interrupted resolver: it leaves the persisted commitment
      // untouched. The alarm must retain the durable retry through that await.
      const resolver = instance as unknown as {
        finishDice(): Promise<void>;
        alarm(): Promise<void>;
      };
      const original = resolver.finishDice;
      resolver.finishDice = async () => {
        expect(
          durableState.storage.sql
            .exec("SELECT kind FROM timers WHERE kind='randomness'")
            .toArray(),
        ).toHaveLength(1);
      };
      try {
        await resolver.alarm();
      } finally {
        resolver.finishDice = original;
      }
      expect(
        durableState.storage.sql
          .exec("SELECT kind FROM timers WHERE kind='randomness'")
          .toArray(),
      ).toHaveLength(1);
      // The retained retry was due, so the room re-armed its alarm for the next
      // millisecond. Keep it from firing on its own (and starting a real relay
      // request) while the test evicts the room; the test runs it below.
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind='randomness'",
        Date.now() + 60_000,
      );
      await durableState.storage.setAlarm(Date.now() + 60_000);
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Relay unavailable"),
    );
    await evictDurableObject(stub);
    expect(await readPending()).toBe(before);
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind='randomness'",
        Date.now() - 1,
      ),
    );
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const failed = await inboxes[seat].next("randomness");
    expect(failed.status).toBe("error");
    expect(await readPending()).toBe(before);
    expect(failed.commitment).toEqual(committed.commitment);
  });
});

describe("Room leader, waiting room and shared screens", () => {
  it("releases a departing device's local players and transfers leadership to another independent device", async () => {
    const host = await create();
    const hostSocket = await connect(host);
    await hostSocket.next("welcome");
    expect(
      await roomOp(hostSocket, "host-local", {
        type: "add-local",
        seat: 1,
        name: "Sam",
      }),
    ).toBe("ack");
    const guest = await joinSeated(host.roomCode, "Bo");
    expect(guest.seat).toBe(2);
    const guestSocket = await connect(guest);
    await guestSocket.next("welcome");
    expect(
      await roomOp(guestSocket, "guest-local", {
        type: "add-local",
        seat: 3,
        name: "Kim",
      }),
    ).toBe("ack");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) => {
      for (const seat of [0, 1]) {
        durableState.storage.sql.exec(
          "INSERT OR REPLACE INTO commands(seat,id) VALUES(?,'old-command')",
          seat,
        );
        durableState.storage.sql.exec(
          "INSERT OR REPLACE INTO meta(k,v) VALUES(?, 'true')",
          `takeover:${seat}`,
        );
        durableState.storage.sql.exec(
          "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES(?,?)",
          `grace:${seat}`,
          Date.now() + 60_000,
        );
      }
    });
    const closed = waitForClose(hostSocket);
    expect((await leave(host)).status).toBe(200);
    expect(await closed).toEqual({ code: 1008, reason: "Left room" });
    const lobby = await lobbyOf(host.roomCode);
    expect(lobby.hostSeat).toBe(guest.seat);
    expect(
      lobby.seats.map((seat) => [seat.control, seat.controller, seat.online]),
    ).toEqual([
      [null, null, false],
      [null, null, false],
      ["human", null, true],
      ["human", 2, true],
    ]);
    expect(
      await runInDurableObject(stub, (_instance, durableState) => ({
        locals: durableState.storage.sql
          .exec("SELECT seat,controller FROM local_seats ORDER BY seat")
          .toArray(),
        commands: durableState.storage.sql
          .exec("SELECT seat,id FROM commands WHERE seat IN (0,1)")
          .toArray(),
        takeover: durableState.storage.sql
          .exec("SELECT k FROM meta WHERE k IN ('takeover:0','takeover:1')")
          .toArray(),
        grace: durableState.storage.sql
          .exec("SELECT kind FROM timers WHERE kind IN ('grace:0','grace:1')")
          .toArray(),
      })),
    ).toEqual({
      locals: [{ seat: 3, controller: 2 }],
      commands: [],
      takeover: [],
      grace: [],
    });
    expect(
      await roomOp(guestSocket, "new-leader-lock", {
        type: "lock",
        locked: true,
      }),
    ).toBe("ack");
    await expectRevoked(host);
  });

  it("removes a departing waiting member and closes both of their connections", async () => {
    const host = await create();
    const hostSocket = await connect(host);
    await hostSocket.next("welcome");
    expect(
      await roomOp(hostSocket, "lock-for-waiter", {
        type: "lock",
        locked: true,
      }),
    ).toBe("ack");
    const waiter = await join(host.roomCode, "Waiting guest");
    expect(waiter.seat).toBeNull();
    const waitingSockets = [await connect(waiter), await connect(waiter)];
    const welcomes = await Promise.all(
      waitingSockets.map((inbox) => inbox.next("welcome")),
    );
    expect(welcomes[0].you.member).not.toBeNull();
    expect(welcomes[1].you).toEqual(welcomes[0].you);
    const closes = waitingSockets.map(waitForClose);
    expect((await leave(waiter)).status).toBe(200);
    expect(await Promise.all(closes)).toEqual([
      { code: 1008, reason: "Left room" },
      { code: 1008, reason: "Left room" },
    ]);
    expect(await lobbyOf(host.roomCode)).toMatchObject({
      hostSeat: 0,
      locked: true,
      waiting: [],
    });
    expect(
      await runInDurableObject(
        env.GAME_ROOM.getByName(host.roomCode),
        (_instance, durableState) =>
          durableState.storage.sql.exec("SELECT id FROM members").toArray(),
      ),
    ).toEqual([]);
    await expectRevoked(waiter);
  });

  it("closes a promoted waiting member's connections using attachments despite their original member tags", async () => {
    const host = await create();
    const hostSocket = await connect(host);
    await hostSocket.next("welcome");
    expect(
      await roomOp(hostSocket, "lock-for-promotion", {
        type: "lock",
        locked: true,
      }),
    ).toBe("ack");
    const waiter = await join(host.roomCode, "Promoted guest");
    const waitingSockets = [await connect(waiter), await connect(waiter)];
    const welcomes = await Promise.all(
      waitingSockets.map((inbox) => inbox.next("welcome")),
    );
    const member = welcomes[0].you.member;
    if (member === null) throw new Error("Waiting member expected");
    expect(
      await roomOp(hostSocket, "admit-promoted", { type: "admit", member }),
    ).toBe("ack");
    for (const inbox of waitingSockets)
      expect((await inbox.next("welcome")).you).toEqual({
        seat: 1,
        member: null,
      });
    expect(
      await runInDurableObject(
        env.GAME_ROOM.getByName(host.roomCode),
        (_instance, durableState) => ({
          originalTags: durableState.getWebSockets(`member:${member}`).length,
          seatTags: durableState.getWebSockets("seat:1").length,
        }),
      ),
    ).toEqual({ originalTags: 2, seatTags: 0 });
    const closes = waitingSockets.map(waitForClose);
    expect((await leave(waiter)).status).toBe(200);
    expect(await Promise.all(closes)).toEqual([
      { code: 1008, reason: "Left room" },
      { code: 1008, reason: "Left room" },
    ]);
    const lobby = await lobbyOf(host.roomCode);
    expect(lobby).toMatchObject({ hostSeat: 0, waiting: [] });
    expect(lobby.seats[1]).toMatchObject({
      control: null,
      online: false,
      controller: null,
    });
    await expectRevoked(waiter);
  });

  it.each([false, true])(
    "unlocks a lobby after its last device leaves and promotes a connected waiter (previous approval: %s)",
    async (approved) => {
      const host = await create();
      const hostSocket = await connect(host);
      await hostSocket.next("welcome");
      expect(
        await roomOp(hostSocket, "lock-before-departure", {
          type: "lock",
          locked: true,
        }),
      ).toBe("ack");
      const waiter = await join(host.roomCode, "Next leader");
      const member = (await lobbyOf(host.roomCode)).waiting[0].id;
      if (approved)
        expect(
          await roomOp(hostSocket, "admit-offline-waiter", {
            type: "admit",
            member,
          }),
        ).toBe("ack");
      for (const seat of [1, 2, 3])
        expect(
          await roomOp(hostSocket, `fill-local-${seat}`, {
            type: "add-local",
            seat,
            name: `Local ${seat}`,
          }),
        ).toBe("ack");
      const waitingSocket = await connect(waiter);
      expect((await waitingSocket.next("welcome")).you).toEqual({
        seat: null,
        member,
      });
      const closed = waitForClose(hostSocket);
      expect((await leave(host)).status).toBe(200);
      await closed;
      const promoted = await waitingSocket.next("welcome");
      expect(promoted.you).toEqual({ seat: 0, member: null });
      expect(promoted.lobby).toMatchObject({
        hostSeat: 0,
        locked: false,
        waiting: [],
      });
      expect(promoted.lobby.seats.map((seat) => seat.control)).toEqual([
        "human",
        null,
        null,
        null,
      ]);
      expect(promoted.lobby.seats[0]).toMatchObject({
        name: "Next leader",
        controller: null,
        online: true,
      });
      expect(
        await roomOp(waitingSocket, "promoted-leader-settings", {
          type: "settings",
          config: promoted.lobby.config,
        }),
      ).toBe("ack");
      await expectRevoked(host);
      const resumed = await connect(waiter);
      expect((await resumed.next("welcome")).you).toEqual({
        seat: 0,
        member: null,
      });
    },
  );

  it("opens a lobby with the bots Play asks for and seats friends in their places", async () => {
    const host = await create(undefined, 3);
    const lobby = await lobbyOf(host.roomCode);
    expect(lobby).toMatchObject({ hostSeat: 0, locked: false, waiting: [] });
    expect(lobby.seats.map((seat) => [seat.name, seat.control])).toEqual([
      ["Alex", "human"],
      ["Milo", "bot"],
      ["Nova", "bot"],
      ["Atlas", "bot"],
    ]);
    // Each friend takes the next bot's place, in seat order.
    for (const [name, seat] of [
      ["Bo", 1],
      ["Cam", 2],
      ["Dee", 3],
    ] as const)
      expect((await join(host.roomCode, name)).seat).toBe(seat);
    const full = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${host.roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: "Eve" }),
      }),
    );
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "room-full" });
    expect(
      (await lobbyOf(host.roomCode)).seats.map((seat) => [
        seat.name,
        seat.control,
      ]),
    ).toEqual([
      ["Alex", "human"],
      ["Bo", "human"],
      ["Cam", "human"],
      ["Dee", "human"],
    ]);
    for (const bots of [4, -1, 1.5])
      expect((await createRoom({ name: "Alex", bots })).status).toBe(400);
  });

  it("gives a room saved before the waiting room its new tables when it wakes", async () => {
    const host = await create();
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    // A room created by the previous build has neither people table.
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec("DROP TABLE members");
      durableState.storage.sql.exec("DROP TABLE local_seats");
    });
    await evictDurableObject(stub);
    expect(await lobbyOf(host.roomCode)).toMatchObject({
      hostSeat: 0,
      locked: false,
      waiting: [],
    });
    const hostSocket = await connect(host);
    await hostSocket.next("welcome");
    expect(
      await roomOp(hostSocket, "lock", { type: "lock", locked: true }),
    ).toBe("ack");
    expect((await join(host.roomCode, "Bo")).seat).toBeNull();
    expect(
      await roomOp(hostSocket, "sam", {
        type: "add-local",
        seat: 1,
        name: "Sam",
      }),
    ).toBe("ack");
    const lobby = await lobbyOf(host.roomCode);
    expect(lobby.waiting.map((member) => member.name)).toEqual(["Bo"]);
    expect(lobby.seats[1]).toMatchObject({ name: "Sam", controller: 0 });
  });

  it("hands the leader role to another person, who then runs the room", async () => {
    const host = await create();
    const bo = await join(host.roomCode, "Bo");
    const hostSocket = await connect(host);
    const boSocket = await connect(bo);
    await hostSocket.next("welcome");
    await boSocket.next("welcome");
    expect(
      await roomOp(boSocket, "bo-lock", { type: "lock", locked: true }),
    ).toBe("host-only");
    // Only another person with a device of their own can lead.
    expect(
      await roomOp(hostSocket, "self", { type: "transfer-host", seat: 0 }),
    ).toBe("not-transferable");
    expect(
      await roomOp(hostSocket, "empty", { type: "transfer-host", seat: 2 }),
    ).toBe("not-transferable");
    expect(await roomOp(hostSocket, "bot", { type: "add-bot", seat: 2 })).toBe(
      "ack",
    );
    expect(
      await roomOp(hostSocket, "to-bot", { type: "transfer-host", seat: 2 }),
    ).toBe("not-transferable");
    expect(
      await roomOp(hostSocket, "to-bo", { type: "transfer-host", seat: 1 }),
    ).toBe("ack");
    expect((await lobbyOf(host.roomCode)).hostSeat).toBe(1);
    expect(
      await roomOp(hostSocket, "old-start", {
        type: "start",
        fillBots: false,
      }),
    ).toBe("host-only");
    expect(
      await roomOp(boSocket, "start", { type: "start", fillBots: false }),
    ).toBe("ack");
    // The role carries into the match: only the leader can end it.
    expect(
      await roomOp(hostSocket, "old-return", { type: "return-to-lobby" }),
    ).toBe("host-only");
    expect(
      await roomOp(boSocket, "back", { type: "transfer-host", seat: 0 }),
    ).toBe("ack");
    expect(await lobbyOf(host.roomCode)).toMatchObject({
      hostSeat: 0,
      status: "playing",
    });
  });

  it("holds newcomers to a locked room until the leader admits or turns them away", async () => {
    const host = await create(undefined, 2);
    const hostSocket = await connect(host);
    await hostSocket.next("welcome");
    expect(
      await roomOp(hostSocket, "lock", { type: "lock", locked: true }),
    ).toBe("ack");
    const bo = await join(host.roomCode, "Bo");
    expect(bo.seat).toBeNull();
    let lobby = await lobbyOf(host.roomCode);
    expect(lobby.locked).toBe(true);
    expect(lobby.waiting).toEqual([
      { id: expect.any(String), name: "Bo", approved: false, online: false },
    ]);
    const boSocket = await connect(bo);
    const waiting = await boSocket.next("welcome");
    expect(waiting.you).toEqual({ seat: null, member: lobby.waiting[0].id });
    expect(
      await roomOp(boSocket, "self-admit", {
        type: "admit",
        member: lobby.waiting[0].id,
      }),
    ).toBe("not-seated");
    expect(
      await roomOp(hostSocket, "admit", {
        type: "admit",
        member: lobby.waiting[0].id,
      }),
    ).toBe("ack");
    // The open place comes before a bot's place.
    expect((await boSocket.next("welcome")).you).toEqual({
      seat: 3,
      member: null,
    });
    lobby = await lobbyOf(host.roomCode);
    expect(lobby.seats[3]).toMatchObject({
      name: "Bo",
      control: "human",
      online: true,
    });
    expect(lobby.waiting).toEqual([]);

    // Turned away: the socket closes and the capability stops working.
    const cam = await join(host.roomCode, "Cam");
    const camSocket = await connect(cam);
    const camWaiting = await camSocket.next("welcome");
    const closed = new Promise<number>((resolve) =>
      camSocket.socket.addEventListener("close", (event) =>
        resolve(event.code),
      ),
    );
    expect(
      await roomOp(hostSocket, "deny", {
        type: "deny",
        member: camWaiting.you.member,
      }),
    ).toBe("ack");
    expect(await closed).toBe(4003);
    const refused = await exports.default.fetch(
      new Request(`${origin}/ws/room/${cam.roomCode}`, {
        headers: {
          Upgrade: "websocket",
          Origin: origin,
          "Sec-WebSocket-Protocol": `polytour, seat.${cam.token}`,
        },
      }),
    );
    expect(refused.status).toBe(401);

    // Opening the door admits whoever still waited at it.
    const dee = await join(host.roomCode, "Dee");
    const deeSocket = await connect(dee);
    await deeSocket.next("welcome");
    expect(
      await roomOp(hostSocket, "unlock", { type: "lock", locked: false }),
    ).toBe("ack");
    expect((await deeSocket.next("welcome")).you.seat).toBe(1);
    lobby = await lobbyOf(host.roomCode);
    expect(lobby.locked).toBe(false);
    expect(lobby.seats.map((seat) => [seat.name, seat.control])).toEqual([
      ["Alex", "human"],
      ["Dee", "human"],
      ["Nova", "bot"],
      ["Bo", "human"],
    ]);
  });

  it("lets a late arrival watch, take a bot's place, and seats the rest for the next game", async () => {
    const host = await create();
    const bo = await join(host.roomCode, "Bo");
    const hostSocket = await connect(host);
    const boSocket = await connect(bo);
    await hostSocket.next("welcome");
    await boSocket.next("welcome");
    expect(
      await roomOp(hostSocket, "start", { type: "start", fillBots: true }),
    ).toBe("ack");
    await hostSocket.next("events");
    const late = await join(host.roomCode, "Late");
    expect(late.seat).toBeNull();
    const lateSocket = await connect(late);
    const watching = await lateSocket.next("welcome");
    expect(watching.snapshot?.players).toHaveLength(4);
    const member = watching.you.member;
    expect(watching.you.seat).toBeNull();
    expect(member).toMatch(/^[a-f0-9]{16}$/);
    lateSocket.send({
      type: "intent",
      id: "peek",
      atSeq: watching.seq,
      action: { type: "Roll" },
    });
    expect(await answer(lateSocket, "peek")).toBe("not-seated");
    const next = await join(host.roomCode, "Next");
    const nextSocket = await connect(next);
    await nextSocket.next("welcome");

    // Only the leader hands out a place, and only a bot's place.
    expect(
      await roomOp(boSocket, "bo-replace", {
        type: "replace-bot",
        member,
        seat: 2,
      }),
    ).toBe("host-only");
    expect(
      await roomOp(hostSocket, "human", {
        type: "replace-bot",
        member,
        seat: 1,
      }),
    ).toBe("not-a-bot");
    expect(
      await roomOp(hostSocket, "nobody", {
        type: "replace-bot",
        member: "0000000000000000",
        seat: 2,
      }),
    ).toBe("member-not-found");
    expect(
      await roomOp(hostSocket, "replace", {
        type: "replace-bot",
        member,
        seat: 2,
      }),
    ).toBe("ack");
    const handed = await eventsWith(boSocket, "PlayerControlChanged");
    expect(handed.events).toContainEqual({
      type: "PlayerControlChanged",
      seat: 2,
      control: "human",
      name: "Late",
    });
    // The same socket is welcomed again, now in the bot's old seat.
    const seated = await lateSocket.next("welcome");
    expect(seated.you).toEqual({ seat: 2, member: null });
    expect(
      seated.snapshot?.players.find((player) => player.seat === 2),
    ).toMatchObject({ name: "Late", control: "human" });
    let lobby = await lobbyOf(host.roomCode);
    expect(lobby.seats[2]).toMatchObject({
      name: "Late",
      control: "human",
      online: true,
    });
    expect(lobby.waiting.map((entry) => entry.name)).toEqual(["Next"]);

    // Back to the lobby: the match is discarded, places and bots remain, and
    // whoever waited takes the next bot's place.
    expect(
      await roomOp(boSocket, "bo-return", { type: "return-to-lobby" }),
    ).toBe("host-only");
    expect(
      await roomOp(hostSocket, "return", { type: "return-to-lobby" }),
    ).toBe("ack");
    for (const inbox of [hostSocket, boSocket, lateSocket]) {
      const back = await inbox.next("welcome");
      expect(back).toMatchObject({ seq: 0, snapshot: null });
      expect(back.lobby.status).toBe("lobby");
    }
    expect((await nextSocket.next("welcome")).you).toEqual({
      seat: 3,
      member: null,
    });
    lobby = await lobbyOf(host.roomCode);
    expect(lobby.status).toBe("lobby");
    expect(lobby.waiting).toEqual([]);
    expect(lobby.seats.map((seat) => [seat.name, seat.control])).toEqual([
      ["Alex", "human"],
      ["Bo", "human"],
      ["Late", "human"],
      ["Next", "human"],
    ]);
    const storage = await runInDurableObject(
      env.GAME_ROOM.getByName(host.roomCode),
      (_instance, durableState) => {
        const sql = durableState.storage.sql;
        return {
          state: sql.exec("SELECT id FROM state").toArray().length,
          events: sql.exec("SELECT seq FROM events").toArray().length,
          timers: sql
            .exec<{ kind: string }>("SELECT kind FROM timers")
            .toArray()
            .map((timer) => timer.kind),
        };
      },
    );
    expect(storage).toEqual({ state: 0, events: 0, timers: ["cleanup"] });
    expect(
      await roomOp(hostSocket, "again", { type: "start", fillBots: false }),
    ).toBe("ack");
    const again = await eventsWith(hostSocket, "GameCreated");
    const created = again.events.find((event) => event.type === "GameCreated");
    expect(again.fromSeq).toBe(1);
    expect(
      created?.type === "GameCreated" &&
        created.state.players.map((player) => player.name),
    ).toEqual(["Alex", "Bo", "Late", "Next"]);
  });

  it("seats a player who shares a device and lets only that device act for them", async () => {
    const host = await create();
    const hostSocket = await connect(host);
    await hostSocket.next("welcome");
    expect(
      await roomOp(hostSocket, "sam", {
        type: "add-local",
        seat: 1,
        name: "Sam",
      }),
    ).toBe("ack");
    expect((await lobbyOf(host.roomCode)).seats[1]).toEqual({
      seat: 1,
      name: "Sam",
      control: "human",
      online: true,
      controller: 0,
    });
    for (const seat of [0, 1])
      expect(
        await roomOp(hostSocket, `taken-${seat}`, {
          type: "add-local",
          seat,
          name: "Twin",
        }),
      ).toBe("seat-taken");
    const bo = await join(host.roomCode, "Bo");
    expect(bo.seat).toBe(2);
    const boSocket = await connect(bo);
    await boSocket.next("welcome");
    // Any player may seat someone at their own screen; only that screen or
    // the leader removes them.
    expect(
      await roomOp(boSocket, "not-mine", { type: "remove-local", seat: 1 }),
    ).toBe("host-only");
    expect(
      await roomOp(boSocket, "kim", {
        type: "add-local",
        seat: 3,
        name: "Kim",
      }),
    ).toBe("ack");
    expect((await lobbyOf(host.roomCode)).seats[3].controller).toBe(2);
    expect(
      await roomOp(hostSocket, "drop-kim", { type: "remove-local", seat: 3 }),
    ).toBe("ack");
    expect(
      await roomOp(hostSocket, "not-local", { type: "remove-local", seat: 2 }),
    ).toBe("not-local");
    expect(
      await roomOp(hostSocket, "lead-sam", { type: "transfer-host", seat: 1 }),
    ).toBe("not-transferable");
    expect(
      await roomOp(hostSocket, "start", { type: "start", fillBots: false }),
    ).toBe("ack");
    const started = await hostSocket.next("events");
    const created = started.events.find(
      (event) => event.type === "GameCreated",
    );
    if (created?.type !== "GameCreated")
      throw new Error("GameCreated expected");
    expect(
      created.state.players.map((player) => [player.name, player.control]),
    ).toEqual([
      ["Alex", "human"],
      ["Sam", "human"],
      ["Bo", "human"],
    ]);
    const state = started.events.reduce(applyEvent, created.state);
    // The host's screen may act for Sam; Bo's screen may not.
    boSocket.send({
      type: "intent",
      id: "steal",
      atSeq: started.toSeq,
      action: { type: "Roll" },
      seat: 1,
    });
    expect(await answer(boSocket, "steal")).toBe("not-your-seat");
    hostSocket.send({
      type: "intent",
      id: "sam-roll",
      atSeq: started.toSeq,
      action: { type: "Roll" },
      seat: 1,
    });
    expect(await answer(hostSocket, "sam-roll")).toBe(
      state.activeSeat === 1 ? "ack" : "not-your-turn",
    );
    // Sam leaves with the screen Sam shares, so both seats get their grace.
    await closeInbox(hostSocket);
    const lobby = await lobbyOf(host.roomCode);
    expect(lobby.seats.map((seat) => seat.online)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    const timers = await runInDurableObject(
      env.GAME_ROOM.getByName(host.roomCode),
      (_instance, durableState) =>
        durableState.storage.sql
          .exec<{ kind: string }>(
            "SELECT kind FROM timers WHERE kind LIKE 'grace:%' ORDER BY kind",
          )
          .toArray()
          .map((timer) => timer.kind),
    );
    expect(timers).toEqual(["grace:0", "grace:1"]);
  });
});
