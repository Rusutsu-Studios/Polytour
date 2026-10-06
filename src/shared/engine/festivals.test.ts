import { describe, expect, it } from "vitest";
import type { CityTile, ResortTile } from "../board/index.js";
import {
  COUNTRY_IDS,
  FESTIVAL_TUNING,
  getBoard,
  isCityTile,
  isResortTile,
} from "../board/index.js";
import { selectInitialFestivals } from "./festivals.js";
import { nextRandom, shuffle } from "./rng.js";

const group = (tile: CityTile | ResortTile) =>
  isCityTile(tile) ? tile.country : `resort-${tile.index}`;
const configurations = [
  { board: "country", resorts: false },
  { board: "country", resorts: true },
  { board: "legacy", resorts: false },
  { board: "legacy", resorts: true },
] as const;
function eligible(config: (typeof configurations)[number]) {
  return getBoard(config.board).filter(
    (tile): tile is CityTile | ResortTile =>
      isCityTile(tile) || (config.resorts && isResortTile(tile)),
  );
}

describe("initial festival distribution", () => {
  it.each(configurations)(
    "preserves the exact original random tiles and RNG on $board (resorts=$resorts)",
    (config) => {
      const candidates = eligible(config);
      for (let count = 0; count <= 20; count += 1) {
        for (let seed = 0; seed < 100; seed += 1) {
          const old = shuffle(
            candidates.map((tile) => tile.index),
            seed,
          );
          expect(
            selectInitialFestivals(candidates, count, seed, "random"),
          ).toEqual({
            items: old.items.slice(0, count),
            state: old.state,
          });
        }
      }
    },
  );
  it.each(configurations)(
    "keeps unique eligible tiles and exact counts 0-20 on $board (resorts=$resorts)",
    (config) => {
      const candidates = eligible(config);
      const groups = new Set(candidates.map(group));
      for (let count = 0; count <= 20; count += 1) {
        for (let seed = 0; seed < 100; seed += 1) {
          const result = selectInitialFestivals(
            candidates,
            count,
            seed,
            "spread",
          );
          expect(result).toEqual(
            selectInitialFestivals(candidates, count, seed, "spread"),
          );
          expect(result.items).toHaveLength(count);
          expect(new Set(result.items).size).toBe(count);
          const selected = result.items.map((index) =>
            candidates.find((tile) => tile.index === index),
          );
          expect(selected.every((tile) => tile !== undefined)).toBe(true);
          const selectedGroups = selected.map((tile) => {
            if (!tile) throw new Error("Ineligible tile");
            return group(tile);
          });
          const roll = nextRandom(shuffle(candidates, seed).state);
          const rare =
            roll.value * 100 <
            count * FESTIVAL_TUNING.repeatedCountryPercentPerFestival;
          if (count >= 2 && count <= groups.size) {
            expect(new Set(selectedGroups).size < count).toBe(rare);
          }
          if (count > groups.size) {
            expect(new Set(selectedGroups.slice(0, groups.size)).size).toBe(
              groups.size,
            );
          }
        }
      }
    },
  );
  it("makes actual repeated-country outcomes about 3% for three festivals, while retaining rare triples", () => {
    const candidates = eligible(configurations[0]);
    let repeated = 0;
    let triples = 0;
    const runs = 100_000;
    for (let seed = 0; seed < runs; seed += 1) {
      const result = selectInitialFestivals(candidates, 3, seed, "spread");
      const countries = result.items.map((index) => {
        const tile = candidates.find((tile) => tile.index === index);
        if (!tile) throw new Error("Ineligible tile");
        return group(tile);
      });
      const groups = new Set(countries).size;
      if (groups < 3) repeated += 1;
      if (groups === 1) triples += 1;
    }
    expect(repeated / runs).toBeGreaterThan(0.0275);
    expect(repeated / runs).toBeLessThan(0.0325);
    expect(triples).toBeGreaterThan(0);
  });
  it("applies identical rules after renaming countries, including Portugal", () => {
    const candidates = eligible(configurations[0]);
    const renamed = candidates.map((tile) => {
      if (!isCityTile(tile)) return tile;
      return {
        ...tile,
        country:
          COUNTRY_IDS[
            (COUNTRY_IDS.indexOf(tile.country) + 2) % COUNTRY_IDS.length
          ],
      };
    });
    for (let count = 0; count <= 20; count += 1) {
      for (let seed = 0; seed < 100; seed += 1) {
        expect(selectInitialFestivals(renamed, count, seed, "spread")).toEqual(
          selectInitialFestivals(candidates, count, seed, "spread"),
        );
      }
    }
  });
  it("creates a city pair safely when a rare prefix contains only resorts", () => {
    const candidates = eligible(configurations[1]);
    let matched = false;
    for (let seed = 0; seed < 100_000; seed += 1) {
      const old = shuffle(candidates, seed);
      if (
        !old.items.slice(0, 2).every(isResortTile) ||
        nextRandom(old.state).value >= 0.02
      )
        continue;
      const result = selectInitialFestivals(candidates, 2, seed, "spread");
      const selected = result.items.map((index) =>
        candidates.find((tile) => tile.index === index),
      );
      expect(result.items).toHaveLength(2);
      expect(new Set(result.items).size).toBe(2);
      expect(selected.every((tile) => tile && isCityTile(tile))).toBe(true);
      expect(selected.map((tile) => tile && group(tile))).toEqual([
        expect.any(String),
        expect.any(String),
      ]);
      expect(selected[0] && group(selected[0])).toBe(
        selected[1] && group(selected[1]),
      );
      matched = true;
      break;
    }
    expect(matched).toBe(true);
  });
});
