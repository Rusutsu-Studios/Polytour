import { z } from "zod";
import type { GameEvent, PublicState } from "../../shared/engine/index.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import { RoomConfigSchema } from "../../shared/protocol/index.js";

const seat = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const tile = z.number().int().min(0).max(31);
const integer = z.number().int();
const publicState = z.object({
  gameId: z.string(),
  config: z
    .object({
      gameId: z.string(),
      startingCash: integer,
      startSalary: integer,
      roundLimit: integer,
    })
    .passthrough(),
  players: z.array(
    z.object({
      playerId: z.string(),
      name: z.string(),
      seat,
      control: z.enum(["human", "bot"]),
      cash: integer,
      position: tile,
      laps: integer,
      onIsland: z.boolean(),
      bankrupt: z.boolean(),
      islandTurns: integer,
      properties: z.array(tile),
      heldCards: z.array(z.enum(["Guardian Angel", "Coupon"])),
      travelPending: z.boolean(),
    }),
  ),
  properties: z.array(
    z.object({ tile, owner: seat.nullable(), level: integer.min(0).max(5) }),
  ),
  turnOrder: z.array(seat),
  startingTurnOrder: z.array(seat),
  roundSeatsRemaining: z.array(seat),
  eliminated: z.array(seat),
  activeSeat: seat,
  round: integer,
  phase: z.enum(["roll", "resolve"]),
  doublesInTurn: integer,
  pending: z
    .object({
      kind: z.enum([
        "roll",
        "island",
        "travel",
        "buy",
        "build",
        "buyout",
        "rent-card",
        "host",
        "card-target",
        "sell",
      ]),
      seat,
      deadline: z.number(),
    })
    .passthrough()
    .nullable(),
  lastRoll: z
    .object({
      seat,
      dice: z.tuple([integer.min(1).max(6), integer.min(1).max(6)]),
    })
    .nullable(),
  lastCard: z.object({ seat, card: z.string() }).nullable(),
  bankLedger: integer,
  championshipHost: z.object({ tile, multiplier: integer }).nullable(),
  festivalTiles: z.array(tile),
  matchDeadline: z.number().nullable(),
  status: z.enum(["active", "finished"]),
  result: z
    .object({
      winner: seat,
      kind: z.string(),
      standings: z.array(z.object({ seat, netWorth: integer })),
    })
    .nullable(),
  startedAt: z.number(),
});
const state = z.custom<PublicState>(
  (value) => publicState.safeParse(value).success,
);
const eventTypes = new Set([
  "GameCreated",
  "DiceRolled",
  "PlayerMoved",
  "SalaryPaid",
  "TurnPhaseChanged",
  "TurnAdvanced",
  "SentToIsland",
  "IslandEscapeFailed",
  "LeftIsland",
  "GameOver",
  "DecisionOpened",
  "DecisionClosed",
  "TravelOptionChanged",
  "PropertyBought",
  "PropertyUpgraded",
  "PropertySold",
  "BoughtOut",
  "RentPaid",
  "MoneyTransferred",
  "ChampionshipChanged",
  "CardDrawn",
  "CardUsed",
  "PropertyDowngraded",
  "PropertiesSwapped",
  "PlayerBankrupt",
  "PlayerControlChanged",
]);
const event = z.custom<GameEvent>((value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    typeof value.type !== "string" ||
    !eventTypes.has(value.type)
  )
    return false;
  if (value.type === "GameCreated")
    return "state" in value && publicState.safeParse(value.state).success;
  if ("seat" in value && !seat.safeParse(value.seat).success) return false;
  if ("tile" in value && !tile.safeParse(value.tile).success) return false;
  if (value.type === "DiceRolled")
    return (
      "dice" in value &&
      z
        .tuple([integer.min(1).max(6), integer.min(1).max(6)])
        .safeParse(value.dice).success
    );
  return true;
});
const lobby = z.object({
  roomCode: z.string(),
  hostSeat: seat,
  status: z.enum(["lobby", "playing", "finished"]),
  config: RoomConfigSchema,
  boardRule: z.enum(["country", "legacy"]).default("country"),
  economyRule: z.enum(["reference", "prototype"]).default("reference"),
  sellBackPercent: z.union([z.literal(50), z.literal(100)]).default(100),
  hotelPurchaseRule: z
    .enum(["staged-hotels", "legacy-lap"])
    .default("staged-hotels"),
  worldTourRule: z.enum(["free-and-own", "free-first"]).default("free-and-own"),
  seats: z
    .array(
      z.object({
        seat,
        name: z.string(),
        control: z.enum(["human", "bot"]).nullable(),
        online: z.boolean(),
      }),
    )
    .length(4),
});
const commitment = z.object({
  mode: z.enum(["secure", "drand"]),
  context: z.string(),
  committedAt: z.number(),
  availableAt: z.number(),
  round: integer.nullable(),
  chainHash: z.string().nullable(),
});
const proof = commitment.extend({
  dice: z.tuple([integer.min(1).max(6), integer.min(1).max(6)]),
  verified: z.boolean(),
  randomness: z.string().nullable(),
  signature: z.string().nullable(),
  source: z.string(),
});
const randomness = z.object({
  status: z.enum(["committed", "waiting", "error", "resolved"]),
  commitment: commitment.optional(),
  proof: proof.optional(),
  message: z.string().optional(),
});
const envelope = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    protocolVersion: integer,
    you: z.object({ seat }),
    seq: integer.nonnegative(),
    snapshot: state.nullable(),
    lobby,
    randomness: randomness.nullable(),
  }),
  z.object({
    type: z.literal("events"),
    fromSeq: integer.nonnegative(),
    toSeq: integer.nonnegative(),
    events: z.array(event),
    proofs: z.array(z.object({ seq: integer, proof })).optional(),
  }),
  z.object({ type: z.literal("lobby"), lobby }),
  z.object({ type: z.literal("ack"), id: z.string() }),
  z.object({
    type: z.literal("reject"),
    id: z.string(),
    reason: z.string(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("presence"),
    seat,
    status: z.enum(["online", "away", "bot"]),
  }),
  randomness.extend({ type: z.literal("randomness") }),
  z.object({ type: z.literal("pong"), t: z.number(), serverNow: z.number() }),
]);
export function parseServerMessage(raw: string): ServerMessage {
  return envelope.parse(JSON.parse(raw) as unknown);
}
