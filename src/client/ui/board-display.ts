import { BOARD, ECONOMY, getTileLandPrice } from "../../shared/board/index.js";
import {
  economyRule,
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
export const PLAYER_SYMBOLS = ["●", "◆", "▲", "■"] as const;
export const PLAYER_LABELS = ["Corail", "Océan", "Lavande", "Forêt"] as const;
export const REGION_COLORS = {
  A: "#74b987",
  B: "#e7a544",
  C: "#63b4c7",
  D: "#b990ca",
  E: "#e57c75",
  F: "#a9b94d",
  G: "#619dc7",
  H: "#da9b64",
} as const;
// One country per colour group, from France to Japan; resorts sit between.
export const TILE_NAMES = [
  "Grand départ",
  "Roubaix",
  "Saint-Étienne",
  "Le Havre",
  "Côte d’Azur",
  "Grenade",
  "Valence",
  "Séville",
  "Île paisible",
  "Faro",
  "Porto",
  "Lisbonne",
  "Surprise",
  "Milan",
  "Surprise",
  "Berlin",
  "Championnat",
  "Prague",
  "Vienne",
  "Surprise",
  "Londres",
  "Dubaï",
  "Londres",
  "Surprise",
  "Chicago",
  "Los Angeles",
  "New York",
  "Tour du monde",
  "Bali",
  "Busan",
  "Séoul",
  "Surprise",
  "Osaka",
  "Taxe locale",
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
  "Roubaix",
  "Saint-Étienne",
  "Le Havre",
  "French Riviera",
  "Granada",
  "Valencia",
  "Seville",
  "Island",
  "Faro",
  "Porto",
  "Lisbon",
  "Chance",
  "Milan",
  "Chance",
  "Berlin",
  "Championship",
  "Prague",
  "Vienna",
  "Chance",
  "London",
  "Dubai",
  "London",
  "Chance",
  "Chicago",
  "Los Angeles",
  "New York",
  "World tour",
  "Bali",
  "Busan",
  "Seoul",
  "Chance",
  "Osaka",
  "Local tax",
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
export function tileName(index: number): string {
  return translate(TILE_NAMES[index] ?? "", ENGLISH_TILE_NAMES[index] ?? "");
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
export function tileColor(index: number) {
  const tile = BOARD[index];
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
  const tile = BOARD[index];
  return tile.kind === "city"
    ? getTileLandPrice(
        tile.index,
        state ? economyRule(state.config) : "reference",
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
