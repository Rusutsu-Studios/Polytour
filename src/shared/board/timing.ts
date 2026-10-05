/**
 * Rules and animation budgets, shared by the engine and presentation.
 * Animation budgets are the 1× durations the client plays; the engine adds
 * them to the next decision so its clock never runs during an animation.
 */
export const DECISION_TIMING = {
  roll: 10_000,
  choice: 15_000,
  sell: 30_000,
  diceAnimation: 1_700,
  stepAnimation: 300,
  /** The longest walk (twelve hops): longer moves hop faster to fit it. */
  walkAnimation: 3_600,
  jumpAnimation: 900,
  cardAnimation: 8_000,
  taxAnimation: 6_000,
  /** The public "cannot afford" notice for a city or a buyout. */
  noticeAnimation: 4_000,
  moneyAnimation: 650,
  propertyAnimation: 1_100,
  /** Earthquake: the city shakes, its top building sinks, the rest settle. */
  wreckAnimation: 2_000,
  islandAnimation: 700,
} as const;

/** Server bots act only after the 1× presentation, then pause like a player. */
export const BOT_TIMING = {
  roll: 700,
  choice: 1_400,
  /** After a wake-up or reconnect, when no animation is left to wait for. */
  resume: 900,
} as const;

/** Multiplayer pause requests share one cooldown, even when declined or expired. */
export const PAUSE_TIMING = {
  vote: 30_000,
  cooldown: 5 * 60_000,
} as const;

export const CHANCE_AMOUNTS = {
  windfall: 150_000,
  fine: 100_000,
  birthday: 50_000,
  auditPercent: 10,
  charity: 100_000,
  /** Original rule only; reworked rooms roll a die for Detour and Tailwind. */
  detourSteps: 3,
  /** Start passes the owner makes before a cut city earns rent again. */
  powerCutLaps: 3,
  /** A full country, a festival and a newly hosted championship each double rent. */
  countryMultiplier: 2,
  initialHostMultiplier: 2,
} as const;

/**
 * Copies of a card in a reworked deck; unlisted cards appear once. The bad
 * cards fill 18 of 36 slots, so half the draws cost the drawer. Fan Trip
 * stays a rare single copy.
 */
export const CHANCE_DECK_COPIES = {
  "Parking Fine": 3,
  Audit: 3,
  Charity: 3,
  Detour: 3,
  Stranded: 3,
  Gift: 2,
} as const;
