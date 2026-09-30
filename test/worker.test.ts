import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GameState,
  PublicState,
  Seat,
} from "../src/shared/engine/index.js";
import { applyEvent } from "../src/shared/engine/index.js";
import type {
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
async function create(
  mode: "secure" | "drand" = "secure",
): Promise<RoomCredentials> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "Alex", config: { randomnessMode: mode } }),
    }),
  );
  expect(response.status).toBe(201);
  return response.json<RoomCredentials>();
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
afterEach(() => {
  for (const socket of activeSockets.splice(0)) socket.close(1000);
  vi.restoreAllMocks();
});

describe("Authoritative private rooms", () => {
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
      id: "missing",
      op: { type: "start", fillBots: false },
    });
    expect((await hostSocket.next("reject")).reason).toBe(
      "four-players-required",
    );
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
    const rejectedJoin = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${host.roomCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: "Late" }),
      }),
    );
    expect(rejectedJoin.status).toBe(409);
  });

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

  it("rejects saved games with an unsupported rules version", async () => {
    const game = await startFour();
    const stub = env.GAME_ROOM.getByName(game.credentials[0].roomCode);
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec(
        "UPDATE meta SET v='999' WHERE k='rulesVersion'",
      ),
    );
    const response = await exports.default.fetch(
      new Request(`${origin}/api/rooms/${game.credentials[0].roomCode}`),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "incompatible-saved-match",
    });
    // Restore to let normal socket close callbacks finish under the supported rules.
    await runInDurableObject(stub, (_instance, durableState) =>
      durableState.storage.sql.exec(
        "UPDATE meta SET v='2' WHERE k='rulesVersion'",
      ),
    );
  });

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
      const resolver = instance as unknown as { finishDice(): Promise<void> };
      const original = resolver.finishDice;
      resolver.finishDice = async () => {
        expect(
          durableState.storage.sql
            .exec("SELECT kind FROM timers WHERE kind='randomness'")
            .toArray(),
        ).toHaveLength(1);
      };
      try {
        await instance.alarm();
      } finally {
        resolver.finishDice = original;
      }
      expect(
        durableState.storage.sql
          .exec("SELECT kind FROM timers WHERE kind='randomness'")
          .toArray(),
      ).toHaveLength(1);
    });
    await evictDurableObject(stub);
    expect(await readPending()).toBe(before);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Relay unavailable"),
    );
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
