import type { BuildLevel } from "../../shared/board/types.js";
import {
  actionCost,
  getProperty,
  type PublicState,
  type Seat,
} from "../../shared/engine/index.js";

export type PurchaseShortfall = {
  /** The cheapest level the open decision allows, and what it costs. */
  readonly level: BuildLevel;
  readonly price: number;
  readonly cash: number;
  /** What the player still needs to afford that cheapest option. */
  readonly missing: number;
};

/**
 * Landing on a property with too little cash for any level of it. The decision
 * still opens, so the card says what the land costs instead of offering a
 * choice the player cannot take.
 */
export function purchaseShortfall(
  state: PublicState,
  seat: Seat,
): PurchaseShortfall | null {
  const pending = state.pending;
  if (!pending || (pending.kind !== "buy" && pending.kind !== "build"))
    return null;
  if (pending.seat !== seat) return null;
  const player = state.players.find((candidate) => candidate.seat === seat);
  if (!player || player.bankrupt) return null;
  // Buying starts at bare land; building starts one level above the current one.
  const level =
    pending.kind === "buy"
      ? 0
      : (getProperty(state, pending.tile)?.level ?? 0) + 1;
  if (level > 5) return null;
  const price = actionCost(
    state,
    pending.kind === "buy"
      ? { type: "Buy", level: level as BuildLevel }
      : { type: "Build", level: level as BuildLevel },
  );
  return price > player.cash
    ? {
        level: level as BuildLevel,
        price,
        cash: player.cash,
        missing: price - player.cash,
      }
    : null;
}
