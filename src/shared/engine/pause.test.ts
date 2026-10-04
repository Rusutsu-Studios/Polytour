import { describe, expect, it } from "vitest";
import { PAUSE_TIMING } from "../board/index.js";
import type {
  Action,
  EngineContext,
  GameState,
  Seat,
  SeatInfo,
} from "./index.js";
import {
  applyAction,
  applyEvent,
  applyTimeout,
  botDecisionAt,
  createGame,
  DEFAULT_GAME_CONFIG,
  expirePauseVote,
  legalActions,
  toPublic,
} from "./index.js";

function game(humans = 4): GameState {
  const seats: SeatInfo[] = [0, 1, 2, 3].map((seat) => ({
    playerId: `player-${seat}`,
    name: `Player ${seat}`,
    control: seat < humans ? "human" : "bot",
  }));
  return createGame(
    { ...DEFAULT_GAME_CONFIG, decisionSeconds: 60, festivalCount: 0 },
    seats,
    7,
    { now: 0 },
  ).state;
}
function act(
  state: GameState,
  seat: Seat,
  action: Action,
  now: number,
  context: Partial<EngineContext> = {},
) {
  const result = applyAction(state, seat, action, { ...context, now });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.events.reduce(applyEvent, toPublic(state))).toEqual(
    toPublic(result.state),
  );
  return result;
}
function rejects(
  state: GameState,
  seat: Seat,
  action: Action,
  now: number,
  code = "illegal-action",
) {
  expect(applyAction(state, seat, action, { now })).toMatchObject({
    ok: false,
    error: { code },
  });
}

describe("authoritative pause", () => {
  it("freezes solo decisions, bots and match expiry, then restores remaining time on resume", () => {
    const initial = game(1);
    const before = JSON.stringify(initial);
    Object.freeze(initial);
    const paused = act(initial, 0, { type: "RequestPause" }, 1_000).state;
    expect(JSON.stringify(initial)).toBe(before);
    expect(paused.pause).toEqual({
      kind: "paused",
      requestedBy: 0,
      startedAt: 1_000,
    });
    expect(paused.pauseCooldownUntil).toBe(0);
    expect(paused.pending).toEqual(initial.pending);
    expect(paused.rngState).toBe(initial.rngState);
    expect(paused.resolutionQueue).toBe(initial.resolutionQueue);
    for (const player of paused.players)
      expect(legalActions(paused, player.seat)).toEqual([]);
    expect(botDecisionAt(paused)).toBeNull();
    rejects(
      paused,
      paused.activeSeat,
      { type: "Roll" },
      8_000_000,
      "game-paused",
    );
    expect(applyTimeout(paused, { now: 8_000_000 })).toEqual({
      state: paused,
      events: [],
    });
    const resumed = act(paused, 0, { type: "ResumeGame" }, 8_000_000).state;
    const duration = 8_000_000 - 1_000;
    expect(resumed.pause).toBeNull();
    expect(resumed.pending?.deadline).toBe(
      (initial.pending?.deadline ?? 0) + duration,
    );
    expect(resumed.matchDeadline).toBe((initial.matchDeadline ?? 0) + duration);
    expect(botDecisionAt(resumed)).toBe(
      (botDecisionAt(initial) ?? 0) + duration,
    );
    expect(applyTimeout(resumed, { now: 8_000_000 }).events).toEqual([]);
    expect(
      act(resumed, 0, { type: "RequestPause" }, 8_000_001).state.pause?.kind,
    ).toBe("paused");
  });

  it("allows off-turn requests and votes, and needs every human's approval", () => {
    const initial = game();
    const requester = initial.players.find(
      (player) => player.seat !== initial.activeSeat,
    )?.seat;
    if (requester === undefined) throw new Error("Expected another player");
    let state = act(initial, requester, { type: "RequestPause" }, 1_000).state;
    expect(state.pause).toEqual({
      kind: "vote",
      requestedBy: requester,
      requiredSeats: [0, 1, 2, 3],
      acceptedSeats: [requester],
      deadline: 1_000 + PAUSE_TIMING.vote,
    });
    expect(state.pauseCooldownUntil).toBe(1_000 + PAUSE_TIMING.cooldown);
    expect(legalActions(state, state.activeSeat)).toEqual(
      legalActions(initial, initial.activeSeat),
    );
    rejects(state, requester, { type: "ResumeGame" }, 1_100);
    const voters = initial.players.filter(
      (player) => player.seat !== requester,
    );
    for (const [index, player] of voters.entries()) {
      state = act(
        state,
        player.seat,
        { type: "VotePause", accept: true },
        2_000 + index,
      ).state;
      expect(state.pause?.kind).toBe(
        index === voters.length - 1 ? "paused" : "vote",
      );
    }
    expect(state.pause).toEqual({
      kind: "paused",
      requestedBy: requester,
      startedAt: 2_002,
    });
    expect(
      act(state, voters[0].seat, { type: "ResumeGame" }, 3_000).state.pause,
    ).toBeNull();
  });

  it("cancels at the first decline and shares the cooldown across requesters", () => {
    const requested = act(game(2), 0, { type: "RequestPause" }, 1_000).state;
    const declined = act(
      requested,
      1,
      { type: "VotePause", accept: false },
      2_000,
    ).state;
    expect(declined.pause).toBeNull();
    expect(declined.pauseCooldownUntil).toBe(requested.pauseCooldownUntil);
    const nextDecision = {
      ...declined,
      pending: declined.pending
        ? { ...declined.pending, deadline: 400_000 }
        : null,
    };
    rejects(
      nextDecision,
      1,
      { type: "RequestPause" },
      requested.pauseCooldownUntil - 1,
      "pause-cooldown",
    );
    const again = act(
      nextDecision,
      1,
      { type: "RequestPause" },
      requested.pauseCooldownUntil,
    ).state;
    expect(again.pause?.requestedBy).toBe(1);
  });

  it("expires a vote independently of dice, and replays expiry plus a due decision exactly", () => {
    const requested = act(game(2), 0, { type: "RequestPause" }, 1_000).state;
    const deadline = 1_000 + PAUSE_TIMING.vote;
    expect(expirePauseVote(requested, deadline - 1)).toEqual({
      state: requested,
      events: [],
    });
    const expired = expirePauseVote(requested, deadline);
    expect(expired.state.pause).toBeNull();
    expect(expired.state.pending).toEqual(requested.pending);
    expect(expired.state.rngState).toBe(requested.rngState);
    expect(expired.events.reduce(applyEvent, toPublic(requested))).toEqual(
      toPublic(expired.state),
    );
    expect(applyTimeout(requested, { now: deadline })).toEqual(expired);
    const due = applyTimeout(requested, {
      now: requested.pending?.deadline ?? 0,
      dice: [1, 2],
    });
    expect(due.events[0]).toMatchObject({ type: "PauseChanged", pause: null });
    expect(due.events.some((event) => event.type === "DiceRolled")).toBe(true);
    expect(due.events.reduce(applyEvent, toPublic(requested))).toEqual(
      toPublic(due.state),
    );
    rejects(requested, 1, { type: "VotePause", accept: true }, deadline);
  });

  it("excludes bots and bankrupt players, retains temporary human takeover, and rejects duplicate votes", () => {
    let initial = game(3);
    initial = {
      ...initial,
      players: initial.players.map((player) =>
        player.seat === 2 ? { ...player, bankrupt: true } : player,
      ),
    };
    const requested = act(initial, 0, { type: "RequestPause" }, 1_000).state;
    expect(requested.pause).toMatchObject({ requiredSeats: [0, 1] });
    rejects(requested, 2, { type: "VotePause", accept: true }, 2_000);
    rejects(requested, 3, { type: "VotePause", accept: true }, 2_000);
    rejects(initial, 3, { type: "RequestPause" }, 1_000);
    rejects(initial, 2, { type: "RequestPause" }, 1_000);
    const takeover = {
      ...initial,
      players: initial.players.map((player) =>
        player.seat === 1 ? { ...player, control: "bot" as const } : player,
      ),
    };
    const vote = act(takeover, 0, { type: "RequestPause" }, 1_000, {
      pauseSeats: [0, 1],
    }).state;
    expect(vote.pause).toMatchObject({ requiredSeats: [0, 1] });
    expect(
      act(vote, 1, { type: "VotePause", accept: true }, 2_000, {
        pauseSeats: [0, 1],
      }).state.pause?.kind,
    ).toBe("paused");
    let multiple = act(game(), 0, { type: "RequestPause" }, 1_000).state;
    rejects(multiple, 0, { type: "VotePause", accept: true }, 1_100);
    rejects(multiple, 1, { type: "RequestPause" }, 1_100);
    multiple = act(
      multiple,
      1,
      { type: "VotePause", accept: true },
      2_000,
    ).state;
    rejects(multiple, 1, { type: "VotePause", accept: true }, 2_001);
    for (const action of legalActions(game(), game().activeSeat))
      expect(["RequestPause", "VotePause", "ResumeGame"]).not.toContain(
        action.type,
      );
  });

  it("cancels a vote when a required player goes bankrupt during normal play", () => {
    const initial = {
      ...game(),
      activeSeat: 1 as const,
      pending: {
        kind: "rent-card" as const,
        seat: 1 as const,
        deadline: 60_000,
        tile: 1,
        owner: 0 as const,
        amount: 1,
        cards: ["Coupon" as const],
      },
      resolutionQueue: [{ kind: "finish" as const }],
    };
    const requested = act(initial, 0, { type: "RequestPause" }, 1_000).state;
    const indebted = {
      ...requested,
      players: requested.players.map((player) =>
        player.seat === 1 ? { ...player, cash: 0 } : player,
      ),
    };
    const bankrupt = act(indebted, 1, { type: "Decline" }, 2_000).state;
    expect(bankrupt.players.find((player) => player.seat === 1)?.bankrupt).toBe(
      true,
    );
    expect(bankrupt.pause).toBeNull();
    expect(bankrupt.pauseCooldownUntil).toBe(requested.pauseCooldownUntil);
  });

  it("cannot rescue expired decisions or finished matches by racing a pause", () => {
    const initial = game(1);
    rejects(
      initial,
      0,
      { type: "RequestPause" },
      initial.pending?.deadline ?? 0,
    );
    const requested = act(game(2), 0, { type: "RequestPause" }, 1_000).state;
    const expiredDecision = {
      ...requested,
      pending: requested.pending
        ? { ...requested.pending, deadline: 2_000 }
        : null,
    };
    rejects(expiredDecision, 1, { type: "VotePause", accept: true }, 2_000);
    const finished = act(
      initial,
      0,
      { type: "RequestPause" },
      initial.matchDeadline ?? 0,
    ).state;
    expect(finished.status).toBe("finished");
    expect(finished.pause).toBeNull();
    rejects(finished, 0, { type: "RequestPause" }, 8_000_000, "game-over");
    rejects(initial, 0, { type: "RequestPause" }, Number.NaN);
    const paused = act(initial, 0, { type: "RequestPause" }, 1_000).state;
    rejects(paused, 0, { type: "ResumeGame" }, 999);
  });
});
