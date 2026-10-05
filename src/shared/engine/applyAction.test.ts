import { describe, expect, it } from "vitest";
import type { BuildLevel } from "../board/index.js";
import { BOT_TIMING, DECISION_TIMING } from "../board/index.js";
import type {
  Action,
  ChanceCard,
  GameConfig,
  GameEvent,
  GameState,
  PlayerState,
  Seat,
  SeatInfo,
} from "./index.js";
import {
  applyAction,
  applyEvent,
  applyTimeout,
  BAD_CHANCE_CARDS,
  botAction,
  botDecisionAt,
  buyoutPrice,
  buyoutPriceAt,
  CHANCE_CARDS,
  chanceDeck,
  changeControl,
  createGame,
  DEFAULT_GAME_CONFIG,
  economyRule,
  getPlayer,
  getProperty,
  getTileInvestedValue,
  legalActions,
  maxBuildLevel,
  netWorth,
  previewPropertyRent,
  propertyOwner,
  propertyRefund,
  propertyRent,
  propertyRentAt,
  rentBoost,
  rentCardPayment,
  resortCount,
  toPublic,
  travelSalary,
  worldTourTargets,
} from "./index.js";

const SEATS: readonly SeatInfo[] = ["Ada", "Bea", "Cy", "Dan"].map(
  (name, index) => ({ playerId: `player-${index}`, name, control: "human" }),
);
/** Saved prototype rooms (rules versions 2–3) keep these rules; see the reference block below. */
const CONFIG: GameConfig = {
  ...DEFAULT_GAME_CONFIG,
  economyRule: "prototype",
  boardRule: "legacy",
  sellBackPercent: 100,
  fourResortRent: false,
  buildAfterBuyout: false,
  escapeCard: false,
  chanceRule: "original",
  roundLimit: 20,
  timeLimitMinutes: undefined,
  festivalCount: 0,
};
function newGame(count = 4, config: GameConfig = CONFIG): GameState {
  return createGame(config, SEATS.slice(0, count), 7, { now: 0 }).state;
}
function setPlayer(
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
function grant(
  state: GameState,
  tile: number,
  seat: Seat,
  level: BuildLevel = 0,
): GameState {
  return {
    ...state,
    ...applyEvent(toPublic(state), {
      type: "PropertyBought",
      seat,
      tile,
      level,
      amount: 0,
    }),
  };
}
function money(state: Pick<GameState, "bankLedger" | "players">): number {
  return (
    state.bankLedger +
    state.players.reduce((sum, player) => sum + player.cash, 0)
  );
}
function act(
  state: GameState,
  action: Action,
  dice?: readonly [number, number],
  now = 1,
) {
  if (!state.pending) throw new Error("Expected pending decision");
  const result = applyAction(state, state.pending.seat, action, { now, dice });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.events.reduce(applyEvent, toPublic(state))).toEqual(
    toPublic(result.state),
  );
  let replay = toPublic(state);
  for (const event of result.events) {
    replay = applyEvent(replay, event);
    expect(money({ ...state, ...replay })).toBe(money(state));
  }
  return result;
}
function land(
  state: GameState,
  tile: number,
  dice: readonly [number, number] = [1, 2],
) {
  return act(
    setPlayer(state, state.activeSeat, {
      position: (tile - dice[0] - dice[1] + 32) % 32,
    }),
    { type: "Roll" },
    dice,
  );
}
function draw(
  state: GameState,
  card: ChanceCard,
  tile = state.config.boardRule === "country" ? 12 : 3,
) {
  return land({ ...state, deck: [card], discard: [] }, tile);
}
function withActive(state: GameState, seat: Seat): GameState {
  return {
    ...state,
    activeSeat: seat,
    pending: { kind: "roll", seat, deadline: 10_000 },
  };
}
function other(state: GameState): Seat {
  const seat = state.turnOrder.find((seat) => seat !== state.activeSeat);
  if (seat === undefined) throw new Error("Expected other seat");
  return seat;
}

describe("salary event reducer", () => {
  it("credits the amount rather than mismatched legacy cash without mutating the input", () => {
    const state = toPublic(newGame());
    const seat = state.activeSeat;
    const before = JSON.stringify(state);
    const cashBefore = getPlayer(state, seat).cash;
    const bankBefore = state.bankLedger;
    const totalBefore = money(state);
    for (const player of state.players) Object.freeze(player);
    Object.freeze(state.players);
    Object.freeze(state);

    const next = applyEvent(state, {
      type: "SalaryPaid",
      seat,
      amount: 400_000,
      cash: 1,
    });

    expect(getPlayer(next, seat).cash).toBe(cashBefore + 400_000);
    expect(next.bankLedger).toBe(bankBefore - 400_000);
    expect(money(next)).toBe(totalBefore);
    expect(JSON.stringify(state)).toBe(before);
    expect(next).not.toBe(state);
    expect(next.players).not.toBe(state.players);
  });

  it("adds sequential salaries, including zero amounts, instead of overwriting the balance", () => {
    const state = toPublic(newGame());
    const seat = state.activeSeat;
    let replay = state;

    for (const amount of [400_000, 200_000, 0]) {
      const previous = replay;
      replay = applyEvent(previous, {
        type: "SalaryPaid",
        seat,
        amount,
        cash: getPlayer(state, seat).cash,
      });
      expect(getPlayer(replay, seat).cash).toBe(
        getPlayer(previous, seat).cash + amount,
      );
      expect(replay.bankLedger).toBe(previous.bankLedger - amount);
      expect(money(replay)).toBe(money(state));
    }

    expect(getPlayer(replay, seat).cash).toBe(
      getPlayer(state, seat).cash + 600_000,
    );
    expect(replay.bankLedger).toBe(state.bankLedger - 600_000);
  });

  it("keeps the bank's account to salaries and bank transfers, not property money", () => {
    const state = toPublic(newGame());
    const [first, second] = state.turnOrder;
    const events: GameEvent[] = [
      { type: "SalaryPaid", seat: first, amount: 400_000, cash: 1 },
      {
        type: "MoneyTransferred",
        from: first,
        to: null,
        amount: 150_000,
        reason: "tax",
      },
      {
        type: "MoneyTransferred",
        from: null,
        to: second,
        amount: 50_000,
        reason: "card",
      },
      {
        type: "MoneyTransferred",
        from: first,
        to: second,
        amount: 70_000,
        reason: "card",
      },
      {
        type: "PropertyBought",
        seat: second,
        tile: state.properties[0].tile,
        level: 1,
        amount: 90_000,
      },
    ];
    const replay = events.reduce(applyEvent, state);

    expect(replay.bankReceived).toBe(150_000);
    expect(replay.bankPaidOut).toBe(450_000);
    // The purchase reaches the ledger, which conserves money, not the account.
    expect(replay.bankLedger).toBe(
      state.bankLedger + replay.bankReceived - replay.bankPaidOut + 90_000,
    );
    expect(money(replay)).toBe(money(state));
  });
});

describe("authoritative action validation and public replay", () => {
  it("uses injected dice without advancing private RNG and offers an affordable purchase", () => {
    const state = newGame();
    const result = land(state, 6, [2, 4]);
    expect(result.state.rngState).toBe(state.rngState);
    expect(result.state.lastRoll?.dice).toEqual([2, 4]);
    expect(result.state.pending).toMatchObject({
      kind: "buy",
      seat: state.activeSeat,
      tile: 6,
      maxLevel: 3,
    });
    expect(getPlayer(result.state, state.activeSeat).cash).toBe(2_000_000);
    expect(result.state.activeSeat).toBe(state.activeSeat);
  });
  it("rejects another seat, impossible target, unaffordable level, invalid dice and repeated action", () => {
    const state = newGame();
    expect(
      applyAction(state, other(state), { type: "Roll" }, { now: 1 }),
    ).toMatchObject({ ok: false, error: { code: "not-active-seat" } });
    expect(
      applyAction(
        state,
        state.activeSeat,
        { type: "Roll" },
        { now: 1, dice: [0, 7] },
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid-dice" } });
    const rolled = land(state, 6).state;
    expect(
      applyAction(
        rolled,
        rolled.activeSeat,
        { type: "ChooseHost", tile: 1 },
        { now: 1 },
      ),
    ).toMatchObject({ ok: false });
    expect(
      applyAction(
        rolled,
        rolled.activeSeat,
        { type: "Buy", level: 4 },
        { now: 1 },
      ),
    ).toMatchObject({ ok: false });
    const poor = setPlayer(rolled, rolled.activeSeat, { cash: 99_999 });
    expect(legalActions(poor, poor.activeSeat)).toEqual([{ type: "Decline" }]);
    const bought = act(rolled, { type: "Buy", level: 2 }).state;
    expect(
      applyAction(
        bought,
        rolled.activeSeat,
        { type: "Buy", level: 2 },
        { now: 1 },
      ),
    ).toMatchObject({ ok: false });
  });
  it("hides every server-only source of future randomness and resolution tasks", () => {
    const publicState = toPublic(newGame());
    for (const secret of [
      "rngState",
      "deck",
      "discard",
      "resolutionQueue",
      "extraRoll",
      "turnEnded",
    ])
      expect(publicState).not.toHaveProperty(secret);
  });
});
describe("property economy and build unlocking", () => {
  it("buys land and every intervening house in one transaction", () => {
    const state = newGame();
    const seat = state.activeSeat;
    const bought = act(land(state, 1).state, { type: "Buy", level: 3 });
    expect(getPlayer(bought.state, seat).cash).toBe(2_400_000 - 210_000);
    expect(getProperty(bought.state, 1)).toEqual({
      tile: 1,
      owner: seat,
      level: 3,
    });
    expect(bought.state.bankLedger).toBe(210_000 - 400_000);
    expect(netWorth(bought.state, seat)).toBe(2_400_000);
    expect(bought.state.activeSeat).not.toBe(seat);
    expect(getTileInvestedValue(1, 4, "prototype")).toBe(360_000);
    expect(getTileInvestedValue(31, 4, "prototype")).toBe(1_500_000);
  });
  it("unlocks Hotel after a lap and Landmark only on landing on one's Hotel", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = setPlayer(state, seat, { laps: 1 });
    const houses = act(land(state, 1).state, { type: "Buy", level: 3 }).state;
    const hotel = act(land(withActive(houses, seat), 1).state, {
      type: "Build",
      level: 4,
    }).state;
    const revisit = land(withActive(hotel, seat), 1).state;
    expect(legalActions(revisit, seat)).toContainEqual({
      type: "Build",
      level: 5,
    });
    const landmark = act(
      { ...revisit, championshipHost: { tile: 1, multiplier: 5 } },
      { type: "Build", level: 5 },
    ).state;
    expect(getProperty(landmark, 1)?.level).toBe(5);
    expect(landmark.championshipHost).toBeNull();
    const visitor = land(
      withActive(landmark, other(withActive(landmark, seat))),
      1,
    ).state;
    expect(visitor.pending?.kind).not.toBe("buyout");
  });
  it("uses the greatest country, festival or Championship modifier once", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = grant(grant(grant(state, 1, seat, 4), 2, seat), 3, seat);
    expect(propertyRent(state, 1)).toBe(336_000);
    state = {
      ...state,
      festivalTiles: [1],
      championshipHost: { tile: 1, multiplier: 5 },
    };
    expect(propertyRent(state, 1)).toBe(840_000);
    state = grant(state, 1, seat, 5);
    expect(propertyRent(state, 1)).toBe(240_000);
  });
  it("pays rent before buyout, pays the owner and clears a transferred host", () => {
    let state = newGame();
    const seat = state.activeSeat;
    const owner = other(state);
    state = grant(state, 1, owner, 1);
    state = { ...state, championshipHost: { tile: 1, multiplier: 2 } };
    const rented = land(state, 1);
    expect(rented.state.pending).toMatchObject({
      kind: "buyout",
      price: 220_000,
    });
    expect(getPlayer(rented.state, seat).cash).toBe(2_400_000 - 72_000);
    const bought = act(rented.state, { type: "Buyout" }).state;
    expect(propertyOwner(bought, 1)).toBe(seat);
    expect(getPlayer(bought, owner).cash).toBe(2_000_000 + 72_000 + 220_000);
    expect(bought.championshipHost).toBeNull();
  });
});
describe("dice, Island, laps and World Tour", () => {
  it("pays one salary and counts one lap when clockwise movement lands on Start", () => {
    const state = newGame();
    const result = land(state, 0, [1, 2]);
    expect(getPlayer(result.state, state.activeSeat)).toMatchObject({
      position: 0,
      laps: 1,
      cash: 2_400_000,
    });
    expect(
      result.events.filter((event) => event.type === "SalaryPaid"),
    ).toHaveLength(1);
  });
  it("finishes the landing before giving a doubles bonus and traps on third double", () => {
    const state = newGame();
    const seat = state.activeSeat;
    const first = land(state, 2, [1, 1]).state;
    expect(first.pending?.kind).toBe("buy");
    const declined = act(first, { type: "Decline" }).state;
    expect(declined.pending).toMatchObject({ kind: "roll", seat });
    expect(declined.doublesInTurn).toBe(1);
    const third = act(
      { ...declined, doublesInTurn: 2 },
      { type: "Roll" },
      [1, 1],
    ).state;
    expect(getPlayer(third, seat)).toMatchObject({
      position: 8,
      onIsland: true,
    });
    expect(third.activeSeat).not.toBe(seat);
  });
  it("keeps a third double moving when the triple-double island rule is off", () => {
    const state = newGame(4, { ...CONFIG, tripleDoubleToIsland: false });
    const seat = state.activeSeat;
    const third = act(
      { ...state, doublesInTurn: 2 },
      { type: "Roll" },
      [1, 1],
    ).state;
    expect(getPlayer(third, seat).onIsland).toBe(false);
    expect(getPlayer(third, seat).position).not.toBe(8);
  });
  it("Island escapes use the same double without an extra roll; two failures release", () => {
    const state = newGame();
    const seat = state.activeSeat;
    const trapped = {
      ...setPlayer(state, seat, { position: 8, onIsland: true }),
      pending: { kind: "island" as const, seat, fee: 100_000, deadline: 100 },
    };
    const escaped = act(trapped, { type: "Roll" }, [1, 1]).state;
    expect(getPlayer(escaped, seat).position).toBe(10);
    expect(act(escaped, { type: "Decline" }).state.activeSeat).not.toBe(seat);
    const failed = act(
      { ...setPlayer(trapped, seat, { islandTurns: 1 }) },
      { type: "Roll" },
      [1, 2],
    ).state;
    expect(getPlayer(failed, seat)).toMatchObject({
      position: 8,
      onIsland: false,
      islandTurns: 0,
    });
    const paid = act(trapped, { type: "PayIsland" }).state;
    expect(paid.pending).toMatchObject({ kind: "roll", seat });
    expect(getPlayer(paid, seat).cash).toBe(1_900_000);
  });
  it("keeps Escape until an Island turn, consumes it for a free release and then rolls normally", () => {
    const initial = newGame(4, { ...DEFAULT_GAME_CONFIG, festivalCount: 0 });
    const seat = initial.activeSeat;
    const drawn = draw(initial, "Escape").state;
    expect(getPlayer(drawn, seat).heldCards).toEqual(["Escape"]);
    expect(drawn.discard).not.toContain("Escape");
    const trapped = {
      ...setPlayer(withActive(drawn, seat), seat, {
        position: 8,
        onIsland: true,
        islandTurns: 2,
        cash: 0,
      }),
      pending: { kind: "island" as const, seat, fee: 200_000, deadline: 100 },
    };
    expect(legalActions(trapped, seat)).toEqual([
      { type: "Roll" },
      { type: "UseEscapeCard" },
    ]);
    expect(botAction(trapped, seat)).toEqual({ type: "UseEscapeCard" });
    const escaped = act(trapped, { type: "UseEscapeCard" });
    expect(escaped.events).toContainEqual({
      type: "CardUsed",
      seat,
      card: "Escape",
    });
    expect(escaped.events).toContainEqual({
      type: "LeftIsland",
      seat,
      method: "card",
    });
    expect(getPlayer(escaped.state, seat)).toMatchObject({
      position: 8,
      cash: 0,
      onIsland: false,
      islandTurns: 0,
      heldCards: [],
    });
    expect(escaped.state.pending).toMatchObject({ kind: "roll", seat });
    expect(
      escaped.state.discard.filter((card) => card === "Escape"),
    ).toHaveLength(1);
    const rolled = act(escaped.state, { type: "Roll" }, [1, 1]).state;
    expect(getPlayer(rolled, seat).position).toBe(10);
    expect(act(rolled, { type: "Decline" }).state.pending).toMatchObject({
      kind: "roll",
      seat,
    });
    for (const invalid of [
      setPlayer(trapped, seat, { heldCards: [] }),
      { ...trapped, pending: { kind: "roll" as const, seat, deadline: 100 } },
    ])
      expect(
        applyAction(invalid, seat, { type: "UseEscapeCard" }, { now: 1 }).ok,
      ).toBe(false);
    expect(
      applyAction(
        trapped,
        other(trapped),
        { type: "UseEscapeCard" },
        { now: 1 },
      ).ok,
    ).toBe(false);
  });
  it("does not offer Escape as a rent card and preserves the automatic Jailbreak effect", () => {
    const initial = newGame(4, { ...DEFAULT_GAME_CONFIG, festivalCount: 0 });
    const seat = initial.activeSeat;
    const owner = other(initial);
    const withCard = setPlayer(grant(initial, 1, owner, 1), seat, {
      heldCards: ["Escape"],
    });
    const rented = land(withCard, 1).state;
    expect(rented.pending?.kind).not.toBe("rent-card");
    expect(getPlayer(rented, seat).heldCards).toEqual(["Escape"]);
    const mixed = land(
      setPlayer(withCard, seat, { heldCards: ["Escape", "Coupon"] }),
      1,
    ).state;
    expect(mixed.pending).toMatchObject({
      kind: "rent-card",
      cards: ["Coupon"],
    });
    expect(legalActions(mixed, seat)).not.toContainEqual({
      type: "UseRentCard",
      card: "Escape",
    });
    const saved = setPlayer(newGame(), owner, { position: 8, onIsland: true });
    expect(getPlayer(draw(saved, "Jailbreak").state, owner).onIsland).toBe(
      false,
    );
  });
  it("World Tour ends doubles, grants a next-turn option and clockwise travel resolves salary", () => {
    const state = newGame();
    const seat = state.activeSeat;
    const landed = land(state, 24, [1, 1]).state;
    expect(landed.activeSeat).not.toBe(seat);
    expect(getPlayer(landed, seat).travelPending).toBe(true);
    const turn = {
      ...withActive(landed, seat),
      pending: {
        kind: "travel" as const,
        seat,
        fee: 50_000,
        deadline: 100,
        targets: [0, 1],
      },
    };
    const travelled = act(turn, { type: "Travel", tile: 1 }).state;
    expect(getPlayer(travelled, seat)).toMatchObject({
      position: 1,
      laps: 1,
      cash: 2_350_000,
      travelPending: false,
    });
    expect(travelled.pending?.kind).toBe("buy");
    const finished = act(travelled, { type: "Decline" }).state;
    expect(finished.activeSeat).not.toBe(seat);
  });
  it("World Tour to a space behind it walks on round the board and collects salary at Start", () => {
    const state = newGame();
    const seat = state.activeSeat;
    const turn = {
      ...withActive(setPlayer(state, seat, { position: 24 }), seat),
      pending: {
        kind: "travel" as const,
        seat,
        fee: 50_000,
        deadline: 100,
        targets: [0, 23, 25],
      },
    };
    expect(travelSalary(toPublic(turn), seat, 23)).toBe(400_000);
    expect(travelSalary(toPublic(turn), seat, 0)).toBe(400_000);
    expect(travelSalary(toPublic(turn), seat, 25)).toBe(0);
    // Tile 23 is one space behind World Tour: the flight takes 31 steps.
    const behind = act(turn, { type: "Travel", tile: 23 });
    expect(behind.events).toContainEqual({
      type: "PlayerMoved",
      seat,
      from: 24,
      position: 23,
      steps: 31,
      laps: 1,
    });
    expect(
      behind.events.filter((event) => event.type === "SalaryPaid"),
    ).toEqual([{ type: "SalaryPaid", seat, amount: 400_000, cash: 2_350_000 }]);
    expect(getPlayer(behind.state, seat)).toMatchObject({
      position: 23,
      laps: 1,
      cash: 2_350_000,
    });
    // The clock waits for the fee, a walk no longer than the longest dice
    // walk, and the salary.
    expect(behind.state.pending).toMatchObject({
      kind: "buy",
      deadline:
        1 +
        DECISION_TIMING.moneyAnimation +
        DECISION_TIMING.walkAnimation +
        DECISION_TIMING.moneyAnimation +
        DECISION_TIMING.choice,
    });
    const ahead = act(turn, { type: "Travel", tile: 25 });
    expect(
      ahead.events.filter((event) => event.type === "SalaryPaid"),
    ).toHaveLength(0);
    expect(getPlayer(ahead.state, seat)).toMatchObject({
      position: 25,
      laps: 0,
      cash: 1_950_000,
    });
    expect(ahead.state.pending).toMatchObject({
      kind: "buy",
      deadline:
        1 +
        DECISION_TIMING.moneyAnimation +
        DECISION_TIMING.stepAnimation +
        DECISION_TIMING.choice,
    });
  });
  it("a version-5 reference World Tour reaches free properties first, then only the traveller's own", () => {
    let state = newGame(4, {
      ...CONFIG,
      economyRule: "reference",
      boardRule: "country",
      worldTourRule: "free-first",
    });
    const seat = state.activeSeat;
    const rival = other(state);
    state = grant(grant(grant(state, 1, seat, 2), 2, rival), 5, rival);
    let next = land(state, 24).state;
    while (next.pending?.seat !== seat)
      next = act(
        next,
        next.pending?.kind === "roll" ? { type: "Roll" } : { type: "Decline" },
        [3, 4],
      ).state;
    expect(next.pending).toMatchObject({ kind: "travel", seat });
    const targets = next.pending?.kind === "travel" ? next.pending.targets : [];
    // With free properties left, the traveller's own spaces are excluded too.
    expect(targets).toEqual([
      3, 4, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22, 23, 25, 26, 27, 29,
      31,
    ]);
    expect(legalActions(next, seat)).not.toContainEqual({
      type: "Travel",
      tile: 2,
    });
    for (const tile of [0, 1, 2, 12, 8, 16, 30])
      expect(
        applyAction(next, seat, { type: "Travel", tile }, { now: 1 }).ok,
      ).toBe(false);
    const fullyOwned = {
      ...next,
      properties: next.properties.map((property) => ({
        ...property,
        owner: property.tile === 1 ? seat : rival,
      })),
    };
    expect(worldTourTargets(fullyOwned, seat)).toEqual([1]);
    const home = act(
      {
        ...fullyOwned,
        pending: {
          kind: "travel",
          seat,
          targets: [1],
          fee: 50_000,
          deadline: 30_000,
        },
      },
      { type: "Travel", tile: 1 },
    ).state;
    expect(getPlayer(home, seat)).toMatchObject({
      position: 1,
      laps: 1,
      cash: 2_350_000,
      travelPending: false,
    });
    // A save without the economy marker keeps its original travel-anywhere rule.
    const { economyRule: _marker, ...legacyConfig } = next.config;
    expect(
      worldTourTargets({ ...toPublic(next), config: legacyConfig }, seat),
    ).toHaveLength(31);
    // A version-5 save carries no World Tour marker and keeps this rule; a
    // version-6 room adds the traveller's own property (tile 1) to the list.
    const { worldTourRule: _tour, ...version5 } = next.config;
    expect(
      worldTourTargets({ ...toPublic(next), config: version5 }, seat),
    ).toEqual(targets);
    expect(
      worldTourTargets(
        {
          ...toPublic(next),
          config: { ...next.config, worldTourRule: "free-and-own" },
        },
        seat,
      ),
    ).toEqual([1, ...targets]);
  });
});
describe("forced sales and bankruptcy", () => {
  it("quotes land and every standing building at full investment, independently of toll bonuses", () => {
    let state = newGame();
    const seat = state.activeSeat;
    for (const level of [0, 1, 2, 3, 4, 5] as const) {
      state = grant(state, 1, seat, level);
      expect(propertyRefund(state, 1)).toBe(
        getTileInvestedValue(1, level, "prototype", "legacy"),
      );
    }
    state = grant(grant(state, 31, seat, 4), 5, seat);
    expect(propertyRefund(state, 31)).toBe(1_500_000);
    expect(propertyRefund(state, 5)).toBe(200_000);
    expect(
      propertyRefund(
        {
          ...state,
          festivalTiles: [31],
          championshipHost: { tile: 31, multiplier: 8 },
        },
        31,
      ),
    ).toBe(1_500_000);
  });
  it("keeps half-investment refunds on preexisting saves without a frozen sale marker", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = grant(grant(state, 4, other(state), 1), 6, seat);
    const { sellBackPercent: _marker, ...legacyConfig } = state.config;
    state = setPlayer({ ...state, config: legacyConfig }, seat, {
      cash: 10_000,
    });
    expect(propertyRefund(state, 6)).toBe(50_000);
    const debtor = land(state, 4).state;
    const sold = act(debtor, { type: "Sell", tile: 6 });
    expect(getPlayer(sold.state, seat).cash).toBe(6_000);
    expect(sold.events).toContainEqual({
      type: "PropertySold",
      seat,
      tile: 6,
      amount: 50_000,
    });
    expect(sold.state.config).not.toHaveProperty("sellBackPercent");
  });
  it("allows a sale to cover debt that the old half-price quote could not cover", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = grant(grant(state, 4, other(state), 2), 6, seat);
    state = setPlayer(state, seat, { cash: 10_000 });
    const debtor = land(state, 4).state;
    expect(getPlayer(debtor, seat).cash).toBe(-80_000);
    expect(debtor.pending).toMatchObject({ kind: "sell", seat, targets: [6] });
    const sold = act(debtor, { type: "Sell", tile: 6 });
    expect(getPlayer(sold.state, seat)).toMatchObject({
      cash: 20_000,
      bankrupt: false,
      properties: [],
    });
    expect(sold.events).toContainEqual({
      type: "PropertySold",
      seat,
      tile: 6,
      amount: 100_000,
    });
    expect(getProperty(sold.state, 6)).toMatchObject({ owner: null, level: 0 });
  });
  it("pauses after a mandatory rent, allows a refund and resumes the landing", () => {
    let state = newGame(4, { ...CONFIG, boardRule: "country" });
    const seat = state.activeSeat;
    state = grant(grant(state, 3, other(state), 1), 5, seat);
    state = setPlayer(state, seat, { cash: 10_000 });
    const debtor = land(state, 3).state;
    expect(debtor.pending).toMatchObject({ kind: "sell", seat, targets: [5] });
    expect(getPlayer(debtor, seat).cash).toBe(-44_000);
    const sold = act(debtor, { type: "Sell", tile: 5 }).state;
    expect(getPlayer(sold, seat)).toMatchObject({
      cash: 56_000,
      bankrupt: false,
      properties: [],
    });
    expect(propertyOwner(sold, 5)).toBeNull();
    expect(sold.pending?.kind).toBe("roll");
  });
  it("skips impossible sales, absorbs the written-off debt and returns properties/cards", () => {
    let state = newGame(2);
    const seat = state.activeSeat;
    const owner = other(state);
    state = grant(grant(state, 31, owner, 4), 1, seat);
    state = setPlayer(state, seat, { cash: 0, heldCards: ["Coupon"] });
    const result = act(land(state, 31).state, { type: "Decline" });
    expect(getPlayer(result.state, seat)).toMatchObject({
      bankrupt: true,
      cash: 0,
      properties: [],
      heldCards: [],
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "PlayerBankrupt",
        writtenOff: 1_120_000,
      }),
    );
    expect(propertyOwner(result.state, 1)).toBeNull();
    expect(result.state.discard).toContain("Coupon");
    expect(result.state.result).toMatchObject({
      winner: owner,
      kind: "last-standing",
    });
  });
  it("resolves Birthday payers in order, including another player's forced sale", () => {
    let state = newGame(4, { ...CONFIG, boardRule: "country" });
    const seat = state.activeSeat;
    const payer = state.turnOrder.find(
      (candidate) => candidate !== seat,
    ) as Seat;
    state = grant(state, 5, payer);
    state = setPlayer(state, payer, { cash: 20_000 });
    const result = draw(state, "Birthday").state;
    expect(result.pending).toMatchObject({ kind: "sell", seat: payer });
    expect(result.activeSeat).toBe(seat);
    const settled = act(result, { type: "Sell", tile: 5 }).state;
    expect(getPlayer(settled, seat).cash).toBe(2_150_000);
    expect(getPlayer(settled, payer).cash).toBe(70_000);
  });
  it("timeout sells cheapest refunds repeatedly until solvent", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = grant(
      grant(grant(state, 31, other(state), 1), 1, seat),
      2,
      seat,
      3,
    );
    state = setPlayer(state, seat, { cash: 120_000 });
    const debtor = land(state, 31).state;
    expect(debtor.pending?.kind).toBe("sell");
    const timeout = applyTimeout(debtor, {
      now: debtor.pending?.deadline ?? 0,
    });
    expect(timeout.events.reduce(applyEvent, toPublic(debtor))).toEqual(
      toPublic(timeout.state),
    );
    expect(
      timeout.events
        .filter((event) => event.type === "PropertySold")
        .map((event) => event.tile),
    ).toEqual([1, 2]);
    expect(getPlayer(timeout.state, seat).cash).toBe(160_000);
  });
});

describe("the original sixteen Chance cards", () => {
  it("movement cards follow clockwise laps, Detour never pays Start, and corner cards end doubles", () => {
    const state = newGame(4, { ...CONFIG, boardRule: "country" });
    const seat = state.activeSeat;
    const grand = draw(state, "Grand Tour");
    expect(getPlayer(grand.state, seat)).toMatchObject({
      position: 0,
      laps: 1,
      cash: 2_400_000,
    });
    // Detour steps back from the first Chance square without any salary.
    const detour = draw(state, "Detour");
    expect(getPlayer(detour.state, seat)).toMatchObject({
      position: 9,
      laps: 0,
      cash: 2_000_000,
    });
    expect(getPlayer(draw(state, "Stranded").state, seat)).toMatchObject({
      onIsland: true,
      position: 8,
    });
    const jet = draw(state, "Jet Set").state;
    expect(getPlayer(jet, seat)).toMatchObject({
      position: 24,
      travelPending: true,
    });
    expect(jet.activeSeat).not.toBe(seat);
    const stadium = draw(grant(state, 1, seat), "Stadium Call", 28).state;
    expect(stadium.pending).toMatchObject({ kind: "host", targets: [1] });
    expect(getPlayer(stadium, seat)).toMatchObject({
      position: 16,
      laps: 1,
      cash: 2_400_000,
    });
  });
  it("bank grants, fines, rounded Audit, Charity and Birthday transfer conserved cash", () => {
    const state = newGame();
    const seat = state.activeSeat;
    expect(getPlayer(draw(state, "Windfall").state, seat).cash).toBe(2_150_000);
    expect(getPlayer(draw(state, "Parking Fine").state, seat).cash).toBe(
      1_900_000,
    );
    expect(
      getPlayer(
        draw(setPlayer(state, seat, { cash: 1_234_501 }), "Audit").state,
        seat,
      ).cash,
    ).toBe(1_111_050);
    const poor = other(state);
    const charitable = draw(
      setPlayer(state, poor, { cash: 50_000 }),
      "Charity",
    ).state;
    expect(getPlayer(charitable, poor).cash).toBe(150_000);
    expect(getPlayer(charitable, seat).cash).toBe(1_900_000);
    const birthday = draw(state, "Birthday").state;
    expect(getPlayer(birthday, seat).cash).toBe(2_150_000);
  });
  it("keeps each rent card, uses at most one and returns it to the discard pile", () => {
    for (const card of ["Guardian Angel", "Coupon"] as const) {
      let state = newGame();
      const seat = state.activeSeat;
      state = draw(state, card).state;
      expect(getPlayer(state, seat).heldCards).toEqual([card]);
      expect(state.discard).not.toContain(card);
      state = grant(
        withActive(state, seat),
        1,
        other(withActive(state, seat)),
        1,
      );
      const offered = land(state, 1).state;
      expect(offered.pending?.kind).toBe("rent-card");
      const used = act(offered, { type: "UseRentCard", card }).state;
      expect(getPlayer(used, seat).heldCards).toEqual([]);
      expect(used.discard).toContain(card);
      expect(getPlayer(used, seat).cash).toBe(
        card === "Guardian Angel" ? 2_400_000 : 2_382_000,
      );
    }
  });
  it("Earthquake excludes Landmarks, and Contractor obeys the Hotel unlock", () => {
    let state = newGame();
    const seat = state.activeSeat;
    const rival = other(state);
    state = grant(grant(grant(state, 1, rival, 4), 2, rival, 5), 6, seat, 2);
    const earthquake = draw(state, "Earthquake").state;
    expect(earthquake.pending).toMatchObject({
      kind: "card-target",
      targets: [1],
    });
    expect(
      getProperty(act(earthquake, { type: "ChooseTarget", tile: 1 }).state, 1)
        ?.level,
    ).toBe(3);
    const contractor = draw(state, "Contractor").state;
    expect(contractor.pending).toMatchObject({
      kind: "card-target",
      targets: [6],
    });
    const built = act(contractor, { type: "ChooseTarget", tile: 6 }).state;
    expect(getProperty(built, 6)?.level).toBe(3);
    expect(getPlayer(built, seat).cash).toBe(2_000_000);
    const noHotel = draw(withActive(built, seat), "Contractor").state;
    expect(noHotel.pending?.kind).toBe("roll");
  });
  it("Land Swap exchanges the cheapest eligible city while retaining levels and clearing hosts", () => {
    let state = newGame();
    const seat = state.activeSeat;
    const rival = other(state);
    state = grant(grant(grant(state, 6, seat, 3), 7, seat), 1, rival, 2);
    state = { ...state, championshipHost: { tile: 1, multiplier: 5 } };
    const offered = draw(state, "Land Swap").state;
    expect(offered.pending).toMatchObject({
      kind: "card-target",
      targets: [1],
      sourceTile: 6,
    });
    const swapped = act(offered, { type: "ChooseTarget", tile: 1 }).state;
    expect(getProperty(swapped, 6)).toMatchObject({ owner: rival, level: 3 });
    expect(getProperty(swapped, 1)).toMatchObject({ owner: seat, level: 2 });
    expect(swapped.championshipHost).toBeNull();
  });
  it("Jailbreak releases everyone without moving them and a targetless card does nothing", () => {
    const state = newGame();
    const rival = other(state);
    const freed = draw(
      setPlayer(state, rival, { position: 8, onIsland: true, islandTurns: 1 }),
      "Jailbreak",
    ).state;
    expect(getPlayer(freed, rival)).toMatchObject({
      position: 8,
      onIsland: false,
      islandTurns: 0,
    });
    for (const card of ["Earthquake", "Land Swap", "Contractor"] as const)
      expect(draw(state, card).state.pending?.kind).toBe("roll");
  });
  it("reshuffles only discarded cards, excluding held rent cards", () => {
    const state = newGame();
    const seat = state.activeSeat;
    const prepared = setPlayer(
      { ...state, deck: [], discard: ["Windfall", "Coupon"] },
      seat,
      { heldCards: ["Guardian Angel"] },
    );
    const result = land(prepared, 3).state;
    expect(result.deck).not.toContain("Guardian Angel");
    expect(result.discard).not.toContain("Guardian Angel");
    expect(getPlayer(result, seat).heldCards).toContain("Guardian Angel");
  });
  it("has a handled branch for every configured card", () => {
    for (const card of CHANCE_CARDS)
      expect(draw(newGame(), card).state.lastCard?.card).toBe(card);
  });
});
describe("the reworked Chance deck (rules version 10)", () => {
  const REWORKED: GameConfig = {
    ...DEFAULT_GAME_CONFIG,
    roundLimit: 20,
    timeLimitMinutes: undefined,
    festivalCount: 0,
  };
  /** A live draw: the first entropy word picks the card, the next the die. */
  function drawLive(
    state: GameState,
    card: ChanceCard,
    die: number,
    tile = 12,
  ) {
    const ready = setPlayer(
      { ...state, deck: [card], discard: [] },
      state.activeSeat,
      { position: tile - 3 },
    );
    const result = applyAction(
      ready,
      ready.activeSeat,
      { type: "Roll" },
      { now: 1, dice: [1, 2], chanceEntropy: [0, die - 1] },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.events.reduce(applyEvent, toPublic(ready))).toEqual(
      toPublic(result.state),
    );
    return result;
  }
  it("deals bad cards half the time, Fan Trip rarely, and keeps old rooms on sixteen cards", () => {
    const deck = chanceDeck(REWORKED);
    const bad = deck.filter((card) => BAD_CHANCE_CARDS.includes(card));
    expect(deck).toHaveLength(36);
    expect(bad.length / deck.length).toBe(0.5);
    expect(deck.filter((card) => card === "Fan Trip")).toHaveLength(1);
    expect(new Set(deck)).toEqual(new Set(CHANCE_CARDS));
    expect(newGame(4, REWORKED).deck).toHaveLength(36);
    expect(chanceDeck(CONFIG)).toHaveLength(16);
    expect(chanceDeck({})).toEqual(chanceDeck(CONFIG));
    expect(chanceDeck(CONFIG)).not.toContain("Power Cut");
  });
  it("sends Audit to the Tax office, which charges the tax there", () => {
    let state = newGame(4, REWORKED);
    const seat = state.activeSeat;
    state = grant(state, 1, seat, 1);
    const audited = draw(state, "Audit");
    expect(getPlayer(audited.state, seat)).toMatchObject({
      position: 30,
      laps: 0,
    });
    const tax = audited.events.find(
      (event) => event.type === "MoneyTransferred" && event.reason === "Tax",
    );
    expect(tax).toMatchObject({ from: seat, to: null });
    expect(getPlayer(audited.state, seat).cash).toBe(
      2_000_000 - (tax?.type === "MoneyTransferred" ? tax.amount : 0),
    );
  });
  it("rolls a die for Detour and Tailwind, paying salary when Tailwind passes Start", () => {
    const state = newGame(4, REWORKED);
    const seat = state.activeSeat;
    const back = drawLive(state, "Detour", 2);
    expect(back.events).toContainEqual(
      expect.objectContaining({ type: "CardDrawn", card: "Detour", roll: 2 }),
    );
    expect(getPlayer(back.state, seat)).toMatchObject({
      position: 10,
      laps: 0,
    });
    const forward = drawLive(state, "Tailwind", 6, 28);
    expect(forward.events).toContainEqual(
      expect.objectContaining({ type: "CardDrawn", card: "Tailwind", roll: 6 }),
    );
    expect(getPlayer(forward.state, seat)).toMatchObject({
      position: 2,
      laps: 1,
      cash: 2_400_000,
    });
    // Seeded simulations roll from the private sequence instead.
    const seeded = draw(state, "Detour");
    const drawn = seeded.events.find((event) => event.type === "CardDrawn");
    expect(drawn?.type === "CardDrawn" ? drawn.roll : 0).toBeGreaterThan(0);
    expect(seeded.state.rngState).not.toBe(state.rngState);
  });
  it("Power Cut stops a rival city's rent until its owner passes Start three times", () => {
    let state = newGame(4, REWORKED);
    const seat = state.activeSeat;
    const rival = other(state);
    state = grant(grant(state, 1, rival, 2), 2, rival);
    const offered = draw(state, "Power Cut").state;
    expect(offered.pending).toMatchObject({
      kind: "card-target",
      card: "Power Cut",
      targets: [1, 2],
    });
    // A bot or an expired decision cuts the city that earns the most.
    expect(botAction(offered, seat)).toEqual({ type: "ChooseTarget", tile: 1 });
    const cut = act(offered, { type: "ChooseTarget", tile: 1 });
    expect(cut.events).toContainEqual({
      type: "PowerCut",
      seat,
      tile: 1,
      untilLap: 3,
    });
    expect(propertyRent(cut.state, 1)).toBe(0);
    expect(propertyRent(cut.state, 2)).toBeGreaterThan(0);
    // A cut city is not a target again while its power is off.
    const again = draw(withActive(cut.state, seat), "Power Cut").state;
    expect(again.pending).toMatchObject({ targets: [2] });
    expect(propertyRent(setPlayer(cut.state, rival, { laps: 2 }), 1)).toBe(0);
    expect(
      propertyRent(setPlayer(cut.state, rival, { laps: 3 }), 1),
    ).toBeGreaterThan(0);
    // A new owner restores the power.
    const sold = applyEvent(toPublic(cut.state), {
      type: "PropertySold",
      seat: rival,
      tile: 1,
      amount: 0,
    });
    expect(getProperty(sold, 1)).not.toHaveProperty("powerCutUntilLap");
  });
  it("Forced Sale refunds a rival property to the bank, and only drops a Hotel one level", () => {
    let state = newGame(4, REWORKED);
    const rival = other(state);
    state = grant(grant(grant(state, 1, rival, 2), 2, rival, 4), 4, rival);
    const offered = draw(state, "Forced Sale").state;
    expect(offered.pending).toMatchObject({
      card: "Forced Sale",
      targets: [1, 2, 4],
    });
    const cash = getPlayer(offered, rival).cash;
    const sold = act(offered, { type: "ChooseTarget", tile: 1 }).state;
    expect(getProperty(sold, 1)).toMatchObject({ owner: null, level: 0 });
    expect(getPlayer(sold, rival).cash).toBe(cash + propertyRefund(offered, 1));
    const hotel = act(offered, { type: "ChooseTarget", tile: 2 }).state;
    expect(getProperty(hotel, 2)).toMatchObject({ owner: rival, level: 3 });
    expect(getPlayer(hotel, rival).cash).toBe(
      cash + propertyRefund(offered, 2) - propertyRefund(hotel, 2),
    );
    expect(getPlayer(hotel, rival).cash).toBeGreaterThan(cash);
  });
  it("a Shield floats over one of your properties and absorbs the next attack", () => {
    let state = newGame(4, REWORKED);
    const seat = state.activeSeat;
    const rival = other(state);
    state = grant(grant(state, 1, seat, 2), 4, seat);
    const offered = draw(state, "Shield").state;
    expect(offered.pending).toMatchObject({ card: "Shield", targets: [1, 4] });
    const shielded = act(offered, { type: "ChooseTarget", tile: 1 }).state;
    expect(getProperty(shielded, 1)?.shielded).toBe(true);
    // A rival's Earthquake breaks the shield instead of a house.
    const attack = draw(withActive(shielded, rival), "Earthquake").state;
    expect(attack.pending).toMatchObject({ targets: [1] });
    const blocked = act(attack, { type: "ChooseTarget", tile: 1 });
    expect(blocked.events).toContainEqual({
      type: "ShieldBroken",
      seat: rival,
      tile: 1,
    });
    expect(getProperty(blocked.state, 1)?.level).toBe(2);
    expect(getProperty(blocked.state, 1)).not.toHaveProperty("shielded");
    // Attack decisions prefer a city without a shield.
    const exposed = grant(shielded, 2, seat, 1);
    const choice = draw(withActive(exposed, rival), "Earthquake").state;
    expect(botAction(choice, rival)).toEqual({
      type: "ChooseTarget",
      tile: 2,
    });
  });
  it("Patron upgrades your city and bills the richest opponent", () => {
    let state = newGame(4, REWORKED);
    const seat = state.activeSeat;
    const rich = other(state);
    state = setPlayer(grant(state, 1, seat, 1), rich, { cash: 3_000_000 });
    const offered = draw(state, "Patron").state;
    expect(offered.pending).toMatchObject({ card: "Patron", targets: [1] });
    const built = act(offered, { type: "ChooseTarget", tile: 1 });
    const bill = built.events.find(
      (event) => event.type === "MoneyTransferred" && event.reason === "Patron",
    );
    expect(bill).toMatchObject({ from: rich, to: null });
    const amount = bill?.type === "MoneyTransferred" ? bill.amount : 0;
    expect(amount).toBeGreaterThan(0);
    expect(getProperty(built.state, 1)?.level).toBe(2);
    expect(getPlayer(built.state, seat).cash).toBe(2_000_000);
    expect(getPlayer(built.state, rich).cash).toBe(3_000_000 - amount);
  });
  it("Fan Trip sends the drawer to pay rent in the host city, and does nothing without one", () => {
    let state = newGame(4, REWORKED);
    const seat = state.activeSeat;
    const host = other(state);
    expect(getPlayer(draw(state, "Fan Trip").state, seat).position).toBe(12);
    state = {
      ...grant(state, 13, host, 1),
      championshipHost: { tile: 13, multiplier: 2 },
    };
    const trip = draw(state, "Fan Trip");
    expect(getPlayer(trip.state, seat).position).toBe(13);
    expect(trip.events).toContainEqual(
      expect.objectContaining({
        type: "RentPaid",
        seat,
        owner: host,
        tile: 13,
      }),
    );
  });
  it("Gift hands one of your cities, buildings included, to the poorest opponent", () => {
    let state = newGame(4, REWORKED);
    const seat = state.activeSeat;
    const poor = other(state);
    state = setPlayer(grant(grant(state, 1, seat, 2), 2, seat, 4), poor, {
      cash: 10_000,
    });
    const offered = draw(state, "Gift").state;
    // A Hotel never changes hands, and the gift cannot be declined.
    expect(offered.pending).toMatchObject({ card: "Gift", targets: [1] });
    expect(legalActions(offered, seat)).not.toContainEqual({
      type: "Decline",
    });
    const given = act(offered, { type: "ChooseTarget", tile: 1 });
    expect(given.events).toContainEqual({
      type: "PropertyGiven",
      seat,
      to: poor,
      tile: 1,
    });
    expect(getProperty(given.state, 1)).toMatchObject({
      owner: poor,
      level: 2,
    });
    expect(getPlayer(given.state, poor).properties).toContain(1);
  });
  it("Roll Again gives the drawer another roll", () => {
    const state = newGame(4, REWORKED);
    const seat = state.activeSeat;
    const again = draw(state, "Roll Again").state;
    expect(again.activeSeat).toBe(seat);
    expect(again.pending).toMatchObject({ kind: "roll", seat });
  });
});
describe("wins, rankings and timeouts", () => {
  it("detects Triple, Line and Resort wins with their documented precedence", () => {
    for (const [tiles, last, kind] of [
      [[1, 2, 3, 5, 6, 7, 9, 10], 11, "triple-monopoly"],
      [[1, 2, 3, 4, 5, 6], 7, "line-monopoly"],
      [[4, 14, 18], 25, "resort-monopoly"],
    ] as const) {
      let state = newGame(4, {
        ...CONFIG,
        boardRule: "country",
        resortMonopoly: true,
      });
      const seat = state.activeSeat;
      for (const tile of tiles) state = grant(state, tile, seat);
      const bought = act(land(state, last).state, {
        type: "Buy",
        level: 0,
      }).state;
      expect(bought.result).toMatchObject({ winner: seat, kind });
      expect(bought.result?.standings[0].seat).toBe(seat);
    }
  });
  it("leaves the four-resort win off by default but keeps it on saves without the option", () => {
    const own = (config: GameConfig) => {
      let state = newGame(4, { ...config, boardRule: "country" });
      const seat = state.activeSeat;
      for (const tile of [4, 14, 18]) state = grant(state, tile, seat);
      return act(land(state, 25).state, { type: "Buy", level: 0 }).state;
    };
    expect(own(CONFIG).status).toBe("active");
    const { resortMonopoly: _marker, ...unmarked } = CONFIG;
    expect(own(unmarked).result?.kind).toBe("resort-monopoly");
  });
  it("honors disabled line/triple conditions and real timed settings", () => {
    let state = newGame(4, {
      ...CONFIG,
      lineMonopoly: false,
      tripleMonopoly: false,
    });
    const seat = state.activeSeat;
    for (const tile of [1, 2, 3, 4, 5, 6]) state = grant(state, tile, seat);
    expect(
      act(land(state, 7).state, { type: "Buy", level: 0 }).state.status,
    ).toBe("active");
    const timed = newGame(4, { ...CONFIG, timeLimitMinutes: 20 });
    expect(timed.matchDeadline).toBe(1_200_000);
    expect(applyTimeout(timed, { now: 1_200_000 }).state.result?.kind).toBe(
      "time-limit",
    );
    expect(applyTimeout(timed, { now: 1_199_999 }).state.status).toBe("active");
  });
  it("settles pending sales and sequential mandatory payments fairly before time-limit ranking", () => {
    let state = newGame(4, {
      ...CONFIG,
      boardRule: "country",
      timeLimitMinutes: 20,
    });
    const seat = state.activeSeat;
    const payer = other(state);
    state = grant(state, 5, payer);
    state = setPlayer(state, payer, { cash: 20_000 });
    const waiting = draw(state, "Birthday").state;
    expect(waiting.pending).toMatchObject({ kind: "sell", seat: payer });
    const ended = applyTimeout(waiting, { now: 1_200_000 });
    expect(ended.state.result?.kind).toBe("time-limit");
    expect(ended.state.pending).toBeNull();
    expect(getPlayer(ended.state, seat).cash).toBe(2_150_000);
    expect(getPlayer(ended.state, payer).cash).toBe(70_000);
    expect(ended.events.some((event) => event.type === "DiceRolled")).toBe(
      false,
    );
    expect(ended.events.reduce(applyEvent, toPublic(waiting))).toEqual(
      toPublic(ended.state),
    );
    expect(money(ended.state)).toBe(money(waiting));
  });
  it("ends after a complete final round and ranks by net worth, cash, resorts and original order", () => {
    let state = newGame(4, { ...CONFIG, roundLimit: 1, startSalary: 0 });
    const last = state.turnOrder.at(-1) as Seat;
    state = withActive({ ...state, roundSeatsRemaining: [last] }, last);
    const leader = state.turnOrder[0];
    const result = land(setPlayer(state, leader, { cash: 3_000_000 }), 0).state;
    expect(result.result).toMatchObject({
      winner: leader,
      kind: "round-limit",
    });
    expect(result.round).toBe(1);
    expect(
      applyAction(result, last, { type: "Roll" }, { now: 1 }),
    ).toMatchObject({ ok: false, error: { code: "game-over" } });
    expect(land(state, 0).state.result?.winner).toBe(leader);
  });
  it("uses deterministic legal defaults only after the deadline", () => {
    const state = newGame();
    expect(applyTimeout(state, { now: 1 }).events).toEqual([]);
    const rolled = applyTimeout(state, {
      now: state.pending?.deadline ?? 0,
      dice: [1, 2],
    }).state;
    expect(rolled.lastRoll?.dice).toEqual([1, 2]);
    const purchase = land(state, 1).state;
    const declined = applyTimeout(purchase, {
      now: purchase.pending?.deadline ?? 0,
    }).state;
    expect(propertyOwner(declined, 1)).toBeNull();
    let host = grant(
      grant(state, 1, state.activeSeat, 1),
      6,
      state.activeSeat,
      3,
    );
    host = land(host, 16).state;
    const selected = applyTimeout(host, {
      now: host.pending?.deadline ?? 0,
    }).state;
    expect(selected.championshipHost).toEqual({ tile: 6, multiplier: 2 });
  });
  it("starts the decision clock and bot moves after the animations", () => {
    const state = newGame();
    // Nothing to watch yet: a bot only takes its short pause.
    expect(botDecisionAt(toPublic(state))).toBe(BOT_TIMING.roll);
    // From tile 4 to 7: the dice, three hops, then the purchase decision.
    const purchase = land(state, 7, [1, 2]).state;
    const presented =
      1 + DECISION_TIMING.diceAnimation + 3 * DECISION_TIMING.stepAnimation;
    expect(purchase.pending).toMatchObject({
      kind: "buy",
      deadline: presented + DECISION_TIMING.choice,
    });
    expect(botDecisionAt(toPublic(purchase))).toBe(
      presented + BOT_TIMING.choice,
    );
    // A custom decision time does not shorten the wait for the animations.
    const custom = land(
      newGame(4, { ...CONFIG, decisionSeconds: 30 }),
      7,
      [1, 2],
    ).state;
    expect(custom.pending?.deadline).toBe(presented + 30_000);
    expect(botDecisionAt(toPublic(custom))).toBe(presented + BOT_TIMING.choice);
    expect(botDecisionAt({ ...toPublic(purchase), pending: null })).toBeNull();
  });
  it("reserves card and tax reading time before decisions and bot actions", () => {
    const card = draw(newGame(), "Windfall").state;
    const motion =
      1 + DECISION_TIMING.diceAnimation + 3 * DECISION_TIMING.stepAnimation;
    expect(card.pending?.deadline).toBe(
      motion +
        DECISION_TIMING.cardAnimation +
        DECISION_TIMING.moneyAnimation +
        DECISION_TIMING.roll,
    );
    expect(botDecisionAt(toPublic(card))).toBe(
      motion +
        DECISION_TIMING.cardAnimation +
        DECISION_TIMING.moneyAnimation +
        BOT_TIMING.roll,
    );
    const taxed = land(grant(newGame(), 1, newGame().activeSeat, 2), 29).state;
    expect(taxed.pending?.deadline).toBe(
      motion + DECISION_TIMING.taxAnimation + DECISION_TIMING.roll,
    );
    expect(botDecisionAt(toPublic(taxed))).toBe(
      motion + DECISION_TIMING.taxAnimation + BOT_TIMING.roll,
    );
    // Taxes remain bounded even when a payment first needs property sales.
    const debtor = land(
      setPlayer(
        grant(newGame(), 1, newGame().activeSeat, 2),
        newGame().activeSeat,
        { cash: 0 },
      ),
      29,
    ).state;
    expect(debtor.pending?.kind).toBe("sell");
    const payment = act(debtor, { type: "Sell", tile: 1 }, undefined, 2).state;
    expect(debtor.pending?.deadline).toBe(
      motion + DECISION_TIMING.taxAnimation + DECISION_TIMING.sell,
    );
    expect(botDecisionAt(toPublic(payment))).toBe(
      2 +
        DECISION_TIMING.propertyAnimation +
        DECISION_TIMING.moneyAnimation +
        BOT_TIMING.roll,
    );
  });
  it("bot choices are always among exposed legal actions", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      let state = newGame();
      for (let count = 0; state.status === "active" && count < 300; count++) {
        const seat = state.pending?.seat;
        if (seat === undefined) throw new Error("Missing decision");
        const action = botAction(toPublic(state), seat, difficulty);
        expect(legalActions(state, seat)).toContainEqual(action);
        state = act(state, action, undefined, count + 1).state;
      }
    }
  });
});

describe("configurable captured room options", () => {
  it("allows direct Hotels only when configured and can disable the doubles bonus", () => {
    const direct = newGame(4, { ...CONFIG, hotelsDirectly: true });
    expect(
      legalActions(land(direct, 6).state, direct.activeSeat),
    ).toContainEqual({ type: "Buy", level: 4 });
    const noDouble = newGame(4, { ...CONFIG, extraRollOnDouble: false });
    const rolled = land(noDouble, 6, [3, 3]).state;
    expect(act(rolled, { type: "Decline" }).state.activeSeat).not.toBe(
      noDouble.activeSeat,
    );
  });
  it("restricts bot construction in the actual legal-action set while preserving human options", () => {
    let state = newGame(4, { ...CONFIG, botCanBuild: false });
    const seat = state.activeSeat;
    state = setPlayer(state, seat, { control: "bot" });
    const bot = land(state, 6).state;
    expect(legalActions(bot, seat)).toEqual([
      { type: "Decline" },
      { type: "Buy", level: 0 },
    ]);
    expect(
      legalActions(
        land(setPlayer(state, seat, { control: "human" }), 6).state,
        seat,
      ),
    ).toContainEqual({ type: "Buy", level: 3 });
  });
  it("hands a bot's place to a late player with its money, turn and secrets intact", () => {
    let state = newGame(4, { ...CONFIG, botCanBuild: false });
    const seat = state.activeSeat;
    state = setPlayer(state, seat, { control: "bot", name: "Iris" });
    const bot = land(state, 6).state;
    const handed = changeControl(bot, seat, "human", "Bo");
    if (!handed.ok) throw new Error(handed.error.message);
    expect(handed.events).toEqual([
      { type: "PlayerControlChanged", seat, control: "human", name: "Bo" },
    ]);
    expect(handed.events.reduce(applyEvent, toPublic(bot))).toEqual(
      toPublic(handed.state),
    );
    expect(getPlayer(handed.state, seat)).toEqual({
      ...getPlayer(bot, seat),
      name: "Bo",
      control: "human",
    });
    expect(handed.state.pending).toBe(bot.pending);
    expect(handed.state.rngState).toBe(bot.rngState);
    expect(handed.state.deck).toBe(bot.deck);
    expect(money(handed.state)).toBe(money(bot));
    // The person, unlike the bot it replaces, may build in this room.
    expect(legalActions(handed.state, seat)).toContainEqual({
      type: "Buy",
      level: 3,
    });
    const back = changeControl(handed.state, seat, "bot");
    expect(back.ok && getPlayer(back.state, seat)).toMatchObject({
      name: "Bo",
      control: "bot",
    });
  });
  it("only hands over a seat that is still playing, and only to a named player", () => {
    const state = newGame(4);
    const seat = other(state);
    expect(changeControl(state, seat, "human", "  ")).toMatchObject({
      ok: false,
      error: { code: "illegal-action" },
    });
    expect(
      changeControl(setPlayer(state, seat, { bankrupt: true }), seat, "human"),
    ).toMatchObject({ ok: false, error: { code: "illegal-action" } });
    expect(
      changeControl({ ...state, status: "finished" }, seat, "human"),
    ).toMatchObject({ ok: false, error: { code: "game-over" } });
    expect(changeControl(newGame(2), 3 as Seat, "human", "Bo")).toMatchObject({
      ok: false,
      error: { code: "illegal-action" },
    });
  });
  it("caps gift payments at available cash when gifts may not bankrupt a player", () => {
    let state = newGame(4, { ...CONFIG, giftCanBankrupt: false });
    const seat = state.activeSeat;
    const payer = other(state);
    state = setPlayer(state, payer, { cash: 20_000 });
    const birthday = draw(state, "Birthday").state;
    expect(getPlayer(birthday, payer)).toMatchObject({
      cash: 0,
      bankrupt: false,
    });
    expect(getPlayer(birthday, seat).cash).toBe(2_120_000);
  });
  it("caps Championship at five and resets to two when a new host is chosen", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = grant(grant(state, 1, seat), 6, seat);
    state = { ...state, championshipHost: { tile: 1, multiplier: 5 } };
    expect(
      act(land(state, 16).state, { type: "ChooseHost", tile: 1 }).state
        .championshipHost,
    ).toEqual({ tile: 1, multiplier: 5 });
    expect(
      act(land(state, 16).state, { type: "ChooseHost", tile: 6 }).state
        .championshipHost,
    ).toEqual({ tile: 6, multiplier: 2 });
  });
  it("compares action fields independent of JSON object key order", () => {
    const state = newGame();
    const landed = land(state, 6).state;
    expect(
      act(landed, { level: 0, type: "Buy" }).state.players.find(
        (player) => player.seat === state.activeSeat,
      )?.properties,
    ).toContain(6);
  });
});

describe("rounding and simultaneous win edges", () => {
  it("charges Tax from current invested value including every house and Hotel", () => {
    let state = newGame(4, { ...CONFIG, boardRule: "country" });
    const seat = state.activeSeat;
    state = grant(grant(state, 1, seat, 3), 31, seat, 4);
    const taxed = land(state, 30).state;
    expect(getPlayer(taxed, seat).cash).toBe(1_829_000);
  });
  it.each([
    { card: "Coupon" as const, expected: 51 },
    { card: "Guardian Angel" as const, expected: 0 },
    { card: null, expected: 101 },
  ])(
    "previews and pays $expected for odd rent with $card",
    ({ card, expected }) => {
      let state = newGame();
      const seat = state.activeSeat;
      const owner = other(state);
      const cards = card ? [card] : (["Coupon"] as const);
      state = setPlayer(state, seat, { heldCards: cards });
      state = {
        ...state,
        pending: {
          kind: "rent-card",
          seat,
          owner,
          amount: 101,
          tile: 6,
          cards,
          deadline: 1_000,
        },
        resolutionQueue: [{ kind: "finish" }],
      };
      const result = act(
        state,
        card ? { type: "UseRentCard", card } : { type: "Decline" },
      );
      const paidAmount = result.events.reduce(
        (amount, event) =>
          amount + (event.type === "RentPaid" ? event.amount : 0),
        0,
      );
      expect(rentCardPayment(101, card)).toBe(expected);
      expect(paidAmount).toBe(rentCardPayment(101, card));
      expect(getPlayer(result.state, seat).cash).toBe(2_000_000 - expected);
      expect(getPlayer(result.state, owner).cash).toBe(2_000_000 + expected);
      if (card === "Guardian Angel")
        expect(result.events.some((event) => event.type === "RentPaid")).toBe(
          false,
        );
    },
  );
  it("gives the active player priority when a Land Swap completes two Triple Monopolies", () => {
    let state = newGame(2, { ...CONFIG, boardRule: "country" });
    const seat = state.activeSeat;
    const rival = other(state);
    for (const tile of [2, 3, 13, 15, 26, 27])
      state = grant(state, tile, seat, 5);
    state = grant(state, 31, seat, 4);
    for (const tile of [5, 6, 7, 9, 10, 11, 29])
      state = grant(state, tile, rival, 5);
    state = grant(state, 1, rival);
    const swap = draw(state, "Land Swap").state;
    expect(swap.pending).toMatchObject({
      kind: "card-target",
      targets: [1],
      sourceTile: 31,
    });
    const result = act(swap, { type: "ChooseTarget", tile: 1 }).state;
    expect(result.result).toMatchObject({
      winner: seat,
      kind: "triple-monopoly",
    });
    expect(result.result?.standings.map((standing) => standing.seat)).toEqual([
      seat,
      rival,
    ]);
  });
});

describe("frozen staged hotel construction", () => {
  it("caps the first purchase at three houses even after a completed lap and rejects a direct Hotel intent", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = setPlayer(state, seat, { laps: 2 });
    const landed = land(state, 6).state;
    expect(landed.pending).toMatchObject({ kind: "buy", maxLevel: 3 });
    expect(legalActions(landed, seat)).not.toContainEqual({
      type: "Buy",
      level: 4,
    });
    expect(
      applyAction(landed, seat, { type: "Buy", level: 4 }, { now: 1 }),
    ).toMatchObject({ ok: false, error: { code: "illegal-action" } });
    expect(getProperty(landed, 6)?.owner).toBeNull();
    const stale = {
      ...landed,
      pending: {
        kind: "buy" as const,
        seat,
        tile: 6,
        maxLevel: 4 as const,
        deadline: 1_000,
      },
    };
    expect(legalActions(stale, seat)).not.toContainEqual({
      type: "Buy",
      level: 4,
    });
    expect(
      applyAction(stale, seat, { type: "Buy", level: 4 }, { now: 1 }),
    ).toMatchObject({ ok: false, error: { code: "illegal-action" } });
  });
  it("requires three houses already present on the previous visit before offering a Hotel", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = setPlayer(grant(state, 6, seat), seat, { laps: 1 });
    const firstReturn = land(state, 6).state;
    expect(firstReturn.pending).toMatchObject({ kind: "build", maxLevel: 3 });
    expect(legalActions(firstReturn, seat)).not.toContainEqual({
      type: "Build",
      level: 4,
    });
    const stale = {
      ...firstReturn,
      pending: {
        kind: "build" as const,
        seat,
        tile: 6,
        maxLevel: 4 as const,
        deadline: 1_000,
      },
    };
    expect(
      applyAction(stale, seat, { type: "Build", level: 4 }, { now: 1 }),
    ).toMatchObject({ ok: false, error: { code: "illegal-action" } });
    const houses = act(firstReturn, { type: "Build", level: 3 }).state;
    expect(getProperty(houses, 6)?.level).toBe(3);
    const nextReturn = land(withActive(houses, seat), 6).state;
    expect(legalActions(nextReturn, seat)).toContainEqual({
      type: "Build",
      level: 4,
    });
    expect(
      getProperty(act(nextReturn, { type: "Build", level: 4 }).state, 6)?.level,
    ).toBe(4);
  });
  it("retains the lap requirement even for an already-owned three-house city", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = grant(state, 6, seat, 3);
    const landed = land(state, 6).state;
    expect(getPlayer(landed, seat).laps).toBe(0);
    expect(getProperty(landed, 6)?.level).toBe(3);
    expect(landed.activeSeat).not.toBe(seat);
    const stale = {
      ...state,
      pending: {
        kind: "build" as const,
        seat,
        tile: 6,
        maxLevel: 4 as const,
        deadline: 1_000,
      },
    };
    expect(legalActions(stale, seat)).toEqual([{ type: "Decline" }]);
    expect(
      applyAction(stale, seat, { type: "Build", level: 4 }, { now: 1 }),
    ).toMatchObject({ ok: false, error: { code: "illegal-action" } });
  });
  it("preserves explicit direct-Hotel custom settings for purchases and upgrades", () => {
    let state = newGame(4, { ...CONFIG, hotelsDirectly: true });
    const seat = state.activeSeat;
    const purchase = land(state, 6).state;
    expect(legalActions(purchase, seat)).toContainEqual({
      type: "Buy",
      level: 4,
    });
    expect(
      getProperty(act(purchase, { type: "Buy", level: 4 }).state, 6)?.level,
    ).toBe(4);
    state = grant(state, 6, seat);
    const upgrade = land(state, 6).state;
    expect(legalActions(upgrade, seat)).toContainEqual({
      type: "Build",
      level: 4,
    });
    expect(
      getProperty(act(upgrade, { type: "Build", level: 4 }).state, 6)?.level,
    ).toBe(4);
  });
  it("keeps old active snapshots without a marker on their original lap-only rules", () => {
    let state = newGame();
    const seat = state.activeSeat;
    const { hotelPurchaseRule: _marker, ...oldConfig } = state.config;
    state = setPlayer({ ...state, config: oldConfig }, seat, { laps: 1 });
    const oldPurchase = land(state, 6).state;
    expect(oldPurchase.config).not.toHaveProperty("hotelPurchaseRule");
    expect(legalActions(oldPurchase, seat)).toContainEqual({
      type: "Buy",
      level: 4,
    });
    const bought = act(oldPurchase, { type: "Buy", level: 4 }).state;
    expect(getProperty(bought, 6)?.level).toBe(4);
    expect(bought.config).not.toHaveProperty("hotelPurchaseRule");
    const oldLand = land(grant(state, 6, seat), 6).state;
    expect(legalActions(oldLand, seat)).toContainEqual({
      type: "Build",
      level: 4,
    });
  });
  it("uses the same staged legal choices for bots", () => {
    let state = newGame();
    const seat = state.activeSeat;
    state = setPlayer(state, seat, { laps: 2, control: "bot" });
    const landed = land(state, 6).state;
    const action = botAction(landed, seat, "hard");
    expect(legalActions(landed, seat)).toContainEqual(action);
    expect(action).toEqual({ type: "Buy", level: 3 });
    expect(getProperty(act(landed, action).state, 6)?.level).toBe(3);
  });
});

describe("property rent previews", () => {
  it("projects purchase ownership and country/festival modifiers without mutating live state", () => {
    const state = grant(
      grant(newGame(4, { ...CONFIG, boardRule: "country" }), 1, 0),
      3,
      0,
    );
    const before = JSON.stringify(state);
    expect(previewPropertyRent(state, 2, 0, 1)).toBe(84_000);
    expect(previewPropertyRent({ ...state, festivalTiles: [2] }, 2, 1, 1)).toBe(
      84_000,
    );
    expect(JSON.stringify(state)).toBe(before);
    expect(getProperty(state, 2)?.owner).toBeNull();
  });
  it("names the one bonus that multiplies a city's rent", () => {
    let state = grant(newGame(), 1, 0);
    expect(rentBoost(state, 1)).toBeNull();
    state = grant(state, 2, 0);
    expect(rentBoost(state, 1)).toEqual({ multiplier: 2, source: "country" });
    state = { ...state, championshipHost: { tile: 1, multiplier: 3 } };
    expect(rentBoost(state, 1)).toEqual({
      multiplier: 3,
      source: "championship",
    });
    // An initial festival multiplies the rent of a city nobody owns yet.
    const bank = { ...newGame(), festivalTiles: [4] };
    expect(rentBoost(bank, 4)).toEqual({ multiplier: 2, source: "festival" });
    expect(rentBoost(bank, 5)).toBeNull();
    expect(rentBoost(bank, 0)).toBeNull();
  });
  it("prices every build level under the city's current bonus", () => {
    const state = {
      ...grant(grant(newGame(), 1, 0, 2), 2, 0),
      festivalTiles: [1],
    };
    const before = JSON.stringify(state);
    expect(propertyRentAt(state, 1, 2)).toBe(propertyRent(state, 1));
    expect(propertyRentAt(state, 1, 0)).toBe(24_000);
    expect(propertyRentAt(state, 1, 4)).toBe(336_000);
    // Landmarks never take a bonus.
    expect(propertyRentAt(state, 1, 5)).toBe(240_000);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("prices a buyout only for an owned city below the landmark", () => {
    let state = grant(newGame(), 1, 0, 2);
    expect(buyoutPrice(state, 1)).toBe(
      getTileInvestedValue(1, 2, "prototype", "legacy") * 2,
    );
    expect(buyoutPrice(state, 2)).toBeNull();
    state = grant(grant(state, 5, 0), 12, 0);
    expect(buyoutPrice(state, 5)).toBeNull();
    expect(resortCount(state, 0)).toBe(2);
    expect(resortCount(state, 1)).toBe(0);
    expect(buyoutPrice(grant(state, 1, 0, 5), 1)).toBeNull();
  });
  it("retains an owned host for upgrades but clears transfer hosts and excludes Landmark multipliers", () => {
    let state = grant(grant(newGame(), 1, 0, 3), 2, 0);
    state = { ...state, championshipHost: { tile: 1, multiplier: 5 } };
    expect(previewPropertyRent(state, 1, 0, 4)).toBe(840_000);
    expect(previewPropertyRent(state, 1, 0, 5)).toBe(240_000);
    expect(previewPropertyRent(state, 1, 1, 4)).toBe(168_000);
    expect(previewPropertyRent(state, 0, 0, 0)).toBe(0);
    expect(state.championshipHost).toEqual({ tile: 1, multiplier: 5 });
    expect(getProperty(state, 1)).toMatchObject({ owner: 0, level: 3 });
  });
});

describe("combined reference rules on the country board", () => {
  it("quotes Madrid's remapped prices, full investment sales, additive boosts and protected Hotel consistently", () => {
    let state = newGame(4, {
      ...CONFIG,
      economyRule: "reference",
      boardRule: "country",
      sellBackPercent: 100,
    });
    const seat = state.activeSeat;
    state = grant(grant(grant(state, 1, seat), 2, seat), 3, seat, 2);
    state = {
      ...state,
      festivalTiles: [3],
      championshipHost: { tile: 3, multiplier: 2 },
    };
    expect(propertyRefund(state, 3)).toBe(160_000);
    expect(buyoutPrice(state, 3)).toBe(320_000);
    expect(rentBoost(state, 3)).toEqual({ multiplier: 4, source: "combined" });
    expect(propertyRent(state, 3)).toBe(240_000);
    expect(propertyRentAt(state, 3, 4)).toBe(720_000);
    expect(previewPropertyRent(state, 3, other(state), 4)).toBe(540_000);
    expect(buyoutPriceAt(state, 3, 4)).toBeNull();
    const hotel = grant(state, 3, seat, 4);
    expect(propertyRefund(hotel, 3)).toBe(360_000);
    expect(buyoutPrice(hotel, 3)).toBeNull();
    expect(propertyRent(hotel, 3)).toBe(propertyRentAt(state, 3, 4));
  });
  it("preserves regrouped resort festival rent for older reference matches", () => {
    let state = newGame(4, {
      ...CONFIG,
      economyRule: "reference",
      boardRule: "country",
      resortFestivals: true,
    });
    const seat = state.activeSeat;
    state = grant(grant(state, 4, seat), 14, seat);
    state = { ...state, festivalTiles: [4] };
    expect(resortCount(state, seat)).toBe(2);
    expect(propertyRent(state, 4)).toBe(100_000);
    expect(rentBoost(state, 4)).toEqual({ multiplier: 2, source: "festival" });
    expect(buyoutPrice(state, 4)).toBeNull();
    expect(propertyRefund(state, 4)).toBe(200_000);
  });
});

/** Reference economy also works on the explicitly frozen original tour. */
const REFERENCE: GameConfig = {
  ...CONFIG,
  economyRule: "reference",
  fourResortRent: true,
  buildAfterBuyout: true,
  resortFestivals: true,
};
function reference(count = 4, config: GameConfig = REFERENCE): GameState {
  return newGame(count, config);
}
function nextSeat(state: GameState): Seat {
  const order = state.turnOrder;
  return order[(order.indexOf(state.activeSeat) + 1) % order.length];
}

describe("reference economy on the original board", () => {
  it("marks new games as reference and reads an unmarked save as prototype", () => {
    const { economyRule: _marker, ...unmarked } = DEFAULT_GAME_CONFIG;
    const created = createGame(unmarked, SEATS, 7, { now: 0 }).state;
    expect(created.config.economyRule).toBe("reference");
    expect(economyRule(unmarked)).toBe("prototype");
    expect(() =>
      createGame(
        { ...unmarked, economyRule: "classic" as "reference" },
        SEATS,
        7,
        { now: 0 },
      ),
    ).toThrow("Unsupported economy rule");
  });
  it("caps a city at two houses before the first lap, three after, and the Hotel on a later visit", () => {
    const state = reference();
    const seat = state.activeSeat;
    const first = land(state, 6).state;
    expect(first.pending).toMatchObject({ kind: "buy", maxLevel: 2 });
    expect(legalActions(first, seat)).not.toContainEqual({
      type: "Buy",
      level: 3,
    });
    const owned = land(grant(state, 6, seat, 2), 6).state;
    expect(owned.pending?.kind).not.toBe("build");
    const lapped = setPlayer(state, seat, { laps: 1 });
    const second = land(lapped, 6).state;
    expect(second.pending).toMatchObject({ kind: "buy", maxLevel: 3 });
    const bought = act(second, { type: "Buy", level: 3 }).state;
    expect(getProperty(bought, 6)?.level).toBe(3);
    const revisit = land(withActive(bought, seat), 6).state;
    expect(revisit.pending).toMatchObject({ kind: "build", maxLevel: 4 });
    const contractor = draw(grant(state, 6, seat, 1), "Contractor").state;
    expect(contractor.pending).toMatchObject({ targets: [6] });
    expect(
      draw(grant(state, 6, seat, 2), "Contractor").state.pending?.kind,
    ).not.toBe("card-target");
  });
  it("previews the buyout price of each level, with Hotels and resorts protected", () => {
    const state = reference();
    // Tile 9 (Venice values): land 140 k + three houses at 100 k = 440 k.
    expect(buyoutPriceAt(state, 9, 3)).toBe(880_000);
    expect(buyoutPriceAt(state, 9, 0)).toBe(280_000);
    expect(buyoutPriceAt(state, 9, 4)).toBeNull();
    expect(buyoutPriceAt(state, 5, 0)).toBeNull();
    expect(buyoutPriceAt(newGame(), 9, 4)).toBe(2 * 580_000);
  });
  it("charges the reference rents and adds each modifier, capped at ten", () => {
    let state = reference();
    const seat = state.activeSeat;
    state = grant(state, 31, seat, 3);
    expect(propertyRent(state, 31)).toBe(600_000);
    state = grant(state, 30, seat);
    expect(propertyRent(state, 31)).toBe(1_200_000);
    expect(propertyRent(state, 30)).toBe(70_000);
    state = {
      ...state,
      festivalTiles: [31],
      championshipHost: { tile: 31, multiplier: 2 },
    };
    // Country, festival and a ×2 championship each add one: ×4.
    expect(propertyRent(state, 31)).toBe(2_400_000);
    state = { ...state, championshipHost: { tile: 31, multiplier: 10 } };
    expect(propertyRent(state, 31)).toBe(6_000_000);
  });
  it("preserves 25/50/100 k resort rents and festival draws for older reference rules", () => {
    let state = reference();
    const seat = state.activeSeat;
    state = grant(state, 5, seat);
    expect(propertyRent(state, 5)).toBe(25_000);
    state = grant(state, 12, seat);
    expect(propertyRent(state, 5)).toBe(50_000);
    state = grant(state, 21, seat);
    expect(propertyRent(state, 5)).toBe(100_000);
    expect(propertyRent({ ...state, festivalTiles: [5] }, 5)).toBe(200_000);
    const resorts = [5, 12, 21, 28];
    const festivals = (rule: GameConfig["economyRule"]) =>
      Array.from({ length: 30 }, (_, seed) =>
        createGame(
          {
            ...DEFAULT_GAME_CONFIG,
            economyRule: rule,
            boardRule: "legacy",
            resortFestivals: rule === "reference",
          },
          SEATS,
          seed,
          {
            now: 0,
          },
        ).state.festivalTiles.filter((tile) => resorts.includes(tile)),
      ).flat();
    expect(festivals("reference").length).toBeGreaterThan(0);
    expect(festivals("prototype")).toEqual([]);
  });
  it("pays 200 k for four resorts, and saves without the marker keep the third rent", () => {
    const owned = (state: GameState) =>
      [5, 12, 21, 28].reduce(
        (all, tile) => grant(all, tile, all.activeSeat),
        state,
      );
    const state = owned(reference());
    expect(resortCount(state, state.activeSeat)).toBe(4);
    expect(propertyRent(state, 5)).toBe(200_000);
    expect(propertyRent({ ...state, festivalTiles: [5] }, 5)).toBe(400_000);
    const saved = owned(reference(4, { ...REFERENCE, fourResortRent: false }));
    expect(propertyRent(saved, 5)).toBe(100_000);
    // A save from before rules version 7 carries no marker at all.
    const { fourResortRent: _marker, ...unmarked } = state.config;
    expect(propertyRent({ ...state, config: unmarked }, 5)).toBe(100_000);
  });
  it.each([
    { level: 0, offered: [1, 2] },
    { level: 1, offered: [2] },
    { level: 2, offered: [3] },
  ])(
    "offers the buyer of a level-$level city to build on it at once",
    ({ level, offered }) => {
      let state = reference();
      const seat = state.activeSeat;
      state = setPlayer(
        grant(state, 1, other(state), level as BuildLevel),
        seat,
        {
          laps: 1,
        },
      );
      const rented = land(state, 1);
      expect(rented.state.pending?.kind).toBe("buyout");
      const bought = act(rented.state, { type: "Buyout" }).state;
      expect(propertyOwner(bought, 1)).toBe(seat);
      expect(bought.pending).toMatchObject({
        kind: "build",
        seat,
        tile: 1,
        maxLevel: 3,
      });
      const builds = legalActions(bought, seat)
        .flatMap((action) => (action.type === "Build" ? [action.level] : []))
        .filter((next) => next <= 3);
      expect(builds).toEqual(
        expect.arrayContaining(offered.filter((next) => next <= 3)),
      );
      const built = act(bought, {
        type: "Build",
        level: Math.max(...builds) as BuildLevel,
      }).state;
      expect(getProperty(built, 1)?.level).toBe(Math.max(...builds));
      expect(built.pending?.kind).not.toBe("build");
    },
  );
  it("lets the buyer of a three-house city build the Hotel straight away", () => {
    let state = reference();
    const seat = state.activeSeat;
    state = setPlayer(grant(state, 1, other(state), 3), seat, { laps: 1 });
    const bought = act(land(state, 1).state, { type: "Buyout" }).state;
    expect(bought.pending).toMatchObject({ kind: "build", maxLevel: 4 });
    const built = act(bought, { type: "Build", level: 4 }).state;
    expect(getProperty(built, 1)).toMatchObject({ owner: seat, level: 4 });
  });
  it("limits a first-lap buyer to two houses and offers nothing on a capped city", () => {
    let state = reference();
    const seat = state.activeSeat;
    state = setPlayer(grant(state, 9, other(state), 1), seat, { laps: 0 });
    const bought = act(land(state, 9).state, { type: "Buyout" }).state;
    expect(bought.pending).toMatchObject({ kind: "build", maxLevel: 2 });
    const full = setPlayer(
      grant(reference(), 9, nextSeat(reference()), 2),
      seat,
      {
        laps: 0,
      },
    );
    const topped = act(land(full, 9).state, { type: "Buyout" }).state;
    expect(topped.pending?.kind).not.toBe("build");
  });
  it("lets a buyout end the turn without building, and keeps older rooms from offering it", () => {
    const state = reference();
    const seat = state.activeSeat;
    const set = (game: GameState) =>
      setPlayer(grant(game, 1, other(game), 1), seat, { laps: 1 });
    const declined = act(
      act(land(set(state), 1).state, { type: "Buyout" }).state,
      { type: "Decline" },
    ).state;
    expect(declined.activeSeat).not.toBe(seat);
    expect(getProperty(declined, 1)).toMatchObject({ owner: seat, level: 1 });
    const older = reference(4, { ...REFERENCE, buildAfterBuyout: false });
    const bought = act(land(set(older), 1).state, { type: "Buyout" }).state;
    expect(bought.pending?.kind).not.toBe("build");
  });
  it("ignores beach festivals in new matches and preserves unmarked saved reference rent", () => {
    let state = newGame(4, { ...DEFAULT_GAME_CONFIG, boardRule: "country" });
    state = grant(state, 4, state.activeSeat);
    state = { ...state, festivalTiles: [4] };
    expect(propertyRent(state, 4)).toBe(25_000);
    expect(rentBoost(state, 4)).toBeNull();
    const { resortFestivals: _marker, ...oldConfig } = state.config;
    const legacy = { ...state, config: oldConfig };
    expect(propertyRent(legacy, 4)).toBe(50_000);
    expect(rentBoost(legacy, 4)).toEqual({ multiplier: 2, source: "festival" });
  });
  it("protects Hotels from buyout and Land Swap, lets Earthquake hit them and has no Landmark", () => {
    const fresh = reference();
    const seat = fresh.activeSeat;
    const owner = other(fresh);
    const hotel = grant(fresh, 1, owner, 4);
    const rented = land(hotel, 1);
    // Passing Start pays the salary before the Hotel rent.
    expect(getPlayer(rented.state, seat).cash).toBe(2_400_000 - 150_000);
    expect(rented.state.activeSeat).not.toBe(seat);
    expect(rented.events).not.toContainEqual(
      expect.objectContaining({
        type: "DecisionOpened",
        pending: expect.objectContaining({ kind: "buyout" }),
      }),
    );
    // Below the Hotel, a buyout still pays the owner twice the investment.
    const houses = land(grant(fresh, 1, owner, 3), 1).state;
    expect(houses.pending).toMatchObject({ kind: "buyout", price: 420_000 });
    const quake = draw(hotel, "Earthquake").state;
    expect(quake.pending).toMatchObject({ kind: "card-target", targets: [1] });
    expect(
      getProperty(act(quake, { type: "ChooseTarget", tile: 1 }).state, 1)
        ?.level,
    ).toBe(3);
    const swap = draw(grant(grant(hotel, 2, owner), 6, seat, 1), "Land Swap");
    expect(swap.state.pending).toMatchObject({
      kind: "card-target",
      targets: [2],
      sourceTile: 6,
    });
    const ownHotel = setPlayer(grant(fresh, 1, seat, 4), seat, { laps: 3 });
    expect(maxBuildLevel(ownHotel, seat, 1, false)).toBe(4);
    const visit = land(ownHotel, 1);
    expect(visit.state.activeSeat).not.toBe(seat);
    expect(visit.events.some((event) => event.type === "DecisionOpened")).toBe(
      true,
    );
    expect(
      visit.events.some(
        (event) =>
          event.type === "DecisionOpened" && event.pending.kind === "build",
      ),
    ).toBe(false);
  });
  it("charges 50 k to move the championship, renews it for free and never restarts it", () => {
    let state = reference();
    const seat = state.activeSeat;
    state = grant(grant(state, 1, seat), 6, seat);
    const first = land(state, 16).state;
    expect(legalActions(first, seat)).toEqual([
      { type: "Decline" },
      { type: "ChooseHost", tile: 1 },
      { type: "ChooseHost", tile: 6 },
    ]);
    const declined = act(first, { type: "Decline" }).state;
    expect(declined.championshipHost).toBeNull();
    expect(getPlayer(declined, seat).cash).toBe(2_000_000);
    const hosted = act(first, { type: "ChooseHost", tile: 1 });
    expect(hosted.state.championshipHost).toEqual({ tile: 1, multiplier: 2 });
    expect(hosted.events).toContainEqual({
      type: "MoneyTransferred",
      from: seat,
      to: null,
      amount: 50_000,
      reason: "Championship",
    });
    const visit = (from: GameState) => land(withActive(from, seat), 16).state;
    const moved = act(visit(hosted.state), { type: "ChooseHost", tile: 6 });
    expect(moved.state.championshipHost).toEqual({ tile: 6, multiplier: 3 });
    expect(getPlayer(moved.state, seat).cash).toBe(2_000_000 - 100_000);
    const renewed = act(visit(moved.state), { type: "ChooseHost", tile: 6 });
    expect(renewed.state.championshipHost).toEqual({ tile: 6, multiplier: 4 });
    expect(getPlayer(renewed.state, seat).cash).toBe(2_000_000 - 100_000);
    const capped = act(
      visit({
        ...renewed.state,
        championshipHost: { tile: 6, multiplier: 10 },
      }),
      { type: "ChooseHost", tile: 1 },
    ).state;
    expect(capped.championshipHost).toEqual({ tile: 1, multiplier: 10 });
    // Without 50 k, only a free renewal remains.
    const poor = land(
      setPlayer(
        { ...state, championshipHost: { tile: 6, multiplier: 3 } },
        seat,
        { cash: 40_000 },
      ),
      16,
    ).state;
    expect(legalActions(poor, seat)).toEqual([
      { type: "Decline" },
      { type: "ChooseHost", tile: 6 },
    ]);
  });
  it.each([true, false])(
    "hosts during the first turn before a completed lap with escape deck %s",
    (escapeCard) => {
      const initial = newGame(4, {
        ...DEFAULT_GAME_CONFIG,
        festivalCount: 0,
        escapeCard,
      });
      const seat = initial.activeSeat;
      const city = act(initial, { type: "Roll" }, [3, 3]).state;
      const bought = act(city, { type: "Buy", level: 2 }).state;
      expect(bought.pending).toMatchObject({ kind: "roll", seat });
      const firstVisit = act(bought, { type: "Roll" }, [4, 6]).state;
      expect(firstVisit.round).toBe(1);
      expect(getPlayer(firstVisit, seat).laps).toBe(0);
      expect(firstVisit.pending).toMatchObject({
        kind: "host",
        seat,
        targets: [6],
      });
      const hosted = act(firstVisit, { type: "ChooseHost", tile: 6 }).state;
      expect(hosted.championshipHost).toEqual({ tile: 6, multiplier: 2 });
      expect(getPlayer(hosted, seat).cash).toBe(
        2_000_000 - getTileInvestedValue(6, 2, "reference", "country") - 50_000,
      );
      expect(hosted.activeSeat).not.toBe(seat);
    },
  );
  it("offers Championship hosting when Stadium Call arrives during the first turn", () => {
    const initial = newGame(4, { ...DEFAULT_GAME_CONFIG, festivalCount: 0 });
    const seat = initial.activeSeat;
    const city = act(initial, { type: "Roll" }, [3, 3]).state;
    const bought = act(city, { type: "Buy", level: 2 }).state;
    const call = act(
      { ...bought, deck: ["Stadium Call"] },
      { type: "Roll" },
      [3, 3],
    ).state;
    expect(call.round).toBe(1);
    expect(getPlayer(call, seat)).toMatchObject({ position: 16, laps: 0 });
    expect(call.pending).toMatchObject({ kind: "host", seat, targets: [6] });
    expect(
      act(call, { type: "ChooseHost", tile: 6 }).state.championshipHost,
    ).toEqual({ tile: 6, multiplier: 2 });
  });
  it("times a paid championship out to a free renewal or a decline", () => {
    let state = reference();
    const seat = state.activeSeat;
    state = grant(grant(state, 1, seat), 6, seat);
    const open = land(state, 16).state;
    if (!open.pending) throw new Error("Expected a host decision");
    const declined = applyTimeout(open, { now: open.pending.deadline });
    expect(declined.state.championshipHost).toBeNull();
    expect(getPlayer(declined.state, seat).cash).toBe(2_000_000);
    const own = land(
      { ...state, championshipHost: { tile: 6, multiplier: 2 } },
      16,
    ).state;
    if (!own.pending) throw new Error("Expected a host decision");
    const renewed = applyTimeout(own, { now: own.pending.deadline });
    expect(renewed.state.championshipHost).toEqual({ tile: 6, multiplier: 3 });
    for (const choice of [open, own])
      expect(legalActions(choice, seat)).toContainEqual(
        botAction(choice, seat, "medium"),
      );
  });
  it("keeps the championship on its city through buyouts and refunds a full sale", () => {
    let state = reference();
    const seat = state.activeSeat;
    const owner = other(state);
    state = grant(state, 1, owner, 1);
    state = { ...state, championshipHost: { tile: 1, multiplier: 3 } };
    const rented = land(state, 1);
    expect(getPlayer(rented.state, seat).cash).toBe(2_400_000 - 75_000);
    expect(rented.state.pending).toMatchObject({
      kind: "buyout",
      price: 220_000,
    });
    const bought = act(rented.state, { type: "Buyout" }).state;
    expect(bought.championshipHost).toEqual({ tile: 1, multiplier: 3 });
    let debtor = grant(grant(reference(), 4, owner, 1), 6, seat, 3);
    debtor = setPlayer(debtor, seat, { cash: 10_000 });
    debtor = { ...debtor, championshipHost: { tile: 6, multiplier: 2 } };
    const selling = land(debtor, 4).state;
    expect(selling.pending).toMatchObject({ kind: "sell", seat, targets: [6] });
    const sold = act(selling, { type: "Sell", tile: 6 }).state;
    expect(getPlayer(sold, seat).cash).toBe(10_000 - 33_000 + 250_000);
    expect(propertyOwner(sold, 6)).toBeNull();
    expect(sold.championshipHost).toEqual({ tile: 6, multiplier: 2 });
  });
  it("charges 200 k to leave the Island and releases after the third failed escape", () => {
    const state = reference();
    const next = nextSeat(state);
    const waiting = land(
      setPlayer(state, next, { position: 8, onIsland: true }),
      0,
    ).state;
    expect(waiting.pending).toMatchObject({
      kind: "island",
      seat: next,
      fee: 200_000,
    });
    const second = act(
      setPlayer(waiting, next, { islandTurns: 1 }),
      { type: "Roll" },
      [1, 2],
    ).state;
    expect(getPlayer(second, next)).toMatchObject({
      onIsland: true,
      islandTurns: 2,
    });
    const third = act(
      setPlayer(waiting, next, { islandTurns: 2 }),
      { type: "Roll" },
      [1, 2],
    ).state;
    expect(getPlayer(third, next)).toMatchObject({
      position: 8,
      onIsland: false,
      islandTurns: 0,
    });
    const paid = act(waiting, { type: "PayIsland" }).state;
    expect(getPlayer(paid, next).cash).toBe(2_000_000 - 200_000);
  });
  it.each([
    // Rules version 6: free properties and the traveller's own.
    ["free-and-own", (tile: number) => tile !== 1],
    // Rules versions 4–5: the traveller's own only when none is free.
    ["free-first", (tile: number) => tile !== 1 && tile !== 2],
  ] as const)(
    "flies a %s World Tour only to the properties that rule allows",
    (worldTourRule, reachable) => {
      const config: GameConfig = {
        ...REFERENCE,
        worldTourRule,
        lineMonopoly: false,
        tripleMonopoly: false,
      };
      const state = reference(4, config);
      const next = nextSeat(state);
      const rival = state.turnOrder.find(
        (seat) => seat !== state.activeSeat && seat !== next,
      );
      if (rival === undefined) throw new Error("Expected a third seat");
      const traveller = (from: GameState) =>
        land(setPlayer(from, next, { position: 24, travelPending: true }), 0)
          .state;
      const tiles = state.properties.map((property) => property.tile);
      // A rival owns tile 1 and the traveller owns tile 2.
      const some = traveller(grant(grant(state, 1, rival), 2, next));
      expect(some.pending).toMatchObject({
        kind: "travel",
        seat: next,
        fee: 50_000,
        targets: tiles.filter(reachable),
      });
      let full = state;
      for (const tile of tiles)
        full = grant(
          full,
          tile,
          [2, 5, 12].includes(tile)
            ? next
            : tile === 21
              ? state.activeSeat
              : rival,
        );
      expect(traveller(full).pending).toMatchObject({
        kind: "travel",
        targets: [2, 5, 12],
      });
    },
  );
  it("taxes 10 % of property value with no minimum", () => {
    const state = reference();
    const seat = state.activeSeat;
    const none = land(state, 29);
    expect(getPlayer(none.state, seat).cash).toBe(2_000_000);
    expect(none.events.some((event) => event.type === "MoneyTransferred")).toBe(
      false,
    );
    const owned = land(grant(grant(state, 1, seat, 3), 31, seat, 4), 29);
    expect(getPlayer(owned.state, seat).cash).toBe(2_000_000 - 171_000);
  });
});
