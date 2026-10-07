import { BOT_POLICY } from "../board/bot-policy.js";
import type {
  BoardRule,
  BuildLevel,
  ChanceRule,
  CityTile,
  EconomyRule,
  ResortTile,
  WorldTourRule,
} from "../board/index.js";
import {
  BOARD_SIZE,
  BOT_TIMING,
  CHANCE_AMOUNTS,
  CHANCE_DECK_COPIES,
  COUNTRY_IDS,
  DECISION_TIMING,
  ECONOMY,
  getBoard,
  getCountryCityTiles,
  getResortRent,
  getTile,
  getTileBaseRent,
  getTileInvestedValue,
  getTileLandPrice,
  isCityTile,
  isResortTile,
  PAUSE_TIMING,
  ruleEconomy,
} from "../board/index.js";
import { selectInitialFestivals } from "./festivals.js";
import { applyEvent, toPublic } from "./reducer.js";
import { createEntropySampler, nextRandom, shuffle } from "./rng.js";
import type {
  Action,
  ApplyActionResult,
  BotDifficulty,
  ChanceCard,
  CreateGameResult,
  EngineContext,
  GameConfig,
  GameEvent,
  GameState,
  KeepCard,
  PendingDecision,
  PlayerState,
  PropertyState,
  PublicState,
  RentCard,
  ResolutionTask,
  Seat,
  SeatInfo,
  Standing,
  WinKind,
} from "./types.js";
import { CHANCE_CARDS, LEGACY_CHANCE_CARDS, SHIELDED_CARDS } from "./types.js";

export { applyEvent, toPublic } from "./reducer.js";
export const DEFAULT_GAME_CONFIG = {
  gameId: "local-game",
  startingCash: ECONOMY.startingCash,
  startSalary: ECONOMY.startSalary,
  roundLimit: 10_000,
  timeLimitMinutes: 120,
  festivalCount: 3,
  festivalDistribution: "spread",
  resortFestivals: false,
  lineMonopoly: true,
  tripleMonopoly: true,
  resortMonopoly: false,
  hotelsDirectly: false,
  hotelPurchaseRule: "staged-hotels",
  economyRule: "reference",
  boardRule: "country",
  worldTourRule: "free-and-own",
  fourResortRent: true,
  buildAfterBuyout: true,
  escapeCard: true,
  chanceRule: "reworked",
  turnOrderRule: "clockwise",
  sellBackPercent: 100,
  extraRollOnDouble: true,
  tripleDoubleToIsland: true,
  botCanBuild: true,
  botDifficulty: "medium",
  giftCanBankrupt: true,
} as const satisfies GameConfig;
/** Saves made before rules version 4 carry no marker: keep the prototype economy. */
export function economyRule(config: GameConfig): EconomyRule {
  return config.economyRule ?? "prototype";
}
/** Missing markers belong to matches made on the original production board. */
export function boardRule(config: Pick<GameConfig, "boardRule">): BoardRule {
  return config.boardRule ?? "legacy";
}
/** Saves made before rules version 6 reach own properties only when none is free. */
export function worldTourRule(
  config: Pick<GameConfig, "worldTourRule">,
): WorldTourRule {
  return config.worldTourRule ?? "free-first";
}
/** Saves before rules version 10 keep the original card set. */
export function chanceRule(config: Pick<GameConfig, "chanceRule">): ChanceRule {
  return config.chanceRule ?? "original";
}
/**
 * The cards a full deck holds under the match's frozen rules: every card with
 * copies (version 10), or the original sixteen plus Escape from version 9.
 */
export function chanceDeck(
  config: Pick<GameConfig, "chanceRule" | "escapeCard">,
): ChanceCard[] {
  const copies: Partial<Record<ChanceCard, number>> = CHANCE_DECK_COPIES;
  if (chanceRule(config) === "reworked")
    return CHANCE_CARDS.flatMap((card) =>
      Array<ChanceCard>(copies[card] ?? 1).fill(card),
    );
  return config.escapeCard === true
    ? [...LEGACY_CHANCE_CARDS, "Escape"]
    : [...LEGACY_CHANCE_CARDS];
}
function rules(state: PublicState) {
  return ruleEconomy(economyRule(state.config));
}
/** New matches exclude resorts; unmarked saves retain their original economy. */
export function resortFestivals(
  config: Pick<GameConfig, "resortFestivals" | "economyRule">,
): boolean {
  return (
    config.resortFestivals ??
    ruleEconomy(config.economyRule ?? "prototype").resortFestivals
  );
}
export function getPlayer(state: PublicState, seat: Seat): PlayerState {
  const player = state.players.find((candidate) => candidate.seat === seat);
  if (!player) throw new RangeError(`Unknown seat ${seat}`);
  return player;
}
export function getProperty(
  state: PublicState,
  tile: number,
): PropertyState | undefined {
  return state.properties.find((property) => property.tile === tile);
}
/** A Power Cut lasts until the owner has passed Start enough times. */
export function powerCutActive(
  state: PublicState,
  property: PropertyState,
): boolean {
  return (
    property.powerCutUntilLap !== undefined &&
    property.owner !== null &&
    getPlayer(state, property.owner).laps < property.powerCutUntilLap
  );
}
/** The opponent still in play with the least (or most) cash; ties keep turn order. */
export function cashRankedOpponent(
  state: PublicState,
  seat: Seat,
  most: boolean,
): Seat | undefined {
  return state.turnOrder
    .filter((other) => other !== seat)
    .map((other) => getPlayer(state, other))
    .sort(
      (a, b) =>
        (most ? b.cash - a.cash : a.cash - b.cash) ||
        state.turnOrder.indexOf(a.seat) - state.turnOrder.indexOf(b.seat),
    )[0]?.seat;
}
export function propertyOwner(state: PublicState, tile: number): Seat | null {
  return getProperty(state, tile)?.owner ?? null;
}
export function propertyInvestedValue(
  state: PublicState,
  tileIndex: number,
): number {
  const tile = getTile(tileIndex, state.config);
  if (tile && isCityTile(tile))
    return getTileInvestedValue(
      tileIndex,
      getProperty(state, tileIndex)?.level ?? 0,
      economyRule(state.config),
      boardRule(state.config),
    );
  if (tile && isResortTile(tile)) return ECONOMY.resortPrice;
  return 0;
}
export function netWorth(state: PublicState, seat: Seat | PlayerState): number {
  const player = typeof seat === "number" ? getPlayer(state, seat) : seat;
  return (
    player.cash +
    player.properties.reduce(
      (value, tile) => value + propertyInvestedValue(state, tile),
      0,
    )
  );
}
export function resortCount(state: PublicState, seat: Seat): number {
  return state.properties.filter(
    (property) =>
      property.owner === seat &&
      getTile(property.tile, state.config)?.kind === "resort",
  ).length;
}
function ownsCountry(
  state: PublicState,
  seat: Seat,
  country: (typeof COUNTRY_IDS)[number],
): boolean {
  return getCountryCityTiles(country, state.config).every(
    (tile) => propertyOwner(state, tile.index) === seat,
  );
}
/**
 * Prototype rooms apply the single largest modifier. Reference rooms add each
 * modifier's bonus: a full country (×2) and a ×2 championship make ×3.
 */
function rentMultiplier(
  state: PublicState,
  modifiers: readonly number[],
): number {
  const economy = rules(state);
  return economy.rentModifiers === "largest"
    ? Math.max(1, ...modifiers)
    : Math.min(
        economy.maxRentMultiplier,
        modifiers.reduce((total, modifier) => total + modifier - 1, 1),
      );
}
export function propertyRent(state: PublicState, tileIndex: number): number {
  const tile = getTile(tileIndex, state.config);
  const property = getProperty(state, tileIndex);
  const rule = economyRule(state.config);
  const festival = state.festivalTiles.includes(tileIndex)
    ? CHANCE_AMOUNTS.initialHostMultiplier
    : 1;
  if (tile && isResortTile(tile)) {
    const count =
      property?.owner !== null && property?.owner !== undefined
        ? resortCount(state, property.owner)
        : 1;
    // Saves before rules version 8 pay a fourth resort like the third.
    const top = state.config.fourResortRent === true ? 4 : 3;
    const rent = getResortRent(
      Math.min(top, Math.max(1, count)) as 1 | 2 | 3 | 4,
      rule,
    );
    return resortFestivals(state.config)
      ? rent * rentMultiplier(state, [festival])
      : rent;
  }
  if (!tile || !isCityTile(tile) || !property) return 0;
  if (powerCutActive(state, property)) return 0;
  const rent = getTileBaseRent(
    tileIndex,
    property.level,
    rule,
    boardRule(state.config),
  );
  if (property.level === 5) return rent;
  const country =
    property.owner !== null && ownsCountry(state, property.owner, tile.country)
      ? CHANCE_AMOUNTS.countryMultiplier
      : 1;
  const host =
    state.championshipHost?.tile === tileIndex
      ? state.championshipHost.multiplier
      : 1;
  return rent * rentMultiplier(state, [country, host, festival]);
}
export type RentBoost = {
  readonly multiplier: number;
  readonly source: "championship" | "festival" | "country" | "combined";
};
/** Uses the same frozen stacking rule as the live rent calculation. */
export function rentBoost(
  state: PublicState,
  tileIndex: number,
): RentBoost | null {
  const tile = getTile(tileIndex, state.config);
  const property = getProperty(state, tileIndex);
  if (!tile || !property || (!isCityTile(tile) && !isResortTile(tile)))
    return null;
  if (isCityTile(tile) && property.level === 5) return null;
  if (isResortTile(tile) && !resortFestivals(state.config)) return null;
  if (powerCutActive(state, property)) return null;
  const boosts: RentBoost[] = [];
  if (isCityTile(tile) && state.championshipHost?.tile === tileIndex)
    boosts.push({
      multiplier: state.championshipHost.multiplier,
      source: "championship",
    });
  if (state.festivalTiles.includes(tileIndex))
    boosts.push({
      multiplier: CHANCE_AMOUNTS.initialHostMultiplier,
      source: "festival",
    });
  if (
    isCityTile(tile) &&
    property.owner !== null &&
    ownsCountry(state, property.owner, tile.country)
  )
    boosts.push({
      multiplier: CHANCE_AMOUNTS.countryMultiplier,
      source: "country",
    });
  if (boosts.length === 0) return null;
  if (rules(state).rentModifiers === "additive")
    return {
      multiplier: rentMultiplier(
        state,
        boosts.map((boost) => boost.multiplier),
      ),
      source: boosts.length > 1 ? "combined" : boosts[0].source,
    };
  return boosts.reduce((best, boost) =>
    best.multiplier >= boost.multiplier ? best : boost,
  );
}
/** Quote another build level without changing ownership or frozen bonuses. */
export function propertyRentAt(
  state: PublicState,
  tile: number,
  level: BuildLevel,
): number {
  return propertyRent(
    {
      ...state,
      properties: state.properties.map((property) =>
        property.tile === tile ? { ...property, level } : property,
      ),
    },
    tile,
  );
}
/** Quote the current owned city; the protected Hotel/legacy Landmark cannot be bought out. */
export function buyoutPrice(state: PublicState, tile: number): number | null {
  const property = getProperty(state, tile);
  return !property || property.owner === null
    ? null
    : buyoutPriceAt(state, tile, property.level);
}
/** Projects a single purchase or upgrade through the same rent rules as live play. */
export function previewPropertyRent(
  state: PublicState,
  tile: number,
  seat: Seat,
  level: BuildLevel,
): number {
  const property = getProperty(state, tile);
  if (!property) return 0;
  const hostChangesOwner =
    !rules(state).championshipPersists &&
    property.owner !== seat &&
    state.championshipHost?.tile === tile;
  return propertyRent(
    {
      ...state,
      properties: state.properties.map((candidate) =>
        candidate.tile === tile
          ? { ...candidate, owner: seat, level }
          : candidate,
      ),
      championshipHost: hostChangesOwner ? null : state.championshipHost,
    },
    tile,
  );
}

/** Construction cap before checking the player's budget or stored decision cap. */
export function maxBuildLevel(
  state: PublicState,
  seat: Seat,
  tileIndex: number,
  purchasing: boolean,
): BuildLevel {
  if (getTile(tileIndex, state.config)?.kind === "resort") return 0;
  const level = getProperty(state, tileIndex)?.level ?? 0;
  if (!purchasing && level === 4) return rules(state).topLevel;
  if (state.config.hotelsDirectly === true) return 4;
  // Reference rooms allow two houses before a first completed lap, then three.
  const lapped = getPlayer(state, seat).laps > 0;
  const houses = lapped ? 3 : rules(state).firstLapHouseCap;
  if (
    state.config.hotelPurchaseRule === "staged-hotels" &&
    (purchasing || level < 3)
  )
    return houses;
  return lapped ? 4 : houses;
}
export function propertyRefund(state: PublicState, tile: number): number {
  return Math.floor(
    (propertyInvestedValue(state, tile) *
      (state.config.sellBackPercent ?? rules(state).sellBackPercent)) /
      100,
  );
}
function purchaseCost(
  state: PublicState,
  tileIndex: number,
  level: BuildLevel,
): number {
  const tile = getTile(tileIndex, state.config);
  return tile && isCityTile(tile)
    ? getTileInvestedValue(
        tileIndex,
        level,
        economyRule(state.config),
        boardRule(state.config),
      )
    : ECONOMY.resortPrice;
}
/**
 * What an opponent would pay to buy out this city at a level, or null when
 * the level (reference Hotel, prototype Landmark) or a resort is protected.
 */
export function buyoutPriceAt(
  state: PublicState,
  tileIndex: number,
  level: BuildLevel,
): number | null {
  const tile = getTile(tileIndex, state.config);
  if (!tile || !isCityTile(tile) || level >= rules(state).protectedLevel)
    return null;
  return (
    getTileInvestedValue(
      tileIndex,
      level,
      economyRule(state.config),
      boardRule(state.config),
    ) * ECONOMY.buyoutMultiplier
  );
}
/** Hosting again on the current host is free; moving the championship has a fee. */
export function championshipCost(state: PublicState, tile: number): number {
  return state.championshipHost?.tile === tile
    ? 0
    : rules(state).championshipFee;
}
/** The championship after hosting it on a tile: a prototype move restarts at ×2. */
export function nextChampionship(
  state: PublicState,
  tile: number,
): NonNullable<PublicState["championshipHost"]> {
  const economy = rules(state);
  const host = state.championshipHost;
  return {
    tile,
    multiplier:
      host && (host.tile === tile || economy.championshipPersists)
        ? Math.min(economy.maxHostMultiplier, host.multiplier + 1)
        : CHANCE_AMOUNTS.initialHostMultiplier,
  };
}
/** The rent owed after choosing at most one protection; null pays it in full. */
export function rentCardPayment(amount: number, card: KeepCard | null): number {
  return card === "Guardian Angel"
    ? 0
    : card === "Coupon"
      ? Math.ceil(amount / 2)
      : amount;
}
/** Destinations are quoted from the same rule used when opening a flight. */
export function worldTourTargets(state: PublicState, seat: Seat): number[] {
  const player = getPlayer(state, seat);
  const others = getBoard(state.config)
    .filter((tile) => tile.index !== player.position)
    .map((tile) => tile.index);
  if (!rules(state).travelToFreeProperties) return others;
  const owned = (...owners: (Seat | null)[]) =>
    others.filter(
      (tile) =>
        getProperty(state, tile) !== undefined &&
        owners.includes(propertyOwner(state, tile)),
    );
  if (worldTourRule(state.config) === "free-and-own") return owned(null, seat);
  const free = owned(null);
  return free.length > 0 ? free : owned(seat);
}
/** Tiles from one space to another going clockwise; the same space is a lap. */
function clockwiseSteps(from: number, to: number): number {
  return (to - from + BOARD_SIZE) % BOARD_SIZE || BOARD_SIZE;
}
/** The Start salary a flight to this tile collects on its clockwise route. */
export function travelSalary(
  state: PublicState,
  seat: Seat,
  tile: number,
): number {
  const position = getPlayer(state, seat).position;
  return position + clockwiseSteps(position, tile) >= BOARD_SIZE
    ? state.config.startSalary
    : 0;
}
export function actionCost(state: PublicState, action: Action): number {
  const pending = state.pending;
  if (!pending) return 0;
  switch (action.type) {
    case "Buy":
      return pending.kind === "buy"
        ? purchaseCost(state, pending.tile, action.level)
        : 0;
    case "Build":
      return pending.kind === "build"
        ? purchaseCost(state, pending.tile, action.level) -
            propertyInvestedValue(state, pending.tile)
        : 0;
    case "Buyout":
      return pending.kind === "buyout" ? pending.price : 0;
    case "PayIsland":
      return pending.kind === "island" ? pending.fee : 0;
    case "Travel":
      return pending.kind === "travel" ? pending.fee : 0;
    case "ChooseHost":
      return pending.kind === "host" ? championshipCost(state, action.tile) : 0;
    default:
      return 0;
  }
}
export function legalActions(state: PublicState, seat: Seat): Action[] {
  const pending = state.pending;
  if (
    state.status !== "active" ||
    state.pause?.kind === "paused" ||
    !pending ||
    pending.seat !== seat ||
    getPlayer(state, seat).bankrupt
  )
    return [];
  const player = getPlayer(state, seat);
  switch (pending.kind) {
    case "roll":
      return [{ type: "Roll" }];
    case "island":
      return [
        { type: "Roll" },
        ...(player.cash >= pending.fee ? [{ type: "PayIsland" as const }] : []),
        ...(player.heldCards.includes("Escape")
          ? [{ type: "UseEscapeCard" as const }]
          : []),
      ];
    case "travel":
      return player.cash >= pending.fee
        ? [
            { type: "Roll" },
            ...pending.targets.map((tile) => ({
              type: "Travel" as const,
              tile,
            })),
          ]
        : [{ type: "Roll" }];
    case "buy": {
      const actions: Action[] = [{ type: "Decline" }];
      const purchaseCap =
        state.config.hotelPurchaseRule === "staged-hotels"
          ? Math.min(
              pending.maxLevel,
              maxBuildLevel(state, seat, pending.tile, true),
            )
          : pending.maxLevel;
      const maxLevel =
        player.control === "bot" && state.config.botCanBuild === false
          ? 0
          : purchaseCap;
      for (let level = 0; level <= maxLevel; level++)
        if (
          purchaseCost(state, pending.tile, level as BuildLevel) <= player.cash
        )
          actions.push({ type: "Buy", level: level as BuildLevel });
      return actions;
    }
    case "build": {
      const actions: Action[] = [{ type: "Decline" }];
      if (player.control === "bot" && state.config.botCanBuild === false)
        return actions;
      const current = getProperty(state, pending.tile)?.level ?? 0;
      const upgradeCap =
        state.config.hotelPurchaseRule === "staged-hotels"
          ? Math.min(
              pending.maxLevel,
              maxBuildLevel(state, seat, pending.tile, false),
            )
          : pending.maxLevel;
      for (let level = current + 1; level <= upgradeCap; level++) {
        const action: Action = { type: "Build", level: level as BuildLevel };
        if (actionCost(state, action) <= player.cash) actions.push(action);
      }
      return actions;
    }
    case "buyout":
      return player.cash >= pending.price
        ? [{ type: "Decline" }, { type: "Buyout" }]
        : [{ type: "Decline" }];
    case "rent-card":
      return [
        { type: "Decline" },
        ...pending.cards.map((card) => ({
          type: "UseRentCard" as const,
          card,
        })),
      ];
    case "host":
      return [
        // A paid championship is optional; the prototype host is mandatory.
        ...(rules(state).championshipFee > 0
          ? [{ type: "Decline" as const }]
          : []),
        ...pending.targets
          .filter((tile) => championshipCost(state, tile) <= player.cash)
          .map((tile) => ({ type: "ChooseHost" as const, tile })),
      ];
    case "card-target":
      return [
        ...(pending.card === "Land Swap" ? [{ type: "Decline" as const }] : []),
        ...pending.targets.map((tile) => ({
          type: "ChooseTarget" as const,
          tile,
        })),
      ];
    case "sell":
      return pending.targets.map((tile) => ({ type: "Sell" as const, tile }));
  }
}
function sameAction(a: Action, b: Action): boolean {
  return (
    a.type === b.type &&
    (!("tile" in a) || ("tile" in b && a.tile === b.tile)) &&
    (!("level" in a) || ("level" in b && a.level === b.level)) &&
    (!("card" in a) || ("card" in b && a.card === b.card))
  );
}
function rankStandings(state: PublicState, winner?: Seat): Standing[] {
  const rank = (seat: Seat) => state.startingTurnOrder.indexOf(seat);
  const living = state.players
    .filter((player) => !player.bankrupt)
    .sort(
      (a, b) =>
        netWorth(state, b) - netWorth(state, a) ||
        b.cash - a.cash ||
        resortCount(state, b.seat) - resortCount(state, a.seat) ||
        rank(a.seat) - rank(b.seat),
    );
  const eliminated = [...state.eliminated]
    .reverse()
    .map((seat) => getPlayer(state, seat));
  const players = [...living, ...eliminated];
  if (winner !== undefined)
    players.sort((a, b) =>
      a.seat === winner ? -1 : b.seat === winner ? 1 : 0,
    );
  return players.map((player) => ({
    seat: player.seat,
    netWorth: netWorth(state, player),
  }));
}
function instantWin(state: PublicState, seat: Seat): WinKind | null {
  if (getPlayer(state, seat).bankrupt) return null;
  if (state.players.filter((player) => !player.bankrupt).length === 1)
    return "last-standing";
  if (
    state.config.tripleMonopoly !== false &&
    COUNTRY_IDS.filter((country) => ownsCountry(state, seat, country)).length >=
      3
  )
    return "triple-monopoly";
  for (let side = 1; state.config.lineMonopoly !== false && side <= 4; side++) {
    const tiles = getBoard(state.config).filter(
      (tile) => (isCityTile(tile) || isResortTile(tile)) && tile.side === side,
    );
    if (tiles.every((tile) => propertyOwner(state, tile.index) === seat))
      return "line-monopoly";
  }
  if (state.config.resortMonopoly !== false && resortCount(state, seat) === 4)
    return "resort-monopoly";
  return null;
}
function animationBudget(events: readonly GameEvent[]): number {
  return events.reduce((total, event) => {
    switch (event.type) {
      case "GameCreated":
        return (
          total +
          (event.state.config.turnOrderRule === "clockwise"
            ? DECISION_TIMING.startAnimation
            : 0)
        );
      case "DiceRolled":
        return total + DECISION_TIMING.diceAnimation;
      case "PlayerMoved": {
        // Mirrors the client: a move walks its route tile by tile, a long one
        // hops faster; only a move without a route jumps.
        const steps = Math.abs(event.steps ?? 0);
        return (
          total +
          (steps === 0
            ? DECISION_TIMING.jumpAnimation
            : Math.min(
                steps * DECISION_TIMING.stepAnimation,
                DECISION_TIMING.walkAnimation,
              ))
        );
      }
      case "SentToIsland":
      case "PlayerBankrupt":
        return total + DECISION_TIMING.islandAnimation;
      case "CardDrawn":
        return total + DECISION_TIMING.cardAnimation;
      case "SalaryPaid":
      case "RentPaid":
        return total + DECISION_TIMING.moneyAnimation;
      case "MoneyTransferred":
        return (
          total +
          (event.reason === "Tax"
            ? Math.max(
                DECISION_TIMING.moneyAnimation,
                DECISION_TIMING.taxAnimation,
              )
            : DECISION_TIMING.moneyAnimation)
        );
      case "BoughtOut":
      case "PropertyBought":
      case "PropertySold":
      case "PropertyUpgraded":
        return (
          total +
          DECISION_TIMING.moneyAnimation +
          DECISION_TIMING.propertyAnimation
        );
      case "PropertyDowngraded":
        return total + DECISION_TIMING.wreckAnimation;
      case "PropertiesSwapped":
      case "PowerCut":
      case "ShieldRaised":
      case "ShieldBroken":
      case "PropertyGiven":
        return total + DECISION_TIMING.propertyAnimation;
      default:
        return total;
    }
  }, 0);
}
/** A player's own time for a decision, after the animations that open it. */
export function decisionWindow(
  config: GameConfig,
  kind: PendingDecision["kind"],
): number {
  return config.decisionSeconds !== undefined
    ? config.decisionSeconds * 1_000
    : kind === "sell"
      ? DECISION_TIMING.sell
      : kind === "roll" || kind === "island" || kind === "travel"
        ? DECISION_TIMING.roll
        : DECISION_TIMING.choice;
}
/**
 * When the animations that opened the pending decision finish at 1× speed.
 * The deadline already holds that presentation budget.
 */
export function decisionOpensAt(state: PublicState): number | null {
  const pending = state.pending;
  if (!pending || state.pause?.kind === "paused") return null;
  return pending.deadline - decisionWindow(state.config, pending.kind);
}
/** Server bots wait for the full presentation, followed by their thinking pause. */
export function botDecisionAt(state: PublicState): number | null {
  const presented = decisionOpensAt(state);
  if (presented === null || !state.pending) return null;
  return (
    presented +
    (state.pending.kind === "roll" ? BOT_TIMING.roll : BOT_TIMING.choice)
  );
}
type DecisionInput = PendingDecision extends infer T
  ? T extends PendingDecision
    ? Omit<T, "deadline">
    : never
  : never;

type ResolutionContext = EngineContext & {
  readonly chanceIndex?: (range: number) => number;
};
function resolutionContext(context: EngineContext): ResolutionContext {
  return {
    ...context,
    chanceIndex:
      context.chanceEntropy === undefined
        ? undefined
        : createEntropySampler(context.chanceEntropy),
  };
}

/** An action-local resolver: all public writes go through emit/applyEvent. */
function resolver(
  initial: GameState,
  context: ResolutionContext,
  openingEvents: readonly GameEvent[] = [],
) {
  let state = initial;
  const events: GameEvent[] = [...openingEvents];
  const emit = (event: GameEvent) => {
    state = { ...state, ...applyEvent(toPublic(state), event) };
    events.push(event);
  };
  const secrets = (
    changes: Partial<
      Pick<
        GameState,
        | "rngState"
        | "deck"
        | "discard"
        | "resolutionQueue"
        | "extraRoll"
        | "turnEnded"
      >
    >,
  ) => {
    state = { ...state, ...changes };
  };
  const prepend = (...tasks: ResolutionTask[]) =>
    secrets({ resolutionQueue: [...tasks, ...state.resolutionQueue] });
  const open = (decision: DecisionInput) => {
    emit({
      type: "DecisionOpened",
      pending: {
        ...decision,
        deadline:
          context.now +
          decisionWindow(state.config, decision.kind) +
          animationBudget(events),
      } as PendingDecision,
    });
  };
  /** An ownership change clears a prototype host; a reference host stays put. */
  const clearHost = (tiles: readonly number[]) => {
    if (
      !rules(state).championshipPersists &&
      state.championshipHost &&
      tiles.includes(state.championshipHost.tile)
    )
      emit({ type: "ChampionshipChanged", host: null });
  };
  const checkWins = (): boolean => {
    const order = [
      state.activeSeat,
      ...state.startingTurnOrder.slice(
        state.startingTurnOrder.indexOf(state.activeSeat) + 1,
      ),
      ...state.startingTurnOrder.slice(
        0,
        state.startingTurnOrder.indexOf(state.activeSeat),
      ),
    ];
    for (const seat of order) {
      const kind = instantWin(state, seat);
      if (kind) {
        emit({
          type: "GameOver",
          winner: seat,
          kind,
          standings: rankStandings(state, seat),
        });
        secrets({ resolutionQueue: [], extraRoll: false });
        return true;
      }
    }
    return false;
  };
  const bankrupt = (seat: Seat, creditor: Seat | null) => {
    const player = getPlayer(state, seat);
    clearHost(player.properties);
    secrets({ discard: [...state.discard, ...player.heldCards] });
    emit({
      type: "PlayerBankrupt",
      seat,
      creditor,
      writtenOff: -Math.min(0, player.cash),
      turnOrder: state.turnOrder.filter((candidate) => candidate !== seat),
      roundSeatsRemaining: state.roundSeatsRemaining.filter(
        (candidate) => candidate !== seat,
      ),
    });
  };
  const insolvency = (seat: Seat, creditor: Seat | null) => {
    const player = getPlayer(state, seat);
    if (player.bankrupt || player.cash >= 0) return;
    const refund = player.properties.reduce(
      (sum, tile) => sum + propertyRefund(state, tile),
      0,
    );
    if (player.cash + refund < 0 || player.properties.length === 0)
      bankrupt(seat, creditor);
    else open({ kind: "sell", seat, targets: player.properties, creditor });
  };
  const payment = (
    from: Seat,
    to: Seat | null,
    amount: number,
    reason: string,
    tile?: number,
  ) => {
    if (getPlayer(state, from).bankrupt || amount === 0) return;
    if (to !== null && getPlayer(state, to).bankrupt) to = null;
    if (
      state.config.giftCanBankrupt === false &&
      ["Birthday", "Charity", "Patron"].includes(reason)
    )
      amount = Math.min(amount, Math.max(0, getPlayer(state, from).cash));
    if (tile !== undefined && to !== null)
      emit({ type: "RentPaid", seat: from, owner: to, tile, amount });
    else emit({ type: "MoneyTransferred", from, to, amount, reason });
    insolvency(from, to);
  };
  /** Reference flights reach unowned and own properties; see WorldTourRule. */
  const travelTargets = (player: PlayerState): number[] => {
    return worldTourTargets(state, player.seat);
  };
  const startDecision = () => {
    const player = getPlayer(state, state.activeSeat);
    if (player.onIsland)
      open({
        kind: "island",
        seat: player.seat,
        fee: rules(state).islandReleaseFee,
      });
    else if (player.travelPending)
      open({
        kind: "travel",
        seat: player.seat,
        fee: ECONOMY.worldTourFee,
        targets: travelTargets(player),
      });
    else open({ kind: "roll", seat: player.seat });
  };
  const endTurn = () => {
    if (checkWins()) return;
    if (
      state.extraRoll &&
      !state.turnEnded &&
      !getPlayer(state, state.activeSeat).bankrupt
    ) {
      secrets({ extraRoll: false });
      emit({ type: "TurnPhaseChanged", phase: "roll" });
      startDecision();
      return;
    }
    let remaining = state.roundSeatsRemaining.filter(
      (seat) => seat !== state.activeSeat && !getPlayer(state, seat).bankrupt,
    );
    const completedRound = remaining.length === 0;
    if (
      completedRound &&
      state.config.timeLimitMinutes !== null &&
      state.round >= state.config.roundLimit
    ) {
      const standings = rankStandings(state);
      emit({
        type: "GameOver",
        winner: standings[0].seat,
        kind: "round-limit",
        standings,
      });
      return;
    }
    if (completedRound) remaining = [...state.turnOrder];
    const index = state.startingTurnOrder.indexOf(state.activeSeat);
    const clockwise = [
      ...state.startingTurnOrder.slice(index + 1),
      ...state.startingTurnOrder.slice(0, index + 1),
    ];
    const activeSeat = clockwise.find((seat) => remaining.includes(seat));
    if (activeSeat === undefined)
      throw new Error("No next player in an active game");
    emit({
      type: "TurnAdvanced",
      activeSeat,
      round: state.round + Number(completedRound),
      roundSeatsRemaining: remaining,
    });
    secrets({ extraRoll: false, turnEnded: false });
    startDecision();
  };
  const move = (seat: Seat, steps: number) => {
    const player = getPlayer(state, seat);
    const absolute = player.position + steps;
    const crossings = steps > 0 ? Math.floor(absolute / BOARD_SIZE) : 0;
    const position = ((absolute % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    emit({
      type: "PlayerMoved",
      seat,
      from: player.position,
      position,
      steps,
      laps: player.laps + crossings,
    });
    if (crossings > 0)
      emit({
        type: "SalaryPaid",
        seat,
        amount: state.config.startSalary * crossings,
        cash: player.cash + state.config.startSalary * crossings,
      });
  };
  const moveTo = (seat: Seat, target: number) => {
    move(seat, clockwiseSteps(getPlayer(state, seat).position, target));
  };
  const roll = (seat: Seat) => {
    const player = getPlayer(state, seat);
    let dice = context.dice;
    if (!dice) {
      const a = nextRandom(state.rngState);
      const b = nextRandom(a.state);
      secrets({ rngState: b.state });
      dice = [Math.floor(a.value * 6) + 1, Math.floor(b.value * 6) + 1];
    }
    const isDouble = dice[0] === dice[1];
    const isEscapeRoll = player.onIsland;
    emit({
      type: "DiceRolled",
      seat,
      dice,
      isDouble,
      purpose: isEscapeRoll ? "escape" : "move",
    });
    emit({ type: "TurnPhaseChanged", phase: "resolve" });
    if (isEscapeRoll && !isDouble) {
      const islandTurns = player.islandTurns + 1;
      emit({ type: "IslandEscapeFailed", seat, islandTurns });
      if (islandTurns >= rules(state).islandMaxFailedEscapes)
        emit({ type: "LeftIsland", seat, method: "released" });
      secrets({ extraRoll: false, turnEnded: true });
      prepend({ kind: "finish" });
    } else if (
      !isEscapeRoll &&
      isDouble &&
      state.config.tripleDoubleToIsland !== false &&
      state.doublesInTurn >= ECONOMY.doublesToIsland
    ) {
      emit({ type: "SentToIsland", seat, reason: "triple-double" });
      secrets({ extraRoll: false, turnEnded: true });
      prepend({ kind: "finish" });
    } else {
      if (isEscapeRoll) emit({ type: "LeftIsland", seat, method: "doubles" });
      secrets({
        extraRoll:
          !isEscapeRoll && isDouble && state.config.extraRollOnDouble !== false,
        turnEnded: false,
      });
      move(seat, dice[0] + dice[1]);
      prepend({ kind: "landing", seat }, { kind: "finish" });
    }
  };
  /** Own cities below the Landmark: hosts and Contractor targets. */
  const eligibleOwnCities = (seat: Seat) =>
    state.properties.filter(
      (property) =>
        property.owner === seat &&
        getTile(property.tile, state.config)?.kind === "city" &&
        property.level < 5,
    );
  /** Own cities a free level can still raise: Contractor and Patron. */
  const upgradeTargets = (seat: Seat) => {
    const cap =
      getPlayer(state, seat).laps > 0 || state.config.hotelsDirectly === true
        ? 4
        : rules(state).firstLapHouseCap;
    return eligibleOwnCities(seat)
      .filter((property) => property.level < cap)
      .map((property) => property.tile);
  };
  /** A card's own die: live entropy, or the seeded sequence in simulations. */
  const rollDie = () => {
    if (context.chanceIndex) return context.chanceIndex(6) + 1;
    const next = nextRandom(state.rngState);
    secrets({ rngState: next.state });
    return Math.floor(next.value * 6) + 1;
  };
  const chance = (seat: Seat) => {
    if (state.deck.length === 0) {
      if (context.chanceIndex) {
        secrets({ deck: state.discard, discard: [] });
      } else {
        const reshuffled = shuffle(state.discard, state.rngState);
        secrets({
          deck: reshuffled.items,
          discard: [],
          rngState: reshuffled.state,
        });
      }
    }
    if (state.deck.length === 0) return;
    // Selecting anew makes even a saved seeded deck unpredictable in live play.
    const index = context.chanceIndex?.(state.deck.length) ?? 0;
    const card = state.deck[index];
    if (!card) return;
    secrets({
      deck: [...state.deck.slice(0, index), ...state.deck.slice(index + 1)],
    });
    const keep =
      card === "Guardian Angel" || card === "Coupon" || card === "Escape";
    const kept =
      keep && !getPlayer(state, seat).heldCards.includes(card as KeepCard);
    const reworked = chanceRule(state.config) === "reworked";
    // The card shows its die, so the roll happens with the draw.
    const roll =
      card === "Tailwind" || (reworked && card === "Detour")
        ? rollDie()
        : undefined;
    emit({
      type: "CardDrawn",
      seat,
      card,
      kept,
      ...(roll === undefined ? {} : { roll }),
    });
    if (kept) return;
    secrets({ discard: [...state.discard, card] });
    const relocate = (target: number) => {
      secrets({ extraRoll: false });
      moveTo(seat, target);
      prepend({ kind: "landing", seat });
    };
    switch (card) {
      case "Grand Tour":
        relocate(0);
        break;
      case "Stranded":
        emit({ type: "SentToIsland", seat, reason: "card" });
        secrets({ turnEnded: true, extraRoll: false });
        break;
      case "Jet Set":
        relocate(24);
        break;
      case "Stadium Call":
        relocate(16);
        break;
      case "Windfall":
        emit({
          type: "MoneyTransferred",
          from: null,
          to: seat,
          amount: CHANCE_AMOUNTS.windfall,
          reason: card,
        });
        break;
      case "Parking Fine":
        prepend({
          kind: "payment",
          from: seat,
          to: null,
          amount: CHANCE_AMOUNTS.fine,
          reason: card,
        });
        break;
      case "Birthday":
        prepend(
          ...state.turnOrder
            .filter((other) => other !== seat)
            .map((from) => ({
              kind: "payment" as const,
              from,
              to: seat,
              amount: CHANCE_AMOUNTS.birthday,
              reason: card,
            })),
        );
        break;
      case "Audit":
        if (reworked) {
          const tax = getBoard(state.config).find(
            (tile) => tile.kind === "tax",
          );
          if (tax) relocate(tax.index);
          break;
        }
        prepend({
          kind: "payment",
          from: seat,
          to: null,
          amount: Math.ceil(
            (Math.max(0, getPlayer(state, seat).cash) *
              CHANCE_AMOUNTS.auditPercent) /
              100,
          ),
          reason: card,
        });
        break;
      case "Earthquake": {
        const targets = state.properties
          .filter(
            (property) =>
              property.owner !== null &&
              property.owner !== seat &&
              property.level > 0 &&
              property.level < 5 &&
              getTile(property.tile, state.config)?.kind === "city",
          )
          .map((property) => property.tile);
        if (targets.length) open({ kind: "card-target", seat, card, targets });
        break;
      }
      case "Land Swap": {
        // Protected cities (Landmarks, reference Hotels) never change hands.
        const swappable = (property: PropertyState) =>
          getTile(property.tile, state.config)?.kind === "city" &&
          property.level < rules(state).protectedLevel;
        const price = (tile: number) => landPrice(state, tile);
        const own = state.properties
          .filter((property) => property.owner === seat && swappable(property))
          .sort((a, b) => price(a.tile) - price(b.tile) || a.tile - b.tile)[0];
        if (!own) break;
        const targets = state.properties
          .filter(
            (property) =>
              property.owner !== null &&
              property.owner !== seat &&
              swappable(property) &&
              price(property.tile) <= price(own.tile),
          )
          .map((property) => property.tile);
        if (targets.length)
          open({
            kind: "card-target",
            seat,
            card,
            targets,
            sourceTile: own.tile,
          });
        break;
      }
      case "Detour":
      case "Tailwind":
        secrets({ extraRoll: false });
        move(
          seat,
          (card === "Detour" ? -1 : 1) * (roll ?? CHANCE_AMOUNTS.detourSteps),
        );
        prepend({ kind: "landing", seat });
        break;
      case "Power Cut": {
        const targets = state.properties
          .filter(
            (property) =>
              property.owner !== null &&
              property.owner !== seat &&
              getTile(property.tile, state.config)?.kind === "city" &&
              !powerCutActive(state, property),
          )
          .map((property) => property.tile);
        if (targets.length) open({ kind: "card-target", seat, card, targets });
        break;
      }
      case "Contractor":
      case "Patron": {
        const targets = upgradeTargets(seat);
        if (targets.length) open({ kind: "card-target", seat, card, targets });
        break;
      }
      case "Forced Sale":
      case "Shield":
      case "Gift": {
        // Forced Sale hits any opponent property; Shield guards one of yours;
        // Gift gives away one of your cities below the Hotel.
        const targets = state.properties
          .filter((property) =>
            card === "Forced Sale"
              ? property.owner !== null && property.owner !== seat
              : property.owner === seat &&
                (card === "Shield"
                  ? !property.shielded
                  : getTile(property.tile, state.config)?.kind === "city" &&
                    property.level < rules(state).protectedLevel),
          )
          .map((property) => property.tile);
        if (targets.length) open({ kind: "card-target", seat, card, targets });
        break;
      }
      case "Fan Trip":
        // Off to whoever hosts the championship, to pay its rent there.
        if (state.championshipHost) relocate(state.championshipHost.tile);
        break;
      case "Roll Again":
        secrets({ extraRoll: true });
        break;
      case "Jailbreak":
        for (const player of state.players)
          if (player.onIsland)
            emit({ type: "LeftIsland", seat: player.seat, method: "card" });
        break;
      case "Escape":
        break;
      case "Charity": {
        const poorest = cashRankedOpponent(state, seat, false);
        if (poorest !== undefined)
          prepend({
            kind: "payment",
            from: seat,
            to: poorest,
            amount: CHANCE_AMOUNTS.charity,
            reason: card,
          });
        break;
      }
      case "Guardian Angel":
      case "Coupon":
        break;
    }
  };
  /** Opens a build decision on an own city that can still rise. */
  const offerBuild = (seat: Seat, tileIndex: number) => {
    const property = getProperty(state, tileIndex);
    if (
      getTile(tileIndex, state.config)?.kind !== "city" ||
      property?.owner !== seat ||
      property.level >= 5
    )
      return;
    const maxLevel = maxBuildLevel(state, seat, tileIndex, false);
    if (property.level < maxLevel)
      open({ kind: "build", seat, tile: tileIndex, maxLevel });
  };
  const landing = (seat: Seat) => {
    const player = getPlayer(state, seat);
    if (player.bankrupt) return;
    const tile = getTile(player.position, state.config);
    if (!tile) throw new Error("Invalid board tile");
    switch (tile.kind) {
      case "city":
      case "resort": {
        const property = getProperty(state, tile.index);
        if (!property) throw new Error("Missing property state");
        if (property.owner === null) {
          const maxLevel = maxBuildLevel(state, seat, tile.index, true);
          open({ kind: "buy", seat, tile: tile.index, maxLevel });
        } else if (property.owner === seat) {
          offerBuild(seat, tile.index);
        } else {
          const amount = propertyRent(state, tile.index);
          prepend({ kind: "buyout", seat, tile: tile.index });
          const cards = player.heldCards.filter(
            (card): card is RentCard => card !== "Escape",
          );
          if (cards.length > 0 && amount > 0)
            open({
              kind: "rent-card",
              seat,
              tile: tile.index,
              owner: property.owner,
              amount,
              cards,
            });
          else
            prepend({
              kind: "rent",
              from: seat,
              to: property.owner,
              amount,
              tile: tile.index,
            });
        }
        break;
      }
      case "island":
        emit({ type: "SentToIsland", seat, reason: "tile" });
        secrets({ extraRoll: false, turnEnded: true });
        break;
      case "world-tour":
        emit({ type: "TravelOptionChanged", seat, available: true });
        secrets({ extraRoll: false, turnEnded: true });
        break;
      case "championship": {
        const targets = eligibleOwnCities(seat)
          .map((property) => property.tile)
          .filter((tile) => championshipCost(state, tile) <= player.cash);
        if (targets.length) open({ kind: "host", seat, targets });
        break;
      }
      case "tax":
        prepend({
          kind: "payment",
          from: seat,
          to: null,
          amount: Math.max(
            rules(state).minimumTax,
            Math.ceil(
              (player.properties.reduce(
                (sum, index) => sum + propertyInvestedValue(state, index),
                0,
              ) *
                ECONOMY.taxPercent) /
                100,
            ),
          ),
          reason: "Tax",
        });
        break;
      case "chance":
        chance(seat);
        break;
      case "start":
        break;
    }
  };
  const drain = () => {
    let count = 0;
    while (
      state.status === "active" &&
      state.pending === null &&
      state.resolutionQueue.length > 0
    ) {
      if (++count > 100)
        throw new Error("Resolution task loop exceeded safety bound");
      const task = state.resolutionQueue[0];
      secrets({ resolutionQueue: state.resolutionQueue.slice(1) });
      switch (task.kind) {
        case "landing":
          landing(task.seat);
          break;
        case "payment":
          payment(task.from, task.to, task.amount, task.reason);
          break;
        case "rent":
          payment(task.from, task.to, task.amount, "Rent", task.tile);
          break;
        case "buyout": {
          const property = getProperty(state, task.tile);
          if (
            !getPlayer(state, task.seat).bankrupt &&
            property &&
            property.owner !== null &&
            property.owner !== task.seat &&
            property.level < rules(state).protectedLevel &&
            getTile(task.tile, state.config)?.kind === "city"
          ) {
            const price = buyoutPriceAt(state, task.tile, property.level);
            if (price !== null && getPlayer(state, task.seat).cash >= price)
              open({ kind: "buyout", seat: task.seat, tile: task.tile, price });
          }
          break;
        }
        case "improve":
          if (!getPlayer(state, task.seat).bankrupt)
            offerBuild(task.seat, task.tile);
          break;
        case "wins":
          checkWins();
          break;
        case "finish":
          endTurn();
          break;
      }
    }
  };
  const act = (seat: Seat, action: Action) => {
    const pending = state.pending;
    if (!pending) throw new Error("Action requires a decision");
    emit({ type: "DecisionClosed" });
    switch (action.type) {
      case "Roll":
        if (getPlayer(state, seat).travelPending)
          emit({ type: "TravelOptionChanged", seat, available: false });
        roll(seat);
        break;
      case "PayIsland":
        if (pending.kind === "island")
          payment(seat, null, pending.fee, "Island release");
        emit({ type: "LeftIsland", seat, method: "paid" });
        startDecision();
        break;
      case "UseEscapeCard":
        emit({ type: "CardUsed", seat, card: "Escape" });
        secrets({ discard: [...state.discard, "Escape"] });
        emit({ type: "LeftIsland", seat, method: "card" });
        startDecision();
        break;
      case "Travel":
        if (pending.kind === "travel")
          payment(seat, null, pending.fee, "World Tour");
        emit({ type: "TravelOptionChanged", seat, available: false });
        emit({ type: "TurnPhaseChanged", phase: "resolve" });
        secrets({ extraRoll: false, turnEnded: false });
        moveTo(seat, action.tile);
        prepend({ kind: "landing", seat }, { kind: "finish" });
        break;
      case "Buy":
        if (pending.kind === "buy") {
          emit({
            type: "PropertyBought",
            seat,
            tile: pending.tile,
            level: action.level,
            amount: purchaseCost(state, pending.tile, action.level),
          });
          prepend({ kind: "wins" });
        }
        break;
      case "Build":
        if (pending.kind === "build") {
          const amount =
            purchaseCost(state, pending.tile, action.level) -
            propertyInvestedValue(state, pending.tile);
          if (action.level === 5) clearHost([pending.tile]);
          emit({
            type: "PropertyUpgraded",
            seat,
            tile: pending.tile,
            level: action.level,
            amount,
            free: false,
          });
        }
        break;
      case "Buyout":
        if (pending.kind === "buyout") {
          const owner = propertyOwner(state, pending.tile);
          if (owner === null) throw new Error("Buyout requires owner");
          clearHost([pending.tile]);
          emit({
            type: "BoughtOut",
            seat,
            previousOwner: owner,
            tile: pending.tile,
            amount: pending.price,
          });
          prepend(
            { kind: "wins" },
            ...(state.config.buildAfterBuyout === true
              ? [{ kind: "improve" as const, seat, tile: pending.tile }]
              : []),
          );
        }
        break;
      case "Sell":
        if (pending.kind === "sell") {
          const amount = propertyRefund(state, action.tile);
          clearHost([action.tile]);
          emit({ type: "PropertySold", seat, tile: action.tile, amount });
          insolvency(seat, pending.creditor);
          if (state.pending === null) prepend({ kind: "wins" });
        }
        break;
      case "ChooseHost": {
        const host = nextChampionship(state, action.tile);
        const fee = championshipCost(state, action.tile);
        if (fee > 0) payment(seat, null, fee, "Championship");
        emit({ type: "ChampionshipChanged", host });
        break;
      }
      case "ChooseTarget":
        if (pending.kind === "card-target") {
          const property = getProperty(state, action.tile);
          if (!property) throw new Error("Card target requires property");
          const tile = action.tile;
          if (SHIELDED_CARDS.includes(pending.card) && property.shielded)
            emit({ type: "ShieldBroken", seat, tile });
          else if (pending.card === "Earthquake")
            emit({
              type: "PropertyDowngraded",
              tile: action.tile,
              level: (property.level - 1) as BuildLevel,
            });
          else if (pending.card === "Power Cut" && property.owner !== null)
            emit({
              type: "PowerCut",
              seat,
              tile: action.tile,
              untilLap:
                getPlayer(state, property.owner).laps +
                CHANCE_AMOUNTS.powerCutLaps,
            });
          else if (pending.card === "Forced Sale" && property.owner !== null) {
            // A Hotel loses its top level instead of the whole city.
            const owner = property.owner;
            if (property.level >= 4) {
              const level = (property.level - 1) as BuildLevel;
              const refund =
                propertyRefund(state, tile) -
                propertyRefund(
                  {
                    ...state,
                    properties: state.properties.map((entry) =>
                      entry.tile === tile ? { ...entry, level } : entry,
                    ),
                  },
                  tile,
                );
              emit({ type: "PropertyDowngraded", tile, level });
              if (refund > 0)
                emit({
                  type: "MoneyTransferred",
                  from: null,
                  to: owner,
                  amount: refund,
                  reason: pending.card,
                });
            } else {
              clearHost([tile]);
              emit({
                type: "PropertySold",
                seat: owner,
                tile,
                amount: propertyRefund(state, tile),
              });
            }
          } else if (pending.card === "Shield")
            emit({ type: "ShieldRaised", seat, tile });
          else if (pending.card === "Gift") {
            const to = cashRankedOpponent(state, seat, false);
            if (to !== undefined) {
              clearHost([tile]);
              emit({ type: "PropertyGiven", seat, to, tile });
              prepend({ kind: "wins" });
            }
          } else if (pending.card === "Patron") {
            // The richest opponent pays the bank for your next level.
            const payer = cashRankedOpponent(state, seat, true);
            const level = (property.level + 1) as BuildLevel;
            const cost =
              purchaseCost(state, tile, level) -
              propertyInvestedValue(state, tile);
            emit({
              type: "PropertyUpgraded",
              seat,
              tile,
              level,
              amount: 0,
              free: true,
            });
            if (payer !== undefined)
              prepend({
                kind: "payment",
                from: payer,
                to: null,
                amount: cost,
                reason: pending.card,
              });
          } else if (pending.card === "Contractor")
            emit({
              type: "PropertyUpgraded",
              seat,
              tile: action.tile,
              level: (property.level + 1) as BuildLevel,
              amount: 0,
              free: true,
            });
          else if (
            pending.sourceTile !== undefined &&
            property.owner !== null
          ) {
            clearHost([action.tile, pending.sourceTile]);
            emit({
              type: "PropertiesSwapped",
              seat,
              otherSeat: property.owner,
              tile: pending.sourceTile,
              otherTile: action.tile,
            });
            prepend({ kind: "wins" });
          }
        }
        break;
      case "UseRentCard":
        if (pending.kind === "rent-card") {
          emit({ type: "CardUsed", seat, card: action.card });
          secrets({ discard: [...state.discard, action.card] });
          prepend({
            kind: "rent",
            from: seat,
            to: pending.owner,
            amount: rentCardPayment(pending.amount, action.card),
            tile: pending.tile,
          });
        }
        break;
      case "Decline":
        if (pending.kind === "rent-card")
          prepend({
            kind: "rent",
            from: seat,
            to: pending.owner,
            amount: rentCardPayment(pending.amount, null),
            tile: pending.tile,
          });
        break;
    }
    drain();
  };
  return { act, startDecision, result: () => ({ state, events }) };
}
function landPrice(state: PublicState, tileIndex: number): number {
  const tile = getTile(tileIndex, state.config);
  return tile && isCityTile(tile)
    ? getTileLandPrice(
        tileIndex,
        economyRule(state.config),
        boardRule(state.config),
      )
    : ECONOMY.resortPrice;
}

function pauseChanged(
  state: GameState,
  pause: PublicState["pause"],
  pauseCooldownUntil = state.pauseCooldownUntil,
): CreateGameResult {
  const event: GameEvent = { type: "PauseChanged", pause, pauseCooldownUntil };
  return {
    state: { ...state, ...applyEvent(toPublic(state), event) },
    events: [event],
  };
}
/** Expire just the vote, without rolling dice or applying a player's decision. */
export function expirePauseVote(
  state: GameState,
  now: number,
): CreateGameResult {
  return state.status === "active" &&
    state.pause?.kind === "vote" &&
    now >= state.pause.deadline
    ? pauseChanged(state, null)
    : { state, events: [] };
}
function applyPauseAction(
  state: GameState,
  seat: Seat,
  action: Extract<
    Action,
    { type: "RequestPause" | "VotePause" | "ResumeGame" }
  >,
  context: ResolutionContext,
): ApplyActionResult {
  const humanSeats = state.players
    .filter(
      (player) =>
        !player.bankrupt &&
        (context.pauseSeats === undefined
          ? player.control === "human"
          : context.pauseSeats.includes(player.seat)),
    )
    .map((player) => player.seat);
  const reject = (message: string): ApplyActionResult => ({
    ok: false,
    error: { code: "illegal-action", message },
  });
  if (!humanSeats.includes(seat))
    return reject("Only a human player still in the game can pause or resume");
  if (action.type === "ResumeGame") {
    if (state.pause?.kind !== "paused") return reject("The game is not paused");
    const duration = context.now - state.pause.startedAt;
    if (duration < 0) return reject("Invalid resume time");
    const event: GameEvent = {
      type: "GameResumed",
      seat,
      pending: state.pending
        ? { ...state.pending, deadline: state.pending.deadline + duration }
        : null,
      matchDeadline:
        state.matchDeadline === null ? null : state.matchDeadline + duration,
    };
    return {
      ok: true,
      state: { ...state, ...applyEvent(toPublic(state), event) },
      events: [event],
    };
  }
  if (state.pause?.kind === "paused")
    return {
      ok: false,
      error: { code: "game-paused", message: "The game is paused" },
    };
  if (state.matchDeadline !== null && context.now >= state.matchDeadline)
    return { ok: true, ...finishOnTime(state, context) };
  if (state.pending && context.now >= state.pending.deadline)
    return reject("The current decision has expired");
  if (action.type === "RequestPause") {
    if (state.pause !== null)
      return reject("A pause vote is already in progress");
    if (humanSeats.length === 1)
      return {
        ok: true,
        ...pauseChanged(state, {
          kind: "paused",
          requestedBy: seat,
          startedAt: context.now,
        }),
      };
    if (context.now < state.pauseCooldownUntil)
      return {
        ok: false,
        error: {
          code: "pause-cooldown",
          message: "Wait before requesting another pause",
        },
      };
    return {
      ok: true,
      ...pauseChanged(
        state,
        {
          kind: "vote",
          requestedBy: seat,
          requiredSeats: humanSeats,
          acceptedSeats: [seat],
          deadline: context.now + PAUSE_TIMING.vote,
        },
        context.now + PAUSE_TIMING.cooldown,
      ),
    };
  }
  const vote = state.pause;
  if (vote?.kind !== "vote" || context.now >= vote.deadline)
    return reject("There is no open pause vote");
  if (!vote.requiredSeats.includes(seat))
    return reject("This player is not part of the pause vote");
  if (vote.acceptedSeats.includes(seat))
    return reject("This player has already voted");
  if (!action.accept) return { ok: true, ...pauseChanged(state, null) };
  const acceptedSeats = [...vote.acceptedSeats, seat];
  return {
    ok: true,
    ...pauseChanged(
      state,
      vote.requiredSeats.every((required) => acceptedSeats.includes(required))
        ? {
            kind: "paused",
            requestedBy: vote.requestedBy,
            startedAt: context.now,
          }
        : { ...vote, acceptedSeats },
    ),
  };
}
export function applyAction(
  state: GameState,
  seat: Seat,
  action: Action,
  context: EngineContext,
): ApplyActionResult {
  return applyActionWithContext(
    state,
    seat,
    action,
    resolutionContext(context),
  );
}
function applyActionWithContext(
  state: GameState,
  seat: Seat,
  action: Action,
  context: ResolutionContext,
): ApplyActionResult {
  if (state.status !== "active")
    return {
      ok: false,
      error: { code: "game-over", message: "The game is over" },
    };
  if (!Number.isFinite(context.now))
    return {
      ok: false,
      error: { code: "illegal-action", message: "Invalid action time" },
    };
  if (
    action.type === "RequestPause" ||
    action.type === "VotePause" ||
    action.type === "ResumeGame"
  )
    return applyPauseAction(state, seat, action, context);
  if (state.pause?.kind === "paused")
    return {
      ok: false,
      error: { code: "game-paused", message: "The game is paused" },
    };
  if (state.pending?.seat !== seat)
    return {
      ok: false,
      error: {
        code: "not-active-seat",
        message: "It is not this seat's decision",
      },
    };
  if (state.matchDeadline !== null && context.now >= state.matchDeadline)
    return { ok: true, ...finishOnTime(state, context) };
  if (
    action.type === "Roll" &&
    context.dice !== undefined &&
    (context.dice.length !== 2 ||
      context.dice.some((die) => !Number.isInteger(die) || die < 1 || die > 6))
  )
    return {
      ok: false,
      error: {
        code: "invalid-dice",
        message: "Dice must be two integers from 1 to 6",
      },
    };
  if (
    !legalActions(state, seat).some((candidate) =>
      sameAction(candidate, action),
    )
  )
    return {
      ok: false,
      error: {
        code: "illegal-action",
        message: "This action is not legal for the current decision",
      },
    };
  const resolved = resolver(state, context);
  resolved.act(seat, action);
  const result = resolved.result();
  if (
    result.state.pause?.kind === "vote" &&
    result.state.pause.requiredSeats.some(
      (required) => getPlayer(result.state, required).bankrupt,
    )
  ) {
    const cancelled = pauseChanged(result.state, null);
    return {
      ok: true,
      state: cancelled.state,
      events: [...result.events, ...cancelled.events],
    };
  }
  return { ok: true, ...result };
}
function bestRentTarget(
  state: PublicState,
  targets: readonly number[],
): number {
  return [...targets].sort(
    (a, b) => propertyRent(state, b) - propertyRent(state, a) || a - b,
  )[0];
}
function nextRentIncrease(state: PublicState, tileIndex: number): number {
  const property = getProperty(state, tileIndex);
  const rule = economyRule(state.config);
  return getTile(tileIndex, state.config)?.kind === "city" &&
    property &&
    property.level < 4
    ? getTileBaseRent(
        tileIndex,
        (property.level + 1) as BuildLevel,
        rule,
        boardRule(state.config),
      ) -
        getTileBaseRent(
          tileIndex,
          property.level,
          rule,
          boardRule(state.config),
        )
    : 0;
}
function timeoutAction(state: PublicState): Action {
  const pending = state.pending;
  if (!pending) return { type: "Roll" };
  switch (pending.kind) {
    case "roll":
    case "island":
    case "travel":
      return { type: "Roll" };
    case "buy":
    case "build":
    case "buyout":
    case "rent-card":
      return { type: "Decline" };
    case "host": {
      // A paid championship is optional: renew your own host for free, never
      // spend on a move by default.
      if (rules(state).championshipFee === 0)
        return {
          type: "ChooseHost",
          tile: bestRentTarget(state, pending.targets),
        };
      const current = state.championshipHost?.tile;
      return current !== undefined && pending.targets.includes(current)
        ? { type: "ChooseHost", tile: current }
        : { type: "Decline" };
    }
    case "card-target": {
      if (pending.card === "Land Swap") return { type: "Decline" };
      const targets = pending.targets;
      // Attacks prefer an unshielded property; a Gift gives the cheapest city.
      const exposed = targets.filter(
        (tile) => !getProperty(state, tile)?.shielded,
      );
      return {
        type: "ChooseTarget",
        tile:
          pending.card === "Gift"
            ? [...targets].sort(
                (a, b) =>
                  propertyInvestedValue(state, a) -
                    propertyInvestedValue(state, b) || a - b,
              )[0]
            : pending.card === "Contractor" || pending.card === "Patron"
              ? [...targets].sort(
                  (a, b) =>
                    nextRentIncrease(state, b) - nextRentIncrease(state, a) ||
                    a - b,
                )[0]
              : bestRentTarget(
                  state,
                  SHIELDED_CARDS.includes(pending.card) && exposed.length
                    ? exposed
                    : targets,
                ),
      };
    }
    case "sell":
      return {
        type: "Sell",
        tile: [...pending.targets].sort(
          (a, b) =>
            propertyRefund(state, a) - propertyRefund(state, b) || a - b,
        )[0],
      };
  }
}
function finishOnTime(
  state: GameState,
  context: ResolutionContext,
): CreateGameResult {
  // Complete the already-earned landing before ranking; never start a fresh roll.
  let settled = state;
  const events: GameEvent[] = [];
  for (
    let count = 0;
    settled.status === "active" &&
    settled.pending &&
    !["roll", "island", "travel"].includes(settled.pending.kind);
    count++
  ) {
    if (count > 100)
      throw new Error("Deadline settlement exceeded safety bound");
    const result = applyActionWithContext(
      settled,
      settled.pending.seat,
      timeoutAction(settled),
      { ...context, now: (state.matchDeadline ?? state.startedAt) - 1 },
    );
    if (!result.ok)
      throw new Error(`Deadline settlement failed: ${result.error.message}`);
    settled = result.state;
    events.push(...result.events);
  }
  if (settled.status === "finished") return { state: settled, events };
  const standings = rankStandings(settled);
  const event: GameEvent = {
    type: "GameOver",
    winner: standings[0].seat,
    kind: "time-limit",
    standings,
  };
  return {
    state: {
      ...settled,
      ...applyEvent(toPublic(settled), event),
      resolutionQueue: [],
      extraRoll: false,
    },
    events: [...events, event],
  };
}
export function applyTimeout(
  state: GameState,
  input: EngineContext,
): CreateGameResult {
  const context = resolutionContext(input);
  if (state.status !== "active" || state.pause?.kind === "paused")
    return { state, events: [] };
  const expiredVote = expirePauseVote(state, context.now);
  state = expiredVote.state;
  if (state.matchDeadline !== null && context.now >= state.matchDeadline) {
    const finished = finishOnTime(state, context);
    return {
      state: finished.state,
      events: [...expiredVote.events, ...finished.events],
    };
  }
  if (!state.pending || context.now < state.pending.deadline)
    return expiredVote;
  const events: GameEvent[] = [...expiredVote.events];
  let next = state;
  const forcedSell = state.pending.kind === "sell";
  do {
    const pending = next.pending;
    if (!pending) break;
    const applied = applyActionWithContext(
      next,
      pending.seat,
      timeoutAction(next),
      context,
    );
    if (!applied.ok)
      throw new Error(`Invalid timeout action: ${applied.error.message}`);
    next = applied.state;
    events.push(...applied.events);
  } while (
    forcedSell &&
    next.pending?.kind === "sell" &&
    next.pending.seat === state.pending.seat
  );
  return { state: next, events };
}
/**
 * Hands a seat to another controller during a match, as when someone who
 * joined late takes a server bot's place. The seat keeps its cash, cities,
 * position, cards and turn; only its name and control change.
 */
export function changeControl(
  state: GameState,
  seat: Seat,
  control: "human" | "bot",
  name?: string,
): ApplyActionResult {
  if (state.status !== "active")
    return {
      ok: false,
      error: { code: "game-over", message: "The game has ended" },
    };
  const player = state.players.find((candidate) => candidate.seat === seat);
  if (!player || player.bankrupt)
    return {
      ok: false,
      error: {
        code: "illegal-action",
        message: "Only a player still in the game can change control",
      },
    };
  if (name !== undefined && name.trim().length === 0)
    return {
      ok: false,
      error: { code: "illegal-action", message: "A player needs a name" },
    };
  const event: GameEvent = {
    type: "PlayerControlChanged",
    seat,
    control,
    ...(name === undefined ? {} : { name }),
  };
  return {
    ok: true,
    state: { ...state, ...applyEvent(toPublic(state), event) },
    events: [event],
  };
}
function acquiredState(
  state: PublicState,
  tile: number,
  seat: Seat | null,
): PublicState {
  const owner = propertyOwner(state, tile);
  if (owner === seat) return state;
  // Follow real ownership cleanup: transfer restores power and drops a shield.
  let acquired: PublicState;
  if (seat === null) {
    if (owner === null) return state;
    acquired = applyEvent(state, {
      type: "PropertySold",
      seat: owner,
      tile,
      amount: 0,
    });
  } else {
    acquired = applyEvent(state, {
      type: "PropertyGiven",
      seat: owner ?? seat,
      to: seat,
      tile,
    });
  }
  return {
    ...acquired,
    championshipHost:
      !rules(state).championshipPersists &&
      state.championshipHost?.tile === tile
        ? null
        : state.championshipHost,
  };
}

/** A short public-state heuristic, not a search of future dice or Chance cards. */
function botHoldingsValue(state: PublicState, seat: Seat): number {
  if (instantWin(state, seat)) return BOT_POLICY.winningValue;
  const player = getPlayer(state, seat);
  const collections = COUNTRY_IDS.reduce((value, country) => {
    const cities = getCountryCityTiles(country, state.config);
    const owned = cities.filter(
      (city) => propertyOwner(state, city.index) === seat,
    ).length;
    return (
      value +
      (owned === cities.length ? BOT_POLICY.collectionValue : 0) +
      Math.max(0, owned - 1) * BOT_POLICY.collectionProgressValue
    );
  }, 0);
  return (
    collections +
    player.properties.reduce(
      (value, tile) =>
        value +
        propertyInvestedValue(state, tile) +
        propertyRent(state, tile) * BOT_POLICY.rentHorizon,
      0,
    )
  );
}

function acquisitionValue(
  state: PublicState,
  tile: number,
  seat: Seat,
): number {
  const acquired = acquiredState(state, tile, seat);
  if (instantWin(acquired, seat)) return BOT_POLICY.winningValue;
  const without = acquiredState(state, tile, null);
  const blocks = state.players.some(
    (player) =>
      player.seat !== seat &&
      !player.bankrupt &&
      instantWin(acquiredState(state, tile, player.seat), player.seat),
  );
  return (
    botHoldingsValue(acquired, seat) -
    botHoldingsValue(without, seat) +
    (blocks ? BOT_POLICY.winningValue / 2 : 0)
  );
}

function hardSwapTarget(
  state: PublicState,
  seat: Seat,
  actions: readonly Action[],
): Action {
  const pending = state.pending;
  if (pending?.kind !== "card-target" || pending.sourceTile === undefined)
    return { type: "Decline" };
  let best: Action = { type: "Decline" };
  let bestValue = 0;
  for (const action of actions) {
    if (action.type !== "ChooseTarget") continue;
    const target = getProperty(state, action.tile);
    if (!target || target.owner === null || target.shielded) continue;
    const beforeSwap =
      !rules(state).championshipPersists &&
      state.championshipHost !== null &&
      [pending.sourceTile, action.tile].includes(state.championshipHost.tile)
        ? { ...state, championshipHost: null }
        : state;
    const swapped = applyEvent(beforeSwap, {
      type: "PropertiesSwapped",
      seat,
      otherSeat: target.owner,
      tile: pending.sourceTile,
      otherTile: action.tile,
    });
    // The active seat wins first if the swap completes two instant conditions.
    if (instantWin(swapped, seat)) return action;
    if (instantWin(swapped, target.owner)) continue;
    const value =
      botHoldingsValue(swapped, seat) -
      botHoldingsValue(state, seat) -
      (botHoldingsValue(swapped, target.owner) -
        botHoldingsValue(state, target.owner));
    if (value > bestValue) {
      bestValue = value;
      best = action;
    }
  }
  return best;
}

function botReserve(state: PublicState, seat: Seat): number {
  const position = getPlayer(state, seat).position;
  let exposure = 0;
  for (let first = 1; first <= 6; first++) {
    for (let second = 1; second <= 6; second++) {
      const tile = (position + first + second) % BOARD_SIZE;
      const owner = propertyOwner(state, tile);
      if (owner !== null && owner !== seat)
        exposure += propertyRent(state, tile);
    }
  }
  return Math.max(
    rules(state).islandReleaseFee,
    Math.ceil((exposure * BOT_POLICY.threatHorizon) / 36),
  );
}

export function botAction(
  state: PublicState,
  seat: Seat,
  difficulty: BotDifficulty = getPlayer(state, seat).botDifficulty ??
    state.config.botDifficulty ??
    "medium",
): Action {
  const actions = legalActions(state, seat);
  if (actions.length === 0) throw new RangeError("Bot has no legal decision");
  const pending = state.pending;
  if (!pending) return actions[0];
  const cash = getPlayer(state, seat).cash;
  // Public, reproducible lapses leave Easy close to the ordinary Medium policy.
  const easyLapse =
    difficulty === "easy" &&
    "tile" in pending &&
    (state.round + seat + pending.tile) % BOT_POLICY.easyLapsePeriod === 0;
  switch (pending.kind) {
    case "island":
      return (
        actions.find((action) => action.type === "UseEscapeCard") ??
        actions.find(
          (action) => action.type === "PayIsland" && cash > pending.fee * 3,
        ) ??
        actions[0]
      );
    case "travel": {
      const travel = actions
        .filter(
          (action): action is Extract<Action, { type: "Travel" }> =>
            action.type === "Travel",
        )
        .filter(
          (action) =>
            difficulty !== "hard" ||
            (propertyOwner(state, action.tile) === seat
              ? nextRentIncrease(state, action.tile) > 0
              : cash +
                  travelSalary(state, seat, action.tile) -
                  ECONOMY.worldTourFee >=
                landPrice(state, action.tile)),
        )
        .sort((a, b) => {
          const score = (tile: number) =>
            difficulty === "hard"
              ? propertyOwner(state, tile) === null
                ? acquisitionValue(state, tile, seat)
                : nextRentIncrease(state, tile)
              : propertyOwner(state, tile) === null && getProperty(state, tile)
                ? landPrice(state, tile) +
                  (getTile(tile, state.config)?.kind === "resort"
                    ? ECONOMY.resortPrice
                    : 0)
                : propertyOwner(state, tile) === seat
                  ? nextRentIncrease(state, tile)
                  : -propertyRent(state, tile);
          return score(b.tile) - score(a.tile) || a.tile - b.tile;
        });
      return (difficulty === "hard" || cash > ECONOMY.worldTourFee * 4) &&
        travel.length
        ? travel[0]
        : actions[0];
    }
    case "buy":
    case "build": {
      if (state.config.botCanBuild === false)
        return pending.kind === "buy"
          ? (actions.find(
              (action) => action.type === "Buy" && action.level === 0,
            ) ?? { type: "Decline" })
          : { type: "Decline" };
      const builds = actions.filter(
        (action) => action.type === "Buy" || action.type === "Build",
      );
      const economy = rules(state);
      const reserve =
        difficulty === "hard"
          ? botReserve(state, seat)
          : economy.islandReleaseFee;
      const winningPurchase =
        difficulty === "hard" &&
        pending.kind === "buy" &&
        instantWin(acquiredState(state, pending.tile, seat), seat) !== null;
      const affordable = builds.filter(
        (action) =>
          cash - actionCost(state, action) >= (winningPurchase ? 0 : reserve),
      );
      const selected = [...affordable]
        .reverse()
        .find(
          (action) =>
            action.type !== "Build" ||
            action.level < 5 ||
            cash >= actionCost(state, action) * 3,
        );
      if (easyLapse && selected && selected.level > 0)
        return (
          affordable.find(
            (action) =>
              action.type === selected.type &&
              action.level === selected.level - 1,
          ) ?? { type: "Decline" }
        );
      return selected ?? { type: "Decline" };
    }
    case "buyout":
      if (difficulty === "hard")
        return actions.some((action) => action.type === "Buyout") &&
          (instantWin(acquiredState(state, pending.tile, seat), seat) !==
            null ||
            (cash - pending.price >= botReserve(state, seat) &&
              acquisitionValue(state, pending.tile, seat) >= pending.price))
          ? { type: "Buyout" }
          : { type: "Decline" };
      return !easyLapse &&
        cash - pending.price >= rules(state).islandReleaseFee &&
        pending.price <= cash / 2
        ? { type: "Buyout" }
        : { type: "Decline" };
    case "rent-card":
      return {
        type: "UseRentCard",
        card: pending.cards.includes("Guardian Angel")
          ? "Guardian Angel"
          : "Coupon",
      };
    case "host": {
      const best = bestRentTarget(state, pending.targets);
      const fee = championshipCost(state, best);
      // Free renewals always; a paid move only with a comfortable reserve.
      return fee === 0 || cash - fee >= rules(state).islandReleaseFee * 2
        ? { type: "ChooseHost", tile: best }
        : timeoutAction(state);
    }
    case "sell":
      if (difficulty === "hard")
        return [...actions].sort((a, b) => {
          if (a.type !== "Sell" || b.type !== "Sell") return 0;
          const loss = (tile: number) =>
            acquisitionValue(state, tile, seat) /
            Math.max(1, propertyRefund(state, tile));
          return loss(a.tile) - loss(b.tile) || a.tile - b.tile;
        })[0];
      return timeoutAction(state);
    case "card-target":
      if (difficulty === "hard" && pending.card === "Land Swap")
        return hardSwapTarget(state, seat, actions);
      if (difficulty === "hard" && pending.card === "Gift") {
        const recipient = cashRankedOpponent(state, seat, false);
        if (recipient !== undefined)
          return {
            type: "ChooseTarget",
            tile: [...pending.targets].sort((a, b) => {
              const loss = (tile: number) =>
                acquisitionValue(state, tile, seat) +
                acquisitionValue(state, tile, recipient);
              return loss(a) - loss(b) || a - b;
            })[0],
          };
      }
      return pending.card === "Land Swap"
        ? (actions.find(
            (action) =>
              action.type === "ChooseTarget" &&
              !getProperty(state, action.tile)?.shielded,
          ) ??
            actions.find((action) => action.type === "ChooseTarget") ??
            actions[0])
        : timeoutAction(state);
    case "roll":
      return actions[0];
  }
}
export function createGame(
  config: GameConfig,
  seats: readonly SeatInfo[],
  seed: number,
  context: EngineContext,
): CreateGameResult {
  if (config.gameId.length === 0) throw new RangeError("A game ID is required");
  if (!Number.isSafeInteger(config.startingCash) || config.startingCash < 0)
    throw new RangeError("Starting cash must be a non-negative integer");
  if (!Number.isSafeInteger(config.startSalary) || config.startSalary < 0)
    throw new RangeError("Start salary must be a non-negative integer");
  if (!Number.isInteger(config.roundLimit) || config.roundLimit < 1)
    throw new RangeError("Round limit must be a positive integer");
  if (
    config.botDifficulty !== undefined &&
    !["easy", "medium", "hard"].includes(config.botDifficulty)
  )
    throw new RangeError("Unsupported bot difficulty");
  if (
    config.decisionSeconds !== undefined &&
    (!Number.isInteger(config.decisionSeconds) || config.decisionSeconds < 1)
  )
    throw new RangeError("Decision time must be a positive integer");
  if (
    config.timeLimitMinutes !== undefined &&
    config.timeLimitMinutes !== null &&
    (!Number.isFinite(config.timeLimitMinutes) || config.timeLimitMinutes <= 0)
  )
    throw new RangeError("Time limit must be positive");
  if (
    config.festivalCount !== undefined &&
    (!Number.isInteger(config.festivalCount) ||
      config.festivalCount < 0 ||
      config.festivalCount > 20)
  )
    throw new RangeError("Festival count must be from 0 to 20");
  if (
    config.resortFestivals !== undefined &&
    typeof config.resortFestivals !== "boolean"
  )
    throw new RangeError("Resort festival rule must be a boolean");
  if (
    config.hotelPurchaseRule !== undefined &&
    !["staged-hotels", "legacy-lap"].includes(config.hotelPurchaseRule)
  )
    throw new RangeError("Unsupported hotel purchase rule");
  if (
    config.economyRule !== undefined &&
    !["reference", "prototype"].includes(config.economyRule)
  )
    throw new RangeError("Unsupported economy rule");
  if (
    config.boardRule !== undefined &&
    !["country", "legacy"].includes(config.boardRule)
  )
    throw new RangeError("Unsupported board rule");
  if (
    config.worldTourRule !== undefined &&
    !["free-and-own", "free-first"].includes(config.worldTourRule)
  )
    throw new RangeError("Unsupported World Tour rule");
  for (const marker of [config.fourResortRent, config.buildAfterBuyout])
    if (marker !== undefined && typeof marker !== "boolean")
      throw new RangeError("Unsupported rules version 8 marker");
  if (config.escapeCard !== undefined && typeof config.escapeCard !== "boolean")
    throw new RangeError("Escape card rule must be a boolean");
  if (
    config.chanceRule !== undefined &&
    !["reworked", "original"].includes(config.chanceRule)
  )
    throw new RangeError("Unsupported Chance rule");
  if (
    config.turnOrderRule !== undefined &&
    !["clockwise", "shuffled"].includes(config.turnOrderRule)
  )
    throw new RangeError("Unsupported turn order rule");
  const turnOrderRule = config.turnOrderRule ?? "clockwise";
  if (
    config.festivalDistribution !== undefined &&
    !["spread", "random"].includes(config.festivalDistribution)
  )
    throw new RangeError("Unsupported festival distribution rule");
  const festivalDistribution = config.festivalDistribution ?? "spread";
  const chances = config.chanceRule ?? "reworked";
  if (
    config.sellBackPercent !== undefined &&
    config.sellBackPercent !== 50 &&
    config.sellBackPercent !== 100
  )
    throw new RangeError("Sell-back percentage must be 50 or 100");
  const economy = ruleEconomy(config.economyRule ?? "reference");
  const board = getBoard(config.boardRule ?? "country");
  if (!Number.isFinite(context.now))
    throw new RangeError("Game time must be finite");
  if (
    seats.length < ECONOMY.minimumPlayers ||
    seats.length > ECONOMY.maximumPlayers
  )
    throw new RangeError(
      `A game requires ${ECONOMY.minimumPlayers} to ${ECONOMY.maximumPlayers} seats`,
    );
  if (new Set(seats.map((seat) => seat.playerId)).size !== seats.length)
    throw new RangeError("Every seat must have a unique player ID");
  if (
    seats.some((seat) => seat.playerId.length === 0 || seat.name.length === 0)
  )
    throw new RangeError("Every seat must have a player ID and name");
  if (
    seats.some(
      (seat) =>
        seat.botDifficulty !== undefined &&
        !["easy", "medium", "hard"].includes(seat.botDifficulty),
    )
  )
    throw new RangeError("Unsupported seat bot difficulty");
  const tableSeats = seats.map((seat, index) => seat.seat ?? index);
  if (
    tableSeats.some(
      (seat) =>
        !Number.isInteger(seat) || seat < 0 || seat >= ECONOMY.maximumPlayers,
    ) ||
    new Set(tableSeats).size !== tableSeats.length
  )
    throw new RangeError("Every player needs a unique table seat from 0 to 3");
  const players: PlayerState[] = seats
    .map((seat, index) => ({
      playerId: seat.playerId,
      name: seat.name,
      control: seat.control,
      ...(seat.control === "bot"
        ? {
            botDifficulty:
              seat.botDifficulty ?? config.botDifficulty ?? "medium",
          }
        : {}),
      seat: tableSeats[index] as Seat,
      cash: config.startingCash,
      position: 0,
      laps: 0,
      onIsland: false,
      islandTurns: 0,
      bankrupt: false,
      properties: [],
      heldCards: [],
      travelPending: false,
    }))
    .sort((a, b) => a.seat - b.seat);
  const occupiedSeats = players.map((player) => player.seat);
  const order = shuffle(occupiedSeats, seed);
  const startingIndex = occupiedSeats.indexOf(order.items[0]);
  const turnOrder =
    turnOrderRule === "shuffled"
      ? order.items
      : [
          ...occupiedSeats.slice(startingIndex),
          ...occupiedSeats.slice(0, startingIndex),
        ];
  const deck = shuffle(
    chanceDeck({
      chanceRule: chances,
      escapeCard: config.escapeCard ?? true,
    }),
    order.state,
  );
  const festivals = selectInitialFestivals(
    board.filter(
      (tile): tile is CityTile | ResortTile =>
        isCityTile(tile) ||
        (config.resortFestivals === true && isResortTile(tile)),
    ),
    config.festivalCount ?? 0,
    deck.state,
    festivalDistribution,
  );
  const publicState: PublicState = {
    gameId: config.gameId,
    config: {
      ...config,
      resortFestivals: config.resortFestivals ?? false,
      festivalDistribution,
      hotelPurchaseRule: config.hotelPurchaseRule ?? "staged-hotels",
      economyRule: config.economyRule ?? "reference",
      boardRule: config.boardRule ?? "country",
      worldTourRule: config.worldTourRule ?? "free-and-own",
      fourResortRent: config.fourResortRent ?? true,
      buildAfterBuyout: config.buildAfterBuyout ?? true,
      escapeCard: config.escapeCard ?? true,
      chanceRule: chances,
      turnOrderRule,
      sellBackPercent: config.sellBackPercent ?? economy.sellBackPercent,
    },
    players,
    properties: board
      .filter((tile) => isCityTile(tile) || isResortTile(tile))
      .map((tile) => ({ tile: tile.index, owner: null, level: 0 })),
    turnOrder,
    startingTurnOrder: turnOrder,
    roundSeatsRemaining: turnOrder,
    eliminated: [],
    activeSeat: turnOrder[0],
    round: 1,
    phase: "roll",
    doublesInTurn: 0,
    pending: null,
    pause: null,
    pauseCooldownUntil: 0,
    lastRoll: null,
    lastCard: null,
    bankLedger: 0,
    bankReceived: 0,
    bankPaidOut: 0,
    championshipHost: null,
    status: "active",
    result: null,
    startedAt: context.now,
    matchDeadline:
      config.timeLimitMinutes !== undefined && config.timeLimitMinutes !== null
        ? context.now + config.timeLimitMinutes * 60_000
        : null,
    festivalTiles: festivals.items,
  };
  const state: GameState = {
    ...publicState,
    rngState: festivals.state,
    deck: deck.items,
    discard: [],
    resolutionQueue: [],
    extraRoll: false,
    turnEnded: false,
  };
  const resolved = resolver(state, resolutionContext(context), [
    { type: "GameCreated", state: toPublic(state) },
  ]);
  resolved.startDecision();
  const result = resolved.result();
  return {
    state: result.state,
    events: [{ type: "GameCreated", state: toPublic(result.state) }],
  };
}
