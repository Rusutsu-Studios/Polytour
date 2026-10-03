# Polytour

A multiplayer property-strategy board game for PC browsers. Two to four players travel from
French cities to Tokyo, buy land, build, pay rent and compete for collections on an
original Three.js toy board. Cloudflare Workers and one SQLite Durable Object per
room own the rules, persistence and WebSockets.

**Status:** first playable prototype. Play opens a private lobby with three server
bots; friends who enter its code take the bots' places, and a player sitting next to
you can join on the same PC. The room's creator leads it: they add or remove bots,
start the match, can lock the room so newcomers wait for approval, hand a bot's place
to someone who arrived mid-game, bring everyone back to the lobby for another game,
and pass the leader role on. A match starts with two to four players. The default preset is
2 M starting cash, 400 k per lap, three festivals, line/triple collection wins and
a two-hour maximum. Room settings can be adjusted before starting.

French and English are available from the welcome header and the in-game view
settings. Language changes update cards, decisions, board labels and tools while
preserving the current room. Three quick sliders sit beside the welcome board;
the full settings dialog also supports precise values. See [LANGUAGES.md](docs/LANGUAGES.md).

In newly created rooms, the first purchase is limited to land and three houses.
Return to your own three-house city after a completed lap to build its hotel.
The direct-hotel custom option is an explicit exception. Existing rooms preserve
their earlier construction rule; create a fresh room to try the new progression.

The current visual target is a viewport-filling isometric board with four compact
player HUDs at its corners, a contextual action area and discreet menus. Play with
a mouse and keyboard. The minimum desktop target is 1280×720; the main review
sizes are 1440×900 and 1920×1080. Journal, dice information, instructions and tile details
open on demand. Mobile is best effort and is not required for this checkpoint.

Each roll uses fresh server `crypto.getRandomValues` on Cloudflare, with uniform
rejection sampling and no external beacon wait. Clients cannot choose the dice;
there are no paid gameplay advantages. New-room settings no longer offer drand.
Saved drand rooms retain their committed-round verification and proof export.

## Play locally

Use the Node version in `.node-version` and the pnpm version in `package.json`:

```sh
pnpm install
pnpm dev
```

Open the displayed local URL, choose a name, and select a game against bots or
create a room for friends in a desktop browser. Friends must use the same reachable
server; separate browser tabs share saved credentials, so use separate browser profiles/private
windows for different seats. Refreshing resumes your seat. A disconnected human
is temporarily controlled by a bot after 60 seconds and regains control on return.

## Verify

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:bundle
pnpm check:wrangler
pnpm sim -- --games 1000
pnpm exec playwright install chromium
pnpm test:e2e
pnpm check:drand
pnpm verify:dice path/to/downloaded-proof.json
```

Browser tests use the local Worker and four isolated browser contexts. New-room
dice need no external randomness service. The optional legacy drand integration
requires its public relay to be reachable; `check:drand` waits for a real future
round and writes evidence under the ignored `.local/` directory.
CI runs the deterministic/browser flows with `--grep-invert '@live'`; the tagged
live integration is run explicitly during release verification.
Set `POLYTOUR_BASE_URL` to a branch Preview URL to run
`pnpm test:e2e e2e/room-flow.spec.ts` against the deployed Worker. The UI regression
fixture in `client-flow.spec.ts` requires the local Vite development server.

After a desktop UI change, verify all three desktop sizes, a complete four-seat
match, keyboard focus, contextual decisions, overlay dismissal and reduced
motion. Record actual results in `docs/PLAYABLE_CHECKPOINT.md`; previous browser
results do not establish that the replacement layout passes.

## Prototype boundaries

The supplied first-city and Tokyo building costs and 200 k resort price are
implemented. Intermediate prices, rents, cards and festival behavior are still
prototype rules; exact reference parity and balance need further playtesting.
Accounts, matchmaking, rankings, audio and premium artwork remain planned.
The scene uses original procedural geometry and an accessible light board when
WebGL is unavailable. Earlier mobile-emulation checks are historical evidence,
not a requirement for the desktop redesign. A dedicated touch layout or phone
performance pass can be planned later.

Feature branches have isolated Worker Preview storage. Production deploys from
`main`; see the architecture document before deploying.

| Doc | What's in it |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Working rules for AI coding agents (Codex reads it; [CLAUDE.md](CLAUDE.md) imports it for Claude Code) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Cloudflare system design, Durable Objects, storage, auth |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Libraries picked, the reasons, and what we rejected |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | New-room rules v0.3, saved-room compatibility, economy, win conditions, engine contract |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | WebSocket messages and game events |
| [docs/ANIMATION.md](docs/ANIMATION.md) | Art direction, animation pipeline, signature moments, perf budgets |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased build plan |
| [docs/RANDOMNESS.md](docs/RANDOMNESS.md) | Server CSPRNG, uniform dice, seed rationale and legacy drand compatibility |
| [docs/REFERENCE_PARITY.md](docs/REFERENCE_PARITY.md) | Captured reference values and provisional economy |
| [docs/PLAYABLE_CHECKPOINT.md](docs/PLAYABLE_CHECKPOINT.md) | Verified features, simulator evidence and remaining work |
| [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md) | Product and visual direction for the playable client |
