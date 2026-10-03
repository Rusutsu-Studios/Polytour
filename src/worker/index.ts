import { Hono } from "hono";

import {
  CreateRoomSchema,
  JoinRoomSchema,
  RoomCodeSchema,
  RoomConfigSchema,
} from "../shared/protocol/index.js";
import { APP_VERSION } from "../shared/version.js";
import { GameRoom } from "./GameRoom.js";
import { Matchmaker } from "./Matchmaker.js";
import { robotsResponse, sitemapResponse, withSeoHeaders } from "./seo.js";
import { workerDiagnostics } from "./worker-diagnostics.js";

export { GameRoom, Matchmaker };

const app = new Hono<{ Bindings: Env }>();
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

app.get("/robots.txt", (context) => robotsResponse(new URL(context.req.url)));
app.get("/sitemap.xml", (context) => sitemapResponse(new URL(context.req.url)));
app.get("/index.html", (context) => {
  const url = new URL(context.req.url);
  return context.redirect(`/${url.search}`, 308);
});
app.get("/", (context) => context.env.ASSETS.fetch(context.req.raw));
app.get("/rooms/:roomCode", (context) => {
  // Retain the old browser route without enabling an unrestricted SPA fallback.
  const url = new URL(context.req.url);
  url.pathname = "/";
  return context.env.ASSETS.fetch(new Request(url, context.req.raw));
});

app.onError((error, context) => {
  // Keep the cause in Worker logs, but never send internal failures as plain text
  // (or expose a storage error/stack to a player creating or joining a room).
  console.error("Room service failed", error);
  const code = error.message.includes(
    "Exceeded allowed rows written in Durable Objects free tier",
  )
    ? "room-storage-limit"
    : "room-service-unavailable";
  return context.json({ error: code }, 503, {
    "Cache-Control": "no-store",
  });
});

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

app.get("/api/health", (context) =>
  context.json(
    {
      status: "ok",
      ...(context.req.query("debug") === "1"
        ? { diagnostics: workerDiagnostics(context.req.raw) }
        : {}),
    },
    200,
    { "Cache-Control": "no-store" },
  ),
);
app.get("/api/version", (context) =>
  context.json({ version: APP_VERSION }, 200, { "Cache-Control": "no-store" }),
);
app.post("/api/rooms", async (context) => {
  // Aggregate edge shedding happens before reading a body or reaching storage.
  // Use a fixed key: a LAN party shares no IP-specific quota, and attacker-chosen
  // cookies/headers cannot bypass this gate by inventing fresh identities.
  const edge = await context.env.ROOM_CREATION_RATE_LIMIT.limit({
    key: "room-creation",
  });
  if (!edge.success)
    return context.json({ error: "rate-limited" }, 429, {
      "Retry-After": "60",
      "Cache-Control": "no-store",
    });
  if (!sameOrigin(context.req.raw))
    return context.json({ error: "origin-rejected" }, 403);
  const parsed = CreateRoomSchema.safeParse(await readJson(context.req.raw));
  if (!parsed.success) return context.json({ error: "invalid-room" }, 400);
  const admission =
    await context.env.MATCHMAKER.getByName(
      "room-admission",
    ).admitRoomCreation();
  if (!admission.success)
    return context.json({ error: "rate-limited" }, 429, {
      "Retry-After": String(admission.retryAfter),
      "Cache-Control": "no-store",
    });
  const config = parsed.data.config ?? RoomConfigSchema.parse({});
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = roomCode();
    const created = await context.env.GAME_ROOM.getByName(code).init(
      code,
      parsed.data.name,
      config,
      parsed.data.bots,
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
app.post("/api/rooms/:roomCode/leave", async (context) => {
  if (!sameOrigin(context.req.raw))
    return context.json({ error: "origin-rejected" }, 403);
  const code = RoomCodeSchema.safeParse(context.req.param("roomCode"));
  if (!code.success) return context.json({ error: "invalid-room" }, 400);
  const token = context.req
    .header("Authorization")
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return context.json({ error: "unauthorized" }, 401);
  const result = await context.env.GAME_ROOM.getByName(code.data).leave(token);
  return context.json(
    result,
    "error" in result ? (result.error === "room-not-found" ? 404 : 401) : 200,
    { "Cache-Control": "no-store" },
  );
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
app.get("/api/rooms/:roomCode/health", (context) => {
  const code = RoomCodeSchema.safeParse(context.req.param("roomCode"));
  if (!code.success) return context.json({ error: "invalid-room" }, 400);
  // Health is service liveness, not a room lookup; probing names allocates no DO.
  return context.json({ kind: "game-room", status: "ok" });
});
app.get("/api/queues/:mode/health", (context) =>
  context.json({ kind: "matchmaker", status: "ok" }),
);
app.notFound((context) => context.json({ error: "Not found" }, 404));

export default {
  async fetch(request, env, executionContext) {
    return withSeoHeaders(
      request,
      await app.fetch(request, env, executionContext),
    );
  },
} satisfies ExportedHandler<Env>;
