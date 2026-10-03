import { describe, expect, it } from "vitest";

import {
  BOARD,
  BOARD_SIZE,
  COUNTRY_IDS,
  getBoard,
  getCountryCityTiles,
  getTile,
  isCityTile,
  isResortTile,
  LEGACY_BOARD,
} from "./index.js";

describe("board configuration", () => {
  it("selects the original board for missing saved markers without moving any tiles", () => {
    expect(getBoard({})).toBe(LEGACY_BOARD);
    expect(getBoard({ boardRule: "country" })).toBe(BOARD);
    expect(getBoard("legacy").map((tile) => tile.index)).toEqual(
      Array.from({ length: 32 }, (_, index) => index),
    );
    expect(
      getBoard({})
        .filter((tile) => tile.kind === "chance")
        .map((tile) => tile.index),
    ).toEqual([3, 14, 19]);
    expect(
      getBoard({})
        .filter(isResortTile)
        .map((tile) => tile.index),
    ).toEqual([5, 12, 21, 28]);
    expect(getTile(4, {})?.kind).toBe("city");
    expect(getTile(5, {})?.kind).toBe("resort");
    expect(getTile(29, {})?.kind).toBe("tax");
    expect(
      COUNTRY_IDS.map((country) => getCountryCityTiles(country, {}).length),
    ).toEqual([2, 3, 3, 2, 3, 2, 3, 2]);
  });
  it("contains every index exactly once", () => {
    expect(BOARD).toHaveLength(BOARD_SIZE);
    expect(BOARD.map((tile) => tile.index)).toEqual(
      Array.from({ length: BOARD_SIZE }, (_, index) => index),
    );
  });

  it("places corners and special tiles at their rule-defined indices", () => {
    expect(getTile(0)?.kind).toBe("start");
    expect(getTile(8)?.kind).toBe("island");
    expect(getTile(16)?.kind).toBe("championship");
    expect(getTile(24)?.kind).toBe("world-tour");
    expect(
      BOARD.filter((tile) => tile.kind === "chance").map((tile) => tile.index),
    ).toEqual([12, 20, 28]);
    expect(getTile(30)?.kind).toBe("tax");
    expect(
      BOARD.filter((tile) => tile.kind === "resort").map((tile) => tile.index),
    ).toEqual([4, 14, 18, 25]);
  });

  it("groups all twenty cities and four resorts into their countries and sides", () => {
    expect(BOARD.filter(isCityTile)).toHaveLength(20);
    expect(BOARD.filter(isResortTile)).toHaveLength(4);
    expect(
      COUNTRY_IDS.map((country) => getCountryCityTiles(country).length),
    ).toEqual([3, 3, 3, 2, 2, 3, 2, 2]);
    // Every colour group is contiguous on its side, apart from one resort,
    // Chance or tax square, so a group always reads as one country.
    for (const country of COUNTRY_IDS) {
      const tiles = getCountryCityTiles(country).map((tile) => tile.index);
      expect((tiles.at(-1) ?? 0) - tiles[0]).toBeLessThanOrEqual(tiles.length);
    }
    expect(BOARD.filter(isCityTile).map((tile) => tile.side)).toEqual([
      1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4,
    ]);
  });
});
