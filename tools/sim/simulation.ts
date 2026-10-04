import type {
  Action,
  GameConfig,
  GameState,
  PublicState,
  SeatInfo,
  WinKind,
} from "../../src/shared/engine/index.js";
import {
  applyAction,
  applyEvent,
  boardRule,
  botAction,
  chanceCards,
  createGame,
  DEFAULT_GAME_CONFIG,
  economyRule,
  getProperty,
  getTileBaseRent,
  legalActions,
  propertyInvestedValue,
  propertyRent,
  toPublic,
} from "../../src/shared/engine/index.js";

export const SIM_SEATS: readonly SeatInfo[] = ["Ada", "Bea", "Cy", "Dan"].map(
  (name, index) => ({ playerId: `sim-${index}`, name, control: "bot" }),
);
/** The first `players` simulator seats, at their own table seats. */
export function simSeats(players: number): readonly SeatInfo[] {
  return SIM_SEATS.slice(0, players);
}
export const SIM_CONFIG: GameConfig = {
  ...DEFAULT_GAME_CONFIG,
  roundLimit: 20,
  timeLimitMinutes: undefined,
};
export function cashTotal(state: PublicState): number {
  return (
    state.bankLedger +
    state.players.reduce((sum, player) => sum + player.cash, 0)
  );
}
export function assertInvariants(state: GameState, expectedCash: number): void {
  if (cashTotal(state) !== expectedCash)
    throw new Error("Money conservation failed");
  if (state.bankReceived < 0 || state.bankPaidOut < 0)
    throw new Error("Bank account totals went negative");
  if (state.round > state.config.roundLimit)
    throw new Error("Round limit exceeded");
  if (
    state.status === "active" &&
    (!state.pending || legalActions(state, state.pending.seat).length === 0)
  )
    throw new Error("Active game has no legal decision");
  if (
    state.status === "finished" &&
    (!state.result ||
      state.pending !== null ||
      state.result.standings.length !== state.players.length ||
      state.result.standings[0].seat !== state.result.winner)
  )
    throw new Error("Invalid result or standings");
  const remaining = [
    ...state.deck,
    ...state.discard,
    ...state.players.flatMap((player) => player.heldCards),
  ];
  const deck = chanceCards(state.config);
  if (
    remaining.length !== deck.length ||
    deck.some(
      (card) =>
        remaining.filter((candidate) => candidate === card).length !== 1,
    )
  )
    throw new Error("Card conservation failed");
  for (const player of state.players) {
    if (
      !Number.isSafeInteger(player.cash) ||
      player.position < 0 ||
      player.position >= 32
    )
      throw new Error("Invalid player amounts or position");
    if (
      player.cash < 0 &&
      (state.pending?.kind !== "sell" || state.pending.seat !== player.seat)
    )
      throw new Error("Debt exists without forced sale");
    if (
      player.bankrupt &&
      (player.cash !== 0 ||
        player.properties.length !== 0 ||
        player.heldCards.length !== 0 ||
        state.turnOrder.includes(player.seat))
    )
      throw new Error("Bankruptcy cleanup failed");
    if (new Set(player.properties).size !== player.properties.length)
      throw new Error("Duplicate property membership");
    for (const tile of player.properties)
      if (getProperty(state, tile)?.owner !== player.seat)
        throw new Error("Owner and property membership disagree");
  }
  for (const property of state.properties) {
    if (!Number.isSafeInteger(propertyInvestedValue(state, property.tile)))
      throw new Error("Noninteger investment");
    if (
      property.owner !== null &&
      !state.players
        .find((player) => player.seat === property.owner)
        ?.properties.includes(property.tile)
    )
      throw new Error("Property missing from owner's membership");
  }
}
export type SimulationResult = {
  seed: number;
  rounds: number;
  decisions: number;
  kind: WinKind;
  winner: number;
  turnPosition: number;
  landmarkBuilds: number;
  landmarkRent: number;
  modifiedHotelRent: number;
};
export function simulateGame(
  seed: number,
  config: GameConfig = SIM_CONFIG,
  choose?: (
    state: PublicState,
    actions: readonly Action[],
    index: number,
  ) => Action,
  seats: readonly SeatInfo[] = SIM_SEATS,
): SimulationResult {
  let state = createGame(config, seats, seed, { now: 0 }).state;
  const expectedCash = cashTotal(state);
  let decisions = 0;
  let landmarkBuilds = 0;
  let landmarkRent = 0;
  let modifiedHotelRent = 0;
  assertInvariants(state, expectedCash);
  while (state.status === "active") {
    if (++decisions > config.roundLimit * 400)
      throw new Error(`Game ${seed} did not terminate`);
    const pending = state.pending;
    if (!pending) throw new Error("Decision missing");
    const publicBefore = toPublic(state);
    const actions = legalActions(publicBefore, pending.seat);
    const action = choose
      ? choose(publicBefore, actions, decisions - 1)
      : botAction(publicBefore, pending.seat, "medium");
    const result = applyAction(state, pending.seat, action, { now: decisions });
    if (!result.ok)
      throw new Error(
        `Illegal bot decision in game ${seed}: ${result.error.message}`,
      );
    let replay = publicBefore;
    for (const event of result.events) {
      if (event.type === "PropertyUpgraded" && event.level === 5)
        landmarkBuilds++;
      if (event.type === "RentPaid") {
        const property = getProperty(replay, event.tile);
        if (property?.level === 5) landmarkRent += event.amount;
        else if (
          property?.level === 4 &&
          propertyRent(replay, event.tile) >
            getTileBaseRent(
              event.tile,
              4,
              economyRule(replay.config),
              boardRule(replay.config),
            )
        )
          modifiedHotelRent += event.amount;
      }
      replay = applyEvent(replay, event);
      if (cashTotal(replay) !== expectedCash)
        throw new Error(
          `Event ${event.type} broke money conservation in game ${seed}`,
        );
    }
    if (JSON.stringify(replay) !== JSON.stringify(toPublic(result.state)))
      throw new Error(`Replay diverged in game ${seed}`);
    state = result.state;
    assertInvariants(state, expectedCash);
  }
  if (!state.result) throw new Error("Finished match lacks result");
  return {
    seed,
    rounds: state.round,
    decisions,
    kind: state.result.kind,
    winner: state.result.winner,
    turnPosition: state.startingTurnOrder.indexOf(state.result.winner),
    landmarkBuilds,
    landmarkRent,
    modifiedHotelRent,
  };
}
