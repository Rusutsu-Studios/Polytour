# Polytour — CLAUDE.md

Polytour is a web-first, real-time multiplayer property-trading board game in the
spirit of Business Tour / Modoo Marble (Monopoly-like, 2–4 players, ~20-minute
matches). It runs entirely on Cloudflare: a Worker serves the SPA and API, and
one Durable Object per match runs the authoritative game. The visual bar is high:
a stylized 3D board with juicy, choreographed animations.

> **Status: Phase 0 scaffold.** The React client, Worker, SQLite Durable Object
> bindings, and local integration tests exist. The deterministic rules engine is the
> next implementation phase. When you change commands or paths, update this file in
> the same change.

## Read before working

| Doc | When |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Any backend, networking, or data work |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Before adding a dependency |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Any rules/engine/balance work |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | Any client↔server message change |
| [docs/ANIMATION.md](docs/ANIMATION.md) | Any rendering, VFX, sound, or UI motion work |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Picking the next task |

## Stack (short version)

- **Runtime:** Cloudflare Workers + Workers Static Assets, Durable Objects (SQLite
  backend, WebSocket Hibernation API, alarms), D1, R2, Analytics Engine, Turnstile.
- **Server code:** TypeScript, Hono (HTTP routing), Zod (message validation), Drizzle (D1).
- **Client:** React 19 + Vite + `@cloudflare/vite-plugin`, React Three Fiber + drei +
  postprocessing (3D board), GSAP (3D/scene choreography), Motion (DOM/UI animation),
  Tailwind CSS v4, Zustand, Howler.js, `partysocket` (reconnecting WebSocket).
- **Tooling:** pnpm, Biome, Vitest 4 + `@cloudflare/vitest-plugin`, fast-check, Playwright.

## Layout (planned — single package, one Worker, one deploy)

```
src/
  shared/     # Pure TS, no DOM, no Workers APIs. Imported by both sides.
    engine/   # Rules engine: applyAction(state, seat, action, { now }) -> { state, events }; applyEvent reducer
    board/    # Board definition + economy config (data, not code)
    protocol/ # Zod schemas + types for every WS/HTTP message
  worker/     # Worker entry (Hono), GameRoom + Matchmaker Durable Objects, D1 access
  client/     # React app: ui/ (DOM HUD, menus), scene/ (R3F), director/ (animation queue), net/
public/assets # Compressed glTF, KTX2 textures, audio sprites, fonts
tools/sim/    # Headless bot-vs-bot simulator for balancing
migrations/   # D1 SQL migrations
```

Import rules: `shared/` imports nothing from `client/` or `worker/`. `client/` and
`worker/` never import each other; they talk only through `shared/protocol`.

## Commands

```bash
pnpm dev            # Vite dev server; Worker + DOs run in workerd via the Cloudflare Vite plugin
pnpm test           # Vitest (engine in Node, worker/DO tests in workerd)
pnpm typecheck      # tsc -b
pnpm lint           # biome check .
pnpm build          # vite build (client + worker)
pnpm run deploy     # build + wrangler deploy (bare `pnpm deploy` is a pnpm builtin)
pnpm cf-typegen     # wrangler types — rerun after any wrangler.jsonc change
```

`pnpm sim` and `pnpm db:migrate:local` are added with the rules engine and D1
schema, respectively; do not imply that either exists before its phase.

## Golden rules (architecture)

1. **Server-authoritative.** Clients send *intents*; the GameRoom DO validates them
   with the engine and broadcasts resulting *events*. Never trust client-side money,
   dice, positions, or turn order.
2. **The engine is pure and deterministic.** `shared/engine` has no I/O, no
   `Date.now()`, no `Math.random()`. Randomness comes from a seeded PRNG whose state
   lives in the game state; time is passed in as input. Same inputs → same outputs.
3. **The RNG seed never leaves the server.** Clients receive dice results and card
   draws as events, never the seed or the deck order.
4. **Events drive animation; snapshots drive recovery.** Clients animate the event
   stream in order. On join/reconnect they get a snapshot and snap the view to it.
   Public state only ever changes through the shared reducer `applyEvent`, on both
   server and client. Rendering code must never mutate game state.
5. **Every rule change gets an engine test.** Invariants (money conservation as
   player cash + bank ledger, turn progression, termination, events reproduce the
   public state) are property-tested with fast-check.

## Cloudflare rules

- One `GameRoom` DO per match, addressed with `getByName(roomCode)`. Never a single
  global DO for games.
- Use the **WebSocket Hibernation API** in DOs: `this.ctx.acceptWebSocket(server, tags)`
  plus `webSocketMessage` / `webSocketClose` / `webSocketError` handlers. Never
  `server.accept()` or `addEventListener` inside a DO.
- Per-connection identity (playerId, seat) goes in `ws.serializeAttachment()` (≤16 KB);
  anything else must be reloaded from SQLite after hibernation. The constructor runs
  on every wake-up — keep it cheap (schema setup inside `blockConcurrencyWhile` only).
  Presence comes from `ctx.getWebSockets(tag)`, never from a stored flag.
- Connecting never creates a room: only `init()` (from `POST /api/rooms` or the
  Matchmaker) does. The Worker checks `Origin` before forwarding any WS upgrade.
- **No `setTimeout`/`setInterval` in DOs** (they block hibernation). All timers
  (decision deadline, disconnect grace, bot think time) go in a `timers` SQLite table;
  the single DO alarm is always set to the earliest `fire_at`. Decision deadlines are
  computed by the engine, never by the DO.
- Persist first, then broadcast. Write the new state + event log rows in one
  synchronous `sql.exec` sequence (no `await` between related writes).
- SQLite-backed DO classes only (`new_sqlite_classes` in migrations). DO migrations
  in `wrangler.jsonc` are append-only — never edit or remove a shipped tag.
- D1 holds cross-match data (users, match results, ratings). Game-in-progress state
  lives only in the DO.
- Every deploy restarts all DOs mid-game. New code must load state saved by the
  previous version (`stateVersion` migration) and never change the rules of a match
  already running (`rulesVersion`). See ARCHITECTURE.md → Deploys and games in progress.
- The Rusutsu Studios account is pinned by `account_id` in `wrangler.jsonc`; locally,
  use the `polytour` Wrangler auth profile. Workers Builds deploys production on every
  push to `main`; there is no staging environment yet.
- Secrets via `wrangler secret put`; local values in `.dev.vars` (gitignored).
- Check current Cloudflare docs before relying on limits, pricing, or compat flags.
  Set `compatibility_date` to the scaffold date; bump deliberately.

## Client & animation rules

- Two animation systems with a hard boundary: **GSAP** for anything inside the R3F
  scene (camera, pawns, dice, buildings, particles) and for sequencing; **Motion** for
  DOM UI (HUD, dialogs, menus). Don't mix them on the same element.
- All game-event animation goes through the **Director** (`client/director`): an
  ordered queue of `event → async handler` that returns when the animation finishes.
  Components don't start game animations on their own.
- Keep two stores: `serverState` (latest authoritative) and `viewState` (what the
  player has seen so far). The Director advances `viewState` as each event finishes.
- Support speed multiplier (1×/1.5×/2×, applied to GSAP *and* Motion durations) and
  "skip" (fast-forward backlog). Respect `prefers-reduced-motion`: no camera shake,
  no slow-mo, camera cuts instead of sweeps.
- Never allocate in `useFrame`. Reuse vectors/quaternions; use instancing for
  repeated meshes (tiles, houses, coins).
- 3D assets: glTF + Meshopt/Draco + KTX2 textures, generated components via gltfjsx.
  Every static asset file must stay under 25 MiB (Workers Static Assets limit).
- Lazy-load the 3D scene and physics/audio chunks; the lobby must load fast.

## Code conventions

- TypeScript `strict`, no `any` (use `unknown` + Zod parse at boundaries).
- Discriminated unions for actions/events/messages (`type` field), exhaustive
  `switch` with a `never` check.
- Money is integer units (no floats). Economy coefficients are integer percentages
  evaluated with integer math (`1.4 * 90` is `125.99999999999999` in JS); fractions
  of money round up for charges and down for payouts. Tile indices are `0..31`.
- Names: `PascalCase` components/classes, `camelCase` functions, `SCREAMING_SNAKE`
  constants, kebab-case filenames except React components (`PascalCase.tsx`).
- Game tuning numbers live in `shared/board/*.ts` config, never inline in logic.

## Verification before calling something done

- `pnpm typecheck && pnpm lint && pnpm test` pass.
- Engine/rules change → engine tests + a quick `pnpm sim` run to catch balance/termination regressions.
- DO/protocol change → a `@cloudflare/vitest-plugin` test covering the message flow
  (connect → intent → broadcast, reconnect with `lastSeq`, alarm firing).
- Visual change → run `pnpm dev` and check it in the browser at desktop and phone
  width; check the FPS overlay (`?debug=1`) stays at 60 on the target device tier.

## Don'ts

- Don't use "Monopoly", Hasbro, Business Tour, or other trademarked names/art in the
  product, assets, or store listings. Mechanics are fine; branding is not.
- Don't add a dependency that duplicates one in the stack table without updating
  [docs/TECH_STACK.md](docs/TECH_STACK.md) with the reason.
- Don't put game logic in React components or in the Worker/DO glue — it belongs in `shared/engine`.
