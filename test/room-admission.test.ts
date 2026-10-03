import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { Matchmaker } from "../src/worker/Matchmaker.js";
import {
  nextRoomAdmission,
  ROOM_ADMISSION_KEY,
  ROOM_CREATION_LIMITS,
  type RoomAdmissionState,
} from "../src/worker/room-admission.js";

const DAY_MS = 86_400_000;
const noon = Date.UTC(2026, 9, 3, 12);

describe("Creation budget calculations", () => {
  it("allows a 60-room burst, then requires one second to refill", () => {
    let state: RoomAdmissionState | undefined;
    for (let index = 0; index < ROOM_CREATION_LIMITS.burst; index += 1) {
      const result = nextRoomAdmission(state, noon);
      if (!result.success) throw new Error("LAN burst rejected");
      state = result.state;
    }
    expect(nextRoomAdmission(state, noon)).toEqual({
      success: false,
      retryAfter: 1,
    });
    expect(nextRoomAdmission(state, noon + 999)).toEqual({
      success: false,
      retryAfter: 1,
    });
    const refilled = nextRoomAdmission(state, noon + 1_000);
    expect(refilled.success).toBe(true);
    if (refilled.success) {
      expect(refilled.state.credit).toBe(0);
      expect(refilled.state.creations).toBe(61);
    }
  });

  it("bounds refill capacity after a long idle period", () => {
    const result = nextRoomAdmission(
      { credit: 0, at: noon, day: Math.floor(noon / DAY_MS), creations: 60 },
      noon + 3_600_000,
    );
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.state.credit).toBe(
        (ROOM_CREATION_LIMITS.burst - 1) * 1_000,
      );
  });

  it("does not grant tokens when the clock moves backwards", () => {
    const previous = {
      credit: 0,
      at: noon,
      day: Math.floor(noon / DAY_MS),
      creations: 60,
    };
    expect(nextRoomAdmission(previous, noon - 1_000)).toEqual({
      success: false,
      retryAfter: 1,
    });
    expect(previous.credit).toBe(0);
  });

  it("resets the daily budget at UTC midnight, with a truthful retry delay", () => {
    const day = Math.floor(noon / DAY_MS);
    const midnight = (day + 1) * DAY_MS;
    const previous = {
      credit: 60_000,
      at: noon,
      day,
      creations: ROOM_CREATION_LIMITS.perUtcDay,
    };
    expect(nextRoomAdmission(previous, midnight - 1_001)).toEqual({
      success: false,
      retryAfter: 2,
    });
    expect(nextRoomAdmission(previous, midnight - 1)).toEqual({
      success: false,
      retryAfter: 1,
    });
    const result = nextRoomAdmission(previous, midnight);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.state.day).toBe(day + 1);
      expect(result.state.creations).toBe(1);
    }
  });
});

describe("Durable global creation budget", () => {
  function isolatedAdmission(): DurableObjectStub<Matchmaker> {
    return env.MATCHMAKER.getByName(`admission-test-${crypto.randomUUID()}`);
  }

  it("serializes concurrent creation admission and keeps one bounded record", async () => {
    const admission = isolatedAdmission();
    // Freeze refill for this concurrency check even on a slow CI runner.
    const at = Date.now() + 60_000;
    await runInDurableObject(admission, async (_object, state) => {
      await state.storage.put(ROOM_ADMISSION_KEY, {
        credit: ROOM_CREATION_LIMITS.burst * 1_000,
        at,
        day: Math.floor(at / DAY_MS),
        creations: 0,
      } satisfies RoomAdmissionState);
    });
    const results = await Promise.all(
      Array.from({ length: 70 }, () => admission.admitRoomCreation()),
    );
    expect(results.filter((result) => result.success)).toHaveLength(60);
    expect(results.filter((result) => !result.success)).toHaveLength(10);
    const records = await runInDurableObject(
      admission,
      async (_object, state) =>
        Array.from(await state.storage.list<RoomAdmissionState>()),
    );
    expect(records).toHaveLength(1);
    expect(records[0][0]).toBe(ROOM_ADMISSION_KEY);
    expect(records[0][1].creations).toBe(60);
  });

  it("persists the spent budget across eviction and writes nothing when denied", async () => {
    const admission = isolatedAdmission();
    const at = Date.now();
    const exhausted = {
      credit: 0,
      at,
      day: Math.floor(at / DAY_MS),
      creations: ROOM_CREATION_LIMITS.perUtcDay,
    };
    await runInDurableObject(admission, async (_object, state) => {
      await state.storage.put(ROOM_ADMISSION_KEY, exhausted);
    });
    await evictDurableObject(admission);
    const result = await runInDurableObject(
      admission,
      async (object, state) => {
        let writes = 0;
        const original = state.storage.transaction.bind(state.storage);
        const spy = vi
          .spyOn(state.storage, "transaction")
          .mockImplementation((callback) =>
            original(async (transaction) => {
              const put = vi.spyOn(transaction, "put");
              try {
                return await callback(transaction);
              } finally {
                writes += put.mock.calls.length;
                put.mockRestore();
              }
            }),
          );
        try {
          const decision = await object.admitRoomCreation();
          return {
            decision,
            writes,
            saved:
              await state.storage.get<RoomAdmissionState>(ROOM_ADMISSION_KEY),
          };
        } finally {
          spy.mockRestore();
        }
      },
    );
    expect(result.decision.success).toBe(false);
    expect(result.writes).toBe(0);
    expect(result.saved).toEqual(exhausted);
  });

  it("refills a spent burst and resets yesterday's daily count durably", async () => {
    const admission = isolatedAdmission();
    const now = Date.now();
    await runInDurableObject(admission, async (_object, state) => {
      await state.storage.put(ROOM_ADMISSION_KEY, {
        credit: 0,
        at: now - 1_000,
        day: Math.floor(now / DAY_MS) - 1,
        creations: ROOM_CREATION_LIMITS.perUtcDay,
      } satisfies RoomAdmissionState);
    });
    expect(await admission.admitRoomCreation()).toEqual({ success: true });
    const saved = await runInDurableObject(admission, async (_object, state) =>
      state.storage.get<RoomAdmissionState>(ROOM_ADMISSION_KEY),
    );
    expect(saved?.day).toBe(Math.floor(now / DAY_MS));
    expect(saved?.creations).toBe(1);
    expect(saved?.credit).toBeLessThan(1_000);
  });

  it("keeps the Matchmaker health response without creating budget storage", async () => {
    const admission = isolatedAdmission();
    const response = await admission.fetch("https://example.test/health");
    expect(await response.json()).toEqual({ kind: "matchmaker", status: "ok" });
    const records = await runInDurableObject(
      admission,
      async (_object, state) => state.storage.list(),
    );
    expect(records.size).toBe(0);
  });
});
