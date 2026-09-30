import { describe, expect, it } from "vitest";
import type { SeatInfo } from "./index.js";
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
