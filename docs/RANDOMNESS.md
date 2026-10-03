# Fair randomness and immediate dice

Polytour has no paid dice, luck statistic, paid reroll, power gauge, or outcome
modifier. The server applies the same uniform 2d6 distribution to every seat.
Cosmetics must never enter the rules, entropy input, or bot policy.

## Current gameplay: server Web Crypto

New rooms default to `secure`. Every roll draws fresh bytes with
`crypto.getRandomValues` in the authoritative Cloudflare Durable Object. The
Workers runtime provides cryptographically sound random values; no public relay,
initial beacon or player-PC randomness is required. No randomness-mode selector
appears in normal new-room settings.

Bytes 252–255 are rejected. For the remaining 252 byte values, `byte % 6 + 1`
gives exactly 42 inputs per face. The first two accepted bytes form the two dice;
more fresh bytes are drawn only if necessary. Humans and bots use this same path.

The result, events and receipt are persisted before broadcasting. Refresh and
reconnect read that saved result rather than throwing again. Server receipts use
`mode: "secure"`, `verified: false`, and null round, chain, signature and beacon
randomness fields. They are not an independently verifiable public proof. The
How to play help explains the equal chances and links the Cloudflare Web Crypto
documentation. The dice-information tool shows the last roll and a shortcut to
that help, without a beacon-verification badge or proof download.

This is a cryptographically secure pseudorandom source backed by runtime entropy,
not a claim of measured physical entropy for every throw. Server operation remains
trusted; no source infers player skill, purchases or win streaks to alter outcomes.

## Why not fetch one drand token at match start?

A public beacon used as the only seed of a deterministic generator would make
future rolls reproducible by anyone who knows the algorithm and match context.
A unique match identifier changes the sequence but does not make a public seed
secret. Mixing a beacon with a strong private server secret is possible, but adds
a startup dependency without a useful benefit for the current game. Fresh server
Web Crypto already supplies the needed unpredictable bytes with no external wait.

The seeded PRNG remains for initial turn order, festivals, the initial deck
representation and repeatable simulations. Its seed is generated with server Web
Crypto and is never sent to clients, but the public setup must not be treated as
a cryptographic secret. Live dice and Chance draws do not use that sequence.

## Live Chance draws

Every live engine invocation receives fresh server Web Crypto uint32 words in
`EngineContext.chanceEntropy`, including human actions, bots, dice resolution and
timeouts. For a draw pile of size `n`, the engine rejects words at or above
`floor(2^32 / n) * n`, then selects `word % n`. Each remaining card has the same
chance and is removed from the pile after selection: draws are without replacement.
The initial seeded deck order and public turn order/festivals cannot predict the
next live card.

When the pile is empty, discarded cards replenish it; held keep cards remain
unavailable. The same uniform selection applies to the replenished pile. Existing
saved decks use this path too, preserving their remaining/discarded/held cards
without a state schema, protocol or rules-version bump. Draw events and resulting
state are persisted before broadcast; replay and reconnect use those saved events.
Neither Chance entropy nor remaining cards appear in public snapshots.

Seeded tests and simulations may omit `chanceEntropy` to draw deterministically
from the seeded shuffled deck. Supplied entropy must contain valid uint32 words;
invalid or exhausted entropy fails instead of falling back to the seeded PRNG.
Live Chance has no public cryptographic receipt and still trusts the server.

## Saved-room compatibility: drand quicknet

The wire enum and resolver retain explicit `drand` support for saved rooms and
compatibility tests/tools. Those games keep their frozen source and recorded
commitments; the update does not silently change a running match. Start a new room
to use immediate server dice. Drand is no longer offered in the normal UI.

Before a legacy drand roll, the room persists and
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

## Why not use Cloudflare's lava lamps directly?

Cloudflare's LavaRand captures physical entropy and mixes it into a CSPRNG as an
additional source. It is an excellent reference for entropy quality, but hosting
a Worker does not give this application a public LavaRand receipt for each roll.
We make no claim that `crypto.getRandomValues` is directly fed by the lava lamps.
Drand addresses publicly verifiable distributed beacons; it remains a saved-room
compatibility path. Physical entropy and publicly auditable outcomes solve
different problems, and neither is required for the immediate CSPRNG dice.

## Pinned quicknet identity

- Chain: `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`
- Scheme: `bls-unchained-g1-rfc9380`
- Period: 3 seconds; genesis: `1692803367` Unix seconds.
- Key and metadata: `src/worker/randomness.ts`, checked against `/info`.
- Relays: `api.drand.sh`, `api2.drand.sh`; never request `/public/latest` for a roll.

## Verification and remaining work

Automated tests check new-room defaults, a real Worker roll while external fetch
is disabled, immediate resolution, no pending commitment after success and honest
receipt fields. The byte-to-face mapping is checked exhaustively. Compatibility
tests retain the signed quicknet fixture, altered rounds/signatures and relay
outage behavior. Chance tests cover uniform index selection, rejection of the
uneven uint32 tail, drawing without replacement, saved-deck compatibility and
deterministic simulation fallback. Statistical simulation is a balance tool,
not a cryptographic proof.

Legacy drand rooms display commitments and offer JSON proof export; replay
restores the latest proof. Normal server dice display no public-verification claim.

If public auditability is added later, it needs its own commitment protocol,
externally witnessed history, proof retention and independent review. Fetching a
single public seed at startup does not provide those guarantees. Account security,
matchmaking and match rewards remain separate work.

## Primary references

- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#methods)
- [W3C Web Crypto: random values](https://www.w3.org/TR/webcrypto/#Crypto-method-getRandomValues)
- [drand client libraries](https://docs.drand.love/developer/clients/)
- [Official JavaScript client](https://github.com/drand/drand-client)
- [drand protocol specification](https://docs.drand.love/docs/specification/)
- [Quicknet chain metadata](https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info)
- [Cloudflare: LavaRand in production](https://blog.cloudflare.com/randomness-101-lavarand-in-production/)
- [Cloudflare: randomness beacon cryptographic background](https://developers.cloudflare.com/randomness-beacon/cryptographic-background/)
