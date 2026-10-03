import { DurableObject } from "cloudflare:workers";
import {
  nextRoomAdmission,
  ROOM_ADMISSION_KEY,
  type RoomAdmission,
  type RoomAdmissionState,
} from "./room-admission.js";

export class Matchmaker extends DurableObject<Env> {
  async admitRoomCreation(): Promise<RoomAdmission> {
    // One persisted record, updated atomically only for an accepted creation.
    // Storage transactions serialize concurrent admissions and survive eviction.
    return this.ctx.storage.transaction(async (transaction) => {
      const previous =
        await transaction.get<RoomAdmissionState>(ROOM_ADMISSION_KEY);
      const result = nextRoomAdmission(previous, Date.now());
      if (!result.success) return result;
      await transaction.put(ROOM_ADMISSION_KEY, result.state);
      return { success: true };
    });
  }

  fetch(): Response {
    return Response.json({ kind: "matchmaker", status: "ok" });
  }
}
