import { describe, expect, it } from "vitest";
import type { StateMigration } from "./state-migrations.js";
import {
  CURRENT_STATE_VERSION,
  migrateSavedState,
  STATE_MIGRATIONS,
} from "./state-migrations.js";

// A stand-in ladder that exercises the walker itself; the shipped rungs are
// proven separately below before a deploy depends on them mid-match.
const LADDER: readonly StateMigration[] = [
  {
    to: 2,
    migrate: (saved) => ({ ...(saved as object), lap: 0 }),
  },
  {
    to: 3,
    migrate: (saved) => {
      const { lap, ...rest } = saved as { lap: number };
      return { ...rest, laps: [lap, lap] };
    },
  },
];

describe("Saved state migrations", () => {
  it("ships a ladder that is append-only, ordered and reaches the current version", () => {
    expect(STATE_MIGRATIONS.map((step) => step.to)).toEqual(
      STATE_MIGRATIONS.map((_step, index) => index + 2),
    );
    expect((STATE_MIGRATIONS.at(-1)?.to ?? 1) === CURRENT_STATE_VERSION).toBe(
      true,
    );
  });

  it("opens an empty bank account for a version-1 save and keeps its ledger", () => {
    expect(
      migrateSavedState({ bankLedger: 250_000, round: 3 }, 1, 2).state,
    ).toEqual({
      bankLedger: 250_000,
      round: 3,
      bankReceived: 0,
      bankPaidOut: 0,
    });
  });

  it("adds unpaused state to version-2 saves and keeps their rules and timers", () => {
    const saved = {
      config: { economyRule: "prototype", boardRule: "legacy" },
      rulesVersion: 2,
      pending: { kind: "roll", seat: 1, deadline: 30_000 },
      matchDeadline: 1_200_000,
      bankLedger: 250_000,
      bankReceived: 50_000,
      bankPaidOut: 100_000,
      rngState: 17,
      deck: ["Coupon"],
    };
    expect(migrateSavedState(saved, 2)).toEqual({
      state: { ...saved, pause: null, pauseCooldownUntil: 0 },
      changed: true,
    });
    expect(saved).not.toHaveProperty("pause");
    expect(migrateSavedState({ bankLedger: 7 }, 1).state).toEqual({
      bankLedger: 7,
      bankReceived: 0,
      bankPaidOut: 0,
      pause: null,
      pauseCooldownUntil: 0,
    });
  });

  it("leaves a save already at the current version untouched and unwritten", () => {
    const saved = { cash: 2_000_000 };
    const migrated = migrateSavedState(saved, 3, 3, LADDER);
    expect(migrated.state).toBe(saved);
    expect(migrated.changed).toBe(false);
  });

  it("climbs one version at a time instead of jumping to the newest shape", () => {
    const seen: number[] = [];
    const traced = LADDER.map((step) => ({
      to: step.to,
      migrate: (saved: unknown) => {
        seen.push(step.to);
        return step.migrate(saved);
      },
    }));
    const migrated = migrateSavedState({ cash: 7 }, 1, 3, traced);
    expect(seen).toEqual([2, 3]);
    expect(migrated.state).toEqual({ cash: 7, laps: [0, 0] });
    expect(migrated.changed).toBe(true);
  });

  it("starts from the saved version rather than replaying shipped steps", () => {
    const migrated = migrateSavedState({ cash: 7, lap: 4 }, 2, 3, LADDER);
    expect(migrated.state).toEqual({ cash: 7, laps: [4, 4] });
  });

  it("refuses a save from a newer build, which a rollback cannot read", () => {
    expect(() => migrateSavedState({}, 4, 3, LADDER)).toThrow(/newer/);
  });

  it("refuses a gap in the ladder instead of guessing the missing shape", () => {
    const gapped = LADDER.filter((step) => step.to !== 2);
    expect(() => migrateSavedState({}, 1, 3, gapped)).toThrow(
      /No migration from state version 1 to 2/,
    );
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "refuses %s as a saved version rather than treating it as version 1",
    (from) => {
      expect(() => migrateSavedState({}, from, 3, LADDER)).toThrow(
        /not a shipped version/,
      );
    },
  );
});
