import {
  ECONOMY,
  getBoard,
  getTileLandPrice,
} from "../../shared/board/index.js";
import {
  boardRule,
  economyRule,
  type GameConfig,
  type PublicState,
  type Seat,
} from "../../shared/engine/index.js";
import { getLocale, translate } from "../i18n.js";

export const PLAYER_COLORS = [
  "#be3d24",
  "#236cce",
  "#8151b5",
  "#26764c",
] as const;
export const PLAYER_LABELS = ["Corail", "Océan", "Lavande", "Forêt"] as const;
// Six vivid hues spread around the wheel and two muted concrete tones, so
// groups stay apart even as the light tints printed on the board. Look-alike
// pairs (orange and yellow, blue and teal) sit on different sides, yellow
// stays away from the sand of the beaches, and the two concrete regions
// (slate lavender, warm taupe) never read as Japan's pink.
export const REGION_COLORS = {
  A: "#5b8fd9",
  B: "#ec8a3c",
  C: "#5fb56c",
  D: "#8a84ad",
  E: "#a9876f",
  F: "#e6c033",
  G: "#3fb5ad",
  H: "#dc72bd",
} as const;
// One country per colour group, from France to Japan; resorts sit between.
export const TILE_NAMES = [
  "Départ",
  "Lyon",
  "Marseille",
  "Paris",
  "Seychelles",
  "Naples",
  "Milan",
  "Rome",
  "Île paisible",
  "Faro",
  "Porto",
  "Lisbonne",
  "Surprise",
  "Hambourg",
  "Maldives",
  "Berlin",
  "Championnat",
  "Genève",
  "Bora Bora",
  "Zurich",
  "Surprise",
  "Chicago",
  "Los Angeles",
  "New York",
  "Tour du monde",
  "Hawaï",
  "Busan",
  "Séoul",
  "Surprise",
  "Osaka",
  "Impôts",
  "Tokyo",
] as const;
export const LEVEL_NAMES = [
  "Terrain",
  "1 maison",
  "2 maisons",
  "3 maisons",
  "Hôtel",
  "Monument",
] as const;
const ENGLISH_TILE_NAMES = [
  "Start",
  "Lyon",
  "Marseille",
  "Paris",
  "Seychelles",
  "Naples",
  "Milan",
  "Rome",
  "Island",
  "Faro",
  "Porto",
  "Lisbon",
  "Chance",
  "Hamburg",
  "Maldives",
  "Berlin",
  "Championship",
  "Geneva",
  "Bora Bora",
  "Zurich",
  "Chance",
  "Chicago",
  "Los Angeles",
  "New York",
  "World tour",
  "Hawaii",
  "Busan",
  "Seoul",
  "Chance",
  "Osaka",
  "Taxes",
  "Tokyo",
] as const;
const ENGLISH_LEVEL_NAMES = [
  "Land",
  "1 house",
  "2 houses",
  "3 houses",
  "Hotel",
  "Landmark",
] as const;
const LEGACY_TILE_NAMES = [
  "Départ",
  "Roubaix",
  "Saint-Étienne",
  "Surprise",
  "Grenade",
  "Côte d’Azur",
  "Valence",
  "Séville",
  "Île paisible",
  "Porto",
  "Lisbonne",
  "Rome",
  "Chypre",
  "Milan",
  "Surprise",
  "Berlin",
  "Championnat",
  "Prague",
  "Vienne",
  "Surprise",
  "Londres",
  "Dubaï",
  "Montréal",
  "New York",
  "Grand voyage",
  "Sydney",
  "Singapour",
  "Séoul",
  "Bali",
  "Impôts",
  "Osaka",
  "Tokyo",
] as const;
const LEGACY_ENGLISH_TILE_NAMES = [
  "Start",
  "Roubaix",
  "Saint-Étienne",
  "Chance",
  "Granada",
  "French Riviera",
  "Valencia",
  "Seville",
  "Island",
  "Porto",
  "Lisbon",
  "Rome",
  "Cyprus",
  "Milan",
  "Chance",
  "Berlin",
  "Championship",
  "Prague",
  "Vienna",
  "Chance",
  "London",
  "Dubai",
  "Montréal",
  "New York",
  "World tour",
  "Sydney",
  "Singapore",
  "Seoul",
  "Bali",
  "Taxes",
  "Osaka",
  "Tokyo",
] as const;
type BoardConfig = Pick<GameConfig, "boardRule">;
export function tileName(index: number, config?: BoardConfig): string {
  const legacy = config !== undefined && boardRule(config) === "legacy";
  return translate(
    (legacy ? LEGACY_TILE_NAMES : TILE_NAMES)[index] ?? "",
    (legacy ? LEGACY_ENGLISH_TILE_NAMES : ENGLISH_TILE_NAMES)[index] ?? "",
  );
}
export function levelName(level: number): string {
  return translate(LEVEL_NAMES[level] ?? "", ENGLISH_LEVEL_NAMES[level] ?? "");
}
export const TILE_ICONS: Record<string, string> = {
  start: "↗",
  island: "☀",
  championship: "★",
  "world-tour": "✈",
  chance: "?",
  tax: "¤",
  resort: "☂",
  city: "⌂",
};
export function tileColor(index: number, config?: BoardConfig) {
  const tile = getBoard(config)[index];
  return tile.kind === "city"
    ? REGION_COLORS[tile.country]
    : tile.kind === "resort"
      ? "#52aab8"
      : tile.kind === "chance"
        ? "#e7b24c"
        : "#78bda7";
}
/** Land price under the match's frozen rules; new rooms use the reference grid. */
export function tilePrice(
  index: number,
  state: Pick<PublicState, "config"> | null = null,
) {
  const tile = getBoard(state?.config)[index];
  return tile.kind === "city"
    ? getTileLandPrice(
        tile.index,
        state ? economyRule(state.config) : "reference",
        state ? boardRule(state.config) : "country",
      )
    : tile.kind === "resort"
      ? ECONOMY.resortPrice
      : null;
}
export function tilePosition(index: number): [number, number] {
  const step = 1.08;
  if (index <= 8) return [(index - 4) * step, 4 * step];
  if (index <= 16) return [4 * step, (12 - index) * step];
  if (index <= 24) return [(20 - index) * step, -4 * step];
  return [-4 * step, (index - 28) * step];
}
export function pawnOffset(seat: Seat): [number, number] {
  return [seat % 2 === 0 ? -0.19 : 0.19, seat < 2 ? -0.18 : 0.18];
}
/** Exact amount with grouped digits (1 800 000), for balances players track. */
export function fullMoney(value: number) {
  return new Intl.NumberFormat(getLocale() === "fr" ? "fr-FR" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(value);
}
export function money(value: number) {
  const locale = getLocale() === "fr" ? "fr-CH" : "en-GB";
  if (Math.abs(value) >= 1_000_000)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1_000_000)} M`;
  if (Math.abs(value) >= 1000)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1000)} k`;
  return new Intl.NumberFormat(locale).format(value);
}
