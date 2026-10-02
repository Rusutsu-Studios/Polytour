import { describe, expect, it } from "vitest";
import type { BuildLevel, EconomyRule } from "./index.js";
import {
  BOARD,
  BUILD_LEVELS,
  CITY_ECONOMY,
  ECONOMY,
  getResortRent,
  getTileBaseRent,
  getTileBuildCost,
  getTileInvestedValue,
  getTileLandPrice,
  isCityTile,
  REFERENCE_CITY_ECONOMY,
  RULE_ECONOMY,
  roundCharge,
  roundPayout,
} from "./index.js";

const levels = (rule: EconomyRule) =>
  BUILD_LEVELS.filter((level) => level.level <= RULE_ECONOMY[rule].topLevel);

describe("economy configuration", () => {
  it("uses the captured lobby defaults and per-city absolute construction costs", () => {
    expect(ECONOMY).toMatchObject({
      startingCash: 2_000_000,
      startSalary: 400_000,
      minimumPlayers: 2,
      maximumPlayers: 4,
      buyoutMultiplier: 2,
      resortPrice: 200_000,
    });
    expect(BUILD_LEVELS.map((level) => level.name)).toEqual([
      "Land",
      "House I",
      "House II",
      "House III",
      "Hotel",
      "Landmark",
    ]);
    // The captured first-city and Tokyo costs are identical in both rule sets.
    for (const rule of ["prototype", "reference"] as const) {
      expect(getTileLandPrice(1, rule)).toBe(60_000);
      expect(
        [1, 2, 3].map((level) =>
          getTileBuildCost(1, level as BuildLevel, rule),
        ),
      ).toEqual([50_000, 50_000, 50_000]);
      expect(getTileBuildCost(1, 4, rule)).toBe(150_000);
      expect(getTileLandPrice(31, rule)).toBe(400_000);
      expect(
        [1, 2, 3].map((level) =>
          getTileBuildCost(31, level as BuildLevel, rule),
        ),
      ).toEqual([200_000, 200_000, 200_000]);
      expect(getTileBuildCost(31, 4, rule)).toBe(500_000);
      expect(getTileInvestedValue(31, 4, rule)).toBe(1_500_000);
    }
  });

  it("has exactly one configuration for every city and integer nonnegative amounts", () => {
    const cities = BOARD.filter(isCityTile).map((tile) => tile.index);
    expect(CITY_ECONOMY.map((city) => city.tile)).toEqual(cities);
    expect(REFERENCE_CITY_ECONOMY.map((city) => city.tile)).toEqual(cities);
    for (const rule of ["prototype", "reference"] as const)
      for (const tile of cities) {
        let previousInvestment = 0;
        for (const level of levels(rule)) {
          expect(
            Number.isSafeInteger(getTileBuildCost(tile, level.level, rule)),
          ).toBe(true);
          expect(
            Number.isSafeInteger(getTileBaseRent(tile, level.level, rule)),
          ).toBe(true);
          const investment = getTileInvestedValue(tile, level.level, rule);
          expect(investment).toBe(
            previousInvestment + getTileBuildCost(tile, level.level, rule),
          );
          previousInvestment = investment;
        }
      }
    expect(() => getTileLandPrice(0, "reference")).toThrow("not a city");
    expect(() => getTileBaseRent(1, 5, "reference")).toThrow("no Landmark");
    expect(getResortRent(1, "prototype")).toBe(50_000);
    expect(getResortRent(3, "prototype")).toBe(200_000);
    expect(
      ([1, 2, 3] as const).map((owned) => getResortRent(owned, "reference")),
    ).toEqual([25_000, 50_000, 100_000]);
  });

  it("takes the reference rents and three-house totals, rising side by side", () => {
    const threeHouses = (tile: number) =>
      getTileInvestedValue(tile, 3, "reference");
    // Captured totals: first city 210 k, 13th city 690 k, Tokyo 1 M.
    expect([1, 18, 31].map(threeHouses)).toEqual([210_000, 690_000, 1_000_000]);
    expect(
      [1, 18, 31].map((tile) => getTileLandPrice(tile, "reference")),
    ).toEqual([60_000, 240_000, 400_000]);
    expect(
      ([0, 1, 2, 3, 4] as const).map((level) =>
        getTileBaseRent(31, level, "reference"),
      ),
    ).toEqual([50_000, 200_000, 400_000, 600_000, 1_100_000]);
    expect(getTileBaseRent(1, 0, "reference")).toBe(2_000);
    // Every side is dearer than the previous one, and each level earns more.
    const sides = [1, 2, 3, 4].map((side) =>
      BOARD.filter(isCityTile)
        .filter((tile) => tile.side === side)
        .map((tile) => threeHouses(tile.index)),
    );
    for (let side = 1; side < 4; side++)
      expect(Math.min(...sides[side])).toBeGreaterThan(
        Math.max(...sides[side - 1]),
      );
    for (const city of REFERENCE_CITY_ECONOMY)
      for (let level = 1; level < city.rent.length; level++)
        expect(city.rent[level]).toBeGreaterThan(city.rent[level - 1]);
  });

  it("freezes the differing rules of each rule set", () => {
    expect(RULE_ECONOMY.prototype).toMatchObject({
      sellBackPercent: 50,
      minimumTax: 50_000,
      islandReleaseFee: 100_000,
      islandMaxFailedEscapes: 2,
      topLevel: 5,
      protectedLevel: 5,
      rentModifiers: "largest",
      championshipFee: 0,
      championshipPersists: false,
    });
    expect(RULE_ECONOMY.reference).toMatchObject({
      sellBackPercent: 100,
      minimumTax: 0,
      islandReleaseFee: 200_000,
      islandMaxFailedEscapes: 3,
      topLevel: 4,
      protectedLevel: 4,
      rentModifiers: "additive",
      maxRentMultiplier: 10,
      championshipFee: 50_000,
      maxHostMultiplier: 10,
      championshipPersists: true,
      resortFestivals: true,
      travelToFreeProperties: true,
    });
  });

  it("rounds player charges up and payouts down", () => {
    expect(roundCharge(67.5)).toBe(68);
    expect(roundPayout(67.5)).toBe(67);
  });
});
