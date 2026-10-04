import { describe, expect, it } from "vitest";
import { ActionSchema, RoomConfigSchema } from "./index.js";

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
