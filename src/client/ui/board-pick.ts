import {
  type Action,
  legalActions,
  type PublicState,
  type Seat,
} from "../../shared/engine/index.js";

export type BoardPickAction = Extract<
  Action,
  { type: "Travel" | "ChooseHost" | "ChooseTarget" }
>;
const BOARD_PICK_KINDS = new Set(["travel", "host", "card-target"]);

/** Decisions whose answer is a space: the player clicks it on the board. */
export function isBoardPick(state: PublicState | null): boolean {
  return state?.pending ? BOARD_PICK_KINDS.has(state.pending.kind) : false;
}

/** The legal space choices only; the engine stays the single rules source. */
export function boardPickActions(
  state: PublicState,
  seat: Seat,
): BoardPickAction[] {
  if (!isBoardPick(state)) return [];
  return legalActions(state, seat).filter(
    (action): action is BoardPickAction =>
      action.type === "Travel" ||
      action.type === "ChooseHost" ||
      action.type === "ChooseTarget",
  );
}

/** Changes whenever the server opens a new decision, so a stale pick resets. */
export function boardPickKey(state: PublicState | null): string {
  const pending = state?.pending;
  return pending
    ? `${state?.gameId}:${pending.kind}:${pending.seat}:${pending.deadline}`
    : "";
}
