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
      config: { hotelPurchaseRule: "staged-hotels", economyRule: "reference" },
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
  it("keeps the table seats of a smaller room, including an empty seat between players", () => {
    const { state, events } = createGame(
      DEFAULT_GAME_CONFIG,
      [
        { ...SEATS[3], seat: 3 },
        { ...SEATS[0], seat: 0 },
        { ...SEATS[1], seat: 1 },
      ],
      42,
      { now: 0 },
    );
    expect(state.players.map((player) => [player.seat, player.name])).toEqual([
      [0, "Ada"],
      [1, "Bea"],
      [3, "Dan"],
    ]);
    expect([...state.turnOrder].sort()).toEqual([0, 1, 3]);
    expect(state.pending?.seat).toBe(state.turnOrder[0]);
    expect(events.reduce(applyEvent, toPublic(state))).toEqual(toPublic(state));
    expect(() =>
      createGame(
        DEFAULT_GAME_CONFIG,
        [
          { ...SEATS[0], seat: 2 },
          { ...SEATS[1], seat: 2 },
        ],
        1,
        { now: 0 },
      ),
    ).toThrow("unique table seat");
  });
  it("freezes the staged hotel rule for new games even when no marker is supplied", () => {
    const game = createGame(
      { ...DEFAULT_GAME_CONFIG, hotelPurchaseRule: undefined },
      SEATS,
      1,
      { now: 0 },
    );
    expect(game.state.config.hotelPurchaseRule).toBe("staged-hotels");
    expect(toPublic(game.state).config.hotelPurchaseRule).toBe("staged-hotels");
    const legacy = createGame(
      { ...DEFAULT_GAME_CONFIG, hotelPurchaseRule: "legacy-lap" },
      SEATS,
      1,
      { now: 0 },
    );
    expect(legacy.state.config.hotelPurchaseRule).toBe("legacy-lap");
  });
  it("freezes the country board and reference rules when no new-game markers are supplied", () => {
    const game = createGame(
      {
        ...DEFAULT_GAME_CONFIG,
        boardRule: undefined,
        economyRule: undefined,
        sellBackPercent: undefined,
      },
      SEATS,
      1,
      { now: 0 },
    );
    expect(toPublic(game.state).config).toMatchObject({
      boardRule: "country",
      economyRule: "reference",
      sellBackPercent: 100,
    });
    const legacy = createGame(
      {
        ...DEFAULT_GAME_CONFIG,
        boardRule: "legacy",
        economyRule: "prototype",
        sellBackPercent: 50,
      },
      SEATS,
      1,
      { now: 0 },
    );
    expect(legacy.state.config).toMatchObject({
      boardRule: "legacy",
      economyRule: "prototype",
      sellBackPercent: 50,
    });
    expect(() =>
      createGame(
        {
          ...DEFAULT_GAME_CONFIG,
          boardRule: "anywhere" as "legacy",
        },
        SEATS,
        1,
        { now: 0 },
      ),
    ).toThrow("board rule");
    expect(() =>
      createGame(
        { ...DEFAULT_GAME_CONFIG, sellBackPercent: 75 as 50 },
        SEATS,
        1,
        { now: 0 },
      ),
    ).toThrow("50 or 100");
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
