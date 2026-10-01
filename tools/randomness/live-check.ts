import { mkdir, writeFile } from "node:fs/promises";
import { prepareDice, resolveDice } from "../../src/worker/randomness.js";

const commitment = prepareDice(
  "drand",
  { roomCode: "CHECK1", seq: 0, seat: 0 },
  Date.now(),
);
console.log(JSON.stringify({ commitment }));
// CLI-only waiting. The Durable Object uses persistent alarms instead.
await new Promise((resolve) =>
  setTimeout(resolve, Math.max(0, commitment.availableAt - Date.now())),
);
const { proof } = await resolveDice(commitment);
await mkdir(".local/verification", { recursive: true });
await writeFile(
  ".local/verification/live-drand-proof.json",
  `${JSON.stringify(proof, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    verified: proof.verified,
    round: proof.round,
    dice: proof.dice,
    source: proof.source,
  }),
);
