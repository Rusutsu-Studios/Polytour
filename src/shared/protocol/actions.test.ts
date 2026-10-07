import { describe, expect, it } from "vitest";
import { ActionSchema, RoomConfigSchema } from "./index.js";

describe("Game duration settings", () => {
  it("defaults to 120 minutes and accepts exact durations or explicit unlimited duration", () => {
    expect(RoomConfigSchema.parse({}).timeLimitMinutes).toBe(120);
    for (const timeLimitMinutes of [15, 20, 45, 60, 73, 120, 200, 240, null]) {
      expect(
        RoomConfigSchema.parse({ timeLimitMinutes }).timeLimitMinutes,
      ).toBe(timeLimitMinutes);
    }
    for (const timeLimitMinutes of [0, -1, 14, 20.5, "infinite"]) {
      expect(RoomConfigSchema.safeParse({ timeLimitMinutes }).success).toBe(
        false,
      );
    }
  });
});

describe("Escape card intents", () => {
  it("accepts an island escape intent without trusting client card or fee data", () => {
    expect(ActionSchema.parse({ type: "UseEscapeCard" })).toEqual({
      type: "UseEscapeCard",
    });
    expect(
      ActionSchema.safeParse({ type: "UseEscapeCard", fee: 0 }).success,
    ).toBe(false);
    expect(
      ActionSchema.safeParse({ type: "UseRentCard", card: "Escape" }).success,
    ).toBe(false);
    expect(RoomConfigSchema.safeParse({ escapeCard: true }).success).toBe(
      false,
    );
  });
});
