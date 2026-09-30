import { describe, expect, it } from "vitest";
import type { SeatInfo } from "./index.js";
import {
  applyEvent,
  createGame,
  DEFAULT_GAME_CONFIG,
  toPublic,
} from "./index.js";

const SEATS: readonly SeatInfo[] = [
  { playerId: "ada", name: "Ada", control: "human" },
  { playerId: "bea", name: "Bea", control: "human" },
  { playerId: "cy", name: "Cy", control: "bot" },
];

describe("createGame", () => {
  it("initializes every player and the first active turn from config", () => {
    const { state, events } = createGame(
      { ...DEFAULT_GAME_CONFIG, gameId: "MATCH01" },
      SEATS,
      42,
      { now: 1_790_719_200_000 },
    );

    expect(state).toMatchObject({
      gameId: "MATCH01",
      config: { ...DEFAULT_GAME_CONFIG, gameId: "MATCH01" },
      activeSeat: state.turnOrder[0],
      round: 1,
      phase: "roll",
      pending: null,
      bankLedger: 0,
      championshipHost: null,
      status: "active",
      startedAt: 1_790_719_200_000,
    });
    expect(state.players).toEqual([
      {
        playerId: "ada",
        name: "Ada",
        control: "human",
        seat: 0,
        cash: 1500,
        position: 0,
        laps: 0,
        islandTurns: 0,
        bankrupt: false,
        properties: [],
        heldCards: [],
      },
      {
        playerId: "bea",
        name: "Bea",
        control: "human",
        seat: 1,
        cash: 1500,
        position: 0,
        laps: 0,
        islandTurns: 0,
        bankrupt: false,
        properties: [],
        heldCards: [],
      },
      {
        playerId: "cy",
        name: "Cy",
        control: "bot",
        seat: 2,
        cash: 1500,
        position: 0,
        laps: 0,
        islandTurns: 0,
        bankrupt: false,
        properties: [],
        heldCards: [],
      },
    ]);
    expect(events).toHaveLength(1);
  });

  it("is deterministic for a seed and reconstructs its public state from events", () => {
    const first = createGame(DEFAULT_GAME_CONFIG, SEATS, 42, { now: 100 });
    const second = createGame(DEFAULT_GAME_CONFIG, SEATS, 42, { now: 100 });
    const third = createGame(DEFAULT_GAME_CONFIG, SEATS, 43, { now: 100 });

    expect(first.state).toEqual(second.state);
    expect(first.state.turnOrder).not.toEqual(third.state.turnOrder);
    expect(first.events.reduce(applyEvent, toPublic(first.state))).toEqual(
      toPublic(first.state),
    );
  });

  it("rejects unsupported player counts and duplicate identities", () => {
    expect(() =>
      createGame(DEFAULT_GAME_CONFIG, SEATS.slice(0, 1), 1, { now: 0 }),
    ).toThrow("2 to 4 seats");
    expect(() =>
      createGame(DEFAULT_GAME_CONFIG, [SEATS[0], SEATS[0]], 1, { now: 0 }),
    ).toThrow("unique player ID");
  });
});
