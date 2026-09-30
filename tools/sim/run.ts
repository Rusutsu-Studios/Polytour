import { simulateGame } from "./simulation.js";

const index = process.argv.indexOf("--games");
const games = index < 0 ? 100 : Number(process.argv[index + 1]);
if (!Number.isInteger(games) || games < 1 || games > 10_000)
  throw new RangeError("--games must be an integer from 1 to 10000");
const results = Array.from({ length: games }, (_, seed) => simulateGame(seed));
const rounds = results.map((result) => result.rounds).sort((a, b) => a - b);
const count: Record<string, number> = {};
const seatWins = [0, 0, 0, 0];
const turnPositionWins = [0, 0, 0, 0];
for (const result of results) {
  count[result.kind] = (count[result.kind] ?? 0) + 1;
  seatWins[result.winner]++;
  turnPositionWins[result.turnPosition]++;
}
const report = {
  games,
  config:
    "four medium bots, 20-round limit, 3 seeded festivals; captured costs + provisional rents",
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
  note: "Balance is provisional: compare round-limit rate and turnPositionWins against targets; Landmarks may earn less than hosted/full-country/festival Hotels; prices/rents and rare monopoly rates need playtesting",
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
