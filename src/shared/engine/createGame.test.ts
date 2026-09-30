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
  { playerId: "dan", name: "Dan", control: "bot" },
];
describe("createGame", () => {
  it("initializes all four seats, property states and chosen match settings", () => {
    const { state, events } = createGame(
      { ...DEFAULT_GAME_CONFIG, gameId: "MATCH01", decisionSeconds: 30 },
      SEATS,
      42,
      { now: 100 },
    );
    expect(state).toMatchObject({
      gameId: "MATCH01",
      activeSeat: state.turnOrder[0],
      round: 1,
      phase: "roll",
      doublesInTurn: 0,
      bankLedger: 0,
      championshipHost: null,
      status: "active",
      result: null,
      startedAt: 100,
      matchDeadline: 7_200_100,
    });
    expect(state.pending).toEqual({
      kind: "roll",
      seat: state.activeSeat,
      deadline: 30_100,
    });
    expect(state.properties).toHaveLength(24);
    expect(
      state.properties.every(
        (property) => property.owner === null && property.level === 0,
      ),
    ).toBe(true);
    expect(state.festivalTiles).toHaveLength(3);
    expect(new Set(state.festivalTiles).size).toBe(3);
    for (const [index, player] of state.players.entries())
      expect(player).toMatchObject({
        ...SEATS[index],
        seat: index,
        cash: 2_000_000,
        position: 0,
        laps: 0,
        onIsland: false,
        bankrupt: false,
        properties: [],
        heldCards: [],
        travelPending: false,
      });
    expect(state.deck).toHaveLength(16);
    expect(events).toHaveLength(1);
    expect(events.reduce(applyEvent, toPublic(state))).toEqual(toPublic(state));
  });
  it("is deterministic for seed and time, including private deck and neutral festivals", () => {
    const first = createGame(DEFAULT_GAME_CONFIG, SEATS, 42, { now: 100 });
    const second = createGame(DEFAULT_GAME_CONFIG, SEATS, 42, { now: 100 });
    const third = createGame(DEFAULT_GAME_CONFIG, SEATS, 43, { now: 100 });
    expect(first).toEqual(second);
    expect(first.state.deck).not.toEqual(third.state.deck);
    expect(first.state.festivalTiles).not.toEqual(third.state.festivalTiles);
    expect(toPublic(first.state)).not.toHaveProperty("rngState");
    expect(first.events[0]).not.toHaveProperty("state.deck");
  });
  it("validates identities, counts, integer money, positive deadlines and supported festivals", () => {
    expect(() =>
      createGame(DEFAULT_GAME_CONFIG, SEATS.slice(0, 1), 1, { now: 0 }),
    ).toThrow("2 to 4 seats");
    expect(() =>
      createGame(DEFAULT_GAME_CONFIG, [SEATS[0], SEATS[0]], 1, { now: 0 }),
    ).toThrow("unique player ID");
    expect(() =>
      createGame({ ...DEFAULT_GAME_CONFIG, startingCash: 1.5 }, SEATS, 1, {
        now: 0,
      }),
    ).toThrow("integer");
    expect(() =>
      createGame({ ...DEFAULT_GAME_CONFIG, roundLimit: 0 }, SEATS, 1, {
        now: 0,
      }),
    ).toThrow("positive integer");
    expect(() =>
      createGame({ ...DEFAULT_GAME_CONFIG, timeLimitMinutes: 0 }, SEATS, 1, {
        now: 0,
      }),
    ).toThrow("positive");
    expect(() =>
      createGame({ ...DEFAULT_GAME_CONFIG, festivalCount: 21 }, SEATS, 1, {
        now: 0,
      }),
    ).toThrow("0 to 20");
  });
});
