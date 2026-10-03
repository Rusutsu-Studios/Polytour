export const COUNTRY_IDS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export type CountryId = (typeof COUNTRY_IDS)[number];
export type BoardSide = 1 | 2 | 3 | 4;
export type BuildLevel = 0 | 1 | 2 | 3 | 4 | 5;
/**
 * Frozen economy of a match. "reference" (rules version 4) follows the
 * reference game's grid and fees; "prototype" (rules versions 2–3, and saves
 * without a marker) keeps the original Polytour economy and its Landmark.
 */
export type EconomyRule = "reference" | "prototype";
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
  | { readonly kind: "chance"; readonly index: 12 | 20 | 28 }
  | { readonly kind: "tax"; readonly index: 30 };

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
