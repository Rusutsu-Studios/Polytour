// These shared service limits allow many hosts behind one LAN address. Keys and
// counters are server-owned: changing cookies, headers or IPs grants no budget.
export const ROOM_CREATION_LIMITS = {
  burst: 60,
  refillPerSecond: 1,
  perUtcDay: 1_000,
} as const;

export const ROOM_ADMISSION_KEY = "room-creation-budget";
const DAY_MS = 86_400_000;
const TOKEN_UNITS = 1_000;

export type RoomAdmissionState = {
  credit: number;
  at: number;
  day: number;
  creations: number;
};
export type RoomAdmission =
  | { success: true }
  | { success: false; retryAfter: number };

/** Calculate without mutating storage; only an admission persists its state. */
export function nextRoomAdmission(
  previous: RoomAdmissionState | undefined,
  now: number,
):
  | { success: true; state: RoomAdmissionState }
  | { success: false; retryAfter: number } {
  // Do not grant extra capacity if the clock moves backwards.
  const at = Math.max(now, previous?.at ?? now);
  const day = Math.floor(at / DAY_MS);
  const capacity = ROOM_CREATION_LIMITS.burst * TOKEN_UNITS;
  const credit = Math.min(
    capacity,
    (previous?.credit ?? capacity) +
      (at - (previous?.at ?? at)) * ROOM_CREATION_LIMITS.refillPerSecond,
  );
  const creations = previous?.day === day ? previous.creations : 0;
  const refillWait = Math.max(
    0,
    Math.ceil(
      (TOKEN_UNITS - credit) /
        (TOKEN_UNITS * ROOM_CREATION_LIMITS.refillPerSecond),
    ),
  );
  const dailyWait =
    creations >= ROOM_CREATION_LIMITS.perUtcDay
      ? Math.ceil(((day + 1) * DAY_MS - at) / 1_000)
      : 0;
  if (refillWait > 0 || dailyWait > 0)
    return { success: false, retryAfter: Math.max(refillWait, dailyWait) };
  return {
    success: true,
    state: { credit: credit - TOKEN_UNITS, at, day, creations: creations + 1 },
  };
}
