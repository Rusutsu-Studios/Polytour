import { BOARD, ECONOMY, getTileLandPrice } from "../../shared/board/index.js";
import type { Seat } from "../../shared/engine/index.js";

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
export const TILE_NAMES = [
  "Grand départ",
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
  "Festival",
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
  "Taxe locale",
  "Osaka",
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
export function tilePrice(index: number) {
  const tile = BOARD[index];
  return tile.kind === "city"
    ? getTileLandPrice(tile.index)
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
export function money(value: number) {
  if (Math.abs(value) >= 1_000_000)
    return `${new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 2 }).format(value / 1_000_000)} M`;
  if (Math.abs(value) >= 1000)
    return `${new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 1 }).format(value / 1000)} k`;
  return new Intl.NumberFormat("fr-CH").format(value);
}
