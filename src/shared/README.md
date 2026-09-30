# Shared game code

Pure TypeScript imported by both the Worker and client:

- `board/`: 32 tiles, per-city economy, chance deck and animation/decision timing.
- `engine/`: deterministic rules, public event reducer, legal actions and bots.
- `protocol/`: validated client commands and room configuration.
- `randomness/`: public commitment/proof types. Network fetching and signature
  verification live in the Worker; the engine receives verified dice as input.

Never import from `src/client` or `src/worker`, use I/O, or read wall-clock time here.
