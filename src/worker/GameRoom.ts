import { DurableObject } from "cloudflare:workers";
import { BOT_TIMING, ECONOMY } from "../shared/board/index.js";
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
  botDecisionAt,
  changeControl,
  createGame,
  expirePauseVote,
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
import {
  DEBUG_PING_REQUEST,
  DEBUG_PING_RESPONSE,
  ROOM_DEBUG_VERSION,
  type RoomDiagnostics,
} from "../shared/protocol/room-diagnostics.js";
import type { WorkerDiagnostics } from "../shared/protocol/worker-diagnostics.js";
import type { DiceCommitment, DiceProof } from "../shared/randomness/types.js";
import { createEngineContext } from "./chance-randomness.js";
import { prepareDice, resolveDice } from "./randomness.js";
import {
  CURRENT_STATE_VERSION,
  migrateSavedState,
} from "./state-migrations.js";
import { workerDiagnostics } from "./worker-diagnostics.js";

type RoomMeta = { roomCode: string; config: RoomConfig; createdAt: number };
type StoredSeat = {
  seat: Seat;
  name: string;
  control: "human" | "bot";
  token_hash: string | null;
};
type StoredMember = {
  id: string;
  name: string;
  token_hash: string;
  approved: number;
  joined_at: number;
};
type Attachment = {
  /** The device's own seat; null while its person waits for a place. */
  seat: Seat | null;
  /** The waiting member id, until that person takes a place. */
  member?: string | null;
  synced: boolean;
  departing?: boolean;
  invalid: number;
  tokens: number;
  rateAt: number;
  workerDiagnostics?: WorkerDiagnostics;
};
type PendingDice = {
  commitment: DiceCommitment;
  seat: Seat;
  action: Action | null;
  intentId: string | null;
  atSeq: number;
};
type EventRow = { seq: number; json: string; proof: string | null };
const BOT_NAMES = ["Iris", "Milo", "Nova", "Atlas"] as const;
const SEATS = [0, 1, 2, 3] as const;
/** People who can wait at once for a place, an approval or the next game. */
const MAX_WAITING = 6;
/** A lobby, or a lobby the leader brought back, expires after two hours. */
const LOBBY_LIFETIME = 7_200_000;
/**
 * 2–3 are original production rooms; 5 combines the board and reference rules;
 * 6 lets World Tour reach the traveller's own properties as well as free ones;
 * 7 restricts initial festivals to cities;
 * 8 pays four resorts double the third's rent and lets a buyout be built on;
 * 9 reworks the Chance deck (see ChanceRule).
 */
const RULES_VERSION = 9;
function frozenRules(version: number | null) {
  if (
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== 5 &&
    version !== 6 &&
    version !== 7 &&
    version !== 8 &&
    version !== 9
  )
    throw new Error("Unsupported saved rules version");
  return {
    boardRule: version >= 5 ? ("country" as const) : ("legacy" as const),
    economyRule: version >= 4 ? ("reference" as const) : ("prototype" as const),
    hotelPurchaseRule:
      version === 2 ? ("legacy-lap" as const) : ("staged-hotels" as const),
    sellBackPercent: version >= 4 ? (100 as const) : (50 as const),
    worldTourRule:
      version >= 6 ? ("free-and-own" as const) : ("free-first" as const),
    fourResortRent: version >= 8,
    buildAfterBuyout: version >= 8,
    chanceRule: version >= 9 ? ("reworked" as const) : ("original" as const),
    resortFestivals: version >= 4 && version < 7,
  };
}

function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function newMemberId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
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
  private deletingRoom = false;
  private schemaReady = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(DEBUG_PING_REQUEST, DEBUG_PING_RESPONSE),
    );
    ctx.blockConcurrencyWhile(async () => {
      // Looking up an unknown room must not allocate persistent tables.
      this.schemaReady =
        this.ctx.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'",
          )
          .toArray().length > 0;
      if (this.schemaReady) this.createPeopleTables();
    });
  }

  /**
   * Waiting members and local players. Rooms saved before these tables
   * existed gain them when they wake; IF NOT EXISTS makes that a no-op later.
   */
  private createPeopleTables(): void {
    // People waiting for a place: an approval, the next game or a bot's seat.
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, approved INTEGER NOT NULL, joined_at INTEGER NOT NULL)",
    );
    // A local player shares the controller seat's device and token.
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS local_seats (seat INTEGER PRIMARY KEY, controller INTEGER NOT NULL)",
    );
  }

  private initializeSchema(): void {
    if (this.schemaReady) return;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS seats (seat INTEGER PRIMARY KEY, name TEXT NOT NULL, control TEXT NOT NULL, token_hash TEXT)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), seq INTEGER NOT NULL, json TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, json TEXT NOT NULL, proof TEXT)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS timers (kind TEXT PRIMARY KEY, fire_at INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS commands (seat INTEGER NOT NULL, id TEXT NOT NULL, PRIMARY KEY(seat,id))",
    );
    this.createPeopleTables();
    this.schemaReady = true;
  }

  private openSockets(): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN);
  }
  /**
   * Sockets are found through their attachments rather than tags: a waiting
   * member's socket stays open when that person takes a place.
   */
  private socketsWhere(test: (attachment: Attachment) => boolean): WebSocket[] {
    return this.openSockets().filter((socket) => {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      return attachment !== null && test(attachment);
    });
  }
  /** Sockets of the device that owns this seat, directly or as a local player. */
  private seatSockets(seat: Seat): WebSocket[] {
    const controller = this.controllerOf(seat);
    return this.socketsWhere((attachment) => attachment.seat === controller);
  }
  private memberSockets(id: string): WebSocket[] {
    return this.socketsWhere((attachment) => attachment.member === id);
  }
  /** An unattended match must not run: spectators alone do not keep it going. */
  private seatedSockets(): WebSocket[] {
    return this.socketsWhere((attachment) => attachment.seat !== null);
  }

  private setTimer(kind: string, fireAt: number): void {
    // A primary-key REPLACE deletes and reinserts even an unchanged timer.
    this.ctx.storage.sql.exec(
      "INSERT INTO timers(kind,fire_at) VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET fire_at=excluded.fire_at WHERE timers.fire_at<>excluded.fire_at",
      kind,
      fireAt,
    );
  }

  private readMeta<T>(key: string): T | null {
    if (!this.schemaReady) return null;
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
    if (!this.schemaReady) return null;
    const row = this.ctx.storage.sql
      .exec<{ seq: number; json: string }>(
        "SELECT seq,json FROM state WHERE id=1",
      )
      .toArray()[0];
    if (!row && this.readMeta("room") === null) return null;
    const rulesVersion = this.readMeta<number>("rulesVersion");
    const frozen = frozenRules(rulesVersion);
    // A deploy restarts every room mid-game, so this build has to read what the
    // previous one wrote: climb the saved shape to CURRENT_STATE_VERSION, and
    // refuse a shape no ladder reaches rather than hand the engine something it
    // does not understand. docs/ARCHITECTURE.md -> Deploys and games in progress.
    const migrated = migrateSavedState(
      row ? (JSON.parse(row.json) as unknown) : null,
      this.readMeta<number>("stateVersion") ?? Number.NaN,
    );
    if (migrated.changed) {
      // Persist the climbed state before any caller broadcasts from it.
      this.ctx.storage.transactionSync(() => {
        if (row)
          this.ctx.storage.sql.exec(
            "UPDATE state SET json=? WHERE id=1",
            JSON.stringify(migrated.state),
          );
        this.writeMeta("stateVersion", CURRENT_STATE_VERSION);
      });
    }
    if (!row) return null;
    const state = migrated.state as GameState;
    const hotelRule = state.config.hotelPurchaseRule;
    const economy = state.config.economyRule;
    const prototypeEconomy = economy === undefined || economy === "prototype";
    const board = state.config.boardRule;
    const sale = state.config.sellBackPercent;
    const tour = state.config.worldTourRule;
    const fourResorts = state.config.fourResortRent;
    const buyoutBuild = state.config.buildAfterBuyout;
    const festivals = state.config.resortFestivals;
    const chances = state.config.chanceRule;
    if (
      // Saves made before rules version 9 carry no Chance marker.
      (rulesVersion !== null &&
        chances !== frozen.chanceRule &&
        (rulesVersion >= 9 || chances !== undefined)) ||
      // Version-7 matches require the marker; older unmarked saves keep their rules.
      (rulesVersion !== null &&
        festivals !== frozen.resortFestivals &&
        (rulesVersion >= 7 || festivals !== undefined)) ||
      // Saves made before rules version 6 carry no World Tour marker.
      (rulesVersion !== null &&
        tour !== frozen.worldTourRule &&
        (rulesVersion >= 6 || tour !== undefined)) ||
      // Saves made before rules version 8 carry neither marker.
      (rulesVersion !== null &&
        ((fourResorts !== frozen.fourResortRent &&
          (rulesVersion >= 8 || fourResorts !== undefined)) ||
          (buyoutBuild !== frozen.buildAfterBuyout &&
            (rulesVersion >= 8 || buyoutBuild !== undefined)))) ||
      (rulesVersion !== null &&
        rulesVersion >= 4 &&
        (hotelRule !== frozen.hotelPurchaseRule ||
          economy !== frozen.economyRule ||
          board !== frozen.boardRule ||
          sale !== frozen.sellBackPercent)) ||
      (rulesVersion !== null &&
        rulesVersion <= 3 &&
        ((board !== undefined && board !== "legacy") ||
          (sale !== undefined && sale !== 50))) ||
      (rulesVersion === 3 &&
        (hotelRule !== "staged-hotels" || !prototypeEconomy)) ||
      (rulesVersion === 2 &&
        ((hotelRule !== undefined && hotelRule !== "legacy-lap") ||
          !prototypeEconomy))
    ) {
      throw new Error(
        "Saved match rules do not match its frozen rules version",
      );
    }
    return { seq: row.seq, state };
  }
  private seats(): StoredSeat[] {
    if (!this.schemaReady) return [];
    return this.ctx.storage.sql
      .exec<StoredSeat>(
        "SELECT seat,name,control,token_hash FROM seats ORDER BY seat",
      )
      .toArray();
  }
  private members(): StoredMember[] {
    if (!this.schemaReady) return [];
    return this.ctx.storage.sql
      .exec<StoredMember>(
        "SELECT id,name,token_hash,approved,joined_at FROM members ORDER BY joined_at,id",
      )
      .toArray();
  }
  private localSeats(): { seat: Seat; controller: Seat }[] {
    if (!this.schemaReady) return [];
    return this.ctx.storage.sql
      .exec<{ seat: Seat; controller: Seat }>(
        "SELECT seat,controller FROM local_seats ORDER BY seat",
      )
      .toArray();
  }
  private controllerOf(seat: Seat): Seat {
    return (
      this.localSeats().find((entry) => entry.seat === seat)?.controller ?? seat
    );
  }
  /** The seats a device acts for: its own, then the local players it added. */
  private controlledSeats(seat: Seat): Seat[] {
    return [
      seat,
      ...this.localSeats()
        .filter((entry) => entry.controller === seat)
        .map((entry) => entry.seat),
    ];
  }
  /** Rooms created before leaders existed keep their creator, seat 0. */
  private hostSeat(): Seat {
    return this.readMeta<Seat>("host") ?? 0;
  }
  /** A person arriving takes an open place first, then a bot's place. */
  private freeSeat(): Seat | undefined {
    const seats = this.seats();
    return (
      SEATS.find((seat) => !seats.some((entry) => entry.seat === seat)) ??
      seats.find((entry) => entry.control === "bot")?.seat
    );
  }

  async init(
    roomCode: string,
    name: string,
    config: RoomConfig,
    bots = 0,
  ): Promise<RoomCredentials | null> {
    if (this.deletingRoom) return null;
    const token = newToken();
    const tokenHash = await hashToken(token);
    if (this.readMeta("room")) return null;
    const hadSchema = this.schemaReady;
    try {
      this.ctx.storage.transactionSync(() => {
        this.initializeSchema();
        this.writeMeta("room", {
          roomCode,
          config: RoomConfigSchema.parse(config),
          createdAt: Date.now(),
        } satisfies RoomMeta);
        this.writeMeta("stateVersion", CURRENT_STATE_VERSION);
        this.writeMeta("rulesVersion", RULES_VERSION);
        this.ctx.storage.sql.exec(
          "INSERT INTO seats(seat,name,control,token_hash) VALUES(0,?,'human',?)",
          name,
          tokenHash,
        );
        for (const seat of SEATS.slice(1, 1 + Math.max(0, Math.min(3, bots))))
          this.ctx.storage.sql.exec(
            "INSERT INTO seats(seat,name,control,token_hash) VALUES(?,?,'bot',NULL)",
            seat,
            BOT_NAMES[seat],
          );
        this.ctx.storage.sql.exec(
          "INSERT INTO timers(kind,fire_at) VALUES('cleanup',?)",
          Date.now() + LOBBY_LIFETIME,
        );
      });
    } catch (error) {
      this.schemaReady = hadSchema;
      throw error;
    }
    await this.scheduleAlarm();
    return { roomCode, seat: 0, token };
  }

  /**
   * An open lobby seats a newcomer at once, in an empty place or instead of a
   * bot. A locked room or a match holds them in the waiting list instead:
   * locked rooms until the leader admits them, matches until the next lobby
   * or until the leader hands them a bot's place.
   */
  async join(name: string): Promise<RoomCredentials | { error: string }> {
    if (this.deletingRoom) return { error: "room-not-found" };
    const token = newToken();
    const tokenHash = await hashToken(token);
    const room = this.readMeta<RoomMeta>("room");
    if (!room) return { error: "room-not-found" };
    const playing = this.readState() !== null;
    const locked = this.readMeta<boolean>("locked") === true;
    // Four people already hold the places, so none could ever open up.
    const seat = this.freeSeat();
    if (seat === undefined) return { error: "room-full" };
    if (!playing && !locked) {
      const needsLeader = !this.seats().some(
        (entry) => entry.control === "human" && entry.token_hash !== null,
      );
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO seats(seat,name,control,token_hash) VALUES(?,?,'human',?)",
          seat,
          name,
          tokenHash,
        );
        if (needsLeader) this.writeMeta("host", seat);
      });
      this.broadcast({ type: "lobby", lobby: this.lobby() });
      return { roomCode: room.roomCode, seat, token };
    }
    if (this.members().length >= MAX_WAITING) return { error: "room-full" };
    this.ctx.storage.sql.exec(
      "INSERT INTO members(id,name,token_hash,approved,joined_at) VALUES(?,?,?,?,?)",
      newMemberId(),
      name,
      tokenHash,
      locked ? 0 : 1,
      Date.now(),
    );
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    return { roomCode: room.roomCode, seat: null, token };
  }

  /** An explicit departure releases lobby places; a dropped socket does not. */
  async leave(
    token: string,
  ): Promise<{ ok: true } | { error: "room-not-found" | "unauthorized" }> {
    const tokenHash = await hashToken(token);
    if (this.deletingRoom || !this.readMeta("room"))
      return { error: "room-not-found" };
    const entry = this.seats().find(
      (candidate) =>
        candidate.control === "human" && candidate.token_hash === tokenHash,
    );
    const member = entry
      ? undefined
      : this.members().find((candidate) => candidate.token_hash === tokenHash);
    if (!entry && !member) return { error: "unauthorized" };
    // Promotion changes attachments but leaves connection-time tags unchanged.
    const connections = this.ctx.getWebSockets().filter((socket) => {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      return (
        attachment !== null &&
        (entry
          ? attachment.seat === entry.seat
          : attachment.member === member?.id)
      );
    });
    const saved = this.readState();
    const seats = entry ? this.controlledSeats(entry.seat) : [];
    if (member) {
      this.ctx.storage.sql.exec("DELETE FROM members WHERE id=?", member.id);
    } else if (!saved) {
      const humans = this.seats().filter(
        (candidate) =>
          !seats.includes(candidate.seat) &&
          candidate.control === "human" &&
          candidate.token_hash !== null,
      );
      const nextHost =
        humans.find(
          (candidate) => this.seatSockets(candidate.seat).length > 0,
        ) ?? humans[0];
      this.ctx.storage.transactionSync(() => {
        for (const seat of seats) {
          this.ctx.storage.sql.exec("DELETE FROM seats WHERE seat=?", seat);
          this.ctx.storage.sql.exec(
            "DELETE FROM local_seats WHERE seat=?",
            seat,
          );
          this.ctx.storage.sql.exec("DELETE FROM commands WHERE seat=?", seat);
          this.ctx.storage.sql.exec(
            "DELETE FROM timers WHERE kind=?",
            `grace:${seat}`,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM meta WHERE k=?",
            `takeover:${seat}`,
          );
        }
        if (seats.includes(this.hostSeat()))
          this.writeMeta("host", nextHost?.seat ?? 0);
        // A locked room cannot wait for approval from a leader who has left.
        if (!nextHost) {
          this.writeMeta("locked", false);
          this.ctx.storage.sql.exec(
            "UPDATE members SET approved=1 WHERE approved=0",
          );
        }
      });
    } else if (saved.state.status === "active") {
      const graceAt = Date.now() + 60_000;
      for (const seat of seats)
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO timers(kind,fire_at) VALUES(?,?)",
          `grace:${seat}`,
          graceAt,
        );
    }
    for (const socket of connections) {
      const attachment = socket.deserializeAttachment() as Attachment;
      // Late callbacks must not mark a new occupant of the seat as absent.
      socket.serializeAttachment({ ...attachment, departing: true });
      socket.close(1008, "Left room");
    }
    if (!saved) this.seatWaitingMembers();
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    if (entry && saved) {
      for (const seat of seats)
        this.broadcast({ type: "presence", seat, status: "away" });
      await this.updateTimers();
    }
    return { ok: true };
  }

  private lobby(): LobbyState {
    const room = this.readMeta<RoomMeta>("room");
    if (!room) throw new Error("Room has not been initialized");
    const seats = this.seats();
    const locals = this.localSeats();
    const saved = this.readState();
    return {
      roomCode: room.roomCode,
      hostSeat: this.hostSeat(),
      locked: this.readMeta<boolean>("locked") === true,
      waiting: this.members().map((member) => ({
        id: member.id,
        name: member.name,
        approved: member.approved === 1,
        online: this.memberSockets(member.id).length > 0,
      })),
      status: !saved
        ? "lobby"
        : saved.state.status === "finished"
          ? "finished"
          : "playing",
      config: room.config,
      ...frozenRules(this.readMeta<number>("rulesVersion")),
      seats: SEATS.map((seat) => {
        const entry = seats.find((candidate) => candidate.seat === seat);
        const controller =
          locals.find((local) => local.seat === seat)?.controller ?? null;
        return {
          seat,
          name: entry?.name ?? "Place libre",
          control: entry?.control ?? null,
          online:
            this.socketsWhere(
              (attachment) => attachment.seat === (controller ?? seat),
            ).length > 0,
          controller,
        };
      }),
    };
  }

  /**
   * In a lobby, admitted people who are present take open places, then bots'
   * places. Their sockets stay open and are welcomed again in their new seat.
   */
  private seatWaitingMembers(): boolean {
    if (this.readState()) return false;
    let seated = false;
    for (const member of this.members()) {
      if (member.approved !== 1 || !this.memberSockets(member.id).length)
        continue;
      const seat = this.freeSeat();
      if (seat === undefined) break;
      const needsLeader = !this.seats().some(
        (entry) => entry.control === "human" && entry.token_hash !== null,
      );
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO seats(seat,name,control,token_hash) VALUES(?,?,'human',?)",
          seat,
          member.name,
          member.token_hash,
        );
        this.ctx.storage.sql.exec("DELETE FROM members WHERE id=?", member.id);
        if (needsLeader) this.writeMeta("host", seat);
      });
      this.promote(member.id, seat);
      seated = true;
    }
    return seated;
  }
  private promote(member: string, seat: Seat): void {
    for (const socket of this.memberSockets(member)) {
      const attachment = socket.deserializeAttachment() as Attachment;
      attachment.seat = seat;
      attachment.member = null;
      socket.serializeAttachment(attachment);
      if (attachment.synced) this.welcome(socket, attachment, null);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/health"))
      return Response.json({ kind: "game-room", status: "ok" });
    if (this.deletingRoom || !this.readMeta("room"))
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
    const member = entry
      ? undefined
      : this.members().find((candidate) => candidate.token_hash === tokenHash);
    if (!entry && !member)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    const existing = entry
      ? this.socketsWhere((attachment) => attachment.seat === entry.seat)
      : this.memberSockets(member?.id ?? "");
    if (existing.length >= 2)
      return Response.json({ error: "too-many-connections" }, { status: 429 });
    const pair = new WebSocketPair();
    // Tags name the socket at connection time for inspection only. A waiting
    // member's socket can take a seat later, so the room reads attachments.
    this.ctx.acceptWebSocket(pair[1], [
      entry ? `seat:${entry.seat}` : `member:${member?.id}`,
    ]);
    pair[1].serializeAttachment({
      seat: entry?.seat ?? null,
      member: member?.id ?? null,
      synced: false,
      invalid: 0,
      tokens: 40,
      rateAt: Date.now(),
      workerDiagnostics: workerDiagnostics(request),
    } satisfies Attachment);
    // The device is back for its own seat and every local player on it.
    if (entry) {
      for (const seat of this.controlledSeats(entry.seat)) {
        this.ctx.storage.sql.exec(
          "DELETE FROM timers WHERE kind=?",
          `grace:${seat}`,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM meta WHERE k=?",
          `takeover:${seat}`,
        );
      }
      await this.updateTimers();
    }
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
    for (const socket of this.openSockets()) {
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

  private roomDiagnostics(attachment: Attachment): RoomDiagnostics {
    const peers = new Map<Seat, RoomDiagnostics["peers"][number]>();
    const ownPoint = attachment.workerDiagnostics?.cloudflare;
    // Seated devices only: someone waiting for a place has no seat to show.
    if (attachment.seat !== null)
      peers.set(attachment.seat, {
        seat: attachment.seat,
        colo: ownPoint?.colo ?? null,
        location: ownPoint?.location ?? null,
        region: ownPoint?.region ?? null,
      });
    for (const socket of this.openSockets()) {
      const peer = socket.deserializeAttachment() as Attachment | null;
      if (!peer?.synced || peer.seat === null || peers.has(peer.seat)) continue;
      const point = peer.workerDiagnostics?.cloudflare;
      peers.set(peer.seat, {
        seat: peer.seat,
        colo: point?.colo ?? null,
        location: point?.location ?? null,
        region: point?.region ?? null,
      });
    }
    const jurisdiction = this.ctx.id.jurisdiction;
    return {
      worker: attachment.workerDiagnostics ?? {
        worker: "polytour",
        hostname: "Unknown",
        runtime: "unknown",
        cloudflare: null,
      },
      room: {
        className: "GameRoom",
        storage: "sqlite",
        location: null,
        jurisdiction:
          jurisdiction === "eu" || jurisdiction === "fedramp"
            ? jurisdiction
            : null,
      },
      peers: [...peers.values()].sort((left, right) => left.seat - right.seat),
    };
  }

  async webSocketMessage(
    socket: WebSocket,
    frame: string | ArrayBuffer,
  ): Promise<void> {
    if (
      this.deletingRoom ||
      !this.schemaReady ||
      socket.readyState !== WebSocket.OPEN
    )
      return socket.close(1000, "Room expired");
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) return socket.close(1008, "Session missing");
    if (attachment.departing) return socket.close(1008, "Left room");
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
    const message = parsed.data as ClientMessage;
    socket.serializeAttachment(attachment);
    // Clock sync needs only connection identity, not a full SQLite state read.
    if (message.type === "ping") {
      if (attachment.synced)
        this.send(socket, { type: "pong", t: message.t, serverNow: now });
      return;
    }
    // Authenticated attachments are sufficient; diagnostics never read game SQL.
    if (message.type === "debug-info") {
      if (attachment.synced)
        this.send(socket, {
          type: "room-diagnostics",
          value: this.roomDiagnostics(attachment),
        });
      return;
    }
    let saved: { state: GameState; seq: number } | null;
    try {
      // A lobby has frozen versions before its first game state is written.
      saved = this.readState();
    } catch {
      return this.reject(
        socket,
        "id" in message ? message.id : message.type,
        "incompatible-saved-match",
      );
    }
    if (message.type === "sync") {
      this.sync(socket, attachment, message.lastSeq);
      return;
    }
    if (!attachment.synced) return;
    if (message.type === "lobby")
      return this.handleLobby(socket, attachment, message);
    if (attachment.seat === null)
      return this.reject(socket, message.id, "not-seated");
    // A device acts for its own seat, or names one of its local players.
    const seat = message.seat ?? attachment.seat;
    if (!this.controlledSeats(attachment.seat).includes(seat))
      return this.reject(socket, message.id, "not-your-seat");
    if (!saved) return this.reject(socket, message.id, "game-not-started");
    if (message.atSeq !== saved.seq)
      return this.reject(socket, message.id, "stale");
    if (
      saved.state.status === "active" &&
      saved.state.pause?.kind !== "paused" &&
      saved.state.matchDeadline !== null &&
      now >= saved.state.matchDeadline
    ) {
      const ended = applyTimeout(saved.state, createEngineContext(now));
      this.persist(ended.state, ended.events, undefined, undefined, true);
      await this.scheduleAlarm();
      return this.reject(socket, message.id, "game-over");
    }
    if (this.readMeta("pendingDice"))
      return this.reject(socket, message.id, "randomness-pending");
    if (this.commandUsed(seat, message.id))
      return this.reject(socket, message.id, "duplicate");
    const pauseAction =
      message.action.type === "RequestPause" ||
      message.action.type === "VotePause" ||
      message.action.type === "ResumeGame";
    if (!pauseAction && saved.state.pause?.kind === "paused")
      return this.reject(socket, message.id, "game-paused");
    // Input handling can precede a delayed alarm. Starting a pause cannot freeze
    // an already spent decision; apply its default before accepting that request.
    if (
      saved.state.pause?.kind !== "paused" &&
      saved.state.pending &&
      now >= saved.state.pending.deadline
    ) {
      if (message.action.type === "RequestPause") {
        await this.expireDecision(saved);
        return this.reject(socket, message.id, "stale");
      }
      if (!pauseAction)
        return this.reject(socket, message.id, "decision-expired");
    }
    if (!pauseAction) {
      const legal = legalActions(toPublic(saved.state), seat).some(
        (action) => JSON.stringify(action) === JSON.stringify(message.action),
      );
      if (!legal)
        return this.reject(
          socket,
          message.id,
          saved.state.activeSeat !== seat ? "not-your-turn" : "illegal-action",
        );
    }
    if (message.action.type === "Roll") {
      await this.beginDice(seat, message.action, message.id, saved.seq);
      this.send(socket, { type: "ack", id: message.id });
      return;
    }
    const result = applyAction(saved.state, seat, message.action, {
      ...createEngineContext(now),
      // Grace takeover is metadata only: disconnected humans still vote.
      pauseSeats: saved.state.players
        .filter((player) => player.control === "human" && !player.bankrupt)
        .map((player) => player.seat),
    });
    if (!result.ok)
      return this.reject(
        socket,
        message.id,
        result.error.code,
        result.error.message,
      );
    this.persist(result.state, result.events, { seat, id: message.id });
    this.send(socket, { type: "ack", id: message.id });
    await this.scheduleAlarm();
  }

  private sync(
    socket: WebSocket,
    attachment: Attachment,
    lastSeq: number | null,
  ): void {
    // An admitted person coming back to an open lobby place takes it now.
    let current = attachment;
    if (current.member && this.seatWaitingMembers())
      current = socket.deserializeAttachment() as Attachment;
    this.welcome(socket, current, lastSeq);
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    if (current.seat === null) return;
    for (const seat of this.controlledSeats(current.seat))
      this.broadcast({ type: "presence", seat, status: "online" });
  }

  private welcome(
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
      roomDebugVersion: ROOM_DEBUG_VERSION,
      you: { seat: attachment.seat, member: attachment.member ?? null },
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

  /**
   * Room operations. The leader runs the room; any seated device may also add
   * a player who shares its screen, and remove that player again.
   */
  private async handleLobby(
    socket: WebSocket,
    attachment: Attachment,
    message: Extract<ClientMessage, { type: "lobby" }>,
  ): Promise<void> {
    const seat = attachment.seat;
    if (seat === null) return this.reject(socket, message.id, "not-seated");
    if (this.commandUsed(seat, message.id))
      return this.reject(socket, message.id, "duplicate");
    const room = this.readMeta<RoomMeta>("room");
    if (!room) return this.reject(socket, message.id, "room-not-found");
    const op = message.op;
    const saved = this.readState();
    const leader = seat === this.hostSeat();
    const done = (writes: () => void) => {
      this.ctx.storage.transactionSync(() => {
        writes();
        this.rememberCommand(seat, message.id);
      });
    };
    // The new lobby goes out before the ack, so a screen that waited for its
    // answer already shows the result when its controls unlock.
    const finish = () => {
      this.broadcast({ type: "lobby", lobby: this.lobby() });
      this.send(socket, { type: "ack", id: message.id });
    };
    if (op.type === "add-local" || op.type === "remove-local") {
      if (saved) return this.reject(socket, message.id, "game-already-started");
      const entry = this.seats().find(
        (candidate) => candidate.seat === op.seat,
      );
      if (op.type === "add-local") {
        if (entry) return this.reject(socket, message.id, "seat-taken");
        done(() => {
          this.ctx.storage.sql.exec(
            "INSERT INTO seats(seat,name,control,token_hash) VALUES(?,?,'human',NULL)",
            op.seat,
            op.name,
          );
          this.ctx.storage.sql.exec(
            "INSERT OR REPLACE INTO local_seats(seat,controller) VALUES(?,?)",
            op.seat,
            seat,
          );
        });
        return finish();
      }
      const local = this.localSeats().find((entry) => entry.seat === op.seat);
      if (!local) return this.reject(socket, message.id, "not-local");
      if (local.controller !== seat && !leader)
        return this.reject(socket, message.id, "host-only");
      done(() => {
        this.ctx.storage.sql.exec("DELETE FROM seats WHERE seat=?", op.seat);
        this.ctx.storage.sql.exec(
          "DELETE FROM local_seats WHERE seat=?",
          op.seat,
        );
      });
      this.seatWaitingMembers();
      return finish();
    }
    if (!leader) return this.reject(socket, message.id, "host-only");
    switch (op.type) {
      case "transfer-host": {
        // The role goes to another person with their own device.
        const target = this.seats().find(
          (candidate) => candidate.seat === op.seat,
        );
        if (
          op.seat === seat ||
          target?.control !== "human" ||
          target.token_hash === null
        )
          return this.reject(socket, message.id, "not-transferable");
        done(() => this.writeMeta("host", op.seat));
        return finish();
      }
      case "lock":
        done(() => {
          this.writeMeta("locked", op.locked);
          // Opening the door admits everyone who was waiting at it.
          if (!op.locked)
            this.ctx.storage.sql.exec("UPDATE members SET approved=1");
        });
        this.seatWaitingMembers();
        return finish();
      case "admit":
      case "deny": {
        const member = this.members().find((entry) => entry.id === op.member);
        if (!member) return this.reject(socket, message.id, "member-not-found");
        if (op.type === "admit") {
          done(() =>
            this.ctx.storage.sql.exec(
              "UPDATE members SET approved=1 WHERE id=?",
              op.member,
            ),
          );
          this.seatWaitingMembers();
          return finish();
        }
        const sockets = this.memberSockets(op.member);
        done(() =>
          this.ctx.storage.sql.exec(
            "DELETE FROM members WHERE id=?",
            op.member,
          ),
        );
        for (const turnedAway of sockets)
          turnedAway.close(4003, "Not admitted");
        return finish();
      }
      case "replace-bot":
        return this.replaceBot(socket, seat, message.id, op);
      case "return-to-lobby":
        if (!saved) return this.reject(socket, message.id, "game-not-started");
        return this.returnToLobby(socket, seat, message.id);
      case "start":
      case "settings":
      case "add-bot":
      case "remove-bot":
        break;
      default: {
        const unknown: never = op;
        return unknown;
      }
    }
    if (saved) return this.reject(socket, message.id, "game-already-started");
    if (op.type === "settings") {
      const config = op.config;
      done(() => this.writeMeta("room", { ...room, config }));
      return finish();
    }
    if (op.type === "add-bot" || op.type === "remove-bot") {
      const target = op.seat;
      const entry = this.seats().find((candidate) => candidate.seat === target);
      if (op.type === "add-bot" && entry)
        return this.reject(socket, message.id, "seat-taken");
      if (op.type === "remove-bot" && entry?.control !== "bot")
        return this.reject(socket, message.id, "not-a-bot");
      const adding = op.type === "add-bot";
      done(() => {
        if (adding)
          this.ctx.storage.sql.exec(
            "INSERT INTO seats(seat,name,control,token_hash) VALUES(?,?,'bot',NULL)",
            target,
            BOT_NAMES[target],
          );
        else
          this.ctx.storage.sql.exec(
            "DELETE FROM seats WHERE seat=? AND control='bot'",
            target,
          );
      });
      if (!adding) this.seatWaitingMembers();
      return finish();
    }
    const seats = this.seats();
    const fillBots = op.fillBots;
    if (!fillBots && seats.length < ECONOMY.minimumPlayers)
      return this.reject(
        socket,
        message.id,
        "players-required",
        `A game needs ${ECONOMY.minimumPlayers} to ${ECONOMY.maximumPlayers} players`,
      );
    // Seats keep their lobby number (colour and corner) in the match, so a
    // three-player room can leave any one of the four places empty.
    const allSeats: SeatInfo[] = SEATS.flatMap((index) => {
      const entry = seats.find((candidate) => candidate.seat === index);
      if (!entry && !fillBots) return [];
      return [
        {
          playerId: `seat-${index}`,
          name: entry?.name ?? BOT_NAMES[index],
          control: entry?.control ?? "bot",
          seat: index,
        },
      ];
    });
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const startedAt = Date.now();
    const rulesVersion = this.readMeta<number>("rulesVersion");
    const result = createGame(
      {
        ...room.config,
        gameId: room.roomCode,
        ...frozenRules(rulesVersion),
      },
      allSeats,
      seed,
      createEngineContext(startedAt),
    );
    this.ctx.storage.transactionSync(() => {
      for (const entry of allSeats)
        if (!seats.some((candidate) => candidate.seat === entry.seat))
          this.ctx.storage.sql.exec(
            "INSERT INTO seats(seat,name,control,token_hash) VALUES(?,?,'bot',NULL)",
            entry.seat,
            entry.name,
          );
      // A human can leave while the room is still a lobby. Lobby disconnects
      // need no alarm, but starting that room must give every absent human the
      // same reconnect grace as a player who disconnects during the match.
      for (const entry of seats)
        if (entry.control === "human" && !this.seatSockets(entry.seat).length)
          this.ctx.storage.sql.exec(
            "INSERT OR IGNORE INTO timers(kind,fire_at) VALUES(?,?)",
            `grace:${entry.seat}`,
            startedAt + 60_000,
          );
      this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind='cleanup'");
    });
    this.persist(result.state, result.events, { seat, id: message.id });
    this.send(socket, { type: "ack", id: message.id });
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    await this.scheduleAlarm();
  }

  /**
   * During a match the leader hands a server bot's place to someone waiting.
   * The engine records the change, so the seat keeps its money and cities.
   */
  private async replaceBot(
    socket: WebSocket,
    seat: Seat,
    id: string,
    op: { member: string; seat: Seat },
  ): Promise<void> {
    const saved = this.readState();
    if (!saved) return this.reject(socket, id, "game-not-started");
    if (saved.state.pause) return this.reject(socket, id, "pause-in-progress");
    if (this.readMeta("pendingDice"))
      return this.reject(socket, id, "randomness-pending");
    const member = this.members().find((entry) => entry.id === op.member);
    if (member?.approved !== 1)
      return this.reject(socket, id, "member-not-found");
    const target = this.seats().find((entry) => entry.seat === op.seat);
    if (target?.control !== "bot") return this.reject(socket, id, "not-a-bot");
    const result = changeControl(saved.state, op.seat, "human", member.name);
    if (!result.ok) return this.reject(socket, id, result.error.code);
    const present = this.memberSockets(member.id).length > 0;
    this.persist(
      result.state,
      result.events,
      { seat, id },
      undefined,
      false,
      () => {
        this.ctx.storage.sql.exec(
          "UPDATE seats SET name=?,control='human',token_hash=? WHERE seat=?",
          member.name,
          member.token_hash,
          op.seat,
        );
        this.ctx.storage.sql.exec("DELETE FROM members WHERE id=?", member.id);
        // Someone who stepped away gets the usual reconnect grace.
        if (!present)
          this.ctx.storage.sql.exec(
            "INSERT OR IGNORE INTO timers(kind,fire_at) VALUES(?,?)",
            `grace:${op.seat}`,
            Date.now() + 60_000,
          );
      },
    );
    this.promote(member.id, op.seat);
    this.send(socket, { type: "ack", id });
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    if (present)
      this.broadcast({ type: "presence", seat: op.seat, status: "online" });
    await this.scheduleAlarm();
  }

  /**
   * The leader ends the match (or leaves its results) and brings everyone
   * back to the lobby: the same places, bots and settings, and a free place
   * for each admitted person who waited. A match in progress is discarded.
   */
  private async returnToLobby(
    socket: WebSocket,
    seat: Seat,
    id: string,
  ): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM state");
      this.ctx.storage.sql.exec("DELETE FROM events");
      this.ctx.storage.sql.exec("DELETE FROM commands");
      this.ctx.storage.sql.exec("DELETE FROM timers");
      this.ctx.storage.sql.exec(
        "DELETE FROM meta WHERE k='pendingDice' OR k LIKE 'takeover:%'",
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO timers(kind,fire_at) VALUES('cleanup',?)",
        Date.now() + LOBBY_LIFETIME,
      );
      this.rememberCommand(seat, id);
    });
    this.seatWaitingMembers();
    this.send(socket, { type: "ack", id });
    // A welcome without a snapshot sends every screen back to the lobby.
    for (const open of this.openSockets()) {
      const attachment = open.deserializeAttachment() as Attachment | null;
      if (attachment?.synced) this.welcome(open, attachment, null);
    }
    this.broadcast({ type: "lobby", lobby: this.lobby() });
    await this.scheduleAlarm();
  }

  private persist(
    state: GameState,
    events: readonly GameEvent[],
    command?: { seat: Seat; id: string },
    proof?: DiceProof,
    clearDice = false,
    /** Room rows that must change together with this state, before timers. */
    writes?: () => void,
  ): void {
    const fromSeq = (this.readState()?.seq ?? 0) + 1;
    const toSeq = fromSeq + events.length - 1;
    const proofIndex = events.findIndex((event) => event.type === "DiceRolled");
    this.ctx.storage.transactionSync(() => {
      writes?.();
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
      this.refreshTimers(state, true);
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
        "DELETE FROM timers WHERE kind IN ('bot','decision','pause-vote')",
      );
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO timers(kind,fire_at) VALUES('randomness',?)",
        commitment.availableAt,
      );
    });
    this.broadcast({ type: "randomness", status: "committed", commitment });
    // Secure dice resolve in this request. Do not wake an extra alarm at now+1
    // for a commitment that finishDice is about to clear. The previous durable
    // decision/match alarm remains a recovery path if this request is interrupted.
    if (commitment.mode === "secure") await this.finishDice();
    else await this.scheduleAlarm();
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
      if (
        saved.state.status !== "active" ||
        saved.state.pause?.kind === "paused"
      )
        return;
      if (
        saved.state.matchDeadline !== null &&
        Date.now() >= saved.state.matchDeadline
      ) {
        const ended = applyTimeout(
          saved.state,
          createEngineContext(Date.now()),
        );
        this.persist(ended.state, ended.events, undefined, undefined, true);
        this.broadcast({ type: "lobby", lobby: this.lobby() });
        await this.scheduleAlarm();
        return;
      }
      const applied = pending.action
        ? applyAction(
            saved.state,
            pending.seat,
            pending.action,
            createEngineContext(Date.now(), result.dice),
          )
        : {
            ok: true as const,
            ...applyTimeout(
              saved.state,
              createEngineContext(Date.now(), result.dice),
            ),
          };
      if (!applied.ok) throw new Error(applied.error.message);
      // A vote may expire while a legacy beacon is pending. Keep its committed
      // sequence stable until the roll resolves, then clear the vote in this batch.
      const expiredVote = expirePauseVote(applied.state, Date.now());
      this.persist(
        expiredVote.state,
        [...applied.events, ...expiredVote.events],
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
      if (this.seatedSockets().length === 0) {
        await this.updateTimers();
        return;
      }
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

  private refreshTimers(
    state = this.readState()?.state ?? null,
    resetBot = false,
  ): void {
    if (!this.schemaReady) return;
    const paused = state?.pause?.kind === "paused";
    if (state?.status === "active" && !paused && state.matchDeadline !== null)
      this.setTimer("match-end", state.matchDeadline);
    else this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind='match-end'");
    if (state?.status !== "active")
      this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind LIKE 'grace:%'");
    if (state?.status === "finished")
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO timers(kind,fire_at) VALUES('cleanup',?)",
        Date.now() + 600_000,
      );
    // An abandoned game must not become an unattended bot simulation.
    // Keep its state, grace timers and real-time end intact; reconnect restores
    // the remaining timers without extending any engine deadline.
    const pendingDice = this.readMeta<PendingDice>("pendingDice");
    if (
      state?.status === "active" &&
      state.pause?.kind === "vote" &&
      !pendingDice
    )
      this.setTimer("pause-vote", state.pause.deadline);
    else
      this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind='pause-vote'");
    if (
      state?.status !== "active" ||
      paused ||
      this.seatedSockets().length === 0
    ) {
      this.ctx.storage.sql.exec(
        "DELETE FROM timers WHERE kind IN ('bot','decision','randomness')",
      );
      return;
    }
    if (pendingDice) {
      this.ctx.storage.sql.exec(
        "DELETE FROM timers WHERE kind IN ('bot','decision')",
      );
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO timers(kind,fire_at) VALUES('randomness',?)",
        pendingDice.commitment.availableAt,
      );
    } else if (state.pending) {
      this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind='randomness'");
      const seat = state.pending.seat;
      const bot =
        this.seats().find((entry) => entry.seat === seat)?.control === "bot" ||
        this.readMeta<boolean>(`takeover:${seat}`) === true;
      this.ctx.storage.sql.exec(
        "DELETE FROM timers WHERE kind=?",
        bot ? "decision" : "bot",
      );
      // A bot waits for the animations that opened its decision, so players
      // can follow its turn. After a wake-up, nothing is left to watch.
      const botAt = Math.max(
        botDecisionAt(state) ?? 0,
        Date.now() + (resetBot ? 0 : BOT_TIMING.resume),
      );
      if (bot && !resetBot)
        this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO timers(kind,fire_at) VALUES('bot',?)",
          botAt,
        );
      else
        this.setTimer(
          bot ? "bot" : "decision",
          bot ? botAt : state.pending.deadline,
        );
    } else {
      this.ctx.storage.sql.exec(
        "DELETE FROM timers WHERE kind IN ('bot','decision','randomness')",
      );
    }
  }
  private async updateTimers(): Promise<void> {
    this.refreshTimers();
    await this.scheduleAlarm();
  }
  private async scheduleAlarm(): Promise<void> {
    if (!this.schemaReady) return;
    const row = this.ctx.storage.sql
      .exec<{ next: number | null }>("SELECT MIN(fire_at) AS next FROM timers")
      .toArray()[0];
    if (row?.next !== null && row?.next !== undefined) {
      const next = Math.max(Date.now() + 1, row.next);
      if ((await this.ctx.storage.getAlarm()) !== next)
        await this.ctx.storage.setAlarm(next);
    } else if ((await this.ctx.storage.getAlarm()) !== null)
      await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    if (this.deletingRoom || !this.schemaReady) return;
    // Old deployments can leave move/retry timers behind in rooms with no
    // audience. Cancel them on their first wake rather than execute a move.
    this.refreshTimers();
    const due = this.ctx.storage.sql
      .exec<{ kind: string; fire_at: number }>(
        "SELECT kind,fire_at FROM timers WHERE fire_at<=? ORDER BY CASE kind WHEN 'cleanup' THEN 0 WHEN 'match-end' THEN 1 ELSE 2 END,fire_at",
        Date.now(),
      )
      .toArray();
    for (const timer of due) {
      // Processing an earlier timer or an interleaving reconnect may replace
      // later work. Never apply that stale copy to a newly started decision.
      const currentTimer = this.ctx.storage.sql
        .exec<{ fire_at: number }>(
          "SELECT fire_at FROM timers WHERE kind=?",
          timer.kind,
        )
        .toArray()[0];
      if (!currentTimer || currentTimer.fire_at !== timer.fire_at) continue;
      if (timer.kind === "randomness") {
        // Keep the durable retry entry while the relay request is in flight.
        // finishDice removes it on success or reschedules the same commitment.
        await this.finishDice();
        continue;
      }
      this.ctx.storage.sql.exec("DELETE FROM timers WHERE kind=?", timer.kind);
      if (timer.kind === "cleanup") {
        this.deletingRoom = true;
        for (const socket of this.ctx.getWebSockets())
          socket.close(1000, "Room expired");
        await this.ctx.storage.deleteAll();
        // Keep expired and unknown rooms storage-free, including after eviction.
        this.schemaReady = false;
        this.deletingRoom = false;
        return;
      }
      if (timer.kind === "match-end") {
        const saved = this.readState();
        if (
          saved?.state.status === "active" &&
          saved.state.pause?.kind !== "paused"
        ) {
          const result = applyTimeout(
            saved.state,
            createEngineContext(Date.now()),
          );
          this.persist(result.state, result.events, undefined, undefined, true);
          this.broadcast({ type: "lobby", lobby: this.lobby() });
        }
        await this.scheduleAlarm();
        continue;
      }
      if (timer.kind.startsWith("grace:")) {
        const seat = Number(timer.kind.slice(6)) as Seat;
        if (!this.seatSockets(seat).length) {
          this.writeMeta(`takeover:${seat}`, true);
          this.broadcast({ type: "presence", seat, status: "bot" });
        }
        const abandoned = this.readState();
        if (abandoned?.state.pause?.kind === "paused") {
          const humans = abandoned.state.players.filter(
            (player) => player.control === "human" && !player.bankrupt,
          );
          if (
            humans.length > 0 &&
            humans.every(
              (player) =>
                !this.seatSockets(player.seat).length &&
                this.readMeta<boolean>(`takeover:${player.seat}`) === true,
            )
          ) {
            // Brief disconnections preserve a pause. Once every human's grace
            // has elapsed, restore room expiry rather than retain it forever.
            const resumed = applyAction(
              abandoned.state,
              humans[0].seat,
              { type: "ResumeGame" },
              createEngineContext(Date.now()),
            );
            if (resumed.ok) this.persist(resumed.state, resumed.events);
          }
        }
        await this.updateTimers();
        continue;
      }
      const saved = this.readState();
      if (
        saved?.state.status !== "active" ||
        saved.state.pause?.kind === "paused" ||
        this.readMeta("pendingDice")
      )
        continue;
      if (timer.kind === "pause-vote") {
        const result = expirePauseVote(saved.state, Date.now());
        this.persist(result.state, result.events);
        await this.scheduleAlarm();
      } else if (timer.kind === "bot") {
        const seat = saved.state.pending?.seat ?? saved.state.activeSeat;
        const action = botAction(toPublic(saved.state), seat);
        if (action.type === "Roll")
          await this.beginDice(seat, action, null, saved.seq);
        else {
          const result = applyAction(
            saved.state,
            seat,
            action,
            createEngineContext(Date.now()),
          );
          if (result.ok) {
            this.persist(result.state, result.events);
            await this.scheduleAlarm();
          } else await this.updateTimers();
        }
      } else if (timer.kind === "decision") {
        await this.expireDecision(saved);
      }
    }
    await this.scheduleAlarm();
  }

  /** Resolves an expired human choice through the same path as its alarm. */
  private async expireDecision(saved: {
    state: GameState;
    seq: number;
  }): Promise<void> {
    const kind = saved.state.pending?.kind;
    if (kind === "roll" || kind === "island" || kind === "travel")
      await this.beginDice(
        saved.state.pending?.seat ?? saved.state.activeSeat,
        null,
        null,
        saved.seq,
      );
    else {
      const result = applyTimeout(saved.state, createEngineContext(Date.now()));
      this.persist(result.state, result.events);
      await this.scheduleAlarm();
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    // Complete the handshake explicitly as well as on runtimes with auto-reply.
    socket.close(1000, "Connection closed");
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (
      this.deletingRoom ||
      !attachment ||
      attachment.departing ||
      !this.readMeta("room")
    )
      return;
    const own = attachment.seat;
    if (own === null) {
      // A waiting member's presence lives in the lobby's waiting list.
      this.broadcast({ type: "lobby", lobby: this.lobby() });
      return;
    }
    if (
      this.socketsWhere((candidate) => candidate.seat === own).some(
        (candidate) => candidate !== socket,
      )
    )
      return;
    const saved = this.readState();
    const seats = this.controlledSeats(own);
    for (const seat of seats)
      this.broadcast({ type: "presence", seat, status: "away" });
    if (saved?.state.status !== "active") return;
    // Local players leave with the device they share.
    for (const seat of seats)
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO timers(kind,fire_at) VALUES(?,?)",
        `grace:${seat}`,
        Date.now() + 60_000,
      );
    await this.updateTimers();
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "Connection error");
    await this.webSocketClose(socket);
  }
}
