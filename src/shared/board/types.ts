export const COUNTRY_IDS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export type CountryId = (typeof COUNTRY_IDS)[number];
export type BoardSide = 1 | 2 | 3 | 4;
export type BuildLevel = 0 | 1 | 2 | 3 | 4 | 5;
/** Frozen layout of a match; old saves without a marker use "legacy". */
export type BoardRule = "country" | "legacy";
/**
 * Frozen economy of a match. "reference" (rules version 4) follows the
 * reference game's grid and fees; "prototype" (rules versions 2–3, and saves
 * without a marker) keeps the original Polytour economy and its Landmark.
 */
export type EconomyRule = "reference" | "prototype";
/**
 * Frozen World Tour destinations of a reference match. "free-and-own" (rules
 * version 6) reaches unowned properties and the traveller's own; "free-first"
 * (versions 4–5, and saves without a marker) reaches the traveller's own only
 * when none is free. Prototype matches fly to any other tile either way.
 */
export type WorldTourRule = "free-and-own" | "free-first";
/**
 * Frozen Chance deck of a match. "reworked" (rules version 10) adds eight cards
 * and duplicate bad cards so half the draws are bad, rolls a die for Detour and
 * Tailwind and sends Audit to the tax square. "original" (and saves without a
 * marker) keeps single cards, a 3-step Detour and a 10% Audit; rules version 9
 * adds only the Escape card to it (`escapeCard`).
 */
export type ChanceRule = "reworked" | "original";
export type ResortId = 1 | 2 | 3 | 4;

export type CityTile = {
  readonly kind: "city";
  readonly index: number;
  readonly country: CountryId;
  readonly city: 1 | 2 | 3;
  readonly side: BoardSide;
};

export type ResortTile = {
  readonly kind: "resort";
  readonly index: number;
  readonly resort: ResortId;
  readonly side: BoardSide;
};

export type Tile =
  | CityTile
  | ResortTile
  | { readonly kind: "start"; readonly index: 0 }
  | { readonly kind: "island"; readonly index: 8 }
  | { readonly kind: "championship"; readonly index: 16 }
  | { readonly kind: "world-tour"; readonly index: 24 }
  | { readonly kind: "chance"; readonly index: 3 | 12 | 14 | 19 | 20 | 28 }
  | { readonly kind: "tax"; readonly index: 29 | 30 };

export type BuildLevelConfig = {
  readonly level: BuildLevel;
  readonly name:
    | "Land"
    | "House I"
    | "House II"
    | "House III"
    | "Hotel"
    | "Landmark";
};

export type CountryConfig = {
  readonly id: CountryId;
  readonly landPrice: number;
};
