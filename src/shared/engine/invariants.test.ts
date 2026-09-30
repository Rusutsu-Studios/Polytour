import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { GameState, SeatInfo } from "./index.js";
import {
  applyAction,
  applyEvent,
  createGame,
  DEFAULT_GAME_CONFIG,
  toPublic,
  totalMoney,
} from "./index.js";

/**
 * Invariants that must hold in every reachable state, checked with fast-check
 * over random seeds rather than a handful of hand-picked examples.
 *
 * Money conservation is the load-bearing one. GAME_DESIGN.md defines the total
 * as player cash plus the bank ledger, and ROADMAP Phase 1 makes it a gate for
 * the engine. It only means anything while the ledger is a real balance, so
 * this suite is what stops it being pinned to a constant again.
 */

const NAMES = ["Ada", "Bea", "Cy", "Dee"] as const;

function seatsOf(count: number): readonly SeatInfo[] {
  return NAMES.slice(0, count).map((name) => ({
    playerId: name.toLowerCase(),
    name,
    control: "human" as const,
  }));
}

const seedArb = fc.integer();
const seatCountArb = fc.integer({ min: 2, max: 4 });

/** Rolls until the match ends or `limit` rolls have been taken. */
function playOut(
  start: GameState,
  limit: number,
  onStep: (before: GameState, after: GameState) => void,
): GameState {
  let state = start;

  for (let turn = 0; turn < limit; turn += 1) {
    const result = applyAction(
      state,
      state.activeSeat,
      { type: "Roll" },
      { now: turn },
    );

    if (!result.ok) {
      // The only legal stopping point is a finished match.
      expect(result.error.code).toBe("game-over");
      break;
    }

    onStep(state, result.state);
    state = result.state;
  }

  return state;
}

describe("money conservation", () => {
  it("holds for any freshly created game", () => {
    fc.assert(
      fc.property(seedArb, seatCountArb, (seed, seatCount) => {
        const { state } = createGame(
          DEFAULT_GAME_CONFIG,
          seatsOf(seatCount),
          seed,
          { now: 0 },
        );

        expect(totalMoney(toPublic(state))).toBe(
          DEFAULT_GAME_CONFIG.startingCash * seatCount,
        );
      }),
    );
  });

  it("holds after every roll of a whole match", () => {
    fc.assert(
      fc.property(seedArb, seatCountArb, (seed, seatCount) => {
        const { state } = createGame(
          DEFAULT_GAME_CONFIG,
          seatsOf(seatCount),
          seed,
          { now: 0 },
        );
        const expected = DEFAULT_GAME_CONFIG.startingCash * seatCount;

        playOut(state, 400, (_before, after) => {
          expect(totalMoney(toPublic(after))).toBe(expected);
        });
      }),
      { numRuns: 50 },
    );
  });

  it("moves salary out of the bank rather than minting it", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const { state } = createGame(DEFAULT_GAME_CONFIG, seatsOf(2), seed, {
          now: 0,
        });
        const final = playOut(state, 200, () => undefined);
        const paidOut = final.players.reduce(
          (sum, player) => sum + player.laps,
          0,
        );

        // Every lap paid one salary, and the ledger is exactly that far down.
        expect(final.bankLedger).toBe(
          -paidOut * DEFAULT_GAME_CONFIG.startSalary,
        );
      }),
      { numRuns: 50 },
    );
  });
});

describe("event completeness", () => {
  it("rebuilds the next public state from the previous one, every roll", () => {
    fc.assert(
      fc.property(seedArb, seatCountArb, (seed, seatCount) => {
        const { state } = createGame(
          DEFAULT_GAME_CONFIG,
          seatsOf(seatCount),
          seed,
          { now: 0 },
        );
        let current = state;

        for (let turn = 0; turn < 200; turn += 1) {
          const before = toPublic(current);
          const result = applyAction(
            current,
            current.activeSeat,
            { type: "Roll" },
            { now: turn },
          );

          if (!result.ok) {
            break;
          }

          // The engine contract: folding the emitted events over the previous
          // public state reproduces the next one, so server and client agree
          // by construction rather than by careful duplication.
          expect(result.events.reduce(applyEvent, before)).toEqual(
            toPublic(result.state),
          );
          current = result.state;
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe("termination and determinism", () => {
  it("finishes inside the round limit", () => {
    fc.assert(
      fc.property(seedArb, seatCountArb, (seed, seatCount) => {
        const { state } = createGame(
          DEFAULT_GAME_CONFIG,
          seatsOf(seatCount),
          seed,
          { now: 0 },
        );
        const final = playOut(state, 1000, () => undefined);

        expect(final.round).toBeLessThanOrEqual(
          DEFAULT_GAME_CONFIG.roundLimit + 1,
        );
      }),
      { numRuns: 30 },
    );
  });

  it("replays a seed into an identical match", () => {
    fc.assert(
      fc.property(seedArb, seatCountArb, (seed, seatCount) => {
        const seats = seatsOf(seatCount);
        const first = createGame(DEFAULT_GAME_CONFIG, seats, seed, { now: 7 });
        const second = createGame(DEFAULT_GAME_CONFIG, seats, seed, { now: 7 });

        expect(playOut(first.state, 60, () => undefined)).toEqual(
          playOut(second.state, 60, () => undefined),
        );
      }),
      { numRuns: 30 },
    );
  });

  it("never leaks the generator state into a public snapshot", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const { state } = createGame(DEFAULT_GAME_CONFIG, seatsOf(3), seed, {
          now: 0,
        });

        expect(Object.hasOwn(toPublic(state), "rngState")).toBe(false);
      }),
    );
  });
});
