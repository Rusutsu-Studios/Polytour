import { describe, expect, it } from "vitest";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  type PublicState,
  toPublic,
} from "../../shared/engine/index.js";
import { purchaseShortfall } from "./decision-shortfall.js";

function fixture(): PublicState {
  return toPublic(
    createGame(
      { ...DEFAULT_GAME_CONFIG, festivalCount: 0 },
      [
        { playerId: "ada", name: "Ada", control: "human" },
        { playerId: "bea", name: "Bea", control: "human" },
      ],
      11,
      { now: 0 },
    ).state,
  );
}
function withCash(state: PublicState, cash: number): PublicState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.seat === 0 ? { ...player, cash } : player,
    ),
  };
}
const buying = (state: PublicState, tile: number): PublicState => ({
  ...state,
  pending: { kind: "buy", seat: 0, tile, maxLevel: 2, deadline: 1000 },
});

describe("purchase shortfall", () => {
  it("reports the land price and the missing cash on an unaffordable city", () => {
    const state = buying(withCash(fixture(), 40_000), 1);
    expect(purchaseShortfall(state, 0)).toEqual({
      level: 0,
      price: 60_000,
      cash: 40_000,
      missing: 20_000,
    });
  });

  it("stays silent when the land itself is affordable", () => {
    const state = buying(withCash(fixture(), 60_000), 1);
    expect(purchaseShortfall(state, 0)).toBeNull();
  });

  it("prices a beach the player cannot pay for", () => {
    const state = buying(withCash(fixture(), 150_000), 4);
    expect(purchaseShortfall(state, 0)).toEqual({
      level: 0,
      price: 200_000,
      cash: 150_000,
      missing: 50_000,
    });
  });

  it("reports the next level on a build the owner cannot pay for", () => {
    const base = withCash(fixture(), 30_000);
    const state: PublicState = {
      ...base,
      properties: base.properties.map((property) =>
        property.tile === 1 ? { ...property, owner: 0, level: 1 } : property,
      ),
      pending: { kind: "build", seat: 0, tile: 1, maxLevel: 3, deadline: 1000 },
    };
    expect(purchaseShortfall(state, 0)).toEqual({
      level: 2,
      price: 50_000,
      cash: 30_000,
      missing: 20_000,
    });
  });

  it("ignores decisions that belong to another seat or another kind", () => {
    const state = buying(withCash(fixture(), 0), 1);
    expect(purchaseShortfall(state, 1)).toBeNull();
    expect(
      purchaseShortfall(
        { ...state, pending: { kind: "roll", seat: 0, deadline: 1000 } },
        0,
      ),
    ).toBeNull();
  });
});
