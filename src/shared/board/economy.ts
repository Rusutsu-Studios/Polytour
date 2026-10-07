import type { BuildLevel, BuildLevelConfig, EconomyRule } from "./types.js";

/** Values shared by every frozen rule set. */
export const ECONOMY = {
  startingCash: 2_000_000,
  startSalary: 400_000,
  minimumPlayers: 2,
  maximumPlayers: 4,
  roundLimit: 20,
  buyoutMultiplier: 2,
  resortPrice: 200_000,
  taxPercent: 10,
  /** Salary for a clockwise landing exactly on Start, as a percentage. */
  startLandingPercent: 150,
  doublesToIsland: 3,
  worldTourFee: 50_000,
} as const;

type RuleEconomy = {
  readonly sellBackPercent: 50 | 100;
  readonly minimumTax: number;
  readonly islandReleaseFee: number;
  /** Failed escape rolls after which the player is released on the spot. */
  readonly islandMaxFailedEscapes: number;
  /** Rent per resort with one to four owned; four counts from rules version 8. */
  readonly resortRents: {
    readonly 1: number;
    readonly 2: number;
    readonly 3: number;
    readonly 4: number;
  };
  /** Houses a player may own on one city before completing a first lap. */
  readonly firstLapHouseCap: BuildLevel;
  /** Highest build level: the Landmark exists only in prototype rooms. */
  readonly topLevel: BuildLevel;
  /** Buyout and Land Swap cannot take a city from this level up. */
  readonly protectedLevel: BuildLevel;
  /** "largest" applies one modifier; "additive" adds each modifier's bonus. */
  readonly rentModifiers: "largest" | "additive";
  readonly maxRentMultiplier: number;
  /** Paid to move the championship onto another city; hosting is optional when positive. */
  readonly championshipFee: number;
  readonly maxHostMultiplier: number;
  /**
   * The championship keeps rising when it moves to another city, and stays on
   * its tile through buyouts, swaps, sales and bankruptcies. Otherwise a move
   * restarts at ×2 and any ownership change clears it.
   */
  readonly championshipPersists: boolean;
  /** Festivals can be drawn on resorts as well as cities. */
  readonly resortFestivals: boolean;
  /** World Tour flies only to properties; WorldTourRule decides when own ones count. */
  readonly travelToFreeProperties: boolean;
};

/** Values that differ between the frozen rule sets; see EconomyRule. */
export const RULE_ECONOMY = {
  prototype: {
    sellBackPercent: 50,
    minimumTax: 50_000,
    islandReleaseFee: 100_000,
    islandMaxFailedEscapes: 2,
    resortRents: { 1: 50_000, 2: 100_000, 3: 200_000, 4: 200_000 },
    firstLapHouseCap: 3,
    topLevel: 5,
    protectedLevel: 5,
    rentModifiers: "largest",
    maxRentMultiplier: 5,
    championshipFee: 0,
    maxHostMultiplier: 5,
    championshipPersists: false,
    resortFestivals: false,
    travelToFreeProperties: false,
  },
  reference: {
    sellBackPercent: 100,
    minimumTax: 0,
    islandReleaseFee: 200_000,
    islandMaxFailedEscapes: 3,
    resortRents: { 1: 25_000, 2: 50_000, 3: 100_000, 4: 200_000 },
    firstLapHouseCap: 2,
    topLevel: 4,
    protectedLevel: 4,
    rentModifiers: "additive",
    maxRentMultiplier: 10,
    championshipFee: 50_000,
    maxHostMultiplier: 10,
    championshipPersists: true,
    resortFestivals: true,
    travelToFreeProperties: true,
  },
} as const satisfies Record<EconomyRule, RuleEconomy>;

export function ruleEconomy(rule: EconomyRule): RuleEconomy {
  return RULE_ECONOMY[rule];
}

/** Labels only: absolute per-city costs/rents live in city-economy.ts. */
export const BUILD_LEVELS = [
  { level: 0, name: "Land" },
  { level: 1, name: "House I" },
  { level: 2, name: "House II" },
  { level: 3, name: "House III" },
  { level: 4, name: "Hotel" },
  { level: 5, name: "Landmark" },
] as const satisfies readonly BuildLevelConfig[];

export function getResortRent(
  resortsOwned: 1 | 2 | 3 | 4,
  rule: EconomyRule,
): number {
  return RULE_ECONOMY[rule].resortRents[resortsOwned];
}
/**
 * Salary for a clockwise landing exactly on Start. Every other crossing pays the
 * flat salary; this is a payout, so the percentage rounds down.
 */
export function startLandingSalary(startSalary: number): number {
  return roundPayout((startSalary * ECONOMY.startLandingPercent) / 100);
}
export function roundCharge(amount: number): number {
  return Math.ceil(amount);
}
export function roundPayout(amount: number): number {
  return Math.floor(amount);
}
