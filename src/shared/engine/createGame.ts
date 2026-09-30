import { BOARD_SIZE, ECONOMY } from "../board/index.js";
import { nextRandom, shuffle } from "./rng.js";
import type {
  Action,
  ApplyActionResult,
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
    case "DiceRolled":
      return { ..._state, lastRoll: { seat: event.seat, dice: event.dice } };
    case "PlayerMoved":
      return {
        ..._state,
        players: _state.players.map((player) =>
          player.seat === event.seat
            ? { ...player, position: event.position, laps: event.laps }
            : player,
        ),
      };
    case "SalaryPaid":
      return {
        ..._state,
        players: _state.players.map((player) =>
          player.seat === event.seat ? { ...player, cash: event.cash } : player,
        ),
      };
    case "TurnPhaseChanged":
      return { ..._state, phase: event.phase };
    case "TurnAdvanced":
      return {
        ..._state,
        activeSeat: event.activeSeat,
        round: event.round,
        phase: "roll",
      };
  }
}

function rollDie(rngState: number): {
  readonly rngState: number;
  readonly die: number;
} {
  const result = nextRandom(rngState);

  return { rngState: result.state, die: Math.floor(result.value * 6) + 1 };
}

function nextTurn(state: GameState): {
  readonly activeSeat: Seat;
  readonly round: number;
} {
  const activeIndex = state.turnOrder.indexOf(state.activeSeat);

  if (activeIndex < 0) {
    throw new Error(`The active seat ${state.activeSeat} is not in turn order`);
  }

  const nextIndex = (activeIndex + 1) % state.turnOrder.length;
  const activeSeat = state.turnOrder[nextIndex];

  if (activeSeat === undefined) {
    throw new Error("A game requires a next active seat");
  }

  return {
    activeSeat,
    round: state.round + Number(nextIndex === 0),
  };
}

export function applyAction(
  state: GameState,
  seat: Seat,
  action: Action,
  _context: EngineContext,
): ApplyActionResult {
  if (state.activeSeat !== seat) {
    return {
      ok: false,
      error: { code: "not-active-seat", message: "It is not this seat's turn" },
    };
  }

  if (state.phase !== "roll" || state.pending !== null) {
    return {
      ok: false,
      error: {
        code: "invalid-phase",
        message: "A normal roll is not legal now",
      },
    };
  }

  switch (action.type) {
    case "Roll": {
      const firstRoll = rollDie(state.rngState);
      const secondRoll = rollDie(firstRoll.rngState);
      const dice: readonly [number, number] = [firstRoll.die, secondRoll.die];
      const activePlayer = state.players.find((player) => player.seat === seat);

      if (!activePlayer) {
        throw new Error(`The active seat ${seat} has no player`);
      }

      const absolutePosition = activePlayer.position + dice[0] + dice[1];
      const passedStart = absolutePosition >= BOARD_SIZE;
      const position = absolutePosition % BOARD_SIZE;
      const laps = activePlayer.laps + Number(passedStart);
      const events: GameEvent[] = [
        { type: "DiceRolled", seat, dice },
        { type: "PlayerMoved", seat, position, laps },
      ];

      if (passedStart) {
        events.push({
          type: "SalaryPaid",
          seat,
          amount: state.config.startSalary,
          cash: activePlayer.cash + state.config.startSalary,
        });
      }

      events.push({ type: "TurnPhaseChanged", phase: "resolve" });

      // Landing resolution has no decisions yet, so this turn completes
      // immediately under the protocol's automatic-advance rule.
      events.push({ type: "TurnAdvanced", ...nextTurn(state) });

      const publicState = events.reduce(applyEvent, toPublic(state));
      const nextState: GameState = {
        ...publicState,
        rngState: secondRoll.rngState,
      };

      return { ok: true, state: nextState, events };
    }
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
    lastRoll: null,
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
