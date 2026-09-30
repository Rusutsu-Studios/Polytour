import { ECONOMY } from "../board/index.js";
import { shuffle } from "./rng.js";
import type {
  CreateGameResult,
  EngineContext,
  GameConfig,
  GameEvent,
  GameState,
  PlayerState,
  PublicState,
  Seat,
  SeatInfo,
} from "./types.js";

export const DEFAULT_GAME_CONFIG = {
  gameId: "local-game",
  startingCash: ECONOMY.startingCash,
  startSalary: ECONOMY.startSalary,
  roundLimit: ECONOMY.roundLimit,
} as const satisfies GameConfig;

function validateGameConfig(config: GameConfig): void {
  if (config.gameId.length === 0) {
    throw new RangeError("A game ID is required");
  }

  if (!Number.isInteger(config.startingCash) || config.startingCash < 0) {
    throw new RangeError("Starting cash must be a non-negative integer");
  }

  if (!Number.isInteger(config.startSalary) || config.startSalary < 0) {
    throw new RangeError("Start salary must be a non-negative integer");
  }

  if (!Number.isInteger(config.roundLimit) || config.roundLimit < 1) {
    throw new RangeError("Round limit must be a positive integer");
  }
}

function validateSeats(seats: readonly SeatInfo[]): void {
  if (
    seats.length < ECONOMY.minimumPlayers ||
    seats.length > ECONOMY.maximumPlayers
  ) {
    throw new RangeError(
      `A game requires ${ECONOMY.minimumPlayers} to ${ECONOMY.maximumPlayers} seats`,
    );
  }

  const playerIds = new Set(seats.map((seat) => seat.playerId));

  if (playerIds.size !== seats.length) {
    throw new RangeError("Every seat must have a unique player ID");
  }

  if (
    seats.some((seat) => seat.playerId.length === 0 || seat.name.length === 0)
  ) {
    throw new RangeError("Every seat must have a player ID and name");
  }
}

function createPlayer(
  seatInfo: SeatInfo,
  seat: Seat,
  cash: number,
): PlayerState {
  return {
    playerId: seatInfo.playerId,
    name: seatInfo.name,
    control: seatInfo.control,
    seat,
    cash,
    position: 0,
    laps: 0,
    islandTurns: 0,
    bankrupt: false,
    properties: [],
    heldCards: [],
  };
}

export function toPublic(state: GameState): PublicState {
  const { rngState: _rngState, ...publicState } = state;
  return publicState;
}

export function applyEvent(_state: PublicState, event: GameEvent): PublicState {
  switch (event.type) {
    case "GameCreated":
      return event.state;
  }
}

export function createGame(
  config: GameConfig,
  seats: readonly SeatInfo[],
  seed: number,
  context: EngineContext,
): CreateGameResult {
  validateGameConfig(config);
  validateSeats(seats);

  const players = seats.map((seat, index) =>
    createPlayer(seat, index as Seat, config.startingCash),
  );
  const turnOrderResult = shuffle(
    players.map((player) => player.seat),
    seed,
  );
  const activeSeat = turnOrderResult.items[0];

  if (activeSeat === undefined) {
    throw new Error("A game requires an active seat");
  }

  const publicState: PublicState = {
    gameId: config.gameId,
    config,
    players,
    turnOrder: turnOrderResult.items,
    activeSeat,
    round: 1,
    phase: "roll",
    pending: null,
    bankLedger: 0,
    championshipHost: null,
    status: "active",
    startedAt: context.now,
  };
  const state: GameState = {
    ...publicState,
    rngState: turnOrderResult.state,
  };
  const events: readonly GameEvent[] = [
    { type: "GameCreated", state: publicState },
  ];

  return { state, events };
}
