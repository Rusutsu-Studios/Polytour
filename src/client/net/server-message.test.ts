import { describe, expect, it } from "vitest";
import { RoomConfigSchema } from "../../shared/protocol/index.js";
import type { RoomDiagnostics } from "../../shared/protocol/room-diagnostics.js";
import { parseServerMessage } from "./server-message.js";

const welcome = {
  type: "welcome",
  protocolVersion: 1,
  you: { seat: 0 },
  seq: 0,
  snapshot: null,
  randomness: null,
  lobby: {
    roomCode: "ABCD35",
    hostSeat: 0,
    status: "lobby",
    config: RoomConfigSchema.parse({}),
    seats: [0, 1, 2, 3].map((seat) => ({
      seat,
      name: `Player ${seat + 1}`,
      control: seat === 0 ? "human" : null,
      online: seat === 0,
    })),
  },
};
const diagnostics: RoomDiagnostics = {
  worker: {
    worker: "polytour",
    hostname: "preview.example",
    runtime: "cloudflare",
    cloudflare: {
      colo: "IAD",
      location: "Ashburn, VA, USA",
      region: "North America",
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
      colo: "IAD",
      location: "Ashburn, VA, USA",
      region: "North America",
    },
  ],
};

describe("room debug server envelopes", () => {
  it("retains the advertised capability without changing an older welcome", () => {
    const older = parseServerMessage(JSON.stringify(welcome));
    expect(older.type).toBe("welcome");
    expect(older).not.toHaveProperty("roomDebugVersion");
    expect(
      parseServerMessage(JSON.stringify({ ...welcome, roomDebugVersion: 1 })),
    ).toMatchObject({ type: "welcome", roomDebugVersion: 1 });
  });

  it("validates room metadata independently of game events", () => {
    expect(
      parseServerMessage(
        JSON.stringify({ type: "room-diagnostics", value: diagnostics }),
      ),
    ).toEqual({ type: "room-diagnostics", value: diagnostics });
  });

  it("accepts a future debug capability without rejecting the game welcome", () => {
    expect(
      parseServerMessage(JSON.stringify({ ...welcome, roomDebugVersion: 2 })),
    ).toMatchObject({ type: "welcome", roomDebugVersion: 2 });
  });

  it("rejects storage data and credentials in diagnostics", () => {
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: "room-diagnostics",
          value: { ...diagnostics, token: "test-token-not-real" },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: "room-diagnostics",
          value: { ...diagnostics, room: { ...diagnostics.room, rows: [] } },
        }),
      ),
    ).toThrow();
  });

  it("rejects invented physical DO locations and oversized peer lists", () => {
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: "room-diagnostics",
          value: {
            ...diagnostics,
            room: { ...diagnostics.room, location: "IAD" },
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: "room-diagnostics",
          value: { ...diagnostics, peers: Array(5).fill(diagnostics.peers[0]) },
        }),
      ),
    ).toThrow();
  });
});
