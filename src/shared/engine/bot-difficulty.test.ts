import { describe, expect, it } from "vitest";
import { SIM_CONFIG, simulateGame } from "../../../tools/sim/simulation.js";
import type { BuildLevel } from "../board/index.js";
import { RoomConfigSchema } from "../protocol/index.js";
import type { PublicState, Seat } from "./index.js";
import {
  botAction,
  createGame,
  DEFAULT_GAME_CONFIG,
  legalActions,
  toPublic,
} from "./index.js";

function fixture(cash = 2_000_000): PublicState {
  const state = toPublic(
    createGame(
      { ...DEFAULT_GAME_CONFIG, festivalCount: 0 },
      [
        { playerId: "a", name: "Ada", control: "bot", seat: 0 },
        { playerId: "b", name: "Bea", control: "bot", seat: 1 },
      ],
      7,
      { now: 0 },
    ).state,
  );
  return {
    ...state,
    activeSeat: 0,
    players: state.players.map((player) =>
      player.seat === 0 ? { ...player, cash, position: 1 } : player,
    ),
    pending: { kind: "buy", seat: 0, tile: 1, maxLevel: 2, deadline: 1000 },
  };
}

function own(
  state: PublicState,
  tiles: readonly number[],
  seat: Seat,
  level: BuildLevel = 0,
): PublicState {
  return {
    ...state,
    properties: state.properties.map((property) =>
      tiles.includes(property.tile)
        ? { ...property, owner: seat, level }
        : property,
    ),
    players: state.players.map((player) => ({
      ...player,
      properties: [
        ...player.properties.filter((tile) => !tiles.includes(tile)),
        ...(player.seat === seat ? tiles : []),
      ],
    })),
  };
}

describe("bot difficulty", () => {
  it("defaults old configs to Medium and rejects unsupported levels", () => {
    expect(RoomConfigSchema.parse({}).botDifficulty).toBe("medium");
    expect(
      RoomConfigSchema.safeParse({ botDifficulty: "expert" }).success,
    ).toBe(false);
    expect(botAction(fixture(), 0)).toEqual(botAction(fixture(), 0, "medium"));
    const easy = {
      ...fixture(),
      config: { ...fixture().config, botDifficulty: "easy" as const },
    };
    expect(botAction(easy, 0)).toEqual({ type: "Buy", level: 0 });
  });

  it("Easy buys land while Medium develops it", () => {
    expect(botAction(fixture(), 0, "easy")).toEqual({ type: "Buy", level: 0 });
    expect(botAction(fixture(), 0, "medium")).toEqual({
      type: "Buy",
      level: 2,
    });
  });

  it("Hard saves cash for nearby opponent rent", () => {
    const state = own(fixture(400_000), [3, 5, 6, 7, 9, 10, 11], 1, 4);
    expect(botAction(state, 0, "medium")).toEqual({ type: "Buy", level: 2 });
    expect(botAction(state, 0, "hard")).toEqual({ type: "Decline" });
  });

  it("Hard spends its reserve for a winning buyout, but never an unaffordable one", () => {
    const state = {
      ...own(own(fixture(120_000), [1, 2, 3, 4, 5, 6], 0), [7], 1),
      pending: {
        kind: "buyout" as const,
        seat: 0 as const,
        tile: 7,
        price: 120_000,
        deadline: 1000,
      },
    };
    expect(botAction(state, 0, "hard")).toEqual({ type: "Buyout" });
    expect(botAction(state, 0, "medium")).toEqual({ type: "Decline" });
    expect(
      botAction(
        { ...state, pending: { ...state.pending, price: 120_001 } },
        0,
        "hard",
      ),
    ).toEqual({ type: "Decline" });
  });

  it("Hard declines an expensive bare-city buyout without a collection benefit", () => {
    const state = {
      ...own(fixture(500_000), [31], 1),
      pending: {
        kind: "buyout" as const,
        seat: 0 as const,
        tile: 31,
        price: 800_000,
        deadline: 1000,
      },
    };
    const rich = {
      ...state,
      players: state.players.map((player) =>
        player.seat === 0 ? { ...player, cash: 1_200_000 } : player,
      ),
    };
    expect(legalActions(rich, 0)).toContainEqual({ type: "Buyout" });
    expect(botAction(rich, 0, "hard")).toEqual({ type: "Decline" });
  });

  it("Hard preserves a complete country during forced sales", () => {
    const state = {
      ...own(own(fixture(-10_000), [13, 15], 0, 2), [31], 0),
      pending: {
        kind: "sell" as const,
        seat: 0 as const,
        targets: [13, 15, 31],
        creditor: null,
        deadline: 1000,
      },
    };
    expect(botAction(state, 0, "hard")).toEqual({ type: "Sell", tile: 31 });
  });

  it("Hard travels to complete a country ahead of expensive unowned land", () => {
    const state = {
      ...own(fixture(), [13], 0),
      pending: {
        kind: "travel" as const,
        seat: 0 as const,
        fee: 50_000,
        targets: [15, 31],
        deadline: 1000,
      },
    };
    expect(botAction(state, 0, "hard")).toEqual({ type: "Travel", tile: 15 });
    expect(botAction(state, 0, "medium")).toEqual({ type: "Travel", tile: 31 });
  });

  it("Hard takes the last free property needed for an opponent's line win", () => {
    const state = {
      ...own(fixture(), [1, 2, 3, 5, 6, 7], 1),
      pending: {
        kind: "travel" as const,
        seat: 0 as const,
        fee: 50_000,
        targets: [4, 31],
        deadline: 1000,
      },
    };
    expect(botAction(state, 0, "hard")).toEqual({ type: "Travel", tile: 4 });
  });

  it("all levels terminate with legal public decisions and conserved money", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      for (let seed = 0; seed < 10; seed++) {
        const result = simulateGame(
          seed,
          { ...SIM_CONFIG, botDifficulty: level },
          (state) => {
            const seat = state.pending?.seat;
            if (seat === undefined) throw new Error("Missing decision");
            const action = botAction(state, seat, level);
            expect(legalActions(state, seat)).toContainEqual(action);
            return action;
          },
        );
        expect(result.rounds).toBeLessThanOrEqual(SIM_CONFIG.roundLimit);
      }
    }
  });
});
