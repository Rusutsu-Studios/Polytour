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
