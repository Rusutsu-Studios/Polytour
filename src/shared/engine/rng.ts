export type RandomResult = {
  readonly state: number;
  readonly value: number;
};

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
