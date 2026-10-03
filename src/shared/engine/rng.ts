export type RandomResult = {
  readonly state: number;
  readonly value: number;
};

/** Action-local, unbiased indices from server-supplied unsigned 32-bit words. */
export function createEntropySampler(
  entropy: readonly number[],
): (range: number) => number {
  const uint32Range = 0x1_0000_0000;
  if (
    entropy.some(
      (word) => !Number.isInteger(word) || word < 0 || word >= uint32Range,
    )
  )
    throw new RangeError(
      "Chance entropy must contain unsigned 32-bit integers",
    );
  let cursor = 0;
  return (range) => {
    if (!Number.isInteger(range) || range < 1 || range > uint32Range)
      throw new RangeError("The entropy sample range must be from 1 to 2^32");
    const limit = Math.floor(uint32Range / range) * range;
    while (cursor < entropy.length) {
      const word = entropy[cursor++];
      // Reject the uneven tail instead of introducing modulo bias.
      if (word < limit) return word % range;
    }
    // Live play must never fall back to the predictable simulation PRNG.
    throw new RangeError("Chance entropy exhausted");
  };
}

export function normalizeSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("The game seed must be a safe integer");
  }

  return seed >>> 0;
}

export function nextRandom(state: number): RandomResult {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let value = nextState;

  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

  return {
    state: nextState,
    value: ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000,
  };
}

export function shuffle<T>(
  items: readonly T[],
  seed: number,
): { readonly items: readonly T[]; readonly state: number } {
  const shuffled = [...items];
  let state = normalizeSeed(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const result = nextRandom(state);
    state = result.state;
    const swapIndex = Math.floor(result.value * (index + 1));

    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return { items: shuffled, state };
}
