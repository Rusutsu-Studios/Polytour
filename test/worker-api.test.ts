import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json" with { type: "json" };
import worker from "../src/worker/index.js";

function allowedAdmissionBindings() {
  return {
    ROOM_CREATION_RATE_LIMIT: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    },
    MATCHMAKER: {
      getByName: vi.fn().mockReturnValue({
        admitRoomCreation: vi.fn().mockResolvedValue({ success: true }),
      }),
    },
  };
}

describe("Application version", () => {
  it("serves the package version without storage bindings or cached responses", async () => {
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://example.test/api/version"),
      {} as Env,
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ version: packageMetadata.version });
  });
});

describe("Unavailable room service", () => {
  it("identifies the verified Durable Object write limit without leaking details", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const bindings = {
      ...allowedAdmissionBindings(),
      GAME_ROOM: {
        getByName: () => ({
          init: () => {
            throw new Error(
              "Exceeded allowed rows written in Durable Objects free tier.",
            );
          },
        }),
      },
    } as unknown as Env;
    try {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request("https://example.test/api/rooms", {
          method: "POST",
          body: JSON.stringify({ name: "Alex" }),
          headers: { "Content-Type": "application/json" },
        }),
        bindings,
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "room-storage-limit" });
    } finally {
      logged.mockRestore();
    }
  });
  it.each([
    { path: "/api/rooms", method: "POST", body: { name: "Alex" } },
    {
      path: "/api/rooms/ABC234/join",
      method: "POST",
      body: { name: "Alex" },
    },
    { path: "/api/rooms/ABC234", method: "GET", body: undefined },
  ])("returns safe JSON when $path fails", async ({ path, method, body }) => {
    const internalError = new Error(
      "Internal storage failure for a private room",
    );
    const fail = vi.fn().mockRejectedValue(internalError);
    const bindings = {
      ...allowedAdmissionBindings(),
      GAME_ROOM: { getByName: () => ({ init: fail, join: fail, fetch: fail }) },
    } as unknown as Env;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const context = createExecutionContext();
      const response = await worker.fetch(
        new Request(`https://example.test${path}`, {
          method,
          headers: {
            Origin: "https://example.test",
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
        bindings,
        context,
      );
      await waitOnExecutionContext(context);
      expect(response.status).toBe(503);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json",
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "room-service-unavailable",
      });
      expect(fail).toHaveBeenCalledOnce();
      expect(logged).toHaveBeenCalledWith("Room service failed", internalError);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("Room creation admission and allocation-free health", () => {
  async function request(
    bindings: Env,
    path = "/api/rooms",
    options: RequestInit<IncomingRequestCfProperties> = {},
  ) {
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request(`https://example.test${path}`, {
        method: "POST",
        headers: {
          Origin: "https://example.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Alex" }),
        ...options,
      }),
      bindings,
      context,
    );
    await waitOnExecutionContext(context);
    return response;
  }

  it("allows several LAN hosts with the same address without an IP quota", async () => {
    const admission = allowedAdmissionBindings();
    const init = vi.fn().mockResolvedValue({ roomCode: "ABC234" });
    const bindings = {
      ...admission,
      GAME_ROOM: { getByName: vi.fn().mockReturnValue({ init }) },
    } as unknown as Env;
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(bindings, "/api/rooms", {
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.10",
          },
        }),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(init).toHaveBeenCalledTimes(12);
    for (const [limit] of admission.ROOM_CREATION_RATE_LIMIT.limit.mock.calls)
      expect(limit).toEqual({ key: "room-creation" });
    for (const [name] of admission.MATCHMAKER.getByName.mock.calls)
      expect(name).toBe("room-admission");
  });

  it("rejects at the edge before parsing a body or looking up any DO", async () => {
    const admission = allowedAdmissionBindings();
    admission.ROOM_CREATION_RATE_LIMIT.limit.mockResolvedValue({
      success: false,
    });
    const roomLookup = vi.fn();
    const response = await request(
      { ...admission, GAME_ROOM: { getByName: roomLookup } } as unknown as Env,
      "/api/rooms",
      { body: "not json" },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "rate-limited" });
    expect(admission.MATCHMAKER.getByName).not.toHaveBeenCalled();
    expect(roomLookup).not.toHaveBeenCalled();
  });

  it("does not spend the durable creation budget on invalid input", async () => {
    const admission = allowedAdmissionBindings();
    const roomLookup = vi.fn();
    const response = await request(
      { ...admission, GAME_ROOM: { getByName: roomLookup } } as unknown as Env,
      "/api/rooms",
      { body: JSON.stringify({ name: "" }) },
    );
    expect(response.status).toBe(400);
    expect(admission.MATCHMAKER.getByName).not.toHaveBeenCalled();
    expect(roomLookup).not.toHaveBeenCalled();
  });

  it("changing browser identities cannot reset the global durable budget", async () => {
    const admission = allowedAdmissionBindings();
    const admit = vi.fn().mockResolvedValue({ success: false, retryAfter: 7 });
    admission.MATCHMAKER.getByName.mockReturnValue({
      admitRoomCreation: admit,
    });
    const roomLookup = vi.fn();
    const bindings = {
      ...admission,
      GAME_ROOM: { getByName: roomLookup },
    } as unknown as Env;
    for (const identity of ["one", "two", "three"]) {
      const response = await request(bindings, "/api/rooms", {
        headers: {
          "Content-Type": "application/json",
          Cookie: `browser=${identity}`,
          "X-Browser-Id": identity,
          "CF-Connecting-IP": `192.0.2.${identity.length}`,
        },
      });
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("7");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "rate-limited" });
    }
    expect(admit).toHaveBeenCalledTimes(3);
    for (const [name] of admission.MATCHMAKER.getByName.mock.calls)
      expect(name).toBe("room-admission");
    expect(roomLookup).not.toHaveBeenCalled();
  });

  it.each(["edge", "durable"])(
    "fails closed when the %s gate fails",
    async (gate) => {
      const admission = allowedAdmissionBindings();
      const failure = new Error("private limiter failure");
      if (gate === "edge")
        admission.ROOM_CREATION_RATE_LIMIT.limit.mockRejectedValue(failure);
      else
        admission.MATCHMAKER.getByName.mockReturnValue({
          admitRoomCreation: vi.fn().mockRejectedValue(failure),
        });
      const roomLookup = vi.fn();
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const response = await request({
          ...admission,
          GAME_ROOM: { getByName: roomLookup },
        } as unknown as Env);
        expect(response.status).toBe(503);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: "room-service-unavailable",
        });
        expect(roomLookup).not.toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    },
  );

  it.each([
    { path: "/api/health", body: { status: "ok" } },
    {
      path: "/api/rooms/ABC234/health",
      body: { kind: "game-room", status: "ok" },
    },
    {
      path: "/api/queues/arbitrary-name/health",
      body: { kind: "matchmaker", status: "ok" },
    },
  ])("$path does not look up any namespace", async ({ path, body }) => {
    const lookup = vi.fn(() => {
      throw new Error("health must not touch a DO");
    });
    const limit = vi.fn();
    const response = await request(
      {
        GAME_ROOM: { getByName: lookup },
        MATCHMAKER: { getByName: lookup },
        ROOM_CREATION_RATE_LIMIT: { limit },
      } as unknown as Env,
      path,
      { method: "GET", body: undefined },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    expect(lookup).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it("validates a health room code without allocating an object", async () => {
    const lookup = vi.fn();
    const response = await request(
      { GAME_ROOM: { getByName: lookup } } as unknown as Env,
      "/api/rooms/not-a-code/health",
      { method: "GET", body: undefined },
    );
    expect(response.status).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps joins outside the global creation budget", async () => {
    const admission = allowedAdmissionBindings();
    admission.ROOM_CREATION_RATE_LIMIT.limit.mockResolvedValue({
      success: false,
    });
    const join = vi.fn().mockResolvedValue({ roomCode: "ABC234" });
    const response = await request(
      {
        ...admission,
        GAME_ROOM: { getByName: vi.fn().mockReturnValue({ join }) },
      } as unknown as Env,
      "/api/rooms/ABC234/join",
    );
    expect(response.status).toBe(200);
    expect(join).toHaveBeenCalledOnce();
    expect(admission.ROOM_CREATION_RATE_LIMIT.limit).not.toHaveBeenCalled();
    expect(admission.MATCHMAKER.getByName).not.toHaveBeenCalled();
  });
});
