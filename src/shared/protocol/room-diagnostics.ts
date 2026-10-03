import { z } from "zod";

export const ROOM_DEBUG_VERSION = 1;
export const DEBUG_PING_REQUEST = "polytour-debug-ping-v1";
export const DEBUG_PING_RESPONSE = "polytour-debug-pong-v1";

const point = {
  colo: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  location: z.string().max(120).nullable(),
  region: z.string().max(80).nullable(),
};

/** Safe room-routing metadata; never includes socket credentials or storage data. */
export const RoomDiagnosticsSchema = z
  .object({
    worker: z
      .object({
        worker: z.string().max(80),
        hostname: z.string().max(253),
        runtime: z.enum(["cloudflare", "local", "unknown"]),
        cloudflare: z
          .object({
            ...point,
            colo: z.string().regex(/^[A-Z]{3}$/),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    room: z
      .object({
        className: z.literal("GameRoom"),
        storage: z.literal("sqlite"),
        location: z.null(),
        jurisdiction: z.enum(["eu", "fedramp"]).nullable(),
      })
      .strict(),
    peers: z
      .array(
        z
          .object({
            seat: z.union([
              z.literal(0),
              z.literal(1),
              z.literal(2),
              z.literal(3),
            ]),
            ...point,
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export type RoomDiagnostics = z.infer<typeof RoomDiagnosticsSchema>;
