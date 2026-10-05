import type {
  BoardRule,
  BuildLevel,
  ChanceRule,
  EconomyRule,
  WorldTourRule,
} from "../board/types.js";

export type Seat = 0 | 1 | 2 | 3;
export type SeatInfo = {
  readonly playerId: string;
  readonly name: string;
  readonly control: "human" | "bot";
  /**
   * The table seat (colour and corner). Defaults to the list index, so a room
   * of two or three players can keep the seats they chose in the lobby.
   */
  readonly seat?: Seat;
};
export type GameConfig = {
  readonly gameId: string;
  readonly startingCash: number;
  readonly startSalary: number;
  readonly roundLimit: number;
  readonly decisionSeconds?: number;
  readonly timeLimitMinutes?: number;
  readonly festivalCount?: number;
  /** Missing on older saves: retain the economy's original resort festivals. */
  readonly resortFestivals?: boolean;
  readonly lineMonopoly?: boolean;
  readonly tripleMonopoly?: boolean;
  /** Missing on saved matches made before the option: they keep the win enabled. */
  readonly resortMonopoly?: boolean;
  readonly hotelsDirectly?: boolean;
  /** Missing on existing saves: preserve the original lap-only hotel rule. */
  readonly hotelPurchaseRule?: "staged-hotels" | "legacy-lap";
  /** Missing on existing saves: preserve the prototype economy and Landmark. */
  readonly economyRule?: EconomyRule;
  /** Missing on saved matches: keep the original production tile indices. */
  readonly boardRule?: BoardRule;
  /** Missing on saves before rules version 6: own properties only when none is free. */
  readonly worldTourRule?: WorldTourRule;
  /** Missing on saves before rules version 8: four resorts pay what three do. */
  readonly fourResortRent?: boolean;
  /** Missing on saves before rules version 8: a bought-out city is not built on. */
  readonly buildAfterBuyout?: boolean;
  /** Missing on saves before rules version 9: retain the original Chance deck. */
  readonly escapeCard?: boolean;
  /** Missing on saves before rules version 10: the original card set. */
  readonly chanceRule?: ChanceRule;
  /** An explicit room rule wins; old prototype saves default to 50%. */
  readonly sellBackPercent?: 50 | 100;
  readonly extraRollOnDouble?: boolean;
  /** Missing on existing saves: the third consecutive double sends you to the island. */
  readonly tripleDoubleToIsland?: boolean;
  readonly botCanBuild?: boolean;
  readonly giftCanBankrupt?: boolean;
};
export type BotDifficulty = "easy" | "medium" | "hard";
export const LEGACY_CHANCE_CARDS = [
  "Grand Tour",
  "Stranded",
  "Jet Set",
  "Stadium Call",
  "Windfall",
  "Parking Fine",
  "Birthday",
  "Audit",
  "Guardian Angel",
  "Coupon",
  "Earthquake",
  "Land Swap",
  "Detour",
  "Contractor",
  "Jailbreak",
  "Charity",
] as const;
/** Reworked decks only (rules version 10). */
export const REWORKED_CHANCE_CARDS = [
  "Tailwind",
  "Power Cut",
  "Forced Sale",
  "Shield",
  "Patron",
  "Fan Trip",
  "Gift",
  "Roll Again",
] as const;
export const CHANCE_CARDS = [
  ...LEGACY_CHANCE_CARDS,
  "Escape",
  ...REWORKED_CHANCE_CARDS,
] as const;
export type ChanceCard = (typeof CHANCE_CARDS)[number];
/** Cards that cost the drawer money, a turn or ground; framed as bad cards. */
export const BAD_CHANCE_CARDS: readonly ChanceCard[] = [
  "Stranded",
  "Parking Fine",
  "Audit",
  "Charity",
  "Detour",
  "Fan Trip",
  "Gift",
];
/** Attacks a Shield absorbs: the first one aimed at a shielded property. */
export const SHIELDED_CARDS: readonly ChanceCard[] = [
  "Earthquake",
  "Power Cut",
  "Forced Sale",
  "Land Swap",
];
export type RentCard = "Guardian Angel" | "Coupon";
export type KeepCard = RentCard | "Escape";
export type TargetCard =
  | "Earthquake"
  | "Land Swap"
  | "Contractor"
  | "Power Cut"
  | "Forced Sale"
  | "Shield"
  | "Patron"
  | "Gift";
export type PlayerState = {
  readonly playerId: string;
  readonly name: string;
  readonly control: "human" | "bot";
  readonly seat: Seat;
  readonly cash: number;
  readonly position: number;
  readonly laps: number;
  readonly onIsland: boolean;
  readonly islandTurns: number;
  readonly bankrupt: boolean;
  readonly properties: readonly number[];
  readonly heldCards: readonly KeepCard[];
  readonly travelPending: boolean;
};
export type PropertyState = {
  readonly tile: number;
  readonly owner: Seat | null;
  readonly level: BuildLevel;
  /** Power Cut: no rent until the owner's lap count reaches this value. */
  readonly powerCutUntilLap?: number;
  /** Shield: absorbs the next attack card aimed at this property. */
  readonly shielded?: true;
};
type DecisionBase = { readonly seat: Seat; readonly deadline: number };
export type PendingDecision = DecisionBase &
  (
    | { readonly kind: "roll" }
    | { readonly kind: "island"; readonly fee: number }
    | {
        readonly kind: "travel";
        readonly fee: number;
        readonly targets: readonly number[];
      }
    | {
        readonly kind: "buy";
        readonly tile: number;
        readonly maxLevel: BuildLevel;
      }
    | {
        readonly kind: "build";
        readonly tile: number;
        readonly maxLevel: BuildLevel;
      }
    | { readonly kind: "buyout"; readonly tile: number; readonly price: number }
    | {
        readonly kind: "rent-card";
        readonly tile: number;
        readonly owner: Seat;
        readonly amount: number;
        readonly cards: readonly RentCard[];
      }
    | { readonly kind: "host"; readonly targets: readonly number[] }
    | {
        readonly kind: "card-target";
        readonly card: TargetCard;
        readonly targets: readonly number[];
        readonly sourceTile?: number;
      }
    | {
        readonly kind: "sell";
        readonly targets: readonly number[];
        readonly creditor: Seat | null;
      }
  );
export type PauseState =
  | {
      readonly kind: "vote";
      readonly requestedBy: Seat;
      readonly requiredSeats: readonly Seat[];
      readonly acceptedSeats: readonly Seat[];
      readonly deadline: number;
    }
  | {
      readonly kind: "paused";
      readonly requestedBy: Seat;
      readonly startedAt: number;
    };
export type PublicState = {
  readonly gameId: string;
  readonly config: GameConfig;
  readonly players: readonly PlayerState[];
  readonly properties: readonly PropertyState[];
  readonly turnOrder: readonly Seat[];
  readonly startingTurnOrder: readonly Seat[];
  readonly roundSeatsRemaining: readonly Seat[];
  readonly eliminated: readonly Seat[];
  readonly activeSeat: Seat;
  readonly round: number;
  readonly phase: "roll" | "resolve";
  readonly doublesInTurn: number;
  readonly pending: PendingDecision | null;
  readonly pause: PauseState | null;
  readonly pauseCooldownUntil: number;
  readonly lastRoll: {
    readonly seat: Seat;
    readonly dice: readonly [number, number];
  } | null;
  readonly lastCard: { readonly seat: Seat; readonly card: ChanceCard } | null;
  readonly bankLedger: number;
  /**
   * The bank's own account: salaries and money that cards, taxes and fines move
   * between players and the bank. Property purchases, building, sales and
   * written-off debts stay in `bankLedger` only.
   */
  readonly bankReceived: number;
  readonly bankPaidOut: number;
  readonly championshipHost: {
    readonly tile: number;
    readonly multiplier: number;
  } | null;
  readonly status: "active" | "finished";
  readonly result: GameResult | null;
  readonly startedAt: number;
  readonly matchDeadline: number | null;
  readonly festivalTiles: readonly number[];
};
export type WinKind =
  | "last-standing"
  | "triple-monopoly"
  | "line-monopoly"
  | "resort-monopoly"
  | "round-limit"
  | "time-limit";
export type Standing = { readonly seat: Seat; readonly netWorth: number };
export type GameResult = {
  readonly winner: Seat;
  readonly kind: WinKind;
  readonly standings: readonly Standing[];
};
export type ResolutionTask =
  | { readonly kind: "landing"; readonly seat: Seat }
  | { readonly kind: "finish" }
  | {
      readonly kind: "payment";
      readonly from: Seat;
      readonly to: Seat | null;
      readonly amount: number;
      readonly reason: string;
    }
  | {
      readonly kind: "rent";
      readonly from: Seat;
      readonly to: Seat;
      readonly amount: number;
      readonly tile: number;
    }
  | { readonly kind: "buyout"; readonly seat: Seat; readonly tile: number }
  /** Offers the new owner of a bought-out city the chance to build on it. */
  | { readonly kind: "improve"; readonly seat: Seat; readonly tile: number }
  | { readonly kind: "wins" };
export type GameState = PublicState & {
  readonly rngState: number;
  readonly deck: readonly ChanceCard[];
  readonly discard: readonly ChanceCard[];
  readonly resolutionQueue: readonly ResolutionTask[];
  readonly extraRoll: boolean;
  readonly turnEnded: boolean;
};
export type GameCreatedEvent = {
  readonly type: "GameCreated";
  readonly state: PublicState;
};
export type DiceRolledEvent = {
  readonly type: "DiceRolled";
  readonly seat: Seat;
  readonly dice: readonly [number, number];
  readonly isDouble: boolean;
  readonly purpose: "move" | "escape";
};
export type PlayerMovedEvent = {
  readonly type: "PlayerMoved";
  readonly seat: Seat;
  readonly position: number;
  readonly laps: number;
  readonly from?: number;
  readonly steps?: number;
};
export type SalaryPaidEvent = {
  readonly type: "SalaryPaid";
  readonly seat: Seat;
  readonly amount: number;
  /** Legacy absolute balance retained for wire compatibility; the reducer credits amount. */
  readonly cash: number;
};
export type TurnPhaseChangedEvent = {
  readonly type: "TurnPhaseChanged";
  readonly phase: "roll" | "resolve";
};
export type TurnAdvancedEvent = {
  readonly type: "TurnAdvanced";
  readonly activeSeat: Seat;
  readonly round: number;
  readonly roundSeatsRemaining: readonly Seat[];
};
export type SentToIslandEvent = {
  readonly type: "SentToIsland";
  readonly seat: Seat;
  readonly reason: "tile" | "triple-double" | "card";
};
export type IslandEscapeFailedEvent = {
  readonly type: "IslandEscapeFailed";
  readonly seat: Seat;
  readonly islandTurns: number;
};
export type LeftIslandEvent = {
  readonly type: "LeftIsland";
  readonly seat: Seat;
  readonly method: "doubles" | "released" | "paid" | "card";
};
export type GameOverEvent = { readonly type: "GameOver" } & GameResult;
export type GameEvent =
  | GameCreatedEvent
  | DiceRolledEvent
  | PlayerMovedEvent
  | SalaryPaidEvent
  | TurnPhaseChangedEvent
  | TurnAdvancedEvent
  | SentToIslandEvent
  | IslandEscapeFailedEvent
  | LeftIslandEvent
  | GameOverEvent
  | {
      readonly type: "PauseChanged";
      readonly pause: PauseState | null;
      readonly pauseCooldownUntil: number;
    }
  | {
      readonly type: "GameResumed";
      readonly seat: Seat;
      readonly pending: PendingDecision | null;
      readonly matchDeadline: number | null;
    }
  | { readonly type: "DecisionOpened"; readonly pending: PendingDecision }
  | { readonly type: "DecisionClosed" }
  | {
      readonly type: "TravelOptionChanged";
      readonly seat: Seat;
      readonly available: boolean;
    }
  | {
      readonly type: "PropertyBought";
      readonly seat: Seat;
      readonly tile: number;
      readonly level: BuildLevel;
      readonly amount: number;
    }
  | {
      readonly type: "PropertyUpgraded";
      readonly seat: Seat;
      readonly tile: number;
      readonly level: BuildLevel;
      readonly amount: number;
      readonly free: boolean;
    }
  | {
      readonly type: "PropertySold";
      readonly seat: Seat;
      readonly tile: number;
      readonly amount: number;
    }
  | {
      readonly type: "BoughtOut";
      readonly seat: Seat;
      readonly previousOwner: Seat;
      readonly tile: number;
      readonly amount: number;
    }
  /**
   * A player cannot pay for the city or resort they landed on: the land of a
   * free one, or the buyout of an opponent's. Public notice only; no state change.
   */
  | {
      readonly type: "PurchaseUnaffordable";
      readonly seat: Seat;
      readonly tile: number;
      readonly purchase: "buy" | "buyout";
      readonly price: number;
    }
  | {
      readonly type: "RentPaid";
      readonly seat: Seat;
      readonly owner: Seat;
      readonly tile: number;
      readonly amount: number;
    }
  | {
      readonly type: "MoneyTransferred";
      readonly from: Seat | null;
      readonly to: Seat | null;
      readonly amount: number;
      readonly reason: string;
    }
  | {
      readonly type: "ChampionshipChanged";
      readonly host: PublicState["championshipHost"];
    }
  | {
      readonly type: "CardDrawn";
      readonly seat: Seat;
      readonly card: ChanceCard;
      readonly kept: boolean;
      /** The die a reworked (rules version 10) Detour or Tailwind rolled, 1 to 6. */
      readonly roll?: number;
    }
  | { readonly type: "CardUsed"; readonly seat: Seat; readonly card: KeepCard }
  | {
      readonly type: "PropertyDowngraded";
      readonly tile: number;
      readonly level: BuildLevel;
    }
  | {
      readonly type: "ShieldRaised";
      readonly seat: Seat;
      readonly tile: number;
    }
  /** An attack card hit a shield: the shield breaks and the attack is lost. */
  | {
      readonly type: "ShieldBroken";
      readonly seat: Seat;
      readonly tile: number;
    }
  | {
      readonly type: "PropertyGiven";
      readonly seat: Seat;
      readonly to: Seat;
      readonly tile: number;
    }
  | {
      readonly type: "PowerCut";
      readonly seat: Seat;
      readonly tile: number;
      readonly untilLap: number;
    }
  | {
      readonly type: "PropertiesSwapped";
      readonly seat: Seat;
      readonly otherSeat: Seat;
      readonly tile: number;
      readonly otherTile: number;
    }
  | {
      readonly type: "PlayerBankrupt";
      readonly seat: Seat;
      readonly creditor: Seat | null;
      readonly writtenOff: number;
      readonly turnOrder: readonly Seat[];
      readonly roundSeatsRemaining: readonly Seat[];
    }
  | {
      readonly type: "PlayerControlChanged";
      readonly seat: Seat;
      readonly control: "human" | "bot";
      /** The new controller's name, when a person takes over a bot's place. */
      readonly name?: string;
    };
export type RollAction = { readonly type: "Roll" };
export type Action =
  | RollAction
  | { readonly type: "RequestPause" }
  | { readonly type: "VotePause"; readonly accept: boolean }
  | { readonly type: "ResumeGame" }
  | { readonly type: "PayIsland" }
  | { readonly type: "UseEscapeCard" }
  | { readonly type: "Travel"; readonly tile: number }
  | { readonly type: "Decline" }
  | { readonly type: "Buy"; readonly level: BuildLevel }
  | { readonly type: "Build"; readonly level: BuildLevel }
  | { readonly type: "Buyout" }
  | { readonly type: "Sell"; readonly tile: number }
  | { readonly type: "ChooseHost"; readonly tile: number }
  | { readonly type: "ChooseTarget"; readonly tile: number }
  | { readonly type: "UseRentCard"; readonly card: RentCard };
export type RuleError = {
  readonly code:
    | "not-active-seat"
    | "invalid-phase"
    | "game-over"
    | "game-paused"
    | "pause-cooldown"
    | "illegal-action"
    | "invalid-dice";
  readonly message: string;
};
export type ApplyActionResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly events: readonly GameEvent[];
    }
  | { readonly ok: false; readonly error: RuleError };
export type EngineContext = {
  readonly now: number;
  /** Permanent human seats, including those under temporary disconnect takeover. */
  readonly pauseSeats?: readonly Seat[];
  readonly dice?: readonly [number, number];
  /** Fresh server uint32 words for live Chance draws; omit for seeded simulation. */
  readonly chanceEntropy?: readonly number[];
};
export type CreateGameResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};
