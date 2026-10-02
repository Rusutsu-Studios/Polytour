import { describe, expect, it } from "vitest";
import type {
  GameConfig,
  PublicState,
  SeatInfo,
} from "../../shared/engine/index.js";
import {
  createGame,
  DEFAULT_GAME_CONFIG,
  toPublic,
} from "../../shared/engine/index.js";
import { ownerTag } from "./board-display.js";

const SEATS: readonly SeatInfo[] = ["Ada", "Bea"].map((name, index) => ({
  playerId: `player-${index}`,
  name,
  control: "human",
}));
const CONFIG: GameConfig = { ...DEFAULT_GAME_CONFIG, festivalCount: 0 };
const VALENCIA = 6;
const RESORT = 5;

function withOwners(): PublicState {
  const { state } = createGame(CONFIG, SEATS, 7, { now: 0 });
  return toPublic({
    ...state,
    properties: state.properties.map((property) =>
      property.tile === VALENCIA
        ? { ...property, owner: 0 as const, level: 4 as const }
        : property.tile === RESORT
          ? { ...property, owner: 1 as const }
          : property,
    ),
  });
}

describe("ownerTag", () => {
  it("names the owner and how far the city is built", () => {
    expect(ownerTag(withOwners(), VALENCIA)).toBe("● Ada · Hôtel");
  });
  it("leaves out the level for a resort, which never builds", () => {
    expect(ownerTag(withOwners(), RESORT)).toBe("◆ Bea");
  });
  it("addresses the viewer rather than naming them", () => {
    expect(ownerTag(withOwners(), VALENCIA, 0)).toBe("● vous · Hôtel");
  });
  it("says nothing about a space nobody holds", () => {
    expect(ownerTag(withOwners(), 7)).toBeNull();
  });
  it("says nothing about a space that is not a property", () => {
    expect(ownerTag(withOwners(), 0)).toBeNull();
  });
});
