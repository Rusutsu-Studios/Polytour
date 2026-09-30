import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiceCommitment } from "../shared/randomness/types.js";
import {
  deriveDice,
  facesFromBytes,
  prepareDice,
  QUICKNET,
  resolveDice,
} from "./randomness.js";

// Actual quicknet round 1 fixture; signature checked by the official client.
const BEACON = {
  round: 1,
  randomness:
    "1466a6cd24e327188770752f6134001c64d6efcc590ccc26b721611ad96f165a",
  signature:
    "b55e7cb2d5c613ee0b2e28d6750aabbb78c39dcc96bd9d38c2c2e12198df95571de8e8e402a0cc48871c7089a2b3af4b",
};
const FIXTURE_COMMITMENT: DiceCommitment = {
  mode: "drand",
  context: '["polytour/dice/v1","TEST01",1,0]',
  round: 1,
  committedAt: QUICKNET.genesis_time * 1000 - 4000,
  availableAt: QUICKNET.genesis_time * 1000 + 500,
  chainHash: QUICKNET.hash,
};

afterEach(() => vi.unstubAllGlobals());

describe("fair dice transport", () => {
  it("rejects biased tail bytes and gives every face exactly 42 byte inputs", () => {
    const faces = facesFromBytes(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(faces).toHaveLength(252);
    for (let face = 1; face <= 6; face += 1) {
      expect(faces.filter((value) => value === face)).toHaveLength(42);
    }
  });

  it("commits a not-yet-published round with a fixed domain and context", () => {
    const now = (QUICKNET.genesis_time + 300) * 1000 + 1700;
    const commitment = prepareDice(
      "drand",
      { roomCode: "ROOM01", seq: 7, seat: 2 },
      now,
    );
    expect(commitment.round).toBe(103);
    expect(commitment.availableAt - now).toBeGreaterThan(3000);
    expect(commitment.context).toBe('["polytour/dice/v1","ROOM01",7,2]');
  });

  it("accepts the real signed fixture and reproduces its public dice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(BEACON)),
    );
    const result = await resolveDice(FIXTURE_COMMITMENT);
    expect(result.proof.verified).toBe(true);
    expect(result.dice).toEqual(
      await deriveDice(BEACON.randomness, FIXTURE_COMMITMENT.context),
    );
    expect(result.proof.signature).toBe(BEACON.signature);
  });

  it.each([
    { ...BEACON, round: 2 },
    { ...BEACON, randomness: "0".repeat(64) },
    { ...BEACON, signature: "0".repeat(96) },
  ])("rejects a tampered beacon without falling back", async (beacon) => {
    const fetchMock = vi.fn(async () => Response.json(beacon));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveDice(FIXTURE_COMMITMENT)).rejects.toThrow(
      "retain the committed round",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(call).toBeDefined();
  });

  it("fails closed when every relay is offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(resolveDice(FIXTURE_COMMITMENT)).rejects.toThrow(
      "retain the committed round",
    );
  });

  it("marks fast dice as local crypto, without a public beacon proof", async () => {
    const commitment = prepareDice(
      "secure",
      { roomCode: "ROOM01", seq: 1, seat: 0 },
      0,
    );
    const result = await resolveDice(commitment);
    expect(result.dice.every((face) => face >= 1 && face <= 6)).toBe(true);
    expect(result.proof).toMatchObject({
      mode: "secure",
      verified: false,
      round: null,
      signature: null,
    });
  });
});
