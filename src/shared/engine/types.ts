export type Seat = 0 | 1 | 2 | 3;

export type SeatInfo = {
  readonly playerId: string;
  readonly name: string;
  readonly control: "human" | "bot";
};

export type GameConfig = {
  readonly gameId: string;
  readonly startingCash: number;
  readonly startSalary: number;
  readonly roundLimit: number;
};

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
  readonly heldCards: readonly string[];
};

export type PublicState = {
  readonly gameId: string;
  readonly config: GameConfig;
  readonly players: readonly PlayerState[];
  readonly turnOrder: readonly Seat[];
  readonly activeSeat: Seat;
  readonly round: number;
  readonly phase: "roll" | "resolve";
  /** Consecutive doubles rolled for movement this turn; resets when the turn ends. */
  readonly doublesInTurn: number;
  readonly pending: null;
  readonly lastRoll: {
    readonly seat: Seat;
    readonly dice: readonly [number, number];
  } | null;
  readonly bankLedger: 0;
  readonly championshipHost: null;
  readonly status: "active" | "finished";
  readonly result: GameResult | null;
  readonly startedAt: number;
};

export type WinKind =
  | "last-standing"
  | "triple-monopoly"
  | "line-monopoly"
  | "resort-monopoly"
  | "round-limit";

export type Standing = {
  readonly seat: Seat;
  readonly netWorth: number;
};

export type GameResult = {
  readonly winner: Seat;
  readonly kind: WinKind;
  /** Every player in placement order; the winner is first. */
  readonly standings: readonly Standing[];
};

export type GameState = PublicState & {
  readonly rngState: number;
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
};

export type SalaryPaidEvent = {
  readonly type: "SalaryPaid";
  readonly seat: Seat;
  readonly amount: number;
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
};

export type SentToIslandEvent = {
  readonly type: "SentToIsland";
  readonly seat: Seat;
  readonly reason: "tile" | "triple-double";
};

export type IslandEscapeFailedEvent = {
  readonly type: "IslandEscapeFailed";
  readonly seat: Seat;
  readonly islandTurns: number;
};

export type LeftIslandEvent = {
  readonly type: "LeftIsland";
  readonly seat: Seat;
  readonly method: "doubles" | "released";
};

export type GameOverEvent = {
  readonly type: "GameOver";
} & GameResult;

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
  | GameOverEvent;

export type RollAction = {
  readonly type: "Roll";
};

export type Action = RollAction;

export type RuleError = {
  readonly code: "not-active-seat" | "invalid-phase" | "game-over";
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
};

export type CreateGameResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};
