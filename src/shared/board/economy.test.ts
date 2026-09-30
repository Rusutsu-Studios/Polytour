import { describe, expect, it } from "vitest";

import {
  BUILD_LEVELS,
  COUNTRIES,
  ECONOMY,
  getBaseRent,
  getBuildCost,
  getInvestedValue,
  getResortRent,
  RESORT_RENTS,
  roundCharge,
  roundPayout,
} from "./index.js";

describe("economy configuration", () => {
  it("matches the documented starting economy", () => {
    expect(ECONOMY).toMatchObject({
      startingCash: 1500,
      startSalary: 200,
      minimumPlayers: 2,
      maximumPlayers: 4,
      roundLimit: 20,
      sellBackPercent: 50,
      buyoutMultiplier: 2,
      resortPrice: 200,
    });
    expect(COUNTRIES.map((country) => country.landPrice)).toEqual([
      60, 90, 120, 150, 180, 210, 240, 280,
    ]);
    expect(BUILD_LEVELS.map((level) => level.buildCostPercent)).toEqual([
      100, 50, 50, 100, 150,
    ]);
    expect(BUILD_LEVELS.map((level) => level.rentPercent)).toEqual([
      20, 60, 140, 280, 400,
    ]);
    expect(RESORT_RENTS).toEqual({ 1: 50, 2: 100, 3: 200 });
  });

  it("uses integer percentage arithmetic for costs, rents, and investment", () => {
    expect(getBuildCost("B", 4)).toBe(135);
    expect(getBaseRent("B", 2)).toBe(126);
    expect(getInvestedValue("B", 0)).toBe(90);
    expect(getInvestedValue("B", 2)).toBe(180);
    expect(getInvestedValue("B", 4)).toBe(405);
    expect(getResortRent(1)).toBe(50);
    expect(getResortRent(3)).toBe(200);
  });

  it("rounds player charges up and payouts down", () => {
    expect(roundCharge(67.5)).toBe(68);
    expect(roundPayout(67.5)).toBe(67);
  });
});
