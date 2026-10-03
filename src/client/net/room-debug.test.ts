import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEBUG_PING_REQUEST,
  type RoomDiagnostics,
} from "../../shared/protocol/room-diagnostics.js";
import { RoomDebugController } from "./room-debug.js";

const diagnostics = (colo = "AMS"): RoomDiagnostics => ({
  worker: {
    worker: "polytour",
    hostname: "test.polytour.example",
    runtime: "cloudflare",
    cloudflare: { colo, location: null, region: null },
  },
  room: {
    className: "GameRoom",
    storage: "sqlite",
    location: null,
    jurisdiction: null,
  },
  peers: [{ seat: 0, colo, location: null, region: null }],
});
function fixture(active = true, version: number | null = 1) {
  const controller = new RoomDebugController({
    now: Date.now,
    checkedAt: Date.now,
  });
  const socket = { readyState: 1, send: vi.fn<(value: string) => void>() };
  controller.setSocket(socket);
  controller.setConnection("online");
  controller.welcome(socket, version ?? undefined);
  controller.setActive(active);
  return { controller, socket };
}
const pingCount = (socket: ReturnType<typeof fixture>["socket"]) =>
  socket.send.mock.calls.filter(([message]) => message === DEBUG_PING_REQUEST)
    .length;
const infoCount = (socket: ReturnType<typeof fixture>["socket"]) =>
  socket.send.mock.calls.filter(
    ([message]) => message === '{"type":"debug-info"}',
  ).length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("room Debug transport", () => {
  it("stays silent while inactive or on an older welcome, then measures every five seconds", () => {
    const { controller, socket } = fixture(false);
    vi.advanceTimersByTime(20_000);
    expect(socket.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    controller.setActive(true);
    expect(socket.send.mock.calls.map(([message]) => message)).toEqual([
      '{"type":"debug-info"}',
      DEBUG_PING_REQUEST,
    ]);
    controller.receiveDiagnostics(socket, diagnostics());
    vi.advanceTimersByTime(42);
    controller.receivePong(socket);
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      latencyMs: 42,
      pingStatus: "success",
      samples: [{ latencyMs: 42, checkedAt: 20_042 }],
    });
    vi.advanceTimersByTime(4_957);
    expect(pingCount(socket)).toBe(1);
    vi.advanceTimersByTime(1);
    expect(pingCount(socket)).toBe(2);
    expect(infoCount(socket)).toBe(1);

    const older = fixture(true, null);
    vi.advanceTimersByTime(15_000);
    expect(older.socket.send).not.toHaveBeenCalled();
    expect(older.controller.getSnapshot().status).toBe("unavailable");
    const future = fixture(true, 2);
    vi.advanceTimersByTime(15_000);
    expect(future.socket.send).not.toHaveBeenCalled();
    expect(future.controller.getSnapshot().status).toBe("unavailable");
    older.controller.welcome(older.socket, 1);
    expect(pingCount(older.socket)).toBe(1);
  });

  it("requires an open, welcomed, online transport and visible browser before sending", () => {
    const controller = new RoomDebugController();
    const socket = { readyState: 0, send: vi.fn<(value: string) => void>() };
    controller.setActive(true);
    controller.setSocket(socket);
    controller.setConnection("online");
    controller.setEnvironment(false, false);
    controller.welcome(socket, 1);
    controller.setEnvironment(true, true);
    expect(socket.send).not.toHaveBeenCalled();
    socket.readyState = 1;
    controller.setConnection("reconnecting");
    expect(socket.send).not.toHaveBeenCalled();
    controller.setConnection("online");
    expect(pingCount(socket)).toBe(1);
    controller.setEnvironment(false, true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(pingCount(socket)).toBe(1);
    controller.setEnvironment(true, false);
    expect(vi.getTimerCount()).toBe(0);
    controller.setEnvironment(true, true);
    expect(pingCount(socket)).toBe(2);
    controller.disconnect(socket);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("consumes a timed-out constant pong's FIFO slot before accepting a newer sample", () => {
    const { controller, socket } = fixture();
    vi.advanceTimersByTime(5_000);
    expect(pingCount(socket)).toBe(2);
    vi.advanceTimersByTime(42);
    controller.receivePong(socket);
    expect(controller.getSnapshot().samples).toEqual([]);
    vi.advanceTimersByTime(5);
    controller.receivePong(socket);
    expect(controller.getSnapshot().samples).toEqual([
      { latencyMs: 47, checkedAt: 5_047 },
    ]);
  });

  it("bounds unanswered requests at three and recovers once tombstones are consumed", () => {
    const { controller, socket } = fixture();
    vi.advanceTimersByTime(30_000);
    expect(pingCount(socket)).toBe(3);
    expect(controller.getSnapshot().pingStatus).toBe("timeout");
    for (let response = 0; response < 3; response++)
      controller.receivePong(socket);
    expect(controller.getSnapshot().samples).toEqual([]);
    vi.advanceTimersByTime(5_000);
    expect(pingCount(socket)).toBe(4);
    vi.advanceTimersByTime(20);
    controller.receivePong(socket);
    expect(controller.getSnapshot().latencyMs).toBe(20);
  });

  it("keeps old ping and metadata slots across closing and reopening Debug", () => {
    const { controller, socket } = fixture();
    controller.setActive(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    controller.setActive(true);
    controller.receiveDiagnostics(socket, diagnostics("CDG"));
    expect(controller.getSnapshot().diagnostics).toBeNull();
    controller.receiveDiagnostics(socket, diagnostics("AMS"));
    expect(controller.getSnapshot().diagnostics?.worker.cloudflare?.colo).toBe(
      "AMS",
    );
    vi.advanceTimersByTime(20);
    controller.receivePong(socket);
    expect(controller.getSnapshot().samples).toEqual([]);
    controller.receivePong(socket);
    expect(controller.getSnapshot().latencyMs).toBe(20);
  });

  it("refreshes missing metadata on visibility resume but retains accepted current metadata", () => {
    const { controller, socket } = fixture();
    controller.setEnvironment(false, true);
    controller.receiveDiagnostics(socket, diagnostics("CDG"));
    controller.setEnvironment(true, true);
    expect(infoCount(socket)).toBe(2);
    controller.receiveDiagnostics(socket, diagnostics("AMS"));
    expect(controller.getSnapshot().diagnostics?.worker.cloudflare?.colo).toBe(
      "AMS",
    );
    controller.setEnvironment(true, false);
    expect(vi.getTimerCount()).toBe(0);
    controller.setEnvironment(true, true);
    expect(infoCount(socket)).toBe(2);
    expect(controller.getSnapshot().status).toBe("ready");
  });

  it("ignores responses from an old socket and starts metadata anew on welcome", () => {
    const { controller, socket } = fixture();
    const next = { readyState: 1, send: vi.fn<(value: string) => void>() };
    controller.setConnection("reconnecting");
    controller.setSocket(next);
    controller.setConnection("online");
    expect(next.send).not.toHaveBeenCalled();
    controller.welcome(next, 1);
    controller.receiveDiagnostics(socket, diagnostics("CDG"));
    controller.receivePong(socket);
    expect(controller.getSnapshot().diagnostics).toBeNull();
    expect(controller.getSnapshot().samples).toEqual([]);
    controller.receiveDiagnostics(next, diagnostics("AMS"));
    vi.advanceTimersByTime(30);
    controller.receivePong(next);
    expect(controller.getSnapshot()).toMatchObject({
      latencyMs: 30,
      status: "ready",
    });
    controller.welcome(next, 1);
    expect(infoCount(next)).toBe(2);
    expect(controller.getSnapshot().diagnostics).toBeNull();
  });

  it("validates routing data and cannot accept a claimed physical room location", () => {
    const { controller, socket } = fixture();
    const invalid = diagnostics();
    controller.receiveDiagnostics(socket, {
      ...invalid,
      room: { ...invalid.room, location: "Paris" },
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: "unavailable",
      diagnostics: null,
    });
  });

  it("keeps only the latest sixty successful samples", () => {
    const { controller, socket } = fixture();
    controller.receiveDiagnostics(socket, diagnostics());
    for (let sample = 0; sample < 65; sample++) {
      if (sample) vi.advanceTimersByTime(4_990);
      vi.advanceTimersByTime(10);
      controller.receivePong(socket);
    }
    expect(controller.getSnapshot().samples).toHaveLength(60);
    expect(controller.getSnapshot().samples[0]).toEqual({
      latencyMs: 10,
      checkedAt: 25_010,
    });
  });
});
