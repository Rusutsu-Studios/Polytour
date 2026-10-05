import { describe, expect, it } from "vitest";
import {
  BOT_TIMING,
  DECISION_TIMING,
  getBoard,
  isCityTile,
} from "../board/index.js";
import type { GameState, Seat, SeatInfo } from "./index.js";
import {
  applyAction,
  applyEvent,
  botDecisionAt,
  chanceDeck,
  createGame,
  DEFAULT_GAME_CONFIG,
  decisionOpensAt,
  shuffle,
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
      bankReceived: 0,
      bankPaidOut: 0,
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
      deadline: 30_100 + DECISION_TIMING.startAnimation,
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
    expect(state.deck).toHaveLength(36);
    expect(events).toHaveLength(1);
    expect(events.reduce(applyEvent, toPublic(state))).toEqual(toPublic(state));
  });
  it("chooses a random starter, then circles clockwise through every occupied seat", () => {
    const tables: readonly (readonly Seat[])[] = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3],
      [0, 1, 2, 3],
    ];
    for (const table of tables) {
      const starters = new Set<Seat>();
      for (let seed = 0; seed < 100; seed += 1) {
        // Input order must not change the fixed corners or direction.
        const seats = [...table]
          .reverse()
          .map((seat) => ({ ...SEATS[seat], seat }));
        const { state } = createGame(DEFAULT_GAME_CONFIG, seats, seed, {
          now: 100,
        });
        const starter = shuffle(table, seed).items[0];
        const index = table.indexOf(starter);
        const expected = [...table.slice(index), ...table.slice(0, index)];
        expect(state.config.turnOrderRule).toBe("clockwise");
        expect(state.turnOrder).toEqual(expected);
        expect(state.startingTurnOrder).toEqual(expected);
        expect(state.roundSeatsRemaining).toEqual(expected);
        expect(state.activeSeat).toBe(starter);
        starters.add(starter);
      }
      expect([...starters].sort()).toEqual(table);
    }
  });
  it("keeps the old shuffle and setup RNG consumption for legacy lobbies", () => {
    const seats = SEATS.map((entry, seat) => ({
      ...entry,
      seat: seat as Seat,
    }));
    for (let seed = 0; seed < 100; seed += 1) {
      const clockwise = createGame(DEFAULT_GAME_CONFIG, seats, seed, {
        now: 100,
      }).state;
      const legacy = createGame(
        { ...DEFAULT_GAME_CONFIG, turnOrderRule: "shuffled" },
        seats,
        seed,
        { now: 100 },
      ).state;
      expect(legacy.turnOrder).toEqual(shuffle([0, 1, 2, 3], seed).items);
      expect(clockwise.activeSeat).toBe(legacy.activeSeat);
      expect(clockwise.deck).toEqual(legacy.deck);
      expect(clockwise.festivalTiles).toEqual(legacy.festivalTiles);
      expect(clockwise.rngState).toBe(legacy.rngState);
      expect(decisionOpensAt(clockwise)).toBe(
        100 + DECISION_TIMING.startAnimation,
      );
      expect(botDecisionAt(clockwise)).toBe(
        100 + DECISION_TIMING.startAnimation + BOT_TIMING.roll,
      );
      expect(decisionOpensAt(legacy)).toBe(100);
      expect(botDecisionAt(legacy)).toBe(100 + BOT_TIMING.roll);
    }
    expect(() =>
      createGame(
        { ...DEFAULT_GAME_CONFIG, turnOrderRule: "reverse" as "clockwise" },
        seats,
        1,
        { now: 0 },
      ),
    ).toThrow("turn order rule");
  });
  it("keeps the clockwise cycle through bankruptcy and starts the next round in the same order", () => {
    let state = createGame(
      { ...DEFAULT_GAME_CONFIG, festivalCount: 0, roundLimit: 3 },
      SEATS,
      42,
      { now: 0 },
    ).state;
    const eliminated = state.startingTurnOrder[1];
    const cycle = state.startingTurnOrder.filter((seat) => seat !== eliminated);
    state = {
      ...state,
      ...applyEvent(toPublic(state), {
        type: "PlayerBankrupt",
        seat: eliminated,
        creditor: null,
        writtenOff: 0,
        turnOrder: cycle,
        roundSeatsRemaining: cycle,
      }),
    };
    for (let turn = 0; turn < cycle.length * 2; turn += 1) {
      expect(state.activeSeat).toBe(cycle[turn % cycle.length]);
      expect(state.round).toBe(Math.floor(turn / cycle.length) + 1);
      // Place the current pawn at Start to isolate turn progression from landings.
      state = {
        ...state,
        players: state.players.map((player) =>
          player.seat === state.activeSeat
            ? { ...player, position: 0 }
            : player,
        ),
      };
      const rolled = applyAction(
        state,
        state.activeSeat,
        { type: "Roll" },
        {
          now: turn * 1000 + 1,
          dice: [1, 2],
        },
      );
      expect(rolled.ok).toBe(true);
      if (!rolled.ok) throw new Error("Roll failed");
      const ended = applyAction(
        rolled.state,
        state.activeSeat,
        { type: "Decline" },
        {
          now: turn * 1000 + 2,
        },
      );
      expect(ended.ok).toBe(true);
      if (!ended.ok) throw new Error("Decline failed");
      state = ended.state as GameState;
      expect(ended.events.reduce(applyEvent, toPublic(rolled.state))).toEqual(
        toPublic(state),
      );
    }
  });
  it("includes Escape in a version-9 deck only when marked, and freezes its marker", () => {
    for (const escapeCard of [true, false, undefined]) {
      // Version 9 decks: the original cards, with or without Escape.
      const { state } = createGame(
        { ...DEFAULT_GAME_CONFIG, chanceRule: "original", escapeCard },
        SEATS,
        42,
        { now: 0 },
      );
      expect(state.config.escapeCard).toBe(escapeCard ?? true);
      expect([...state.deck].sort()).toEqual(
        [...chanceDeck(state.config)].sort(),
      );
      expect(state.deck.includes("Escape")).toBe(escapeCard ?? true);
    }
    expect(chanceDeck({})).not.toContain("Escape");
    expect(chanceDeck({ chanceRule: "reworked" })).toContain("Escape");
    expect(() =>
      createGame(
        { ...DEFAULT_GAME_CONFIG, escapeCard: "yes" as unknown as boolean },
        SEATS,
        42,
        { now: 0 },
      ),
    ).toThrow("Escape card rule");
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
  it.each(["country", "legacy"] as const)(
    "draws initial festivals only on cities on the %s board",
    (boardRule) => {
      const cities = getBoard(boardRule)
        .filter(isCityTile)
        .map((tile) => tile.index);
      for (const economyRule of ["reference", "prototype"] as const) {
        for (const festivalCount of [0, 3, 20]) {
          for (let seed = 0; seed < 100; seed += 1) {
            const game = createGame(
              { ...DEFAULT_GAME_CONFIG, boardRule, economyRule, festivalCount },
              SEATS,
              seed,
              { now: 0 },
            );
            expect(game.state.config.resortFestivals).toBe(false);
            expect(game.state.festivalTiles).toHaveLength(festivalCount);
            expect(new Set(game.state.festivalTiles).size).toBe(festivalCount);
            expect(
              game.state.festivalTiles.every((tile) => cities.includes(tile)),
            ).toBe(true);
            expect(
              game.events.reduce(applyEvent, toPublic(game.state)),
            ).toEqual(toPublic(game.state));
          }
        }
      }
    },
  );
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
        resortFestivals: undefined,
      },
      SEATS,
      1,
      { now: 0 },
    );
    expect(toPublic(game.state).config).toMatchObject({
      boardRule: "country",
      economyRule: "reference",
      sellBackPercent: 100,
      resortFestivals: false,
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
      createGame(
        {
          ...DEFAULT_GAME_CONFIG,
          resortFestivals: "yes" as unknown as boolean,
        },
        SEATS,
        1,
        { now: 0 },
      ),
    ).toThrow("festival rule");
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
