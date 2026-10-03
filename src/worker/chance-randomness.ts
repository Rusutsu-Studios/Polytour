import type { EngineContext } from "../shared/engine/types.js";

/** Every engine invocation gets fresh Chance entropy, including alarms and bots. */
export function createEngineContext(
  now: number,
  dice?: readonly [number, number],
): EngineContext {
  return {
    now,
    dice,
    chanceEntropy: Array.from(crypto.getRandomValues(new Uint32Array(8))),
  };
}
