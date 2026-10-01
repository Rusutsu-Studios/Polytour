import type { BuildLevelConfig } from "./types.js";

export const ECONOMY = {
  startingCash: 2_000_000,
  startSalary: 400_000,
  minimumPlayers: 2,
  maximumPlayers: 4,
  roundLimit: 20,
  sellBackPercent: 50,
  buyoutMultiplier: 2,
  resortPrice: 200_000,
  taxPercent: 10,
  minimumTax: 50_000,
  islandReleaseFee: 100_000,
  islandMaxFailedEscapes: 2,
  doublesToIsland: 3,
  worldTourFee: 50_000,
} as const;
/** Labels only: absolute per-city costs/rents live in city-economy.ts. */
export const BUILD_LEVELS = [
  { level: 0, name: "Land" },
  { level: 1, name: "House I" },
  { level: 2, name: "House II" },
  { level: 3, name: "House III" },
  { level: 4, name: "Hotel" },
  { level: 5, name: "Landmark" },
] as const satisfies readonly BuildLevelConfig[];
export const RESORT_RENTS = { 1: 50_000, 2: 100_000, 3: 200_000 } as const;
export function getResortRent(resortsOwned: 1 | 2 | 3): number {
  return RESORT_RENTS[resortsOwned];
}
export function roundCharge(amount: number): number {
  return Math.ceil(amount);
}
export function roundPayout(amount: number): number {
  return Math.floor(amount);
}
