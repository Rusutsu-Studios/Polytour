import { describe, expect, it } from "vitest";
import type { BuildLevel } from "../board/index.js";
import { BOT_TIMING, DECISION_TIMING } from "../board/index.js";
import type {
  Action,
  ChanceCard,
  GameConfig,
  GameState,
  PlayerState,
  Seat,
  SeatInfo,
} from "./index.js";
import {
  applyAction,
  applyEvent,
  applyTimeout,
  botAction,
  botDecisionAt,
  CHANCE_CARDS,
  createGame,
  DEFAULT_GAME_CONFIG,
  getPlayer,
  getProperty,
  getTileInvestedValue,
  legalActions,
  netWorth,
  previewPropertyRent,
  propertyOwner,
  propertyRefund,
  propertyRent,
  rentCardPayment,
  toPublic,
} from "./index.js";

const SEATS: readonly SeatInfo[] = ["Ada", "Bea", "Cy", "Dan"].map(
  (name, index) => ({ playerId: `player-${index}`, name, control: "human" }),
);
const CONFIG: GameConfig = {
  ...DEFAULT_GAME_CONFIG,
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
function draw(state: GameState, card: ChanceCard, tile = 3) {
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
    expect(getTileInvestedValue(1, 4)).toBe(360_000);
    expect(getTileInvestedValue(31, 4)).toBe(1_500_000);
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
    state = grant(grant(state, 1, seat, 4), 2, seat);
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
});
describe("forced sales and bankruptcy", () => {
  it("quotes land and every standing building at full investment, independently of toll bonuses", () => {
    let state = newGame();
    const seat = state.activeSeat;
    for (const level of [0, 1, 2, 3, 4, 5] as const) {
      state = grant(state, 1, seat, level);
      expect(propertyRefund(state, 1)).toBe(getTileInvestedValue(1, level));
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
    let state = newGame();
    const seat = state.activeSeat;
    state = grant(grant(state, 4, other(state), 1), 6, seat);
    state = setPlayer(state, seat, { cash: 10_000 });
    const debtor = land(state, 4).state;
    expect(debtor.pending).toMatchObject({ kind: "sell", seat, targets: [6] });
    expect(getPlayer(debtor, seat).cash).toBe(-44_000);
    const sold = act(debtor, { type: "Sell", tile: 6 }).state;
    expect(getPlayer(sold, seat)).toMatchObject({
      cash: 56_000,
      bankrupt: false,
      properties: [],
    });
    expect(propertyOwner(sold, 6)).toBeNull();
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
    let state = newGame();
    const seat = state.activeSeat;
    const payer = state.turnOrder.find(
      (candidate) => candidate !== seat,
    ) as Seat;
    state = grant(state, 6, payer);
    state = setPlayer(state, payer, { cash: 20_000 });
    const result = draw(state, "Birthday").state;
    expect(result.pending).toMatchObject({ kind: "sell", seat: payer });
    expect(result.activeSeat).toBe(seat);
    const settled = act(result, { type: "Sell", tile: 6 }).state;
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

describe("all sixteen Chance cards", () => {
  it("movement cards follow clockwise laps, Detour never pays Start, and corner cards end doubles", () => {
    const state = newGame();
    const seat = state.activeSeat;
    const grand = draw(state, "Grand Tour");
    expect(getPlayer(grand.state, seat)).toMatchObject({
      position: 0,
      laps: 1,
      cash: 2_400_000,
    });
    const detour = draw(state, "Detour");
    expect(getPlayer(detour.state, seat)).toMatchObject({
      position: 0,
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
    const stadium = draw(grant(state, 1, seat), "Stadium Call", 19).state;
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
describe("wins, rankings and timeouts", () => {
  it("detects Triple, Line and Resort wins with their documented precedence", () => {
    for (const [tiles, last, kind] of [
      [[1, 2, 4, 6, 7, 9, 10], 11, "triple-monopoly"],
      [[1, 2, 4, 5, 6], 7, "line-monopoly"],
      [[5, 12, 21], 28, "resort-monopoly"],
    ] as const) {
      let state = newGame();
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
  it("honors disabled line/triple conditions and real timed settings", () => {
    let state = newGame(4, {
      ...CONFIG,
      lineMonopoly: false,
      tripleMonopoly: false,
    });
    const seat = state.activeSeat;
    for (const tile of [1, 2, 4, 5, 6]) state = grant(state, tile, seat);
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
    let state = newGame(4, { ...CONFIG, timeLimitMinutes: 20 });
    const seat = state.activeSeat;
    const payer = other(state);
    state = grant(state, 6, payer);
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
    let state = newGame();
    const seat = state.activeSeat;
    state = grant(grant(state, 1, seat, 3), 31, seat, 4);
    const taxed = land(state, 29).state;
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
    let state = newGame(2);
    const seat = state.activeSeat;
    const rival = other(state);
    for (const tile of [2, 13, 15, 25, 26, 27])
      state = grant(state, tile, seat, 5);
    state = grant(state, 31, seat, 4);
    for (const tile of [4, 6, 7, 9, 10, 11, 30])
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
    const state = grant(newGame(), 1, 0);
    const before = JSON.stringify(state);
    expect(previewPropertyRent(state, 2, 0, 1)).toBe(84_000);
    expect(previewPropertyRent({ ...state, festivalTiles: [2] }, 2, 1, 1)).toBe(
      84_000,
    );
    expect(JSON.stringify(state)).toBe(before);
    expect(getProperty(state, 2)?.owner).toBeNull();
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
