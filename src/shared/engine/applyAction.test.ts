import { describe, expect, it } from "vitest";
import { BOARD_SIZE } from "../board/index.js";
import type {
  GameEvent,
  GameState,
  PlayerState,
  Seat,
  SeatInfo,
} from "./index.js";
import {
  applyAction,
  applyEvent,
  createGame,
  DEFAULT_GAME_CONFIG,
  toPublic,
} from "./index.js";

const SEATS: readonly SeatInfo[] = [
  { playerId: "ada", name: "Ada", control: "human" },
  { playerId: "bea", name: "Bea", control: "human" },
];

type Dice = readonly [number, number];

const isDouble = (dice: Dice) => dice[0] === dice[1];
const total = (dice: Dice) => dice[0] + dice[1];

function newGame(): GameState {
  return createGame(DEFAULT_GAME_CONFIG, SEATS, 7, { now: 0 }).state;
}

function roll(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  const result = applyAction(
    state,
    state.activeSeat,
    { type: "Roll" },
    { now: 1 },
  );

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  expect(result.events.reduce(applyEvent, toPublic(state))).toEqual(
    toPublic(result.state),
  );

  return result;
}

/** Returns `state` with the first RNG state whose next roll satisfies `matches`. */
function withDice(
  state: GameState,
  matches: (dice: Dice) => boolean,
): { readonly state: GameState; readonly dice: Dice } {
  for (let rngState = 0; rngState < 10_000; rngState += 1) {
    const candidate = { ...state, rngState };
    const dice = roll(candidate).state.lastRoll?.dice;

    if (dice && matches(dice)) {
      return { state: candidate, dice };
    }
  }

  throw new Error("No RNG state rolls the requested dice");
}

function withPlayer(
  state: GameState,
  seat: Seat,
  changes: Partial<PlayerState>,
): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat ? { ...player, ...changes } : player,
    ),
  };
}

function playerAt(state: GameState, seat: Seat): PlayerState {
  const player = state.players.find((candidate) => candidate.seat === seat);

  if (!player) {
    throw new Error(`Expected a player in seat ${seat}`);
  }

  return player;
}

function nextSeat(state: GameState): Seat {
  const index = state.turnOrder.indexOf(state.activeSeat);
  const seat = state.turnOrder[(index + 1) % state.turnOrder.length];

  if (seat === undefined) {
    throw new Error("Expected a next seat");
  }

  return seat;
}

describe("applyAction", () => {
  it("rolls deterministic dice, moves the active player, and advances the turn", () => {
    const game = createGame(DEFAULT_GAME_CONFIG, SEATS, 7, { now: 0 });
    const rollingSeat = game.state.activeSeat;
    const result = applyAction(
      game.state,
      game.state.activeSeat,
      { type: "Roll" },
      { now: 1 },
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "PlayerMoved",
      "TurnPhaseChanged",
      "TurnAdvanced",
    ]);
    expect(result.state.lastRoll?.seat).toBe(rollingSeat);
    expect(result.state.lastRoll?.dice).toEqual([1, 6]);
    expect(
      result.state.players.find((player) => player.seat === rollingSeat),
    ).toMatchObject({ position: 7, laps: 0, cash: 1500 });
    expect(result.state.activeSeat).toBe(
      game.state.turnOrder[(game.state.turnOrder.indexOf(rollingSeat) + 1) % 2],
    );
    expect(result.state.phase).toBe("roll");
    expect(result.events.reduce(applyEvent, toPublic(game.state))).toEqual(
      toPublic(result.state),
    );
  });

  it("pays Start salary exactly once when movement crosses the board boundary", () => {
    const game = createGame(DEFAULT_GAME_CONFIG, SEATS, 7, { now: 0 });
    const activePlayer = game.state.players.find(
      (player) => player.seat === game.state.activeSeat,
    );

    if (!activePlayer) {
      throw new Error("Expected an active player");
    }

    const preparedState = {
      ...game.state,
      players: game.state.players.map((player) =>
        player.seat === activePlayer.seat
          ? { ...player, position: 28 }
          : player,
      ),
    };
    const result = applyAction(
      preparedState,
      game.state.activeSeat,
      { type: "Roll" },
      { now: 1 },
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "PlayerMoved",
      "SalaryPaid",
      "TurnPhaseChanged",
      "TurnAdvanced",
    ]);
    expect(
      result.state.players.find((player) => player.seat === activePlayer.seat),
    ).toMatchObject({ position: 3, laps: 1, cash: 1700 });
  });

  it("increments the round after the final seat completes its turn", () => {
    const game = createGame(DEFAULT_GAME_CONFIG, SEATS, 7, { now: 0 });
    const lastSeat = game.state.turnOrder[game.state.turnOrder.length - 1];

    if (lastSeat === undefined) {
      throw new Error("Expected a final seat");
    }

    const finalSeatState = { ...game.state, activeSeat: lastSeat };
    const result = applyAction(
      finalSeatState,
      lastSeat,
      { type: "Roll" },
      { now: 1 },
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.state).toMatchObject({
      activeSeat: game.state.turnOrder[0],
      round: 2,
      phase: "roll",
    });
  });

  it("rejects a roll from another seat or during resolution", () => {
    const game = createGame(DEFAULT_GAME_CONFIG, SEATS, 7, { now: 0 });
    const otherSeat = game.state.activeSeat === 0 ? 1 : 0;

    expect(
      applyAction(game.state, otherSeat, { type: "Roll" }, { now: 1 }),
    ).toEqual({
      ok: false,
      error: { code: "not-active-seat", message: "It is not this seat's turn" },
    });

    const resolvingState = { ...game.state, phase: "resolve" as const };

    expect(
      applyAction(
        resolvingState,
        game.state.activeSeat,
        { type: "Roll" },
        { now: 1 },
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid-phase",
        message: "A normal roll is not legal now",
      },
    });
  });
});

describe("doubles", () => {
  it("grants another roll to the same seat after a double", () => {
    // From Start, a double of 4 would land on the Island and end the turn.
    const { state } = withDice(
      newGame(),
      (dice) => isDouble(dice) && total(dice) !== 8,
    );
    const result = roll(state);

    expect(result.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "PlayerMoved",
      "TurnPhaseChanged",
      "TurnPhaseChanged",
    ]);
    expect(result.state).toMatchObject({
      activeSeat: state.activeSeat,
      phase: "roll",
      doublesInTurn: 1,
    });
  });

  it("sends the pawn to the Island on the third consecutive double and ends the turn", () => {
    const prepared = withPlayer(
      { ...newGame(), doublesInTurn: 2 },
      newGame().activeSeat,
      { position: 5 },
    );
    const { state } = withDice(prepared, isDouble);
    const result = roll(state);

    expect(result.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "SentToIsland",
      "TurnAdvanced",
    ]);
    expect(playerAt(result.state, state.activeSeat)).toMatchObject({
      position: 8,
      onIsland: true,
      islandTurns: 0,
      laps: 0,
      cash: 1500,
    });
    expect(result.state).toMatchObject({
      activeSeat: nextSeat(state),
      doublesInTurn: 0,
    });
  });

  it("forfeits the extra roll when a double lands on the Island", () => {
    const game = newGame();
    // Every double, including 5-5 and 6-6 which reach the Island by passing Start.
    for (let face = 1; face <= 6; face += 1) {
      const { state: rolled } = withDice(
        game,
        (dice) => dice[0] === face && dice[1] === face,
      );
      const state = withPlayer(rolled, game.activeSeat, {
        position: (8 - 2 * face + BOARD_SIZE) % BOARD_SIZE,
      });
      const result = roll(state);

      expect(result.events).toContainEqual({
        type: "SentToIsland",
        seat: game.activeSeat,
        reason: "tile",
      });
      expect(result.events.at(-1)?.type).toBe("TurnAdvanced");
    }
  });

  it("puts a pawn that lands on the Island in the trapped state", () => {
    const game = newGame();
    const { state: rolled, dice } = withDice(game, isDouble);
    const state = withPlayer(rolled, game.activeSeat, {
      position: (8 - total(dice) + BOARD_SIZE) % BOARD_SIZE,
    });
    const result = roll(state);

    expect(result.events).toContainEqual({
      type: "SentToIsland",
      seat: game.activeSeat,
      reason: "tile",
    });
    expect(result.events.at(-1)?.type).toBe("TurnAdvanced");
    expect(playerAt(result.state, game.activeSeat)).toMatchObject({
      position: 8,
      onIsland: true,
    });
    expect(result.state.activeSeat).toBe(nextSeat(state));
  });

  it("forfeits the extra roll when a double lands on World Tour", () => {
    const game = newGame();
    const { state: rolled, dice } = withDice(game, isDouble);
    const state = withPlayer(rolled, game.activeSeat, {
      position: 24 - total(dice),
    });
    const result = roll(state);

    expect(result.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "PlayerMoved",
      "TurnPhaseChanged",
      "TurnAdvanced",
    ]);
    expect(playerAt(result.state, game.activeSeat).position).toBe(24);
    expect(result.state.activeSeat).toBe(nextSeat(state));
  });
});

describe("Island escape rolls", () => {
  function trapped(islandTurns: number): GameState {
    const game = newGame();

    return withPlayer(game, game.activeSeat, {
      position: 8,
      onIsland: true,
      islandTurns,
    });
  }

  it("keeps the pawn on the Island after a failed escape roll", () => {
    const { state } = withDice(trapped(0), (dice) => !isDouble(dice));
    const result = roll(state);

    expect(result.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "IslandEscapeFailed",
      "TurnAdvanced",
    ]);
    expect(result.events[0]).toMatchObject({ purpose: "escape" });
    expect(playerAt(result.state, state.activeSeat)).toMatchObject({
      position: 8,
      onIsland: true,
      islandTurns: 1,
    });
  });

  it("releases the pawn on the spot after the second failed escape roll", () => {
    const { state } = withDice(trapped(1), (dice) => !isDouble(dice));
    const result = roll(state);

    expect(result.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "IslandEscapeFailed",
      "LeftIsland",
      "TurnAdvanced",
    ]);
    expect(playerAt(result.state, state.activeSeat)).toMatchObject({
      position: 8,
      onIsland: false,
      islandTurns: 0,
    });
  });

  it("moves with an escape double without granting another roll", () => {
    const { state, dice } = withDice(trapped(0), isDouble);
    const result = roll(state);

    expect(result.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "LeftIsland",
      "PlayerMoved",
      "TurnPhaseChanged",
      "TurnAdvanced",
    ]);
    expect(playerAt(result.state, state.activeSeat)).toMatchObject({
      position: 8 + total(dice),
      onIsland: false,
    });
    expect(result.state).toMatchObject({
      activeSeat: nextSeat(state),
      doublesInTurn: 0,
    });
  });
});

describe("round limit", () => {
  function finalTurn(): GameState {
    const game = newGame();
    const lastSeat = game.turnOrder.at(-1);

    if (lastSeat === undefined) {
      throw new Error("Expected a final seat");
    }

    // A plain roll from Start that stays clear of the Island ends the turn.
    return withDice(
      { ...game, activeSeat: lastSeat, round: DEFAULT_GAME_CONFIG.roundLimit },
      (dice) => !isDouble(dice) && total(dice) !== 8,
    ).state;
  }

  function firstSeat(state: GameState): Seat {
    const seat = state.turnOrder[0];

    if (seat === undefined) {
      throw new Error("Expected a first seat");
    }

    return seat;
  }

  it("ends the game after the final round and ranks players by net worth", () => {
    const state = finalTurn();
    const leader = firstSeat(state);
    const result = roll(withPlayer(state, leader, { cash: 1800 }));

    expect(result.events.at(-1)).toEqual({
      type: "GameOver",
      winner: leader,
      kind: "round-limit",
      standings: [
        { seat: leader, netWorth: 1800 },
        { seat: state.activeSeat, netWorth: 1500 },
      ],
    });
    expect(result.state.status).toBe("finished");
    expect(
      applyAction(
        result.state,
        result.state.activeSeat,
        { type: "Roll" },
        { now: 2 },
      ),
    ).toEqual({
      ok: false,
      error: { code: "game-over", message: "The game is over" },
    });
  });

  it("breaks a net-worth tie on cash, then on turn order", () => {
    const state = finalTurn();
    const first = firstSeat(state);

    // Same net worth (1300 cash + a 200 resort vs 1500 cash): more cash wins.
    const cashTie = roll(
      withPlayer(state, first, { cash: 1300, properties: [5] }),
    );

    expect(cashTie.state.result?.winner).toBe(state.activeSeat);

    // Identical players: the earlier seat in turn order wins.
    expect(roll(state).state.result?.winner).toBe(first);
  });
});
