import { readFile } from "node:fs/promises";
import { z } from "zod";
import { QUICKNET, resolveDice } from "../../src/worker/randomness.js";

const proofSchema = z.object({
  mode: z.literal("drand"),
  context: z.string(),
  committedAt: z.number().int(),
  availableAt: z.number().int(),
  round: z.number().int().positive(),
  chainHash: z.literal(QUICKNET.hash),
  dice: z.tuple([
    z.number().int().min(1).max(6),
    z.number().int().min(1).max(6),
  ]),
  verified: z.literal(true),
  randomness: z.string(),
  signature: z.string(),
  source: z.string(),
});

const path = process.argv[2];
if (!path) throw new Error("Usage: pnpm verify:dice path/to/proof.json");
const proof = proofSchema.parse(JSON.parse(await readFile(path, "utf8")));
const scheduled =
  (QUICKNET.genesis_time + (proof.round - 1) * QUICKNET.period) * 1000;
if (scheduled <= proof.committedAt || proof.availableAt !== scheduled + 500) {
  throw new Error("The proof does not describe a future round commitment");
}
const result = await resolveDice(proof);
if (
  JSON.stringify(result.dice) !== JSON.stringify(proof.dice) ||
  result.proof.randomness !== proof.randomness ||
  result.proof.signature !== proof.signature
)
  throw new Error(
    "Proof mismatch: the signed beacon does not produce these dice",
  );
console.log(
  JSON.stringify(
    {
      valid: true,
      round: proof.round,
      context: proof.context,
      dice: result.dice,
    },
    null,
    2,
  ),
);
