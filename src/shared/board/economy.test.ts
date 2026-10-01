import { describe, expect, it } from "vitest";
import type { BuildLevel } from "./index.js";
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
  roundCharge,
  roundPayout,
} from "./index.js";

describe("economy configuration", () => {
  it("uses the captured lobby defaults and per-city absolute construction costs", () => {
    expect(ECONOMY).toMatchObject({
      startingCash: 2_000_000,
      startSalary: 400_000,
      minimumPlayers: 2,
      maximumPlayers: 4,
      sellBackPercent: 50,
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
    expect(getTileLandPrice(1)).toBe(60_000);
    expect(
      [1, 2, 3].map((level) => getTileBuildCost(1, level as BuildLevel)),
    ).toEqual([50_000, 50_000, 50_000]);
    expect(getTileBuildCost(1, 4)).toBe(150_000);
    expect(getTileLandPrice(31)).toBe(400_000);
    expect(
      [1, 2, 3].map((level) => getTileBuildCost(31, level as BuildLevel)),
    ).toEqual([200_000, 200_000, 200_000]);
    expect(getTileBuildCost(31, 4)).toBe(500_000);
    expect(getTileInvestedValue(31, 4)).toBe(1_500_000);
  });
  it("has exactly one configuration for every city and integer nonnegative amounts", () => {
    expect(CITY_ECONOMY.map((city) => city.tile)).toEqual(
      BOARD.filter(isCityTile).map((tile) => tile.index),
    );
    for (const city of CITY_ECONOMY) {
      let previousInvestment = 0;
      for (const level of BUILD_LEVELS) {
        expect(
          Number.isSafeInteger(getTileBuildCost(city.tile, level.level)),
        ).toBe(true);
        expect(
          Number.isSafeInteger(getTileBaseRent(city.tile, level.level)),
        ).toBe(true);
        const investment = getTileInvestedValue(city.tile, level.level);
        expect(investment).toBe(
          previousInvestment + getTileBuildCost(city.tile, level.level),
        );
        previousInvestment = investment;
      }
    }
    expect(() => getTileLandPrice(0)).toThrow("not a city");
    expect(getResortRent(1)).toBe(50_000);
    expect(getResortRent(3)).toBe(200_000);
  });
  it("rounds player charges up and payouts down", () => {
    expect(roundCharge(67.5)).toBe(68);
    expect(roundPayout(67.5)).toBe(67);
  });
});
