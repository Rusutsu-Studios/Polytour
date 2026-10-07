import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { Action, GameState, Seat } from "../src/shared/engine/index.js";
import type {
  RoomCredentials,
  ServerMessage,
} from "../src/shared/protocol/index.js";

const origin = "https://example.test";
const sockets: WebSocket[] = [];
class Inbox {
  readonly messages: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  readonly socket: WebSocket;
  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)) as ServerMessage);
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.accept();
    sockets.push(socket);
  }
  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }
  async next<T extends ServerMessage["type"]>(
    type: T,
    id?: string,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const index = this.messages.findIndex(
        (message) =>
          message.type === type &&
          (id === undefined || ("id" in message && message.id === id)),
      );
      if (index >= 0)
        return this.messages.splice(index, 1)[0] as Extract<
          ServerMessage,
          { type: T }
        >;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}
async function connect(
  credentials: RoomCredentials,
  lastSeq: number | null = null,
) {
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
  if (!response.webSocket) throw new Error("Socket expected");
  const inbox = new Inbox(response.webSocket);
  inbox.send({ type: "sync", lastSeq });
  const welcome = await inbox.next("welcome");
  return { inbox, welcome };
}
async function join(code: string): Promise<RoomCredentials> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/rooms/${code}/join`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bo" }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json<RoomCredentials>();
}
async function start(
  humans = 1,
  local = false,
  mode: "secure" | "drand" = "secure",
) {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/rooms`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alex",
        config: { randomnessMode: mode, decisionSeconds: 60 },
      }),
    }),
  );
  expect(response.status).toBe(201);
  const host = await response.json<RoomCredentials>();
  const credentials = [host];
  for (let index = 1; index < humans; index++)
    credentials.push(await join(host.roomCode));
  const inboxes = [];
  for (const credential of credentials)
    inboxes.push((await connect(credential)).inbox);
  if (local) {
    inboxes[0].send({
      type: "lobby",
      id: "local",
      op: { type: "add-local", seat: 1, name: "Cam" },
    });
    await inboxes[0].next("ack", "local");
  }
  inboxes[0].send({
    type: "lobby",
    id: "start",
    op: { type: "start", fillBots: true },
  });
  await inboxes[0].next("ack", "start");
  await editState(host.roomCode, (state) => ({
    ...state,
    activeSeat: 0,
    pending: { kind: "roll", seat: 0, deadline: Date.now() + 60_000 },
  }));
  return { code: host.roomCode, credentials, inboxes };
}
function readRoom(code: string) {
  return runInDurableObject(
    env.GAME_ROOM.getByName(code),
    (_instance, durableState) => {
      const sql = durableState.storage.sql;
      const row = sql
        .exec<{ seq: number; json: string }>(
          "SELECT seq,json FROM state WHERE id=1",
        )
        .toArray()[0];
      return {
        seq: row.seq,
        state: JSON.parse(row.json) as GameState,
        timers: sql
          .exec<{ kind: string; fire_at: number }>(
            "SELECT kind,fire_at FROM timers ORDER BY kind",
          )
          .toArray(),
      };
    },
  );
}
function editState(code: string, change: (state: GameState) => GameState) {
  return runInDurableObject(
    env.GAME_ROOM.getByName(code),
    (_instance, durableState) => {
      const sql = durableState.storage.sql;
      const row = sql
        .exec<{ json: string }>("SELECT json FROM state WHERE id=1")
        .toArray()[0];
      sql.exec(
        "UPDATE state SET json=? WHERE id=1",
        JSON.stringify(change(JSON.parse(row.json) as GameState)),
      );
    },
  );
}
async function intent(
  code: string,
  inbox: Inbox,
  id: string,
  action: Action,
  seat?: Seat,
  rejection?: string,
) {
  const saved = await readRoom(code);
  inbox.send({
    type: "intent",
    id,
    atSeq: saved.seq,
    action,
    ...(seat === undefined ? {} : { seat }),
  });
  if (rejection)
    expect((await inbox.next("reject", id)).reason).toBe(rejection);
  else await inbox.next("ack", id);
  return readRoom(code);
}
async function close(inbox: Inbox) {
  const closed = new Promise<void>((resolve) =>
    inbox.socket.addEventListener("close", () => resolve(), { once: true }),
  );
  inbox.socket.close(1000);
  await closed;
}
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close(1000);
});

describe("Authoritative game pause", () => {
  it("freezes a solo human's bot turn and overdue gameplay alarms, then restores remaining deadlines", async () => {
    const game = await start();
    await editState(game.code, (state) => ({
      ...state,
      activeSeat: 1,
      pending: { kind: "roll", seat: 1, deadline: Date.now() + 20_000 },
      matchDeadline: Date.now() + 40_000,
    }));
    const paused = await intent(game.code, game.inboxes[0], "pause", {
      type: "RequestPause",
    });
    expect(paused.state.pause).toMatchObject({
      kind: "paused",
      requestedBy: 0,
    });
    expect(paused.timers).toEqual([]);
    await intent(
      game.code,
      game.inboxes[0],
      "blocked",
      { type: "Roll" },
      undefined,
      "game-paused",
    );
    await editState(game.code, (state) => {
      if (
        state.pause?.kind !== "paused" ||
        !state.pending ||
        state.matchDeadline === null
      )
        throw new Error("Paused game expected");
      return {
        ...state,
        pause: { ...state.pause, startedAt: state.pause.startedAt - 120_000 },
        pending: {
          ...state.pending,
          deadline: state.pending.deadline - 120_000,
        },
        matchDeadline: state.matchDeadline - 120_000,
      };
    });
    const stub = env.GAME_ROOM.getByName(game.code);
    await runInDurableObject(stub, async (_instance, durableState) => {
      for (const kind of ["bot", "decision", "randomness", "match-end"])
        durableState.storage.sql.exec(
          "INSERT INTO timers(kind,fire_at) VALUES(?,?)",
          kind,
          Date.now() - 1,
        );
      // Keep the platform alarm future: the test helper fires the overdue SQL work.
      await durableState.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const frozen = await readRoom(game.code);
    expect(frozen.seq).toBe(paused.seq);
    expect(frozen.state.pause?.kind).toBe("paused");
    expect(frozen.timers).toEqual([]);
    if (
      frozen.state.pause?.kind !== "paused" ||
      !frozen.state.pending ||
      frozen.state.matchDeadline === null
    )
      throw new Error("Paused game expected");
    const beforeResume = Date.now();
    const resumed = await intent(game.code, game.inboxes[0], "resume", {
      type: "ResumeGame",
    });
    const afterResume = Date.now();
    const minimumShift = beforeResume - frozen.state.pause.startedAt;
    const maximumShift = afterResume - frozen.state.pause.startedAt;
    expect(resumed.state.pause).toBeNull();
    expect(resumed.state.pending?.deadline).toBeGreaterThanOrEqual(
      frozen.state.pending.deadline + minimumShift,
    );
    expect(resumed.state.pending?.deadline).toBeLessThanOrEqual(
      frozen.state.pending.deadline + maximumShift,
    );
    expect(resumed.state.matchDeadline).toBeGreaterThanOrEqual(
      frozen.state.matchDeadline + minimumShift,
    );
    expect(resumed.state.matchDeadline).toBeLessThanOrEqual(
      frozen.state.matchDeadline + maximumShift,
    );
    expect(resumed.timers.map((timer) => timer.kind)).toEqual([
      "bot",
      "match-end",
    ]);
  });

  it("keeps multiplayer moving during voting, requires every human, and rejects stale or duplicate commands", async () => {
    const game = await start(3);
    await editState(game.code, (state) => ({
      ...state,
      activeSeat: 0,
      pending: { kind: "roll", seat: 0, deadline: Date.now() + 60_000 },
    }));
    const voting = await intent(game.code, game.inboxes[1], "ask", {
      type: "RequestPause",
    });
    expect(voting.state.pause).toMatchObject({
      kind: "vote",
      requiredSeats: [0, 1, 2],
      acceptedSeats: [1],
    });
    expect(voting.timers.map((timer) => timer.kind)).toEqual([
      "decision",
      "match-end",
      "pause-vote",
    ]);
    await intent(
      game.code,
      game.inboxes[1],
      "ask",
      { type: "RequestPause" },
      undefined,
      "duplicate",
    );
    game.inboxes[2].send({
      type: "intent",
      id: "stale-vote",
      atSeq: voting.seq - 1,
      action: { type: "VotePause", accept: true },
    });
    expect((await game.inboxes[2].next("reject", "stale-vote")).reason).toBe(
      "stale",
    );
    const rolled = await intent(game.code, game.inboxes[0], "roll-voting", {
      type: "Roll",
    });
    expect(rolled.state.lastRoll?.seat).toBe(0);
    expect(rolled.state.pause?.kind).toBe("vote");
    const accepted = await intent(game.code, game.inboxes[0], "accept-one", {
      type: "VotePause",
      accept: true,
    });
    expect(accepted.state.pause?.kind).toBe("vote");
    const paused = await intent(game.code, game.inboxes[2], "accept-all", {
      type: "VotePause",
      accept: true,
    });
    expect(paused.state.pause?.kind).toBe("paused");
    expect(paused.timers).toEqual([]);
    const resumed = await intent(
      game.code,
      game.inboxes[2],
      "resume-any-human",
      { type: "ResumeGame" },
    );
    expect(resumed.state.pause).toBeNull();
    await intent(
      game.code,
      game.inboxes[0],
      "too-soon",
      { type: "RequestPause" },
      undefined,
      "pause-cooldown",
    );
  });

  it("declines and expires votes without pausing a decision or changing the cooldown", async () => {
    const game = await start(2);
    const requested = await intent(game.code, game.inboxes[0], "request", {
      type: "RequestPause",
    });
    const declined = await intent(game.code, game.inboxes[1], "decline", {
      type: "VotePause",
      accept: false,
    });
    expect(declined.state.pause).toBeNull();
    expect(declined.state.pauseCooldownUntil).toBe(
      requested.state.pauseCooldownUntil,
    );
    await intent(
      game.code,
      game.inboxes[1],
      "cooldown",
      { type: "RequestPause" },
      undefined,
      "pause-cooldown",
    );
    await editState(game.code, (state) => ({
      ...state,
      pauseCooldownUntil: 0,
    }));
    const vote = await intent(game.code, game.inboxes[1], "request-again", {
      type: "RequestPause",
    });
    await editState(game.code, (state) => {
      if (state.pause?.kind !== "vote") throw new Error("Vote expected");
      return { ...state, pause: { ...state.pause, deadline: Date.now() - 1 } };
    });
    expect(
      await runDurableObjectAlarm(env.GAME_ROOM.getByName(game.code)),
    ).toBe(true);
    const expired = await readRoom(game.code);
    expect(expired.state.pause).toBeNull();
    expect(expired.state.pending).toEqual(vote.state.pending);
    expect(expired.state.pauseCooldownUntil).toBe(
      vote.state.pauseCooldownUntil,
    );
    expect(expired.timers.some((timer) => timer.kind === "pause-vote")).toBe(
      false,
    );
  });

  it("preserves a paused snapshot and replay after eviction, and resumes once every disconnected human's grace expires", async () => {
    const game = await start(2);
    await intent(game.code, game.inboxes[0], "request", {
      type: "RequestPause",
    });
    const beforeAccept = await readRoom(game.code);
    const paused = await intent(game.code, game.inboxes[1], "accept", {
      type: "VotePause",
      accept: true,
    });
    await Promise.all(game.inboxes.map(close));
    const disconnected = await readRoom(game.code);
    expect(disconnected.state.pause).toEqual(paused.state.pause);
    expect(disconnected.timers.map((timer) => timer.kind)).toEqual([
      "grace:0",
      "grace:1",
    ]);
    const stub = env.GAME_ROOM.getByName(game.code);
    await evictDurableObject(stub);
    const replay = await connect(game.credentials[0], beforeAccept.seq);
    expect(replay.welcome.snapshot).toBeNull();
    expect((await replay.inbox.next("events")).events).toContainEqual(
      expect.objectContaining({
        type: "PauseChanged",
        pause: expect.objectContaining({ kind: "paused" }),
      }),
    );
    const recovered = await connect(game.credentials[1]);
    expect(recovered.welcome.snapshot?.pause).toEqual(paused.state.pause);
    await Promise.all([close(replay.inbox), close(recovered.inbox)]);
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind LIKE 'grace:%'",
        Date.now() - 1,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const abandoned = await readRoom(game.code);
    expect(abandoned.state.pause).toBeNull();
    expect(abandoned.state.status).toBe("active");
    expect(abandoned.timers.map((timer) => timer.kind)).toEqual(["match-end"]);
    expect(abandoned.state.pending?.deadline).toBeGreaterThanOrEqual(
      paused.state.pending?.deadline ?? 0,
    );
  });

  it("counts disconnected takeover humans and authorizes local votes without admitting waiting members", async () => {
    const game = await start(2);
    await close(game.inboxes[1]);
    const stub = env.GAME_ROOM.getByName(game.code);
    await runInDurableObject(stub, (_instance, durableState) => {
      durableState.storage.sql.exec(
        "UPDATE timers SET fire_at=? WHERE kind='grace:1'",
        Date.now() - 1,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const vote = await intent(game.code, game.inboxes[0], "request-away", {
      type: "RequestPause",
    });
    expect(vote.state.pause).toMatchObject({
      kind: "vote",
      requiredSeats: [0, 1],
    });
    const waitingCredentials = await join(game.code);
    expect(waitingCredentials.seat).toBeNull();
    const waiting = await connect(waitingCredentials);
    await intent(
      game.code,
      waiting.inbox,
      "spectator",
      { type: "VotePause", accept: true },
      undefined,
      "not-seated",
    );
    const member = waiting.welcome.you.member;
    game.inboxes[0].send({
      type: "lobby",
      id: "replacement",
      op: { type: "replace-bot", member, seat: 2 },
    });
    expect((await game.inboxes[0].next("reject", "replacement")).reason).toBe(
      "pause-in-progress",
    );
    await intent(
      game.code,
      game.inboxes[0],
      "foreign-seat",
      { type: "VotePause", accept: true },
      1,
      "not-your-seat",
    );

    const local = await start(1, true);
    await intent(local.code, local.inboxes[0], "local-request", {
      type: "RequestPause",
    });
    const paused = await intent(
      local.code,
      local.inboxes[0],
      "local-vote",
      { type: "VotePause", accept: true },
      1,
    );
    expect(paused.state.pause?.kind).toBe("paused");
    expect(
      (
        await intent(
          local.code,
          local.inboxes[0],
          "local-resume",
          { type: "ResumeGame" },
          1,
        )
      ).state.pause,
    ).toBeNull();
  });

  it("applies an already expired decision before a pause and refuses an expired match", async () => {
    const game = await start();
    await editState(game.code, (state) => ({
      ...state,
      activeSeat: 0,
      pending: { kind: "roll", seat: 0, deadline: Date.now() - 1 },
    }));
    const expired = await intent(
      game.code,
      game.inboxes[0],
      "late-pause",
      { type: "RequestPause" },
      undefined,
      "stale",
    );
    expect(expired.state.pause).toBeNull();
    expect(expired.state.lastRoll?.seat).toBe(0);
    await editState(game.code, (state) => ({
      ...state,
      matchDeadline: Date.now() - 1,
    }));
    const finished = await intent(
      game.code,
      game.inboxes[0],
      "late-match",
      { type: "RequestPause" },
      undefined,
      "game-over",
    );
    expect(finished.state.status).toBe("finished");
    expect(finished.state.pause).toBeNull();
  });

  it("keeps a legacy drand commitment and sequence unchanged while a vote expires", async () => {
    const game = await start(2, false, "drand");
    await editState(game.code, (state) => ({
      ...state,
      activeSeat: 0,
      pending: { kind: "roll", seat: 0, deadline: Date.now() + 60_000 },
    }));
    const vote = await intent(game.code, game.inboxes[1], "ask", {
      type: "RequestPause",
    });
    await intent(game.code, game.inboxes[0], "roll", { type: "Roll" });
    const stub = env.GAME_ROOM.getByName(game.code);
    const commitment = await runInDurableObject(
      stub,
      (_instance, durableState) =>
        durableState.storage.sql
          .exec<{ v: string }>("SELECT v FROM meta WHERE k='pendingDice'")
          .toArray()[0].v,
    );
    await intent(
      game.code,
      game.inboxes[1],
      "too-late-vote",
      { type: "VotePause", accept: true },
      undefined,
      "randomness-pending",
    );
    await editState(game.code, (state) => {
      if (state.pause?.kind !== "vote") throw new Error("Vote expected");
      return { ...state, pause: { ...state.pause, deadline: Date.now() - 1 } };
    });
    await runInDurableObject(stub, async (_instance, durableState) => {
      durableState.storage.sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('pause-vote',?)",
        Date.now() - 1,
      );
      // Keep the platform alarm future: the test helper fires the overdue SQL work.
      await durableState.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const pending = await readRoom(game.code);
    expect(pending.seq).toBe(vote.seq);
    expect(pending.state.pause?.kind).toBe("vote");
    expect(pending.timers.some((timer) => timer.kind === "pause-vote")).toBe(
      false,
    );
    expect(
      await runInDurableObject(
        stub,
        (_instance, durableState) =>
          durableState.storage.sql
            .exec<{ v: string }>("SELECT v FROM meta WHERE k='pendingDice'")
            .toArray()[0].v,
      ),
    ).toBe(commitment);
  });
});
