import { DurableObject } from "cloudflare:workers";

export class GameRoom extends DurableObject<Env> {
  fetch(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ kind: "game-room", status: "ok" });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server, ["phase0"]);
    server.send(JSON.stringify({ type: "phase0.hello", status: "ok" }));

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === "ping") {
      socket.send("pong");
    }
  }
}
