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
  readonly pending: null;
  readonly lastRoll: {
    readonly seat: Seat;
    readonly dice: readonly [number, number];
  } | null;
  readonly bankLedger: 0;
  readonly championshipHost: null;
  readonly status: "active";
  readonly startedAt: number;
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

export type GameEvent =
  | GameCreatedEvent
  | DiceRolledEvent
  | PlayerMovedEvent
  | SalaryPaidEvent
  | TurnPhaseChangedEvent
  | TurnAdvancedEvent;

export type RollAction = {
  readonly type: "Roll";
};

export type Action = RollAction;

export type RuleError = {
  readonly code: "not-active-seat" | "invalid-phase";
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
