import type { BuildLevel } from "./types.js";

/** Captured endpoints are exact; intermediate prices/rents are provisional tuning.
 * Costs are absolute per tile, never a guessed house-to-land ratio. */
export const CITY_ECONOMY = [
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
] as const;
const city = (tile: number) => {
  const config = CITY_ECONOMY.find((config) => config.tile === tile);
  if (!config) throw new RangeError(`Tile ${tile} is not a city`);
  return config;
};
export function getTileLandPrice(tile: number): number {
  return city(tile).land;
}
export function getTileBuildCost(tile: number, level: BuildLevel): number {
  const config = city(tile);
  return level === 0
    ? config.land
    : level < 4
      ? config.house
      : level === 4
        ? config.hotel
        : Math.ceil((config.hotel * 3) / 2);
}
export function getTileInvestedValue(tile: number, level: BuildLevel): number {
  let total = 0;
  for (let current = 0; current <= level; current++)
    total += getTileBuildCost(tile, current as BuildLevel);
  return total;
}
const RENT_PERCENT = [20, 60, 100, 140, 280, 400] as const;
export function getTileBaseRent(tile: number, level: BuildLevel): number {
  return Math.ceil((city(tile).land * RENT_PERCENT[level]) / 100);
}
