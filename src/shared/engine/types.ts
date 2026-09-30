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
  readonly position: 0;
  readonly laps: 0;
  readonly islandTurns: 0;
  readonly bankrupt: false;
  readonly properties: readonly number[];
  readonly heldCards: readonly string[];
};

export type PublicState = {
  readonly gameId: string;
  readonly config: GameConfig;
  readonly players: readonly PlayerState[];
  readonly turnOrder: readonly Seat[];
  readonly activeSeat: Seat;
  readonly round: 1;
  readonly phase: "roll";
  readonly pending: null;
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

export type GameEvent = GameCreatedEvent;

export type EngineContext = {
  readonly now: number;
};

export type CreateGameResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
};
