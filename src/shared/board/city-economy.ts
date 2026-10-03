import { BOARD, isCityTile } from "./board.js";
import type { BoardRule, BuildLevel, EconomyRule } from "./types.js";

type CityConfig = {
  readonly tile: number;
  readonly land: number;
  readonly house: number;
  readonly hotel: number;
};
type ReferenceCityConfig = CityConfig & {
  /** Rent for Land, House I, House II, House III and Hotel. */
  readonly rent: readonly [number, number, number, number, number];
};

/** Prototype rooms (rules versions 2–3). Captured endpoints are exact;
 * intermediate prices/rents are provisional tuning. Costs are absolute per
 * tile, never a guessed house-to-land ratio. */
export const CITY_ECONOMY = [
  { tile: 1, land: 60_000, house: 50_000, hotel: 150_000 },
  { tile: 2, land: 70_000, house: 50_000, hotel: 150_000 },
  { tile: 3, land: 90_000, house: 60_000, hotel: 180_000 },
  { tile: 5, land: 100_000, house: 60_000, hotel: 180_000 },
  { tile: 6, land: 110_000, house: 70_000, hotel: 200_000 },
  { tile: 7, land: 120_000, house: 80_000, hotel: 220_000 },
  { tile: 9, land: 130_000, house: 80_000, hotel: 220_000 },
  { tile: 10, land: 140_000, house: 90_000, hotel: 250_000 },
  { tile: 11, land: 150_000, house: 100_000, hotel: 280_000 },
  { tile: 13, land: 170_000, house: 100_000, hotel: 280_000 },
  { tile: 15, land: 180_000, house: 110_000, hotel: 300_000 },
  { tile: 17, land: 190_000, house: 120_000, hotel: 320_000 },
  { tile: 19, land: 200_000, house: 120_000, hotel: 320_000 },
  { tile: 21, land: 210_000, house: 130_000, hotel: 350_000 },
  { tile: 22, land: 230_000, house: 140_000, hotel: 370_000 },
  { tile: 23, land: 250_000, house: 150_000, hotel: 400_000 },
  { tile: 26, land: 280_000, house: 160_000, hotel: 420_000 },
  { tile: 27, land: 300_000, house: 170_000, hotel: 450_000 },
  { tile: 29, land: 350_000, house: 180_000, hotel: 480_000 },
  { tile: 31, land: 400_000, house: 200_000, hotel: 500_000 },
] as const satisfies readonly CityConfig[];

/** Exact original production prices. Kept separate from the regrouped board. */
export const LEGACY_CITY_ECONOMY = [
  { tile: 1, land: 60_000, house: 50_000, hotel: 150_000 },
  { tile: 2, land: 70_000, house: 50_000, hotel: 150_000 },
  { tile: 4, land: 90_000, house: 60_000, hotel: 180_000 },
  { tile: 6, land: 100_000, house: 60_000, hotel: 180_000 },
  { tile: 7, land: 110_000, house: 70_000, hotel: 200_000 },
  { tile: 9, land: 120_000, house: 80_000, hotel: 220_000 },
  { tile: 10, land: 130_000, house: 80_000, hotel: 220_000 },
  { tile: 11, land: 140_000, house: 90_000, hotel: 250_000 },
  { tile: 13, land: 150_000, house: 100_000, hotel: 280_000 },
  { tile: 15, land: 170_000, house: 100_000, hotel: 280_000 },
  { tile: 17, land: 180_000, house: 110_000, hotel: 300_000 },
  { tile: 18, land: 190_000, house: 120_000, hotel: 320_000 },
  { tile: 20, land: 200_000, house: 120_000, hotel: 320_000 },
  { tile: 22, land: 210_000, house: 130_000, hotel: 350_000 },
  { tile: 23, land: 230_000, house: 140_000, hotel: 370_000 },
  { tile: 25, land: 250_000, house: 150_000, hotel: 400_000 },
  { tile: 26, land: 280_000, house: 160_000, hotel: 420_000 },
  { tile: 27, land: 300_000, house: 170_000, hotel: 450_000 },
  { tile: 30, land: 350_000, house: 180_000, hotel: 480_000 },
  { tile: 31, land: 400_000, house: 200_000, hotel: 500_000 },
] as const satisfies readonly CityConfig[];

/**
 * Reference rooms (rules version 4): the reference game's grid, laid side by
 * side on Polytour's board so each side keeps its price tier. Rents and
 * three-house totals are the reference values (see REFERENCE_PARITY.md); the
 * comment names the reference city each tile takes. A house costs 50/100/150/
 * 200 k on sides 1–4, which matches the three captured splits (first city,
 * 13th city's bare plot, Tokyo). Hotel costs, the totals marked "interpolated"
 * and tile 27 are interpolated between captured values.
 */
export const LEGACY_REFERENCE_CITY_ECONOMY = [
  // Side 1: Granada, Seville; Hong Kong (total interpolated), Beijing, Shanghai.
  {
    tile: 1,
    land: 60_000,
    house: 50_000,
    hotel: 150_000,
    rent: [2_000, 25_000, 50_000, 75_000, 150_000],
  },
  {
    tile: 2,
    land: 60_000,
    house: 50_000,
    hotel: 150_000,
    rent: [2_000, 28_000, 55_000, 83_000, 165_000],
  },
  {
    tile: 4,
    land: 80_000,
    house: 50_000,
    hotel: 150_000,
    rent: [6_000, 33_000, 65_000, 98_000, 195_000],
  },
  {
    tile: 6,
    land: 100_000,
    house: 50_000,
    hotel: 150_000,
    rent: [6_000, 35_000, 75_000, 105_000, 210_000],
  },
  {
    tile: 7,
    land: 120_000,
    house: 50_000,
    hotel: 150_000,
    rent: [8_000, 38_000, 75_000, 113_000, 225_000],
  },
  // Side 2: Venice, Milan, Rome; Hamburg, Berlin.
  {
    tile: 9,
    land: 140_000,
    house: 100_000,
    hotel: 250_000,
    rent: [10_000, 70_000, 140_000, 210_000, 385_000],
  },
  {
    tile: 10,
    land: 140_000,
    house: 100_000,
    hotel: 250_000,
    rent: [10_000, 75_000, 150_000, 225_000, 413_000],
  },
  {
    tile: 11,
    land: 160_000,
    house: 100_000,
    hotel: 250_000,
    rent: [12_000, 80_000, 160_000, 240_000, 440_000],
  },
  {
    tile: 13,
    land: 180_000,
    house: 100_000,
    hotel: 250_000,
    rent: [14_000, 85_000, 170_000, 255_000, 468_000],
  },
  {
    tile: 15,
    land: 200_000,
    house: 100_000,
    hotel: 250_000,
    rent: [16_000, 90_000, 180_000, 270_000, 495_000],
  },
  // Side 3: London (total interpolated), Sydney, Chicago; Las Vegas
  // (total interpolated), New York.
  {
    tile: 17,
    land: 200_000,
    house: 150_000,
    hotel: 375_000,
    rent: [18_000, 113_000, 225_000, 338_000, 619_000],
  },
  {
    tile: 18,
    land: 240_000,
    house: 150_000,
    hotel: 375_000,
    rent: [20_000, 120_000, 240_000, 360_000, 660_000],
  },
  {
    tile: 20,
    land: 260_000,
    house: 150_000,
    hotel: 375_000,
    rent: [22_000, 128_000, 255_000, 383_000, 701_000],
  },
  {
    tile: 22,
    land: 270_000,
    house: 150_000,
    hotel: 375_000,
    rent: [22_000, 135_000, 270_000, 405_000, 743_000],
  },
  {
    tile: 23,
    land: 280_000,
    house: 150_000,
    hotel: 375_000,
    rent: [24_000, 143_000, 285_000, 428_000, 784_000],
  },
  // Side 4: Lyon, Paris (total interpolated), an interpolated city; Osaka, Tokyo.
  {
    tile: 25,
    land: 300_000,
    house: 200_000,
    hotel: 500_000,
    rent: [26_000, 170_000, 340_000, 510_000, 935_000],
  },
  {
    tile: 26,
    land: 320_000,
    house: 200_000,
    hotel: 500_000,
    rent: [28_000, 180_000, 360_000, 540_000, 990_000],
  },
  {
    tile: 27,
    land: 340_000,
    house: 200_000,
    hotel: 500_000,
    rent: [30_000, 185_000, 370_000, 555_000, 1_018_000],
  },
  {
    tile: 30,
    land: 350_000,
    house: 200_000,
    hotel: 500_000,
    rent: [35_000, 190_000, 380_000, 570_000, 1_045_000],
  },
  {
    tile: 31,
    land: 400_000,
    house: 200_000,
    hotel: 500_000,
    rent: [50_000, 200_000, 400_000, 600_000, 1_100_000],
  },
] as const satisfies readonly ReferenceCityConfig[];

/**
 * Reference rows retain their order, land price and rent on the new tour.
 * Construction prices follow the destination side's 50/100/150/200k tier;
 * hotels follow that side too. Every city gets exactly one complete row.
 */
const countryReferenceRows: readonly ReferenceCityConfig[] = [
  ...LEGACY_REFERENCE_CITY_ECONOMY.slice(0, 2),
  {
    tile: 3,
    land: 60_000,
    house: 50_000,
    hotel: 150_000,
    rent: [4_000, 30_000, 60_000, 90_000, 180_000],
  },
  ...LEGACY_REFERENCE_CITY_ECONOMY.slice(2, 17),
  ...LEGACY_REFERENCE_CITY_ECONOMY.slice(18),
];
export const REFERENCE_CITY_ECONOMY: readonly ReferenceCityConfig[] =
  BOARD.filter(isCityTile).map((tile, index) => ({
    ...countryReferenceRows[index],
    tile: tile.index,
    house: [50_000, 100_000, 150_000, 200_000][tile.side - 1],
    hotel: [150_000, 250_000, 375_000, 500_000][tile.side - 1],
  }));

function defaultBoard(rule: EconomyRule): BoardRule {
  return rule === "reference" ? "country" : "legacy";
}
function city(tile: number, rule: EconomyRule, board: BoardRule): CityConfig {
  const table =
    rule === "reference"
      ? board === "legacy"
        ? LEGACY_REFERENCE_CITY_ECONOMY
        : REFERENCE_CITY_ECONOMY
      : board === "legacy"
        ? LEGACY_CITY_ECONOMY
        : CITY_ECONOMY;
  const config = table.find((config) => config.tile === tile);
  if (!config) throw new RangeError(`Tile ${tile} is not a city`);
  return config;
}
function referenceCity(tile: number, board: BoardRule): ReferenceCityConfig {
  const table =
    board === "legacy" ? LEGACY_REFERENCE_CITY_ECONOMY : REFERENCE_CITY_ECONOMY;
  const config = table.find((config) => config.tile === tile);
  if (!config) throw new RangeError(`Tile ${tile} is not a city`);
  return config;
}
function assertLevel(level: BuildLevel, rule: EconomyRule): void {
  if (rule === "reference" && level === 5)
    throw new RangeError("Reference rules have no Landmark level");
}

export function getTileLandPrice(
  tile: number,
  rule: EconomyRule,
  board: BoardRule = defaultBoard(rule),
): number {
  return city(tile, rule, board).land;
}
export function getTileBuildCost(
  tile: number,
  level: BuildLevel,
  rule: EconomyRule,
  board: BoardRule = defaultBoard(rule),
): number {
  assertLevel(level, rule);
  const config = city(tile, rule, board);
  return level === 0
    ? config.land
    : level < 4
      ? config.house
      : level === 4
        ? config.hotel
        : Math.ceil((config.hotel * 3) / 2);
}
export function getTileInvestedValue(
  tile: number,
  level: BuildLevel,
  rule: EconomyRule,
  board: BoardRule = defaultBoard(rule),
): number {
  let total = 0;
  for (let current = 0; current <= level; current++)
    total += getTileBuildCost(tile, current as BuildLevel, rule, board);
  return total;
}
const RENT_PERCENT = [20, 60, 100, 140, 280, 400] as const;
export function getTileBaseRent(
  tile: number,
  level: BuildLevel,
  rule: EconomyRule,
  board: BoardRule = defaultBoard(rule),
): number {
  assertLevel(level, rule);
  if (rule === "prototype")
    return Math.ceil(
      (city(tile, rule, board).land * RENT_PERCENT[level]) / 100,
    );
  const rent = referenceCity(tile, board).rent.at(level);
  if (rent === undefined) throw new RangeError(`No rent for level ${level}`);
  return rent;
}
