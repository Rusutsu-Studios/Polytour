import { DurableObject } from "cloudflare:workers";
import type {
  Action,
  GameEvent,
  GameState,
  Seat,
  SeatInfo,
} from "../shared/engine/index.js";
import {
  applyAction,
  applyTimeout,
  botAction,
  createGame,
  legalActions,
  toPublic,
} from "../shared/engine/index.js";
import type {
  ClientMessage,
  LobbyState,
  RoomConfig,
  RoomCredentials,
  ServerMessage,
} from "../shared/protocol/index.js";
import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  RoomConfigSchema,
} from "../shared/protocol/index.js";
import type { DiceCommitment, DiceProof } from "../shared/randomness/types.js";
import { prepareDice, resolveDice } from "./randomness.js";

type RoomMeta = { roomCode: string; config: RoomConfig; createdAt: number };
type StoredSeat = {
  seat: Seat;
  name: string;
  control: "human" | "bot";
  token_hash: string | null;
};
type Attachment = {
  seat: Seat;
  synced: boolean;
  invalid: number;
  tokens: number;
  rateAt: number;
};
type PendingDice = {
  commitment: DiceCommitment;
  seat: Seat;
  action: Action | null;
  intentId: string | null;
  atSeq: number;
};
type EventRow = { seq: number; json: string; proof: string | null };

function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
      );
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS seats (seat INTEGER PRIMARY KEY, name TEXT NOT NULL, control TEXT NOT NULL, token_hash TEXT)",
      );
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), seq INTEGER NOT NULL, json TEXT NOT NULL)",
      );
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, json TEXT NOT NULL, proof TEXT)",
      );
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS timers (kind TEXT PRIMARY KEY, fire_at INTEGER NOT NULL)",
      );
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS commands (seat INTEGER NOT NULL, id TEXT NOT NULL, PRIMARY KEY(seat,id))",
      );
    });
  }

  private readMeta<T>(key: string): T | null {
    const row = this.ctx.storage.sql
      .exec<{ v: string }>("SELECT v FROM meta WHERE k=?", key)
      .toArray()[0];
    return row ? (JSON.parse(row.v) as T) : null;
  }
  private writeMeta(key: string, value: unknown): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)",
      key,
      JSON.stringify(value),
    );
  }
  private readState(): { state: GameState; seq: number } | null {
    const row = this.ctx.storage.sql
      .exec<{ seq: number; json: string }>(
        "SELECT seq,json FROM state WHERE id=1",
      )
      .toArray()[0];
    if (
      row &&
      (this.readMeta<number>("stateVersion") !== 1 ||
        this.readMeta<number>("rulesVersion") !== 2)
    ) {
      throw new Error(
        "Unsupported saved match version; this room cannot use different rules silently",
      );
    }
    return row
      ? { seq: row.seq, state: JSON.parse(row.json) as GameState }
      : null;
  }
  private seats(): StoredSeat[] {
    return this.ctx.storage.sql
      .exec<StoredSeat>(
        "SELECT seat,name,control,token_hash FROM seats ORDER BY seat",
      )
      .toArray();
  }

  async init(
    roomCode: string,
    name: string,
    config: RoomConfig,
  ): Promise<RoomCredentials | null> {
    const token = newToken();
    const tokenHash = await hashToken(token);
    if (this.readMeta("room")) return null;
    this.ctx.storage.transactionSync(() => {
      this.writeMeta("room", {
        roomCode,
        config: RoomConfigSchema.parse(config),
        createdAt: Date.now(),
      } satisfies RoomMeta);
      this.writeMeta("stateVersion", 1);
      this.writeMeta("rulesVersion", 2);
      this.ctx.storage.sql.exec(
        "INSERT INTO seats(seat,name,control,token_hash) VALUES(0,?,'human',?)",
        name,
        tokenHash,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO timers(kind,fire_at) VALUES('cleanup',?)",
        Date.now() + 7_200_000,
      );
    });
    await this.scheduleAlarm();
    return { roomCode, seat: 0, token };
  }

  async join(name: string): Promise<RoomCredentials | { error: string }> {
    const token = newToken();
    const tokenHash = await hashToken(token);
    const room = this.readMeta<RoomMeta>("room");
    if (!room) return { error: "room-not-found" };
    if (this.readState()) return { error: "game-already-started" };
    const occupied = this.seats();
    const seat = ([0, 1, 2, 3] as const).find(
      (candidate) => !occupied.some((entry) => entry.seat === candidate),
    );
    if (seat === undefined) return { error: "room-full" };
    this.ctx.storage.sql.exec(
      "INSERT INTO seats(seat,name,control,token_hash) VALUES(?,?,'human',?)",
      seat,
      name,
      tokenHash,
    );
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    return { roomCode: room.roomCode, seat, token };
  }

  private lobby(): LobbyState {
    const room = this.readMeta<RoomMeta>("room");
    if (!room) throw new Error("Room has not been initialized");
    const seats = this.seats();
    const saved = this.readState();
    return {
      roomCode: room.roomCode,
      hostSeat: 0,
      status: !saved
        ? "lobby"
        : saved.state.status === "finished"
          ? "finished"
          : "playing",
      config: room.config,
      seats: ([0, 1, 2, 3] as const).map((seat) => {
        const entry = seats.find((candidate) => candidate.seat === seat);
        return {
          seat,
          name: entry?.name ?? "Place libre",
          control: entry?.control ?? null,
          online: this.ctx.getWebSockets(`seat:${seat}`).length > 0,
        };
      }),
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/health"))
      return Response.json({ kind: "game-room", status: "ok" });
    if (!this.readMeta("room"))
      return Response.json({ error: "room-not-found" }, { status: 404 });
    try {
      this.readState();
    } catch {
      return Response.json(
        { error: "incompatible-saved-match" },
        { status: 409 },
      );
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return Response.json({ lobby: this.lobby() });
    if (request.headers.get("Origin") !== url.origin)
      return Response.json({ error: "origin-rejected" }, { status: 403 });
    const token = request.headers
      .get("Sec-WebSocket-Protocol")
      ?.split(",")
      .map((part) => part.trim())
      .find((part) => part.startsWith("seat."))
      ?.slice(5);
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const tokenHash = await hashToken(token);
    const entry = this.seats().find(
      (seat) => seat.control === "human" && seat.token_hash === tokenHash,
    );
    if (!entry)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    if (this.ctx.getWebSockets(`seat:${entry.seat}`).length >= 2)
      return Response.json({ error: "too-many-connections" }, { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [`seat:${entry.seat}`]);
    pair[1].serializeAttachment({
      seat: entry.seat,
      synced: false,
      invalid: 0,
      tokens: 40,
      rateAt: Date.now(),
    } satisfies Attachment);
    this.ctx.storage.sql.exec(
      "DELETE FROM timers WHERE kind=?",
      `grace:${entry.seat}`,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM meta WHERE k=?",
      `takeover:${entry.seat}`,
    );
    await this.updateTimers();
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: { "Sec-WebSocket-Protocol": "polytour" },
    });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* Persisted state remains recoverable after a dropped socket. */
    }
  }
  private broadcast(message: ServerMessage): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (attachment?.synced) this.send(socket, message);
    }
  }
  private reject(
    socket: WebSocket,
    id: string,
    reason: string,
    message?: string,
  ): void {
    this.send(socket, { type: "reject", id, reason, message });
  }

  async webSocketMessage(
    socket: WebSocket,
    frame: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) return socket.close(1008, "Session missing");
    const now = Date.now();
    attachment.tokens =
      Math.min(40, attachment.tokens + (now - attachment.rateAt) * 0.02) - 1;
    attachment.rateAt = now;
    if (attachment.tokens < 0) return socket.close(1008, "Message limit");
    let parsed: ReturnType<typeof ClientMessageSchema.safeParse>;
    try {
      if (
        typeof frame !== "string" ||
        new TextEncoder().encode(frame).byteLength > 4096
      )
        throw new Error("Invalid frame");
      parsed = ClientMessageSchema.safeParse(JSON.parse(frame));
    } catch {
      parsed = ClientMessageSchema.safeParse(null);
    }
    if (!parsed.success) {
      attachment.invalid += 1;
      socket.serializeAttachment(attachment);
      if (attachment.invalid >= 3) socket.close(1008, "Invalid messages");
      else if (attachment.synced) this.reject(socket, "invalid", "malformed");
      return;
    }
    socket.serializeAttachment(attachment);
    const message = parsed.data as ClientMessage;
    if (message.type === "sync") {
      this.sync(socket, attachment, message.lastSeq);
      return;
    }
    if (!attachment.synced) return;
    if (message.type === "ping")
      return this.send(socket, { type: "pong", t: message.t, serverNow: now });
    if (message.type === "lobby")
      return this.handleLobby(socket, attachment.seat, message);
    const saved = this.readState();
    if (!saved) return this.reject(socket, message.id, "game-not-started");
    if (message.atSeq !== saved.seq)
      return this.reject(socket, message.id, "stale");
    if (
      saved.state.status === "active" &&
      saved.state.matchDeadline !== null &&
      now >= saved.state.matchDeadline
    ) {
      const ended = applyTimeout(saved.state, { now });
      this.persist(ended.state, ended.events, undefined, undefined, true);
      await this.scheduleAlarm();
      return this.reject(socket, message.id, "game-over");
    }
    if (this.readMeta("pendingDice"))
      return this.reject(socket, message.id, "randomness-pending");
    if (this.commandUsed(attachment.seat, message.id))
      return this.reject(socket, message.id, "duplicate");
    // Input handling can precede a delayed alarm. A human may not extend the
    // decision by racing that alarm; the persisted timeout owns the next move.
    if (saved.state.pending && now >= saved.state.pending.deadline)
      return this.reject(socket, message.id, "decision-expired");
    const legal = legalActions(toPublic(saved.state), attachment.seat).some(
      (action) => JSON.stringify(action) === JSON.stringify(message.action),
    );
    if (!legal)
      return this.reject(
        socket,
        message.id,
        saved.state.activeSeat !== attachment.seat
          ? "not-your-turn"
          : "illegal-action",
      );
    if (message.action.type === "Roll") {
      await this.beginDice(
        attachment.seat,
        message.action,
        message.id,
        saved.seq,
      );
      this.send(socket, { type: "ack", id: message.id });
      return;
    }
    const result = applyAction(saved.state, attachment.seat, message.action, {
      now,
    });
    if (!result.ok)
      return this.reject(
        socket,
        message.id,
        result.error.code,
        result.error.message,
      );
    this.persist(result.state, result.events, {
      seat: attachment.seat,
      id: message.id,
    });
    this.send(socket, { type: "ack", id: message.id });
    await this.scheduleAlarm();
  }

  private sync(
    socket: WebSocket,
    attachment: Attachment,
    lastSeq: number | null,
  ): void {
    const saved = this.readState();
    const seq = saved?.seq ?? 0;
    const replay =
      saved !== null &&
      lastSeq !== null &&
      lastSeq <= seq &&
      seq - lastSeq <= 500;
    const pending = this.readMeta<PendingDice>("pendingDice");
    const lastProof = this.ctx.storage.sql
      .exec<{ proof: string }>(
        "SELECT proof FROM events WHERE proof IS NOT NULL ORDER BY seq DESC LIMIT 1",
      )
      .toArray()[0];
    this.send(socket, {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      you: { seat: attachment.seat },
      seq,
      snapshot: saved && !replay ? toPublic(saved.state) : null,
      lobby: this.lobby(),
      randomness: pending
        ? { status: "waiting", commitment: pending.commitment }
        : lastProof
          ? {
              status: "resolved",
              proof: JSON.parse(lastProof.proof) as DiceProof,
            }
          : null,
    });
    attachment.synced = true;
    socket.serializeAttachment(attachment);
    if (replay && lastSeq !== null && lastSeq < seq) {
      const rows = this.ctx.storage.sql
        .exec<EventRow>(
          "SELECT seq,json,proof FROM events WHERE seq>? ORDER BY seq",
          lastSeq,
        )
        .toArray();
      this.send(socket, {
        type: "events",
        fromSeq: lastSeq + 1,
        toSeq: seq,
        events: rows.map((row) => JSON.parse(row.json) as GameEvent),
        proofs: rows
          .filter((row) => row.proof)
          .map((row) => ({
            seq: row.seq,
            proof: JSON.parse(row.proof as string) as DiceProof,
          })),
      });
    }
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    this.broadcast({
      type: "presence",
      seat: attachment.seat,
      status: "online",
    });
  }

  private commandUsed(seat: Seat, id: string): boolean {
    return (
      this.ctx.storage.sql
        .exec("SELECT id FROM commands WHERE seat=? AND id=?", seat, id)
        .toArray().length > 0
    );
  }
  private rememberCommand(seat: Seat, id: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO commands(seat,id) VALUES(?,?)",
      seat,
      id,
    );
  }

  private async handleLobby(
    socket: WebSocket,
    seat: Seat,
    message: Extract<ClientMessage, { type: "lobby" }>,
  ): Promise<void> {
    if (seat !== 0) return this.reject(socket, message.id, "host-only");
    if (this.readState())
      return this.reject(socket, message.id, "game-already-started");
    if (this.commandUsed(seat, message.id))
      return this.reject(socket, message.id, "duplicate");
    const room = this.readMeta<RoomMeta>("room");
    if (!room) return this.reject(socket, message.id, "room-not-found");
    if (message.op.type === "settings") {
      const config = message.op.config;
      this.ctx.storage.transactionSync(() => {
        this.writeMeta("room", { ...room, config });
        this.rememberCommand(seat, message.id);
      });
      this.send(socket, { type: "ack", id: message.id });
      this.broadcast({ type: "lobby", lobby: this.lobby() });
      return;
    }
    const seats = this.seats();
    if (seats.length < 4 && !message.op.fillBots)
      return this.reject(socket, message.id, "four-players-required");
    const allSeats: SeatInfo[] = ([0, 1, 2, 3] as const).map((index) => {
      const entry = seats.find((candidate) => candidate.seat === index);
      return {
        playerId: `seat-${index}`,
        name: entry?.name ?? ["", "Milo", "Nova", "Atlas"][index],
        control: entry?.control ?? "bot",
      };
    });
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const result = createGame(
      { ...room.config, gameId: room.roomCode },
      allSeats,
      seed,
      { now: Date.now() },
    );
    this.ctx.storage.transactionSync(() => {
      for (const index of [0, 1, 2, 3] as const)
        if (!seats.some((candidate) => candidate.seat === index))
          this.ctx.storage.sql.exec(
            "INSERT INTO seats(seat,name,control,token_hash) VALUES(?,?,'bot',NULL)",
            index,
            allSeats[index].name,
          );
      this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind='cleanup'");
    });
    this.persist(result.state, result.events, { seat, id: message.id });
    this.send(socket, { type: "ack", id: message.id });
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    await this.scheduleAlarm();
  }

  private persist(
    state: GameState,
    events: readonly GameEvent[],
    command?: { seat: Seat; id: string },
    proof?: DiceProof,
    clearDice = false,
  ): void {
    const fromSeq = (this.readState()?.seq ?? 0) + 1;
    const toSeq = fromSeq + events.length - 1;
    const proofIndex = events.findIndex((event) => event.type === "DiceRolled");
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO state(id,seq,json) VALUES(1,?,?)",
        toSeq,
        JSON.stringify(state),
      );
      events.forEach((event, index) => {
        this.ctx.storage.sql.exec(
          "INSERT INTO events(seq,json,proof) VALUES(?,?,?)",
          fromSeq + index,
          JSON.stringify(event),
          proof && index === proofIndex ? JSON.stringify(proof) : null,
        );
      });
      if (command) this.rememberCommand(command.seat, command.id);
      if (clearDice) {
        this.ctx.storage.sql.exec("DELETE FROM meta WHERE k='pendingDice'");
        this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind='randomness'");
      }
      this.refreshTimers();
    });
    if (events.length)
      this.broadcast({
        type: "events",
        fromSeq,
        toSeq,
        events,
        proofs:
          proof && proofIndex >= 0
            ? [{ seq: fromSeq + proofIndex, proof }]
            : undefined,
      });
    if (state.status === "finished")
      this.broadcast({ type: "lobby", lobby: this.lobby() });
  }

  private async beginDice(
    seat: Seat,
    action: Action | null,
    intentId: string | null,
    atSeq: number,
  ): Promise<void> {
    const room = this.readMeta<RoomMeta>("room");
    if (!room) return;
    const commitment = prepareDice(
      room.config.randomnessMode,
      { roomCode: room.roomCode, seq: atSeq, seat },
      Date.now(),
    );
    const pending: PendingDice = { commitment, seat, action, intentId, atSeq };
    this.ctx.storage.transactionSync(() => {
      this.writeMeta("pendingDice", pending);
      if (intentId) this.rememberCommand(seat, intentId);
      this.ctx.storage.sql.exec(
        "DELETE FROM timers WHERE kind IN ('bot','decision')",
      );
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('randomness',?)",
        commitment.availableAt,
      );
    });
    this.broadcast({ type: "randomness", status: "committed", commitment });
    await this.scheduleAlarm();
    if (commitment.mode === "secure") await this.finishDice();
  }

  private async finishDice(): Promise<void> {
    const pending = this.readMeta<PendingDice>("pendingDice");
    if (!pending) return;
    try {
      const result = await resolveDice(pending.commitment);
      const currentPending = this.readMeta<PendingDice>("pendingDice");
      if (
        !currentPending ||
        JSON.stringify(currentPending.commitment) !==
          JSON.stringify(pending.commitment)
      )
        return;
      const saved = this.readState();
      if (!saved || saved.seq !== pending.atSeq)
        throw new Error("State moved after dice commitment");
      if (saved.state.status !== "active") return;
      if (
        saved.state.matchDeadline !== null &&
        Date.now() >= saved.state.matchDeadline
      ) {
        const ended = applyTimeout(saved.state, { now: Date.now() });
        this.persist(ended.state, ended.events, undefined, undefined, true);
        this.broadcast({ type: "lobby", lobby: this.lobby() });
        await this.scheduleAlarm();
        return;
      }
      const applied = pending.action
        ? applyAction(saved.state, pending.seat, pending.action, {
            now: Date.now(),
            dice: result.dice,
          })
        : {
            ok: true as const,
            ...applyTimeout(saved.state, {
              now: Date.now(),
              dice: result.dice,
            }),
          };
      if (!applied.ok) throw new Error(applied.error.message);
      this.persist(
        applied.state,
        applied.events,
        undefined,
        result.proof,
        true,
      );
      this.broadcast({
        type: "randomness",
        status: "resolved",
        proof: result.proof,
      });
      await this.scheduleAlarm();
    } catch {
      if (
        !this.readMeta("pendingDice") ||
        this.readState()?.state.status !== "active"
      )
        return;
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('randomness',?)",
        Date.now() + 5000,
      );
      this.broadcast({
        type: "randomness",
        status: "error",
        commitment: pending.commitment,
        message:
          pending.commitment.mode === "drand"
            ? "Le tirage vérifiable est indisponible. La même balise sera réessayée, sans modifier les dés."
            : "Le tirage serveur est indisponible. Le serveur réessaie automatiquement.",
      });
      await this.scheduleAlarm();
    }
  }

  private refreshTimers(): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM timers WHERE kind IN ('bot','decision')",
    );
    const saved = this.readState();
    if (saved?.state.status === "active" && saved.state.matchDeadline !== null)
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('match-end',?)",
        saved.state.matchDeadline,
      );
    else this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind='match-end'");
    if (saved?.state.status === "finished")
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO timers(kind,fire_at) VALUES('cleanup',?)",
        Date.now() + 600_000,
      );
    if (
      saved?.state.status === "active" &&
      !this.readMeta("pendingDice") &&
      saved.state.pending
    ) {
      const seat = saved.state.pending.seat;
      const bot =
        this.seats().find((entry) => entry.seat === seat)?.control === "bot" ||
        this.readMeta<boolean>(`takeover:${seat}`) === true;
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES(?,?)",
        bot ? "bot" : "decision",
        bot ? Date.now() + 900 : saved.state.pending.deadline,
      );
    }
  }
  private async updateTimers(): Promise<void> {
    this.refreshTimers();
    await this.scheduleAlarm();
  }
  private async scheduleAlarm(): Promise<void> {
    const row = this.ctx.storage.sql
      .exec<{ next: number | null }>("SELECT MIN(fire_at) AS next FROM timers")
      .toArray()[0];
    if (row?.next !== null && row?.next !== undefined)
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, row.next));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const due = this.ctx.storage.sql
      .exec<{ kind: string }>(
        "SELECT kind FROM timers WHERE fire_at<=? ORDER BY fire_at",
        Date.now(),
      )
      .toArray();
    for (const timer of due) {
      if (timer.kind === "randomness") {
        // Keep the durable retry entry while the relay request is in flight.
        // finishDice removes it on success or reschedules the same commitment.
        await this.finishDice();
        continue;
      }
      this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind=?", timer.kind);
      if (timer.kind === "cleanup") {
        for (const socket of this.ctx.getWebSockets())
          socket.close(1000, "Room expired");
        await this.ctx.storage.deleteAll();
        return;
      }
      if (timer.kind === "match-end") {
        const saved = this.readState();
        if (saved?.state.status === "active") {
          const result = applyTimeout(saved.state, { now: Date.now() });
          this.persist(result.state, result.events, undefined, undefined, true);
          this.broadcast({ type: "lobby", lobby: this.lobby() });
        }
        await this.scheduleAlarm();
        continue;
      }
      if (timer.kind.startsWith("grace:")) {
        const seat = Number(timer.kind.slice(6)) as Seat;
        if (!this.ctx.getWebSockets(`seat:${seat}`).length) {
          this.writeMeta(`takeover:${seat}`, true);
          this.broadcast({ type: "presence", seat, status: "bot" });
        }
        await this.updateTimers();
        continue;
      }
      const saved = this.readState();
      if (saved?.state.status !== "active" || this.readMeta("pendingDice"))
        continue;
      if (timer.kind === "bot") {
        const seat = saved.state.pending?.seat ?? saved.state.activeSeat;
        const action = botAction(toPublic(saved.state), seat);
        if (action.type === "Roll")
          await this.beginDice(seat, action, null, saved.seq);
        else {
          const result = applyAction(saved.state, seat, action, {
            now: Date.now(),
          });
          if (result.ok) this.persist(result.state, result.events);
          await this.updateTimers();
        }
      } else if (timer.kind === "decision") {
        const kind = saved.state.pending?.kind;
        if (kind === "roll" || kind === "island" || kind === "travel")
          await this.beginDice(
            saved.state.pending?.seat ?? saved.state.activeSeat,
            null,
            null,
            saved.seq,
          );
        else {
          const result = applyTimeout(saved.state, { now: Date.now() });
          this.persist(result.state, result.events);
          await this.updateTimers();
        }
      }
    }
    await this.scheduleAlarm();
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (
      !attachment ||
      this.ctx
        .getWebSockets(`seat:${attachment.seat}`)
        .some((candidate) => candidate !== socket)
    )
      return;
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES(?,?)",
      `grace:${attachment.seat}`,
      Date.now() + 60_000,
    );
    this.broadcast({ type: "presence", seat: attachment.seat, status: "away" });
    await this.scheduleAlarm();
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "Connection error");
    await this.webSocketClose(socket);
  }
}
