import { z } from "zod";
import type { BoardRule, EconomyRule } from "../board/index.js";
import type { Action, GameEvent, PublicState, Seat } from "../engine/index.js";
import type { DiceCommitment, DiceProof } from "../randomness/types.js";
import type { RoomDiagnostics } from "./room-diagnostics.js";

// Layout, prices and sale quotes depend on frozen room rules; stale clients reload.
export const PROTOCOL_VERSION = 3;
export const RoomCodeSchema = z
  .string()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
export const NameSchema = z.string().trim().min(1).max(24);
export const RoomConfigSchema = z
  .object({
    startingCash: z.number().int().min(0).max(10_000_000).default(2_000_000),
    startSalary: z.number().int().min(0).max(1_000_000).default(400_000),
    roundLimit: z.number().int().min(1).max(10_000).default(10_000),
    timeLimitMinutes: z
      .union([z.literal(20), z.literal(60), z.literal(120)])
      .default(120),
    festivalCount: z.number().int().min(0).max(20).default(3),
    lineMonopoly: z.boolean().default(true),
    tripleMonopoly: z.boolean().default(true),
    hotelsDirectly: z.boolean().default(false),
    extraRollOnDouble: z.boolean().default(true),
    botCanBuild: z.boolean().default(true),
    giftCanBankrupt: z.boolean().default(true),
    decisionSeconds: z.number().int().min(10).max(60).default(30),
    randomnessMode: z.enum(["secure", "drand"]).default("secure"),
  })
  .strict();
export type RoomConfig = z.infer<typeof RoomConfigSchema>;
export const CreateRoomSchema = z
  .object({
    name: NameSchema,
    config: RoomConfigSchema.optional(),
  })
  .strict();
export const JoinRoomSchema = z.object({ name: NameSchema }).strict();

const seat = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const tile = z.number().int().min(0).max(31);
const level = z.number().int().min(0).max(5);
export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Roll") }).strict(),
  z.object({ type: z.literal("PayIsland") }).strict(),
  z.object({ type: z.literal("Decline") }).strict(),
  z.object({ type: z.literal("Buyout") }).strict(),
  z.object({ type: z.literal("Travel"), tile }).strict(),
  z.object({ type: z.literal("Sell"), tile }).strict(),
  z.object({ type: z.literal("ChooseHost"), tile }).strict(),
  z.object({ type: z.literal("ChooseTarget"), tile }).strict(),
  z.object({ type: z.literal("Buy"), level }).strict(),
  z.object({ type: z.literal("Build"), level }).strict(),
  z
    .object({
      type: z.literal("UseRentCard"),
      card: z.enum(["Guardian Angel", "Coupon"]),
    })
    .strict(),
]);
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w-]+$/);
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("sync"),
      lastSeq: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("intent"),
      id,
      atSeq: z.number().int().nonnegative(),
      action: ActionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("lobby"),
      id,
      op: z.discriminatedUnion("type", [
        z.object({ type: z.literal("start"), fillBots: z.boolean() }).strict(),
        z
          .object({ type: z.literal("settings"), config: RoomConfigSchema })
          .strict(),
        z.object({ type: z.literal("add-bot"), seat }).strict(),
        z.object({ type: z.literal("remove-bot"), seat }).strict(),
      ]),
    })
    .strict(),
  z.object({ type: z.literal("ping"), t: z.number().finite() }).strict(),
  z.object({ type: z.literal("debug-info") }).strict(),
]);
/**
 * Host-only lobby operations. `start` with `fillBots` seats bots in every empty
 * place; without it, the room starts with its occupied seats (two or more).
 */
export type LobbyOp =
  | { type: "start"; fillBots: boolean }
  | { type: "settings"; config: RoomConfig }
  | { type: "add-bot"; seat: Seat }
  | { type: "remove-bot"; seat: Seat };
export type ClientMessage =
  | { type: "sync"; lastSeq: number | null }
  | { type: "intent"; id: string; atSeq: number; action: Action }
  | { type: "lobby"; id: string; op: LobbyOp }
  | { type: "ping"; t: number }
  | { type: "debug-info" };

export type RoomCredentials = { roomCode: string; seat: Seat; token: string };
export type LobbySeat = {
  seat: Seat;
  name: string;
  control: "human" | "bot" | null;
  online: boolean;
};
export type LobbyState = {
  roomCode: string;
  hostSeat: Seat;
  status: "lobby" | "playing" | "finished";
  config: RoomConfig;
  readonly boardRule: BoardRule;
  readonly economyRule: EconomyRule;
  readonly hotelPurchaseRule: "staged-hotels" | "legacy-lap";
  readonly sellBackPercent: 50 | 100;
  seats: LobbySeat[];
};
export type RandomnessStatus = {
  status: "committed" | "waiting" | "error" | "resolved";
  commitment?: DiceCommitment;
  proof?: DiceProof;
  message?: string;
};
export type ServerMessage =
  | {
      type: "welcome";
      protocolVersion: number;
      roomDebugVersion?: number;
      you: { seat: Seat };
      seq: number;
      snapshot: PublicState | null;
      lobby: LobbyState;
      randomness: RandomnessStatus | null;
    }
  | {
      type: "events";
      fromSeq: number;
      toSeq: number;
      events: readonly GameEvent[];
      proofs?: { seq: number; proof: DiceProof }[];
    }
  | { type: "ack"; id: string }
  | { type: "reject"; id: string; reason: string; message?: string }
  | { type: "lobby"; lobby: LobbyState }
  | { type: "presence"; seat: Seat; status: "online" | "away" | "bot" }
  | ({ type: "randomness" } & RandomnessStatus)
  | { type: "pong"; t: number; serverNow: number }
  | { type: "room-diagnostics"; value: RoomDiagnostics };
