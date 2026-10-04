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
  LEGACY_CITY_ECONOMY,
  REFERENCE_CITY_ECONOMY,
  RULE_ECONOMY,
  roundCharge,
  roundPayout,
} from "./index.js";

const levels = (rule: EconomyRule) =>
  BUILD_LEVELS.filter((level) => level.level <= RULE_ECONOMY[rule].topLevel);

describe("economy configuration", () => {
  it("preserves the exact original prototype prices at their original tile indices", () => {
    expect(
      LEGACY_CITY_ECONOMY.map((city) => [
        city.tile,
        city.land,
        city.house,
        city.hotel,
      ]),
    ).toEqual([
      [1, 60_000, 50_000, 150_000],
      [2, 70_000, 50_000, 150_000],
      [4, 90_000, 60_000, 180_000],
      [6, 100_000, 60_000, 180_000],
      [7, 110_000, 70_000, 200_000],
      [9, 120_000, 80_000, 220_000],
      [10, 130_000, 80_000, 220_000],
      [11, 140_000, 90_000, 250_000],
      [13, 150_000, 100_000, 280_000],
      [15, 170_000, 100_000, 280_000],
      [17, 180_000, 110_000, 300_000],
      [18, 190_000, 120_000, 320_000],
      [20, 200_000, 120_000, 320_000],
      [22, 210_000, 130_000, 350_000],
      [23, 230_000, 140_000, 370_000],
      [25, 250_000, 150_000, 400_000],
      [26, 280_000, 160_000, 420_000],
      [27, 300_000, 170_000, 450_000],
      [30, 350_000, 180_000, 480_000],
      [31, 400_000, 200_000, 500_000],
    ]);
    expect(getTileInvestedValue(6, 4, "prototype", "legacy")).toBe(460_000);
    expect(getTileBaseRent(4, 1, "prototype", "legacy")).toBe(54_000);
  });
  it("maps all twenty reference cities including Madrid onto the grouped board and its side tiers", () => {
    expect(
      REFERENCE_CITY_ECONOMY.map((city) => [
        city.tile,
        city.land,
        city.house,
        city.hotel,
        ...city.rent,
      ]),
    ).toEqual([
      [1, 60_000, 50_000, 150_000, 2_000, 25_000, 50_000, 75_000, 150_000],
      [2, 60_000, 50_000, 150_000, 2_000, 28_000, 55_000, 83_000, 165_000],
      [3, 60_000, 50_000, 150_000, 4_000, 30_000, 60_000, 90_000, 180_000],
      [5, 80_000, 50_000, 150_000, 6_000, 33_000, 65_000, 98_000, 195_000],
      [6, 100_000, 50_000, 150_000, 6_000, 35_000, 75_000, 105_000, 210_000],
      [7, 120_000, 50_000, 150_000, 8_000, 38_000, 75_000, 113_000, 225_000],
      [9, 140_000, 100_000, 250_000, 10_000, 70_000, 140_000, 210_000, 385_000],
      [
        10, 140_000, 100_000, 250_000, 10_000, 75_000, 150_000, 225_000,
        413_000,
      ],
      [
        11, 160_000, 100_000, 250_000, 12_000, 80_000, 160_000, 240_000,
        440_000,
      ],
      [
        13, 180_000, 100_000, 250_000, 14_000, 85_000, 170_000, 255_000,
        468_000,
      ],
      [
        15, 200_000, 100_000, 250_000, 16_000, 90_000, 180_000, 270_000,
        495_000,
      ],
      [
        17, 200_000, 150_000, 375_000, 18_000, 113_000, 225_000, 338_000,
        619_000,
      ],
      [
        19, 240_000, 150_000, 375_000, 20_000, 120_000, 240_000, 360_000,
        660_000,
      ],
      [
        21, 260_000, 150_000, 375_000, 22_000, 128_000, 255_000, 383_000,
        701_000,
      ],
      [
        22, 270_000, 150_000, 375_000, 22_000, 135_000, 270_000, 405_000,
        743_000,
      ],
      [
        23, 280_000, 150_000, 375_000, 24_000, 143_000, 285_000, 428_000,
        784_000,
      ],
      [
        26, 300_000, 200_000, 500_000, 26_000, 170_000, 340_000, 510_000,
        935_000,
      ],
      [
        27, 320_000, 200_000, 500_000, 28_000, 180_000, 360_000, 540_000,
        990_000,
      ],
      [
        29, 350_000, 200_000, 500_000, 35_000, 190_000, 380_000, 570_000,
        1_045_000,
      ],
      [
        31, 400_000, 200_000, 500_000, 50_000, 200_000, 400_000, 600_000,
        1_100_000,
      ],
    ]);
  });
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
            Number.isSafeInteger(
              getTileBuildCost(tile, level.level, rule, "country"),
            ),
          ).toBe(true);
          expect(
            Number.isSafeInteger(
              getTileBaseRent(tile, level.level, rule, "country"),
            ),
          ).toBe(true);
          const investment = getTileInvestedValue(
            tile,
            level.level,
            rule,
            "country",
          );
          expect(investment).toBe(
            previousInvestment +
              getTileBuildCost(tile, level.level, rule, "country"),
          );
          previousInvestment = investment;
        }
      }
    expect(() => getTileLandPrice(0, "reference")).toThrow("not a city");
    expect(() => getTileBaseRent(1, 5, "reference")).toThrow("no Landmark");
    expect(getResortRent(1, "prototype")).toBe(50_000);
    expect(getResortRent(3, "prototype")).toBe(200_000);
    expect(
      ([1, 2, 3, 4] as const).map((owned) => getResortRent(owned, "reference")),
    ).toEqual([25_000, 50_000, 100_000, 200_000]);
  });

  it("takes the reference rents and three-house totals, rising side by side", () => {
    const threeHouses = (tile: number) =>
      getTileInvestedValue(tile, 3, "reference");
    // Captured totals: first city 210 k, 13th city 690 k, Tokyo 1 M.
    expect([1, 19, 31].map(threeHouses)).toEqual([210_000, 690_000, 1_000_000]);
    expect(
      [1, 19, 31].map((tile) => getTileLandPrice(tile, "reference")),
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
