import type { CityTile, CountryId, ResortTile, Tile } from "./types.js";

export const BOARD_SIZE = 32;

export const BOARD: readonly Tile[] = [
  { kind: "start", index: 0 },
  { kind: "city", index: 1, country: "A", city: 1, side: 1 },
  { kind: "city", index: 2, country: "A", city: 2, side: 1 },
  { kind: "chance", index: 3 },
  { kind: "city", index: 4, country: "B", city: 1, side: 1 },
  { kind: "resort", index: 5, resort: 1, side: 1 },
  { kind: "city", index: 6, country: "B", city: 2, side: 1 },
  { kind: "city", index: 7, country: "B", city: 3, side: 1 },
  { kind: "island", index: 8 },
  { kind: "city", index: 9, country: "C", city: 1, side: 2 },
  { kind: "city", index: 10, country: "C", city: 2, side: 2 },
  { kind: "city", index: 11, country: "C", city: 3, side: 2 },
  { kind: "resort", index: 12, resort: 2, side: 2 },
  { kind: "city", index: 13, country: "D", city: 1, side: 2 },
  { kind: "chance", index: 14 },
  { kind: "city", index: 15, country: "D", city: 2, side: 2 },
  { kind: "championship", index: 16 },
  { kind: "city", index: 17, country: "E", city: 1, side: 3 },
  { kind: "city", index: 18, country: "E", city: 2, side: 3 },
  { kind: "chance", index: 19 },
  { kind: "city", index: 20, country: "E", city: 3, side: 3 },
  { kind: "resort", index: 21, resort: 3, side: 3 },
  { kind: "city", index: 22, country: "F", city: 1, side: 3 },
  { kind: "city", index: 23, country: "F", city: 2, side: 3 },
  { kind: "world-tour", index: 24 },
  { kind: "city", index: 25, country: "G", city: 1, side: 4 },
  { kind: "city", index: 26, country: "G", city: 2, side: 4 },
  { kind: "city", index: 27, country: "G", city: 3, side: 4 },
  { kind: "resort", index: 28, resort: 4, side: 4 },
  { kind: "tax", index: 29 },
  { kind: "city", index: 30, country: "H", city: 1, side: 4 },
  { kind: "city", index: 31, country: "H", city: 2, side: 4 },
] satisfies readonly Tile[];

function findTileIndex(kind: Tile["kind"]): number {
  const tile = BOARD.find((candidate) => candidate.kind === kind);

  if (!tile) {
    throw new Error(`The board has no ${kind} tile`);
  }

  return tile.index;
}

export const ISLAND_TILE_INDEX = findTileIndex("island");

export function getTile(index: number): Tile | undefined {
  return BOARD[index];
}

export function isCityTile(tile: Tile): tile is CityTile {
  return tile.kind === "city";
}

export function isResortTile(tile: Tile): tile is ResortTile {
  return tile.kind === "resort";
}

export function getCountryCityTiles(country: CountryId): readonly CityTile[] {
  return BOARD.filter(
    (tile): tile is CityTile => isCityTile(tile) && tile.country === country,
  );
}
