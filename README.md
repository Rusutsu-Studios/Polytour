# Polytour

A multiplayer property-strategy board game for the web. Four players travel from
French cities to Tokyo, buy land, build, pay rent and compete for collections on an
original Three.js toy board. Cloudflare Workers and one SQLite Durable Object per
room own the rules, persistence and WebSockets.

**Status:** first playable prototype. Create a private room and share its code with
friends, or immediately play against three server bots. The default preset is
2 M starting cash, 400 k per lap, three festivals, line/triple collection wins and
a two-hour maximum. Room settings can be adjusted before starting.

Dice default to future public drand rounds with BLS signature verification and
uniform rejection sampling. Each commitment precedes publication, survives
reconnection, and exposes a downloadable proof. A separately labelled fast mode
uses fresh server cryptographic entropy. There are no paid gameplay advantages.

## Play locally

Use the Node version in `.node-version` and the pnpm version in `package.json`:

```sh
pnpm install
pnpm dev
```

Open the displayed local URL, choose a name, and select a game against bots or
create a room for friends. Friends must use the same reachable server; separate
browser tabs share saved credentials, so use separate browser profiles/private
windows for different seats. Refreshing resumes your seat. A disconnected human
is temporarily controlled by a bot after 60 seconds and regains control on return.

## Verify

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm sim -- --games 1000
pnpm exec playwright install chromium
pnpm test:e2e
pnpm check:drand
pnpm verify:dice path/to/downloaded-proof.json
```

Browser tests use the local Worker and four isolated browser contexts; the drand
integration requires its public relay to be reachable. `check:drand` waits for a
real future round and writes evidence under the ignored `.local/` directory.
CI runs the deterministic/browser flows with `--grep-invert '@live'`; the tagged
live integration is run explicitly during release verification.
Set `POLYTOUR_BASE_URL` to a branch Preview URL to run
`pnpm test:e2e e2e/room-flow.spec.ts` against the deployed Worker. The UI regression
fixture in `client-flow.spec.ts` requires the local Vite development server.

## Prototype boundaries

The supplied first-city and Tokyo building costs and 200 k resort price are
implemented. Intermediate prices, rents, cards and festival behavior are still
prototype rules; exact reference parity and balance need further playtesting.
Accounts, matchmaking, rankings, audio and premium artwork remain planned.
The scene uses original procedural geometry and an accessible light board when
WebGL is unavailable. Mobile layout is tested in Chromium emulation; 60 fps on a
physical mid-range phone is not yet established.

Feature branches have isolated Worker Preview storage. Production deploys from
`main`; see the architecture document before deploying.

| Doc | What's in it |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Working rules for AI-assisted development in this repo |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Cloudflare system design, Durable Objects, storage, auth |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Libraries picked, the reasons, and what we rejected |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Playable rules v0.2, board, economy, win conditions, engine contract |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | WebSocket messages and game events |
| [docs/ANIMATION.md](docs/ANIMATION.md) | Art direction, animation pipeline, signature moments, perf budgets |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased build plan |
| [docs/RANDOMNESS.md](docs/RANDOMNESS.md) | Future commitments, uniform dice, verification and LavaRand comparison |
| [docs/REFERENCE_PARITY.md](docs/REFERENCE_PARITY.md) | Captured reference values and provisional economy |
| [docs/PLAYABLE_CHECKPOINT.md](docs/PLAYABLE_CHECKPOINT.md) | Verified features, simulator evidence and remaining work |
| [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md) | Product and visual direction for the playable client |
