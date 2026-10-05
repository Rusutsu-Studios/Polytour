import type { EconomyRule } from "../../src/shared/board/index.js";
import {
  type BotDifficulty,
  botAction,
} from "../../src/shared/engine/index.js";
import { SIM_CONFIG, simSeats, simulateGame } from "./simulation.js";

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
}
const games = option("--games", 100);
if (!Number.isInteger(games) || games < 1 || games > 10_000)
  throw new RangeError("--games must be an integer from 1 to 10000");
const seedStart = option("--seed-start", 0);
if (
  !Number.isSafeInteger(seedStart) ||
  seedStart < 0 ||
  !Number.isSafeInteger(seedStart + games - 1)
)
  throw new RangeError("--seed-start must be a non-negative safe integer");
const players = option("--players", 4);
const roundLimit = option("--rounds", 20);
if (!Number.isInteger(roundLimit) || roundLimit < 1 || roundLimit > 200)
  throw new RangeError("--rounds must be an integer from 1 to 200");
if (!Number.isInteger(players) || players < 2 || players > 4)
  throw new RangeError("--players must be an integer from 2 to 4");
const rulesIndex = process.argv.indexOf("--rules");
const rules = (
  rulesIndex < 0 ? "reference" : process.argv[rulesIndex + 1]
) as EconomyRule;
if (rules !== "reference" && rules !== "prototype")
  throw new RangeError("--rules must be reference or prototype");
const config = {
  ...SIM_CONFIG,
  economyRule: rules,
  boardRule: rules === "reference" ? ("country" as const) : ("legacy" as const),
  sellBackPercent: rules === "reference" ? (100 as const) : (50 as const),
  roundLimit,
};
const levelsIndex = process.argv.indexOf("--levels");
const difficultyIndex = process.argv.indexOf("--difficulty");
const levels =
  levelsIndex < 0
    ? Array.from({ length: players }, () =>
        difficultyIndex < 0 ? "medium" : process.argv[difficultyIndex + 1],
      )
    : (process.argv[levelsIndex + 1] ?? "").split(",");
if (
  levels.length !== players ||
  levels.some((level) => !["easy", "medium", "hard"].includes(level))
)
  throw new RangeError(
    "Use --difficulty easy|medium|hard or --levels with one comma-separated level per seat",
  );
// Rotate policies across table seats; each seed is used once in this run.
const results = Array.from({ length: games }, (_, index) =>
  simulateGame(
    seedStart + index,
    config,
    (state) => {
      const seat = state.pending?.seat;
      if (seat === undefined) throw new Error("Missing decision");
      return botAction(
        state,
        seat,
        levels[(seat + seedStart + index) % players] as BotDifficulty,
      );
    },
    simSeats(players),
  ),
);
const rounds = results.map((result) => result.rounds).sort((a, b) => a - b);
const count: Record<string, number> = {};
const seatWins = [0, 0, 0, 0];
const turnPositionWins = [0, 0, 0, 0];
const difficultyWins: Record<BotDifficulty, number> = {
  easy: 0,
  medium: 0,
  hard: 0,
};
const difficultySeats: Record<string, number> = {};
for (const level of levels)
  difficultySeats[level] = (difficultySeats[level] ?? 0) + 1;
for (const result of results) {
  count[result.kind] = (count[result.kind] ?? 0) + 1;
  seatWins[result.winner]++;
  turnPositionWins[result.turnPosition]++;
  const level = levels[
    (result.winner + result.seed) % players
  ] as BotDifficulty;
  difficultyWins[level]++;
}
const report = {
  games,
  seedStart,
  economyRule: rules,
  boardRule: config.boardRule,
  levels,
  difficultyWins,
  difficultySeats,
  config: `${players} bots (levels rotate across seats), ${roundLimit}-round limit, 3 seeded festivals; ${rules === "reference" ? "reference grid and fees" : "captured costs + provisional rents"}`,
  medianRounds: rounds[Math.floor((games - 1) * 0.5)],
  p90Rounds: rounds[Math.floor((games - 1) * 0.9)],
  wins: count,
  seatWins,
  turnPositionWins,
  landmarkBuilds: results.reduce(
    (sum, result) => sum + result.landmarkBuilds,
    0,
  ),
  landmarkRent: results.reduce((sum, result) => sum + result.landmarkRent, 0),
  modifiedHotelRent: results.reduce(
    (sum, result) => sum + result.modifiedHotelRent,
    0,
  ),
  assertions:
    "All games terminated; per-event money conservation, event replay, card conservation, ownership and legal decisions passed",
  note:
    rules === "reference"
      ? "Reference rules have no Landmark; compare round-limit rate, bankruptcies and turnPositionWins with the prototype run"
      : "Balance is provisional: compare round-limit rate and turnPositionWins against targets; Landmarks may earn less than hosted/full-country/festival Hotels; prices/rents and rare monopoly rates need playtesting",
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
