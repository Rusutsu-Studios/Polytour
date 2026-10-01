import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker/index.js";

describe("Unavailable room service", () => {
  it("identifies the verified Durable Object write limit without leaking details", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const bindings = {
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
