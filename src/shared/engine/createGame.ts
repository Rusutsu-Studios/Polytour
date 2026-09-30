import {
  BOARD_SIZE,
  ECONOMY,
  getInvestedValue,
  getTile,
  ISLAND_TILE_INDEX,
  isCityTile,
  isResortTile,
} from "../board/index.js";
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
  Standing,
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
    onIsland: false,
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

function updatePlayer(
  state: PublicState,
  seat: Seat,
  update: (player: PlayerState) => PlayerState,
): PublicState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat ? update(player) : player,
    ),
  };
}

export function applyEvent(_state: PublicState, event: GameEvent): PublicState {
  switch (event.type) {
    case "GameCreated":
      return event.state;
    case "DiceRolled":
      return {
        ..._state,
        lastRoll: { seat: event.seat, dice: event.dice },
        doublesInTurn:
          event.isDouble && event.purpose === "move"
            ? _state.doublesInTurn + 1
            : _state.doublesInTurn,
      };
    case "PlayerMoved":
      return updatePlayer(_state, event.seat, (player) => ({
        ...player,
        position: event.position,
        laps: event.laps,
      }));
    case "SalaryPaid":
      return updatePlayer(_state, event.seat, (player) => ({
        ...player,
        cash: event.cash,
      }));
    case "TurnPhaseChanged":
      return { ..._state, phase: event.phase };
    case "TurnAdvanced":
      return {
        ..._state,
        activeSeat: event.activeSeat,
        round: event.round,
        phase: "roll",
        doublesInTurn: 0,
      };
    case "SentToIsland":
      return updatePlayer(_state, event.seat, (player) => ({
        ...player,
        position: ISLAND_TILE_INDEX,
        onIsland: true,
        islandTurns: 0,
      }));
    case "IslandEscapeFailed":
      return updatePlayer(_state, event.seat, (player) => ({
        ...player,
        islandTurns: event.islandTurns,
      }));
    case "LeftIsland":
      return updatePlayer(_state, event.seat, (player) => ({
        ...player,
        onIsland: false,
        islandTurns: 0,
      }));
    case "GameOver":
      return {
        ..._state,
        status: "finished",
        result: {
          winner: event.winner,
          kind: event.kind,
          standings: event.standings,
        },
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

function propertyValue(tileIndex: number): number {
  const tile = getTile(tileIndex);

  if (tile && isResortTile(tile)) {
    return ECONOMY.resortPrice;
  }

  if (tile && isCityTile(tile)) {
    // Owned cities are bare tile indices until build levels are tracked, so
    // each one counts at its Land value.
    return getInvestedValue(tile.country, 0);
  }

  throw new Error(`Tile ${tileIndex} cannot be owned`);
}

function netWorth(player: PlayerState): number {
  return player.properties.reduce(
    (total, tileIndex) => total + propertyValue(tileIndex),
    player.cash,
  );
}

function resortCount(player: PlayerState): number {
  return player.properties.filter((tileIndex) => {
    const tile = getTile(tileIndex);
    return tile !== undefined && isResortTile(tile);
  }).length;
}

function rankStandings(state: PublicState): readonly Standing[] {
  const turnPosition = (seat: Seat) => state.turnOrder.indexOf(seat);
  const solvent = state.players
    .filter((player) => !player.bankrupt)
    .sort(
      (a, b) =>
        netWorth(b) - netWorth(a) ||
        b.cash - a.cash ||
        resortCount(b) - resortCount(a) ||
        turnPosition(a.seat) - turnPosition(b.seat),
    );
  // Bankruptcy is not implemented yet, so there is no elimination order to
  // rank bankrupt players by; they keep seat order after every solvent player.
  const bankrupt = state.players.filter((player) => player.bankrupt);

  return [...solvent, ...bankrupt].map((player) => ({
    seat: player.seat,
    netWorth: netWorth(player),
  }));
}

/** Hands the turn to the next seat, or ends the game when the last round completes. */
function endTurn(state: PublicState): GameEvent {
  const activeIndex = state.turnOrder.indexOf(state.activeSeat);

  if (activeIndex < 0) {
    throw new Error(`The active seat ${state.activeSeat} is not in turn order`);
  }

  const nextIndex = (activeIndex + 1) % state.turnOrder.length;
  const activeSeat = state.turnOrder[nextIndex];

  if (activeSeat === undefined) {
    throw new Error("A game requires a next active seat");
  }

  const round = state.round + Number(nextIndex === 0);

  if (round > state.config.roundLimit) {
    const standings = rankStandings(state);
    const winner = standings[0];

    if (!winner) {
      throw new Error("A finished game requires a winner");
    }

    return {
      type: "GameOver",
      winner: winner.seat,
      kind: "round-limit",
      standings,
    };
  }

  return { type: "TurnAdvanced", activeSeat, round };
}

type Dice = readonly [number, number];

type TurnOutcome = {
  readonly events: readonly GameEvent[];
  readonly endsTurn: boolean;
};

function moveEvents(
  player: PlayerState,
  steps: number,
  config: GameConfig,
): { readonly events: readonly GameEvent[]; readonly position: number } {
  const absolutePosition = player.position + steps;
  const passedStart = absolutePosition >= BOARD_SIZE;
  const position = absolutePosition % BOARD_SIZE;
  const events: GameEvent[] = [
    {
      type: "PlayerMoved",
      seat: player.seat,
      position,
      laps: player.laps + Number(passedStart),
    },
  ];

  if (passedStart) {
    events.push({
      type: "SalaryPaid",
      seat: player.seat,
      amount: config.startSalary,
      cash: player.cash + config.startSalary,
    });
  }

  return { events, position };
}

/** Resolves the tile a pawn landed on; Island and World Tour end the turn. */
function landingEvents(seat: Seat, position: number): TurnOutcome {
  switch (getTile(position)?.kind) {
    case "island":
      return {
        events: [{ type: "SentToIsland", seat, reason: "tile" }],
        endsTurn: true,
      };
    case "world-tour":
      // The next-turn travel option is not implemented yet; landing still
      // ends the turn and forfeits any doubles roll.
      return { events: [], endsTurn: true };
    default:
      return { events: [], endsTurn: false };
  }
}

function moveRoll(
  player: PlayerState,
  dice: Dice,
  doublesInTurn: number,
  config: GameConfig,
): TurnOutcome {
  const seat = player.seat;
  const isDouble = dice[0] === dice[1];
  const rolled: GameEvent = {
    type: "DiceRolled",
    seat,
    dice,
    isDouble,
    purpose: "move",
  };

  if (isDouble && doublesInTurn + 1 >= ECONOMY.doublesToIsland) {
    return {
      events: [rolled, { type: "SentToIsland", seat, reason: "triple-double" }],
      endsTurn: true,
    };
  }

  const move = moveEvents(player, dice[0] + dice[1], config);
  const landing = landingEvents(seat, move.position);
  const events: readonly GameEvent[] = [
    rolled,
    ...move.events,
    { type: "TurnPhaseChanged", phase: "resolve" },
    ...landing.events,
  ];

  if (isDouble && !landing.endsTurn) {
    // A double earns another roll once the landing is resolved.
    return {
      events: [...events, { type: "TurnPhaseChanged", phase: "roll" }],
      endsTurn: false,
    };
  }

  // Landing resolution has no decisions yet, so the turn ends automatically:
  // no decision is pending and no extra roll is due.
  return { events, endsTurn: true };
}

function escapeRoll(
  player: PlayerState,
  dice: Dice,
  config: GameConfig,
): TurnOutcome {
  const seat = player.seat;
  const isDouble = dice[0] === dice[1];
  const rolled: GameEvent = {
    type: "DiceRolled",
    seat,
    dice,
    isDouble,
    purpose: "escape",
  };

  if (isDouble) {
    // The double releases the pawn and those same dice move it. An escape
    // roll never earns another roll.
    const move = moveEvents(player, dice[0] + dice[1], config);
    const landing = landingEvents(seat, move.position);

    return {
      events: [
        rolled,
        { type: "LeftIsland", seat, method: "doubles" },
        ...move.events,
        { type: "TurnPhaseChanged", phase: "resolve" },
        ...landing.events,
      ],
      endsTurn: true,
    };
  }

  const islandTurns = player.islandTurns + 1;
  const events: GameEvent[] = [
    rolled,
    { type: "IslandEscapeFailed", seat, islandTurns },
  ];

  if (islandTurns >= ECONOMY.islandMaxFailedEscapes) {
    events.push({ type: "LeftIsland", seat, method: "released" });
  }

  return { events, endsTurn: true };
}

export function applyAction(
  state: GameState,
  seat: Seat,
  action: Action,
  _context: EngineContext,
): ApplyActionResult {
  if (state.status !== "active") {
    return {
      ok: false,
      error: { code: "game-over", message: "The game is over" },
    };
  }

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
      const dice: Dice = [firstRoll.die, secondRoll.die];
      const activePlayer = state.players.find((player) => player.seat === seat);

      if (!activePlayer) {
        throw new Error(`The active seat ${seat} has no player`);
      }

      const turn = activePlayer.onIsland
        ? escapeRoll(activePlayer, dice, state.config)
        : moveRoll(activePlayer, dice, state.doublesInTurn, state.config);
      const turnState = turn.events.reduce(applyEvent, toPublic(state));
      const endEvents = turn.endsTurn ? [endTurn(turnState)] : [];
      const publicState = endEvents.reduce(applyEvent, turnState);
      const nextState: GameState = {
        ...publicState,
        rngState: secondRoll.rngState,
      };

      return {
        ok: true,
        state: nextState,
        events: [...turn.events, ...endEvents],
      };
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
    doublesInTurn: 0,
    pending: null,
    lastRoll: null,
    bankLedger: 0,
    championshipHost: null,
    status: "active",
    result: null,
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
