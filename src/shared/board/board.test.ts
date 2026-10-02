import { describe, expect, it } from "vitest";

import {
  BOARD,
  BOARD_SIZE,
  COUNTRY_IDS,
  getCountryCityTiles,
  getTile,
  isCityTile,
  isResortTile,
} from "./index.js";

describe("board configuration", () => {
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
