// Every deploy restarts every Durable Object mid-game, so new code always loads
// games saved by the previous version. See
// docs/ARCHITECTURE.md → Deploys and games in progress.
//
// `meta.stateVersion` records the shape of the JSON in the `state` table. When a
// deploy changes that shape, bump CURRENT_STATE_VERSION and append one step to
// STATE_MIGRATIONS; the GameRoom walks the ladder on load before handing the
// state to the engine. This is the persisted shape only. The rules a match plays
// by are frozen separately by `meta.rulesVersion`, which is never migrated: a
// match keeps the rules it started with until it ends.

/** The shape this build writes. Bump it together with a new ladder step. */
export const CURRENT_STATE_VERSION = 2;

export type StateMigration = {
  /** Version produced by this step; it reads version `to - 1`. */
  readonly to: number;
  /** Rewrites one saved state JSON. Pure: no I/O, no clock, no randomness. */
  readonly migrate: (saved: unknown) => unknown;
};

/**
 * Append-only, ordered by `to`. Version 1 is the first shipped shape, so there
 * is nothing below it to migrate. Never edit or remove a shipped step: a match
 * saved by an older build has to climb exactly the same rungs the build that
 * wrote it expected to be climbed.
 */
export const STATE_MIGRATIONS: readonly StateMigration[] = [
  {
    // Version 2 adds the bank's own account. Older saves only kept a ledger
    // that mixes in property money, so their account starts over at zero.
    to: 2,
    migrate: (saved) =>
      saved === null || typeof saved !== "object"
        ? saved
        : { ...saved, bankReceived: 0, bankPaidOut: 0 },
  },
];

export type MigratedState = {
  /** Saved JSON at `CURRENT_STATE_VERSION` (or at `target`, when given). */
  readonly state: unknown;
  /** True when at least one step ran, so the caller persists the result. */
  readonly changed: boolean;
};

/**
 * Climbs `saved` from `from` to `target`, one version at a time.
 *
 * Throws when the save cannot be read by this build, which the GameRoom turns
 * into `incompatible-saved-match` rather than silently playing a match under
 * rules or a shape it does not understand. That covers a save written by a
 * newer build, which happens on a rollback: this build cannot know what the
 * newer one added, and guessing would corrupt a live match.
 */
export function migrateSavedState(
  saved: unknown,
  from: number,
  target: number = CURRENT_STATE_VERSION,
  ladder: readonly StateMigration[] = STATE_MIGRATIONS,
): MigratedState {
  if (!Number.isInteger(from) || from < 1)
    throw new Error(`Saved state version ${from} is not a shipped version`);
  if (from > target)
    throw new Error(
      `Saved state version ${from} is newer than this build's ${target}; a rollback cannot read it`,
    );
  let state = saved;
  for (let version = from + 1; version <= target; version++) {
    const step = ladder.find((candidate) => candidate.to === version);
    if (!step)
      throw new Error(
        `No migration from state version ${version - 1} to ${version}`,
      );
    state = step.migrate(state);
  }
  return { state, changed: from !== target };
}
