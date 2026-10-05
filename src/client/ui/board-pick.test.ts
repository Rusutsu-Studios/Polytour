import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  DEFAULT_GAME_CONFIG,
} from "../../shared/engine/index.js";
import { boardPickActions, isBoardPick } from "./board-pick.js";

describe("Championship board choices", () => {
  it("exposes the owned city on the first turn before completing a lap", () => {
    let state = createGame(
      { ...DEFAULT_GAME_CONFIG, festivalCount: 0 },
      [
        { playerId: "ada", name: "Ada", control: "human" },
        { playerId: "bea", name: "Bea", control: "human" },
      ],
      7,
      { now: 0 },
    ).state;
    const seat = state.activeSeat;
    const actions = [
      { action: { type: "Roll" as const }, dice: [3, 3] as const },
      { action: { type: "Buy" as const, level: 2 as const } },
      { action: { type: "Roll" as const }, dice: [4, 6] as const },
    ];
    for (const { action, dice } of actions) {
      const result = applyAction(state, seat, action, { now: 1, dice });
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
    expect(state.players.find((player) => player.seat === seat)?.laps).toBe(0);
    expect(isBoardPick(state)).toBe(true);
    expect(boardPickActions(state, seat)).toEqual([
      { type: "ChooseHost", tile: 6 },
    ]);
    expect(
      boardPickActions(
        state,
        state.turnOrder.find((other) => other !== seat) ?? seat,
      ),
    ).toEqual([]);
  });
});
