import type {
  BuildLevel,
  BuildLevelConfig,
  CountryConfig,
  CountryId,
} from "./types.js";

export const ECONOMY = {
  startingCash: 1500,
  startSalary: 200,
  minimumPlayers: 2,
  maximumPlayers: 4,
  roundLimit: 20,
  sellBackPercent: 50,
  buyoutMultiplier: 2,
  resortPrice: 200,
  taxPercent: 10,
  minimumTax: 50,
  islandReleaseFee: 100,
  islandMaxFailedEscapes: 2,
  doublesToIsland: 3,
  worldTourFee: 50,
} as const;

export const COUNTRIES = [
  { id: "A", landPrice: 60 },
  { id: "B", landPrice: 90 },
  { id: "C", landPrice: 120 },
  { id: "D", landPrice: 150 },
  { id: "E", landPrice: 180 },
  { id: "F", landPrice: 210 },
  { id: "G", landPrice: 240 },
  { id: "H", landPrice: 280 },
] as const satisfies readonly CountryConfig[];

export const BUILD_LEVELS = [
  { level: 0, name: "Land", buildCostPercent: 100, rentPercent: 20 },
  { level: 1, name: "House", buildCostPercent: 50, rentPercent: 60 },
  { level: 2, name: "Villa", buildCostPercent: 50, rentPercent: 140 },
  { level: 3, name: "Hotel", buildCostPercent: 100, rentPercent: 280 },
  { level: 4, name: "Landmark", buildCostPercent: 150, rentPercent: 400 },
] as const satisfies readonly BuildLevelConfig[];

export const RESORT_RENTS = {
  1: 50,
  2: 100,
  3: 200,
} as const;

const COUNTRY_BY_ID = new Map(
  COUNTRIES.map((country) => [country.id, country]),
);
const BUILD_LEVEL_BY_NUMBER = new Map(
  BUILD_LEVELS.map((level) => [level.level, level]),
);

function calculateExactPercent(base: number, percent: number): number {
  const amount = (base * percent) / 100;

  if (!Number.isInteger(amount)) {
    throw new Error(`Expected an integer amount for ${base} at ${percent}%`);
  }

  return amount;
}

function getCountry(country: CountryId): CountryConfig {
  const config = COUNTRY_BY_ID.get(country);

  if (!config) {
    throw new Error(`Unknown country: ${country}`);
  }

  return config;
}

function getBuildLevel(level: BuildLevel): BuildLevelConfig {
  const config = BUILD_LEVEL_BY_NUMBER.get(level);

  if (!config) {
    throw new Error(`Unknown build level: ${level}`);
  }

  return config;
}

export function getLandPrice(country: CountryId): number {
  return getCountry(country).landPrice;
}

export function getBuildCost(country: CountryId, level: BuildLevel): number {
  return calculateExactPercent(
    getLandPrice(country),
    getBuildLevel(level).buildCostPercent,
  );
}

export function getBaseRent(country: CountryId, level: BuildLevel): number {
  return calculateExactPercent(
    getLandPrice(country),
    getBuildLevel(level).rentPercent,
  );
}

export function getInvestedValue(
  country: CountryId,
  level: BuildLevel,
): number {
  let value = 0;

  for (const buildLevel of BUILD_LEVELS) {
    if (buildLevel.level > level) {
      break;
    }

    value += getBuildCost(country, buildLevel.level);
  }

  return value;
}

export function getResortRent(resortsOwned: 1 | 2 | 3): number {
  return RESORT_RENTS[resortsOwned];
}

export function roundCharge(amount: number): number {
  return Math.ceil(amount);
}

export function roundPayout(amount: number): number {
  return Math.floor(amount);
}
