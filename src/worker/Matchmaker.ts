import { DurableObject } from "cloudflare:workers";

export class Matchmaker extends DurableObject<Env> {
  fetch(): Response {
    return Response.json({ kind: "matchmaker", status: "ok" });
  }
}
