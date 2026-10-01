import { describe, expect, it } from "vitest";
import { parseRoomResponse, RoomRequestError } from "./room-response.js";

describe("room HTTP response boundary", () => {
  it.each([
    [500, "Internal Server Error", "text/plain"],
    [503, "<!doctype html><h1>Service unavailable</h1>", "text/html"],
    [429, "Too many requests", "text/plain"],
  ])(
    "reports HTTP %i failures without exposing JSON or HTML errors",
    async (status, body, contentType) => {
      const response = new Response(body, {
        status,
        headers: { "Content-Type": contentType },
      });
      await expect(parseRoomResponse(response)).rejects.toMatchObject({
        name: "RoomRequestError",
        status,
        message: expect.stringContaining(`HTTP ${status}`),
      });
    },
  );

  it("keeps a recognized structured room error actionable", async () => {
    await expect(
      parseRoomResponse(Response.json({ error: "room-full" }, { status: 409 })),
    ).rejects.toThrow("Cette salle est complète. Créez une nouvelle partie.");
  });

  it("preserves a valid server explanation for a structured failure", async () => {
    await expect(
      parseRoomResponse(
        Response.json(
          {
            error: "room-unavailable",
            message: "Cette salle est en maintenance.",
          },
          { status: 503 },
        ),
      ),
    ).rejects.toThrow("Cette salle est en maintenance.");
  });

  it("distinguishes a confirmed daily write quota from a general outage", async () => {
    await expect(
      parseRoomResponse(
        Response.json({ error: "room-storage-limit" }, { status: 503 }),
      ),
    ).rejects.toThrow("quota quotidien d’écriture des salles Cloudflare");
    await expect(
      parseRoomResponse(
        Response.json({ error: "room-service-unavailable" }, { status: 503 }),
      ),
    ).rejects.toThrow("serveur de jeu est temporairement indisponible");
  });

  it("accepts only valid seat credentials on success", async () => {
    const credentials = {
      roomCode: "ABCD23",
      seat: 0,
      token: "test-capability-not-real",
    };
    await expect(
      parseRoomResponse(Response.json(credentials, { status: 201 })),
    ).resolves.toEqual(credentials);
  });

  it.each([
    "Internal Server Error",
    JSON.stringify({ roomCode: "ABCD23", seat: 1.5, token: "test-not-real" }),
    JSON.stringify({ roomCode: "ABCD23", seat: 0, token: "" }),
    JSON.stringify({ error: "room-not-found" }),
  ])(
    "rejects malformed successful responses before credentials can be stored",
    async (body) => {
      await expect(
        parseRoomResponse(new Response(body)),
      ).rejects.toBeInstanceOf(RoomRequestError);
      await expect(parseRoomResponse(new Response(body))).rejects.toThrow(
        "réponse de salle incompatible",
      );
    },
  );
});
