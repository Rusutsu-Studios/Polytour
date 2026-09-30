# Fair randomness and verifiable dice

Polytour has no paid dice, luck statistic, paid reroll, power gauge, or outcome
modifier. The server applies the same uniform 2d6 distribution to all four seats.
Cosmetics must never enter the rules, entropy input, or bot policy.

## Implemented modes

**Verifiable dice (default): drand quicknet.** Before a roll, the room persists and
broadcasts a commitment to a future quicknet round and an immutable context:
`["polytour/dice/v1", roomCode, eventSeq, seat]`. The round is at least one full
3-second beacon period ahead. An alarm wakes the room after publication; there is
no polling timer keeping the room awake. Incoming actions are blocked during this
pending roll. Refreshing, reconnecting, or retrying does not select another round.

The official `drand-client` verifies the round, the BLS signature, and
`randomness = SHA-256(signature)` against a pinned quicknet public key. Both relays
serve the **same round**. Invalid data or an outage pauses the roll and retries
that commitment; it never silently switches to another randomness mode.

Two dice are extracted from SHA-256 of
`["polytour/d6/v1", beaconRandomnessHex, committedContext, counter]`, starting at
counter zero. Bytes 252–255 are rejected. Each remaining byte gives `byte % 6 + 1`;
there are exactly 42 byte values for each face. The first two accepted bytes form
the dice. Additional hashes are generated only if necessary. Domain separation
keeps different rooms/turns/seats distinct without introducing a luck parameter.

The public proof contains context, commitment times, chain hash, round, signature,
randomness, dice, and relay. It is attached to the persisted dice event and restored
on replay. `pnpm verify:dice path/to/proof.json` independently fetches and verifies
the committed beacon and recomputes the dice. A connection should record the
commitment before publication; a proof file alone does not prove when a server
committed. The server can still refuse to continue a match: this prototype does
not claim to prevent a dishonest operator from censoring a result.

**Fast dice (optional): server Web Crypto.** Each roll draws fresh bytes from
`crypto.getRandomValues`, with the same rejection sampling. This is a
cryptographically secure source, but it has no independently verifiable public
beacon proof. The chosen mode is visible and frozen when the match starts. It is
useful for local tests and quick play; it is never a fallback inside a drand match.

The deterministic PRNG remains for the private shuffled Chance deck, initial turn
order, and repeatable simulator runs. Live dice always override it with server
entropy. Its seed is generated with server Web Crypto and never sent to clients;
deck order and resolution queues are also excluded from public snapshots.

## Why not use Cloudflare's lava lamps directly?

Cloudflare's LavaRand captures physical entropy and mixes it into a CSPRNG as an
additional source. It is an excellent reference for entropy quality, but hosting
a Worker does not give this application a public LavaRand receipt for each roll.
We make no claim that `crypto.getRandomValues` is directly fed by the lava lamps.
drand addresses the other requirement: publicly verifiable distributed beacons.
Physical entropy and publicly auditable game outcomes solve different problems.

## Pinned quicknet identity

- Chain: `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`
- Scheme: `bls-unchained-g1-rfc9380`
- Period: 3 seconds; genesis: `1692803367` Unix seconds.
- Key and metadata: `src/worker/randomness.ts`, checked against `/info`.
- Relays: `api.drand.sh`, `api2.drand.sh`; never request `/public/latest` for a roll.

## Verification and remaining work

Automated tests verify a real signed quicknet fixture, reject altered rounds,
randomness and signatures, cover relay outages, and exhaustively check byte-to-die
mapping. Statistical simulation is a balance tool; it is not a cryptographic proof.

The client displays commitments and offers JSON proof export; replay restores
the latest proof. A read-only implementation review and a real future-round check
have been performed for this slice.

Before ranked launch: durable externally witnessed commitment history, durable
cross-match proof retention, browser-side signature verification, independent security
review, and a verifiable deck/turn-order protocol. Account security, matchmaking,
and match rewards are separate work. No RNG design should infer player skill,
purchase history, win streak, or account age to alter outcomes.

## Primary references

- [drand client libraries](https://docs.drand.love/developer/clients/)
- [Official JavaScript client](https://github.com/drand/drand-client)
- [drand protocol specification](https://docs.drand.love/docs/specification/)
- [Quicknet chain metadata](https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info)
- [Cloudflare: LavaRand in production](https://blog.cloudflare.com/randomness-101-lavarand-in-production/)
- [Cloudflare: randomness beacon cryptographic background](https://developers.cloudflare.com/randomness-beacon/cryptographic-background/)
