import { Hono } from "hono";

import {
  CreateRoomSchema,
  JoinRoomSchema,
  RoomCodeSchema,
  RoomConfigSchema,
} from "../shared/protocol/index.js";
import { GameRoom } from "./GameRoom.js";
import { Matchmaker } from "./Matchmaker.js";

export { GameRoom, Matchmaker };

const app = new Hono<{ Bindings: Env }>();
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function roomCode(): string {
  // 32-symbol alphabet divides 256 exactly, so this mapping has no modulo bias.
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length],
  ).join("");
}
function sameOrigin(request: Request, required = false): boolean {
  const origin = request.headers.get("Origin");
  return (
    origin === new URL(request.url).origin || (!required && origin === null)
  );
}
async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 4096) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(buffer);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

app.get("/api/health", (context) => context.json({ status: "ok" }));
app.post("/api/rooms", async (context) => {
  if (!sameOrigin(context.req.raw))
    return context.json({ error: "origin-rejected" }, 403);
  const parsed = CreateRoomSchema.safeParse(await readJson(context.req.raw));
  if (!parsed.success) return context.json({ error: "invalid-room" }, 400);
  const config = parsed.data.config ?? RoomConfigSchema.parse({});
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = roomCode();
    const created = await context.env.GAME_ROOM.getByName(code).init(
      code,
      parsed.data.name,
      config,
    );
    if (created)
      return context.json(created, 201, { "Cache-Control": "no-store" });
  }
  return context.json({ error: "room-creation-unavailable" }, 503);
});
app.post("/api/rooms/:roomCode/join", async (context) => {
  if (!sameOrigin(context.req.raw))
    return context.json({ error: "origin-rejected" }, 403);
  const code = RoomCodeSchema.safeParse(context.req.param("roomCode"));
  const parsed = JoinRoomSchema.safeParse(await readJson(context.req.raw));
  if (!code.success || !parsed.success)
    return context.json({ error: "invalid-room" }, 400);
  const result = await context.env.GAME_ROOM.getByName(code.data).join(
    parsed.data.name,
  );
  if ("error" in result)
    return context.json(result, result.error === "room-not-found" ? 404 : 409);
  return context.json(result, 200, { "Cache-Control": "no-store" });
});
app.get("/api/rooms/:roomCode", async (context) => {
  if (context.req.header("Upgrade"))
    return context.json({ error: "invalid-route" }, 400);
  const code = RoomCodeSchema.safeParse(context.req.param("roomCode"));
  if (!code.success) return context.json({ error: "invalid-room" }, 400);
  return context.env.GAME_ROOM.getByName(code.data).fetch(context.req.raw);
});
app.get("/ws/room/:roomCode", async (context) => {
  if (!sameOrigin(context.req.raw, true))
    return context.json({ error: "origin-rejected" }, 403);
  const code = RoomCodeSchema.safeParse(context.req.param("roomCode"));
  if (!code.success) return context.json({ error: "invalid-room" }, 400);
  if (context.req.header("Upgrade")?.toLowerCase() !== "websocket")
    return context.json({ error: "upgrade-required" }, 426);
  return context.env.GAME_ROOM.getByName(code.data).fetch(context.req.raw);
});
app.get("/api/rooms/:roomCode/health", async (context) =>
  context.env.GAME_ROOM.getByName(context.req.param("roomCode")).fetch(
    context.req.raw,
  ),
);
app.get("/api/queues/:mode/health", async (context) =>
  context.env.MATCHMAKER.getByName(context.req.param("mode")).fetch(
    context.req.raw,
  ),
);
app.notFound((context) => context.json({ error: "Not found" }, 404));

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
