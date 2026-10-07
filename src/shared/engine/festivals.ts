import type { CityTile, ResortTile } from "../board/index.js";
import { FESTIVAL_TUNING, isCityTile } from "../board/index.js";
import { nextRandom, shuffle } from "./rng.js";
import type { GameConfig } from "./types.js";

/** Seeded setup only: snapshots retain their already selected festival tiles. */
export function selectInitialFestivals(
  candidates: readonly (CityTile | ResortTile)[],
  count: number,
  seed: number,
  distribution: NonNullable<GameConfig["festivalDistribution"]>,
): { readonly items: readonly number[]; readonly state: number } {
  const shuffled = shuffle(candidates, seed);
  if (distribution === "random") {
    return {
      items: shuffled.items.slice(0, count).map((tile) => tile.index),
      state: shuffled.state,
    };
  }
  // Resorts have no country: each is a separate place for spreading purposes.
  const group = (tile: CityTile | ResortTile) =>
    isCityTile(tile) ? tile.country : `resort-${tile.index}`;
  const groups = new Set(shuffled.items.map(group));
  const chance = nextRandom(shuffled.state);
  let selected: (CityTile | ResortTile)[] = [];
  if (
    count >= 2 &&
    count <= groups.size &&
    chance.value * 100 <
      count * FESTIVAL_TUNING.repeatedCountryPercentPerFestival
  ) {
    selected = shuffled.items.slice(0, count);
    // The rare branch must actually repeat a country, not merely allow a repeat.
    // An already clustered prefix is retained, including rare three-city clusters.
    if (new Set(selected.map(group)).size === selected.length) {
      const city = selected.find(isCityTile) ?? shuffled.items.find(isCityTile);
      if (city) {
        const cityIndex = selected.indexOf(city);
        if (cityIndex >= 0)
          [selected[0], selected[cityIndex]] = [
            selected[cityIndex],
            selected[0],
          ];
        else selected[0] = city;
        const sibling = shuffled.items.find(
          (tile) =>
            isCityTile(tile) &&
            tile.country === city.country &&
            !selected.includes(tile),
        );
        if (sibling) selected[selected.length - 1] = sibling;
      }
    }
  } else {
    const used = new Set<string>();
    for (const tile of shuffled.items) {
      if (selected.length >= count) break;
      const key = group(tile);
      if (used.has(key)) continue;
      used.add(key);
      selected.push(tile);
    }
    // Larger custom counts cover every country before additional cities repeat.
    for (const tile of shuffled.items) {
      if (selected.length >= count) break;
      if (!selected.includes(tile)) selected.push(tile);
    }
  }
  return { items: selected.map((tile) => tile.index), state: chance.state };
}
