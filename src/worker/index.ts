import { Hono } from "hono";

import { GameRoom } from "./GameRoom.js";
import { Matchmaker } from "./Matchmaker.js";

export { GameRoom, Matchmaker };

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (context) => context.json({ status: "ok" }));

app.get("/api/rooms/:roomCode/health", async (context) => {
  const room = context.env.GAME_ROOM.getByName(context.req.param("roomCode"));
  return room.fetch(context.req.raw);
});

app.get("/api/queues/:mode/health", async (context) => {
  const queue = context.env.MATCHMAKER.getByName(context.req.param("mode"));
  return queue.fetch(context.req.raw);
});

app.get("/ws/debug/hello", async (context) => {
  const room = context.env.GAME_ROOM.getByName("phase0-debug");
  return room.fetch(context.req.raw);
});

app.notFound((context) => context.json({ error: "Not found" }, 404));

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
