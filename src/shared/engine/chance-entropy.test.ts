import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEvent,
  applyTimeout,
  CHANCE_CARDS,
  createGame,
  DEFAULT_GAME_CONFIG,
  toPublic,
} from "./index.js";
import { createEntropySampler } from "./rng.js";
import type { ChanceCard, EngineContext, GameState } from "./types.js";

function newGame(): GameState {
  return createGame(
    { ...DEFAULT_GAME_CONFIG, timeLimitMinutes: undefined, roundLimit: 100 },
    [
      { playerId: "ada", name: "Ada", control: "human" },
      { playerId: "bea", name: "Bea", control: "human" },
    ],
    7,
    { now: 0 },
  ).state;
}
function readyToDraw(state: GameState): GameState {
  return {
    ...state,
    phase: "roll",
    pending: { kind: "roll", seat: state.activeSeat, deadline: 1 },
    players: state.players.map((player) =>
      player.seat === state.activeSeat
        ? { ...player, position: 9, onIsland: false, travelPending: false }
        : player,
    ),
    resolutionQueue: [],
    doublesInTurn: 0,
    extraRoll: false,
    turnEnded: false,
  };
}
function draw(state: GameState, chanceEntropy?: readonly number[]) {
  const initial = readyToDraw(state);
  const result = applyAction(
    initial,
    initial.activeSeat,
    { type: "Roll" },
    {
      now: 1,
      dice: [1, 2],
      chanceEntropy,
    },
  );
  if (!result.ok) throw new Error(result.error.message);
  expect(result.events.reduce(applyEvent, toPublic(initial))).toEqual(
    toPublic(result.state),
  );
  const event = result.events.find((event) => event.type === "CardDrawn");
  if (event?.type !== "CardDrawn") throw new Error("Expected a Chance draw");
  return { ...result, card: event.card };
}

describe("unbiased Chance entropy", () => {
  it("rejects uneven uint32 tail values and consumes each accepted word once", () => {
    const sample = createEntropySampler([0xffff_ffff, 1, 2]);
    expect(sample(3)).toBe(1);
    expect(sample(3)).toBe(2);
    expect(() => sample(3)).toThrow("Chance entropy exhausted");
    const edge = createEntropySampler([0xffff_ffff]);
    expect(edge(0x1_0000_0000)).toBe(0xffff_ffff);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 0x1_0000_0000])(
    "rejects invalid entropy word %s without a seeded fallback",
    (word) => {
      expect(() => draw(newGame(), [word])).toThrow(
        "Chance entropy must contain unsigned 32-bit integers",
      );
    },
  );

  it.each([{ entropy: [] }, { entropy: [0xffff_ffff] }])(
    "fails closed on exhausted entropy %j without changing the input",
    ({ entropy }) => {
      const initial = {
        ...newGame(),
        deck: ["Windfall", "Jailbreak", "Contractor"] as const,
      };
      const before = JSON.stringify(initial);
      expect(() => draw(initial, entropy)).toThrow("Chance entropy exhausted");
      expect(JSON.stringify(initial)).toBe(before);
    },
  );

  it.each([0, -1, 1.5, 0x1_0000_0001])("rejects sample range %s", (range) => {
    expect(() => createEntropySampler([0])(range)).toThrow("sample range");
  });
});

describe("live Chance draws", () => {
  it("changes the card despite identical seed, public setup and saved deck", () => {
    const initial = newGame();
    const before = JSON.stringify(initial);
    const first = draw(initial, [0]);
    const second = draw(initial, [1]);
    expect(first.card).toBe(initial.deck[0]);
    expect(second.card).toBe(initial.deck[1]);
    expect(first.card).not.toBe(second.card);
    expect(JSON.stringify(initial)).toBe(before);
    expect(first.state.rngState).toBe(initial.rngState);
    expect(second.state.rngState).toBe(initial.rngState);
    expect(first.state.deck).toEqual(initial.deck.slice(1));
    expect(second.state.deck).toEqual([
      initial.deck[0],
      ...initial.deck.slice(2),
    ]);
  });

  it("is deterministic from the same explicit inputs and preserves seeded simulation", () => {
    const initial = newGame();
    const entropy = Object.freeze([14]);
    expect(draw(initial, entropy)).toEqual(draw(initial, entropy));
    expect(draw(initial)).toEqual(draw(initial));
    expect(draw(initial).card).toBe(initial.deck[0]);
    expect(toPublic(initial)).not.toHaveProperty("chanceEntropy");
  });

  it("rejects a biased tail before picking the next available card", () => {
    const initial = {
      ...newGame(),
      deck: ["Windfall", "Jailbreak", "Contractor"] as const,
    };
    expect(draw(initial, [0xffff_ffff, 1]).card).toBe("Jailbreak");
  });

  it("draws without repeats, refills from discard and keeps held cards unavailable", () => {
    let state = newGame();
    const drawn: ChanceCard[] = [];
    for (let count = 0; count < CHANCE_CARDS.length; count += 1) {
      const result = draw(state, [0]);
      drawn.push(result.card);
      state = result.state;
    }
    expect(new Set(drawn).size).toBe(CHANCE_CARDS.length);
    expect(state.deck).toEqual([]);
    expect(state.discard).toHaveLength(CHANCE_CARDS.length - 3);
    expect(state.players.flatMap((player) => player.heldCards).sort()).toEqual([
      "Coupon",
      "Escape",
      "Guardian Angel",
    ]);
    const before = JSON.stringify(state);
    const previousDiscard = [...state.discard];
    const previousRng = state.rngState;
    const result = draw(state, [1]);
    expect(result.card).toBe(previousDiscard[1]);
    expect(result.state.deck).toHaveLength(CHANCE_CARDS.length - 4);
    expect(result.state.discard).toEqual([result.card]);
    expect(result.state.deck).not.toContain("Guardian Angel");
    expect(result.state.deck).not.toContain("Coupon");
    expect(result.state.deck).not.toContain("Escape");
    expect(result.state.rngState).toBe(previousRng);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("consumes distinct entropy words for multiple draws in one resolution", () => {
    const base = newGame();
    const initial: GameState = {
      ...base,
      pending: {
        kind: "buy",
        seat: base.activeSeat,
        deadline: 100,
        tile: 1,
        maxLevel: 1,
      },
      players: base.players.map((player) =>
        player.seat === base.activeSeat ? { ...player, position: 12 } : player,
      ),
      deck: ["Jailbreak", "Contractor", "Windfall"] as const,
      resolutionQueue: [
        { kind: "landing", seat: base.activeSeat },
        { kind: "landing", seat: base.activeSeat },
      ],
    };
    const result = applyAction(
      initial,
      initial.activeSeat,
      { type: "Decline" },
      {
        now: 1,
        dice: [1, 2],
        chanceEntropy: [2, 0],
      },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(
      result.events
        .filter((event) => event.type === "CardDrawn")
        .map((event) => event.card),
    ).toEqual(["Windfall", "Jailbreak"]);
  });

  it("retains Chance entropy for an automatic roll at its decision deadline", () => {
    const initial = {
      ...readyToDraw(newGame()),
      deck: ["Windfall", "Jailbreak"] as const,
    };
    const result = applyTimeout(initial, {
      now: 1,
      dice: [1, 2],
      chanceEntropy: [1],
    });
    expect(result.events).toContainEqual({
      type: "CardDrawn",
      seat: initial.activeSeat,
      card: "Jailbreak",
      kept: false,
    });
  });

  it.each(["action", "timeout"])(
    "retains Chance entropy while %s settles a landing at the match deadline",
    (method) => {
      const base = newGame();
      const initial: GameState = {
        ...base,
        matchDeadline: 100,
        pending: {
          kind: "build",
          seat: base.activeSeat,
          deadline: 100,
          tile: 1,
          maxLevel: 1,
        },
        players: base.players.map((player) =>
          player.seat === base.activeSeat
            ? { ...player, position: 12 }
            : player,
        ),
        properties: base.properties.map((property) =>
          property.tile === 1
            ? { ...property, owner: base.activeSeat }
            : property,
        ),
        deck: ["Contractor", "Jailbreak", "Windfall"],
        resolutionQueue: [
          { kind: "landing", seat: base.activeSeat },
          { kind: "landing", seat: base.activeSeat },
        ],
      };
      const context: EngineContext = { now: 100, chanceEntropy: [0, 1] };
      const result = (() => {
        if (method === "timeout") return applyTimeout(initial, context);
        const applied = applyAction(
          initial,
          initial.activeSeat,
          { type: "Decline" },
          context,
        );
        if (!applied.ok) throw new Error(applied.error.message);
        return applied;
      })();
      expect(
        result.events
          .filter((event) => event.type === "CardDrawn")
          .map((event) => event.card),
      ).toEqual(["Contractor", "Windfall"]);
      expect(result.state.status).toBe("finished");
    },
  );
});
