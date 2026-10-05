import { describe, expect, it } from "vitest";
import { createGame, DEFAULT_GAME_CONFIG } from "../../shared/engine/index.js";
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
  it("accepts Escape in snapshots and preserves the optional frozen deck marker", () => {
    const snapshot = createGame(
      DEFAULT_GAME_CONFIG,
      [
        { playerId: "ada", name: "Ada", control: "human" },
        { playerId: "bea", name: "Bea", control: "human" },
      ],
      7,
      { now: 0 },
    ).state;
    const withCard = {
      ...snapshot,
      players: snapshot.players.map((player) => ({
        ...player,
        heldCards: ["Escape"],
      })),
    };
    expect(
      parseServerMessage(
        JSON.stringify({
          ...welcome,
          snapshot: withCard,
          lobby: { ...welcome.lobby, escapeCard: true },
        }),
      ),
    ).toMatchObject({
      snapshot: {
        players: [{ heldCards: ["Escape"] }, { heldCards: ["Escape"] }],
      },
      lobby: { escapeCard: true },
    });
    expect(parseServerMessage(JSON.stringify(welcome))).not.toHaveProperty(
      "lobby.escapeCard",
    );
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          ...welcome,
          lobby: { ...welcome.lobby, escapeCard: "yes" },
        }),
      ),
    ).toThrow();
  });
  it("validates pause and resume events before they reach the reducer", () => {
    const events = [
      {
        type: "PauseChanged",
        pause: { kind: "paused", requestedBy: 0, startedAt: 10 },
        pauseCooldownUntil: 300_000,
      },
      { type: "GameResumed", seat: 0, pending: null, matchDeadline: 400_000 },
    ];
    const envelope = { type: "events", fromSeq: 1, toSeq: 2, events };
    expect(parseServerMessage(JSON.stringify(envelope))).toMatchObject({
      events,
    });
    for (const event of [
      {
        ...events[0],
        pause: { kind: "paused", requestedBy: 9, startedAt: 10 },
      },
      { ...events[0], pauseCooldownUntil: "later" },
      { ...events[1], pending: { kind: "roll", seat: 0 } },
      { ...events[1], matchDeadline: "later" },
    ])
      expect(() =>
        parseServerMessage(JSON.stringify({ ...envelope, events: [event] })),
      ).toThrow();
  });
  it("accepts the reworked deck's die roll, Power Cut, shields and gifts", () => {
    const events = [
      { type: "CardDrawn", seat: 1, card: "Tailwind", kept: false, roll: 4 },
      { type: "PowerCut", seat: 1, tile: 13, untilLap: 3 },
      { type: "ShieldRaised", seat: 0, tile: 1 },
      { type: "ShieldBroken", seat: 1, tile: 1 },
      { type: "PropertyGiven", seat: 0, to: 2, tile: 3 },
    ];
    expect(
      parseServerMessage(
        JSON.stringify({ type: "events", fromSeq: 1, toSeq: 2, events }),
      ),
    ).toMatchObject({ events });
    expect(parseServerMessage(JSON.stringify(welcome))).toMatchObject({
      lobby: { chanceRule: "reworked" },
    });
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: "events",
          fromSeq: 1,
          toSeq: 1,
          events: [{ ...events[1], tile: 40 }],
        }),
      ),
    ).toThrow();
  });
  it.each([false, true])(
    "retains the frozen resort festival marker %s",
    (resortFestivals) => {
      const message = parseServerMessage(
        JSON.stringify({
          ...welcome,
          lobby: { ...welcome.lobby, resortFestivals },
        }),
      );
      expect(message).toMatchObject({
        type: "welcome",
        lobby: { resortFestivals },
      });
    },
  );
  it("keeps the marker absent for older servers and rejects invalid values", () => {
    const message = parseServerMessage(JSON.stringify(welcome));
    expect(
      message.type === "welcome" && message.lobby.resortFestivals,
    ).toBeUndefined();
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          ...welcome,
          lobby: { ...welcome.lobby, resortFestivals: "yes" },
        }),
      ),
    ).toThrow();
    expect(RoomConfigSchema.safeParse({ resortFestivals: true }).success).toBe(
      false,
    );
  });
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

function lobby() {
  return {
    roomCode: "RULE23",
    hostSeat: 0,
    status: "lobby",
    config: RoomConfigSchema.parse({}),
    seats: [0, 1, 2, 3].map((seat) => ({
      seat,
      name: "Fixture",
      control: null,
      online: false,
    })),
  };
}
describe("frozen lobby rules at the client boundary", () => {
  it("retains old board, economy and hotel markers for a recovered lobby", () => {
    const markers = {
      sellBackPercent: 50,
      boardRule: "legacy",
      economyRule: "prototype",
      hotelPurchaseRule: "legacy-lap",
    };
    const message = parseServerMessage(
      JSON.stringify({ type: "lobby", lobby: { ...lobby(), ...markers } }),
    );
    expect(message.type).toBe("lobby");
    if (message.type !== "lobby") throw new Error("Expected lobby");
    expect(message.lobby).toMatchObject(markers);
  });
  it("retains the combined new-room markers", () => {
    const markers = {
      sellBackPercent: 100,
      boardRule: "country",
      economyRule: "reference",
      hotelPurchaseRule: "staged-hotels",
    };
    const message = parseServerMessage(
      JSON.stringify({ type: "lobby", lobby: { ...lobby(), ...markers } }),
    );
    if (message.type !== "lobby") throw new Error("Expected lobby");
    expect(message.lobby).toMatchObject(markers);
  });
  it("refuses an unknown board marker before displaying misleading tile semantics", () => {
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: "lobby",
          lobby: { ...lobby(), boardRule: "unknown-board" },
        }),
      ),
    ).toThrow();
  });
});
describe("room people at the client boundary", () => {
  it("reads leaders, waiting members and local players", () => {
    const people = {
      ...lobby(),
      hostSeat: 2,
      locked: true,
      waiting: [
        { id: "0123456789abcdef", name: "Bo", approved: false, online: true },
      ],
      seats: [0, 1, 2, 3].map((seat) => ({
        seat,
        name: "Fixture",
        control: "human",
        online: true,
        controller: seat === 1 ? 0 : null,
      })),
    };
    const message = parseServerMessage(
      JSON.stringify({ type: "lobby", lobby: people }),
    );
    if (message.type !== "lobby") throw new Error("Expected lobby");
    expect(message.lobby).toMatchObject({
      hostSeat: 2,
      locked: true,
      waiting: people.waiting,
    });
    expect(message.lobby.seats.map((seat) => seat.controller)).toEqual([
      null,
      0,
      null,
      null,
    ]);
  });
  it("welcomes someone who waits without a seat", () => {
    const message = parseServerMessage(
      JSON.stringify({
        type: "welcome",
        protocolVersion: 4,
        you: { seat: null, member: "0123456789abcdef" },
        seq: 0,
        snapshot: null,
        lobby: lobby(),
        randomness: null,
      }),
    );
    if (message.type !== "welcome") throw new Error("Expected welcome");
    expect(message.you).toEqual({ seat: null, member: "0123456789abcdef" });
    // Fields a lobby fixture leaves out read as an open room without guests.
    expect(message.lobby).toMatchObject({ locked: false, waiting: [] });
    expect(message.lobby.seats[0].controller).toBeNull();
  });
});
