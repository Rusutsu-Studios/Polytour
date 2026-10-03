import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngineContext } from "./chance-randomness.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("server Chance context", () => {
  it("draws fresh Web Crypto uint32 words for every engine invocation", () => {
    const buffers: Uint32Array[] = [];
    const getRandomValues = vi.fn((buffer: Uint32Array) => {
      buffers.push(buffer);
      buffer.fill(buffers.length);
      return buffer;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const dice = [2, 5] as const;
    const first = createEngineContext(10, dice);
    const second = createEngineContext(20);
    expect(first).toEqual({ now: 10, dice, chanceEntropy: Array(8).fill(1) });
    expect(second).toEqual({
      now: 20,
      dice: undefined,
      chanceEntropy: Array(8).fill(2),
    });
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    expect(buffers[0]).not.toBe(buffers[1]);
    buffers[0]?.fill(99);
    expect(first.chanceEntropy).toEqual(Array(8).fill(1));
  });

  it("fails closed if Web Crypto cannot provide entropy", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: () => {
        throw new Error("entropy unavailable");
      },
    });
    expect(() => createEngineContext(0)).toThrow("entropy unavailable");
  });
});
