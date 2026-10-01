import {
  type Chain,
  type ChainClient,
  type ChainInfo,
  fetchBeacon,
} from "drand-client";
import { z } from "zod";
import type {
  DiceCommitment,
  DiceProof,
  RandomnessMode,
} from "../shared/randomness/types.js";

// Independently pinned quicknet identity, verified against the public /info API.
export const QUICKNET: ChainInfo = {
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesis_time: 1692803367,
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
};

const RELAYS = ["https://api.drand.sh", "https://api2.drand.sh"];
const beaconSchema = z.object({
  round: z.number().int().positive(),
  randomness: z.string().regex(/^[0-9a-f]{64}$/i),
  signature: z.string().regex(/^[0-9a-f]{96}$/i),
});

export function prepareDice(
  mode: RandomnessMode,
  input: {
    readonly roomCode: string;
    readonly seq: number;
    readonly seat: number;
  },
  now: number,
): DiceCommitment {
  // round 1 is published at genesis. Choose at least one whole period ahead.
  const round =
    mode === "drand"
      ? Math.floor((now / 1000 - QUICKNET.genesis_time) / QUICKNET.period) + 3
      : null;
  return {
    mode,
    context: JSON.stringify([
      "polytour/dice/v1",
      input.roomCode,
      input.seq,
      input.seat,
    ]),
    committedAt: now,
    availableAt:
      round === null
        ? now
        : (QUICKNET.genesis_time + (round - 1) * QUICKNET.period) * 1000 + 500,
    round,
    chainHash: mode === "drand" ? QUICKNET.hash : null,
  };
}

/** Bytes 252..255 are rejected: 252 is divisible by six, avoiding modulo bias. */
export function facesFromBytes(bytes: Uint8Array): number[] {
  return Array.from(bytes)
    .filter((byte) => byte < 252)
    .map((byte) => (byte % 6) + 1);
}

function secureDice(): readonly [number, number] {
  const faces: number[] = [];
  while (faces.length < 2) {
    faces.push(...facesFromBytes(crypto.getRandomValues(new Uint8Array(16))));
  }
  return [faces[0] ?? 1, faces[1] ?? 1];
}

export async function deriveDice(
  randomness: string,
  context: string,
): Promise<readonly [number, number]> {
  const faces: number[] = [];
  for (let counter = 0; faces.length < 2; counter += 1) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify(["polytour/d6/v1", randomness, context, counter]),
      ),
    );
    faces.push(...facesFromBytes(new Uint8Array(digest)));
  }
  return [faces[0] ?? 1, faces[1] ?? 1];
}

export async function resolveDice(commitment: DiceCommitment): Promise<{
  readonly dice: readonly [number, number];
  readonly proof: DiceProof;
}> {
  if (commitment.mode === "secure") {
    const dice = secureDice();
    return {
      dice,
      proof: {
        ...commitment,
        dice,
        verified: false,
        randomness: null,
        signature: null,
        source: "Web Crypto / server CSPRNG",
      },
    };
  }
  if (
    commitment.round === null ||
    commitment.chainHash !== QUICKNET.hash ||
    commitment.availableAt <= commitment.committedAt
  ) {
    throw new Error("Invalid future-round commitment");
  }
  let lastError: unknown;
  for (const relay of RELAYS) {
    try {
      // Use pinned chain metadata, never a public key supplied by a relay.
      const chain: Chain = {
        baseUrl: `${relay}/${QUICKNET.hash}`,
        info: async () => QUICKNET,
      };
      const client: ChainClient = {
        options: { disableBeaconVerification: false, noCache: false },
        chain: () => chain,
        get: async (round) => {
          const response = await fetch(`${chain.baseUrl}/public/${round}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok)
            throw new Error(`drand returned ${response.status}`);
          return beaconSchema.parse(await response.json());
        },
        latest: async () => {
          throw new Error("Only the committed future round may be fetched");
        },
      };
      const beacon = await fetchBeacon(client, commitment.round);
      const dice = await deriveDice(beacon.randomness, commitment.context);
      return {
        dice,
        proof: {
          ...commitment,
          dice,
          verified: true,
          randomness: beacon.randomness,
          signature: beacon.signature,
          source: chain.baseUrl,
        },
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    "drand unavailable or invalid; retain the committed round and retry",
    {
      cause: lastError,
    },
  );
}
