import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RoomCredentials,
  ServerMessage,
} from "../src/shared/protocol/index.js";
import {
  DEBUG_PING_REQUEST,
  DEBUG_PING_RESPONSE,
  ROOM_DEBUG_VERSION,
  RoomDiagnosticsSchema,
} from "../src/shared/protocol/room-diagnostics.js";
import type { GameRoom } from "../src/worker/GameRoom.js";

const origin = "https://polytour.example";
const activeSockets: WebSocket[] = [];
class Inbox {
  readonly socket: WebSocket;
  readonly frames: string[] = [];
  private waiters: (() => void)[] = [];
  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      this.frames.push(String(event.data));
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
      const index = this.frames.findIndex((frame) => {
        if (!frame.startsWith("{")) return false;
        return (JSON.parse(frame) as ServerMessage).type === type;
      });
      if (index >= 0)
        return JSON.parse(this.frames.splice(index, 1)[0]) as Extract<
          ServerMessage,
          { type: T }
        >;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
  async nextRaw(value: string): Promise<void> {
    for (;;) {
      const index = this.frames.indexOf(value);
      if (index >= 0) {
        this.frames.splice(index, 1);
        return;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

async function create(): Promise<RoomCredentials> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "Alex" }),
    }),
  );
  expect(response.status).toBe(201);
  return response.json<RoomCredentials>();
}

async function join(roomCode: string): Promise<RoomCredentials> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/rooms/${roomCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "Bo" }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json<RoomCredentials>();
}

async function connect(
  credentials: RoomCredentials,
  colo?: string,
): Promise<Inbox> {
  const response = await exports.default.fetch(
    new Request(`${origin}/ws/room/${credentials.roomCode}`, {
      headers: {
        Upgrade: "websocket",
        Origin: origin,
        "Sec-WebSocket-Protocol": `polytour, seat.${credentials.token}`,
      },
      cf: {
        ...(colo ? { colo } : {}),
        city: "Sydney",
        region: "New South Wales",
        country: "AU",
      },
    }),
  );
  expect(response.status).toBe(101);
  if (!response.webSocket) throw new Error("WebSocket expected");
  return new Inbox(response.webSocket);
}

async function sync(inbox: Inbox) {
  inbox.send({ type: "sync", lastSeq: null });
  return inbox.next("welcome");
}

afterEach(() => {
  for (const socket of activeSockets.splice(0)) socket.close(1000);
  vi.restoreAllMocks();
});

describe("Private room diagnostics", () => {
  it("advertises optional debug capability and returns only authenticated routing metadata", async () => {
    const host = await create();
    const peer = await join(host.roomCode);
    const pendingPeer = await join(host.roomCode);
    const own = await connect(host, "FRA");
    const other = await connect(peer, "IAD");
    await connect(pendingPeer, "NRT");
    expect((await sync(own)).roomDebugVersion).toBe(ROOM_DEBUG_VERSION);
    await sync(other);
    own.send({ type: "debug-info" });
    const message = await own.next("room-diagnostics");
    expect(RoomDiagnosticsSchema.safeParse(message.value).success).toBe(true);
    expect(message.value).toEqual({
      worker: {
        worker: "polytour",
        hostname: "polytour.example",
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
        jurisdiction: null,
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
          location: "Ashburn, VA, United States",
          region: "North America",
        },
      ],
    });
    const wire = JSON.stringify(message);
    for (const privateValue of [
      host.token,
      peer.token,
      host.roomCode,
      "Sydney",
    ])
      expect(wire).not.toContain(privateValue);
    expect(
      other.frames.some((frame) => frame.includes("room-diagnostics")),
    ).toBe(false);
  });

  it("rejects unauthenticated upgrades and ignores debug requests before sync", async () => {
    const host = await create();
    const denied = await exports.default.fetch(
      new Request(`${origin}/ws/room/${host.roomCode}`, {
        headers: { Upgrade: "websocket", Origin: origin },
      }),
    );
    expect(denied.status).toBe(401);
    const own = await connect(host, "ZRH");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, async (instance, durableState) => {
      const sql = vi.spyOn(durableState.storage.sql, "exec");
      try {
        await (instance as GameRoom).webSocketMessage(
          durableState.getWebSockets()[0],
          JSON.stringify({ type: "debug-info" }),
        );
        expect(sql).not.toHaveBeenCalled();
      } finally {
        sql.mockRestore();
      }
    });
    await sync(own);
    own.send({ type: "ping", t: 42 });
    await own.next("pong");
    expect(own.frames.some((frame) => frame.includes("room-diagnostics"))).toBe(
      false,
    );
  });

  it("reads no SQLite or alarms and honors the socket rate limit", async () => {
    const host = await create();
    const own = await connect(host, "ZRH");
    await sync(own);
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, async (instance, durableState) => {
      const sql = vi.spyOn(durableState.storage.sql, "exec");
      const alarm = vi.spyOn(durableState.storage, "setAlarm");
      try {
        const socket = durableState.getWebSockets()[0];
        await (instance as GameRoom).webSocketMessage(
          socket,
          JSON.stringify({ type: "debug-info" }),
        );
        expect(sql).not.toHaveBeenCalled();
        expect(alarm).not.toHaveBeenCalled();
        const attachment = socket.deserializeAttachment() as {
          tokens: number;
          rateAt: number;
        };
        socket.serializeAttachment({
          ...attachment,
          tokens: 0,
          rateAt: Date.now(),
        });
        const close = vi.spyOn(socket, "close");
        await (instance as GameRoom).webSocketMessage(
          socket,
          JSON.stringify({ type: "debug-info" }),
        );
        expect(close).toHaveBeenCalledWith(1008, "Message limit");
      } finally {
        sql.mockRestore();
        alarm.mockRestore();
      }
    });
    await own.next("room-diagnostics");
  });

  it("keeps legacy and new unmapped metadata unknown and deduplicates connected seats", async () => {
    const host = await create();
    const peer = await join(host.roomCode);
    const own = await connect(host, "FRA");
    await sync(own);
    const ownNew = await connect(host, "XZZ");
    await sync(ownNew);
    const other = await connect(peer, "IAD");
    await sync(other);
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await runInDurableObject(stub, (_instance, durableState) => {
      const socket = durableState.getWebSockets("seat:1")[0];
      const attachment = socket.deserializeAttachment() as {
        workerDiagnostics?: unknown;
      };
      delete attachment.workerDiagnostics;
      socket.serializeAttachment(attachment);
    });
    ownNew.send({ type: "debug-info" });
    expect((await ownNew.next("room-diagnostics")).value.peers).toEqual([
      { seat: 0, colo: "XZZ", location: null, region: null },
      { seat: 1, colo: null, location: null, region: null },
    ]);
    other.send({ type: "debug-info" });
    expect((await other.next("room-diagnostics")).value.worker).toEqual({
      worker: "polytour",
      hostname: "Unknown",
      runtime: "unknown",
      cloudflare: null,
    });
  });

  it("automatically replies over the existing socket without JS, SQL, alarms or game events", async () => {
    const host = await create();
    const own = await connect(host, "FRA");
    await sync(own);
    own.send({
      type: "lobby",
      id: "start",
      op: { type: "start", fillBots: true },
    });
    await own.next("events");
    const stub = env.GAME_ROOM.getByName(host.roomCode);
    await evictDurableObject(stub);
    const before = await runInDurableObject(stub, (_instance, durableState) => {
      const pair = durableState.getWebSocketAutoResponse();
      expect(pair?.request).toBe(DEBUG_PING_REQUEST);
      expect(pair?.response).toBe(DEBUG_PING_RESPONSE);
      return durableState.storage.sql
        .exec("SELECT seq,json FROM state WHERE id=1")
        .toArray();
    });
    let assertNoIo: (() => void) | undefined;
    let restore: (() => void) | undefined;
    await runInDurableObject(stub, (instance, durableState) => {
      const handler = vi.spyOn(instance as GameRoom, "webSocketMessage");
      const sql = vi.spyOn(durableState.storage.sql, "exec");
      const alarm = vi.spyOn(durableState.storage, "setAlarm");
      assertNoIo = () => {
        expect(handler).not.toHaveBeenCalled();
        expect(sql).not.toHaveBeenCalled();
        expect(alarm).not.toHaveBeenCalled();
      };
      restore = () => {
        handler.mockRestore();
        sql.mockRestore();
        alarm.mockRestore();
      };
    });
    try {
      own.socket.send(DEBUG_PING_REQUEST);
      await own.nextRaw(DEBUG_PING_RESPONSE);
      await runInDurableObject(stub, (_instance, durableState) => {
        assertNoIo?.();
        expect(
          durableState.getWebSocketAutoResponseTimestamp(
            durableState.getWebSockets()[0],
          ),
        ).not.toBeNull();
      });
    } finally {
      await runInDurableObject(stub, () => restore?.());
    }
    expect(
      await runInDurableObject(stub, (_instance, durableState) =>
        durableState.storage.sql
          .exec("SELECT seq,json FROM state WHERE id=1")
          .toArray(),
      ),
    ).toEqual(before);
  });
});
