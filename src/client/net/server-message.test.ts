import { describe, expect, it } from "vitest";
import { RoomConfigSchema } from "../../shared/protocol/index.js";
import { parseServerMessage } from "./server-message.js";

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
