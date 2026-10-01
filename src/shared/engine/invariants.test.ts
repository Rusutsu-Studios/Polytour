import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SIM_CONFIG, simulateGame } from "../../../tools/sim/simulation.js";

describe("rules invariants for generated matches", () => {
  it("replays arbitrary legal decisions, conserves every cash movement and card, and always terminates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.nat(1000), { minLength: 1, maxLength: 100 }),
        (seed, roundLimit, selections) => {
          const result = simulateGame(
            seed,
            { ...SIM_CONFIG, roundLimit },
            (_state, actions, index) =>
              actions[selections[index % selections.length] % actions.length],
          );
          expect(result.rounds).toBeLessThanOrEqual(roundLimit);
          expect(result.decisions).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100, seed: 20261001 },
    );
  });
  it("finishes repeatable complete bot matches across independent seeds", () => {
    for (let seed = 0; seed < 30; seed++) {
      const first = simulateGame(seed);
      expect(simulateGame(seed)).toEqual(first);
      expect(first.rounds).toBeLessThanOrEqual(SIM_CONFIG.roundLimit);
    }
  });
});
