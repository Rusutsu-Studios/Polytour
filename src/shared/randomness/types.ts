export type RandomnessMode = "secure" | "drand";

/** Public input fixed before the future beacon exists; never replace on retry. */
export type DiceCommitment = {
  readonly mode: RandomnessMode;
  readonly context: string;
  readonly committedAt: number;
  readonly availableAt: number;
  readonly round: number | null;
  readonly chainHash: string | null;
};

export type DiceProof = DiceCommitment & {
  readonly dice: readonly [number, number];
  readonly verified: boolean;
  readonly randomness: string | null;
  readonly signature: string | null;
  readonly source: string;
};
