import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Phase 0 Worker scaffold", () => {
  it("serves the health endpoint", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.test/api/health"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("addresses a GameRoom Durable Object", async () => {
    const room = env.GAME_ROOM.getByName("TEST01");
    const response = await room.fetch("https://example.test/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "game-room",
      status: "ok",
    });
  });

  it("opens the Phase 0 WebSocket handshake through the Worker", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.test/ws/debug/hello", {
        headers: { Upgrade: "websocket" },
      }),
    );
    const socket = response.webSocket;

    if (!socket) {
      throw new Error("Expected a WebSocket upgrade response");
    }

    const hello = new Promise<string>((resolve) => {
      socket.addEventListener("message", (event: MessageEvent) =>
        resolve(String(event.data)),
      );
    });
    socket.accept();

    expect(response.status).toBe(101);
    expect(JSON.parse(await hello)).toEqual({
      type: "phase0.hello",
      status: "ok",
    });
  });
});
