# Polytour - AGENTS.md

This file is the one set of project instructions for every coding agent: Codex
reads it directly, and Claude Code reads it through the `@AGENTS.md` import in
[CLAUDE.md](CLAUDE.md). Put every rule here. CLAUDE.md holds only that import, and
CI fails if the import is missing.

Polytour is a web-first, real-time multiplayer property-trading board game in the
spirit of Business Tour / Modoo Marble (2–4 player rooms, configurable 20/60/120-minute
limits). The current target is desktop browsers with mouse and keyboard; mobile
support is optional. It runs entirely on Cloudflare: a Worker serves the SPA and API, and
one Durable Object per match runs the authoritative game. The visual bar is high:
a stylized 3D board with juicy, choreographed animations.

> **Status: first playable prototype.** Shared rules, 2–4 player private rooms
> with a transferable leader, a waiting room and players sharing one screen,
> server bots, persistence/reconnection, a Three.js board, and immediate server
> Web Crypto dice exist. Drand remains for saved-room compatibility only in the UI.
> The default is 2 M cash, 400 k salary, 3 festivals, line/triple wins (four-beach win optional, off) and
> 120 minutes. New rooms (rules version 10) use the reference economy: its rent
> grid laid side by side on the board, additive rent modifiers up to ×10, a paid
> championship, a retained island Escape card, a reworked 36-card Chance deck (half bad
> cards), Hotels that cannot be bought out and no Landmark. Festivals are
> cities only; saved version-4/5/6 rooms keep resort festivals. World Tour
> reaches free properties and the traveller's own (version 5: own only when none
> is free). Four resorts pay 200 k rent, and a bought-out city can be built on
> at once. Two houses
> before a first completed lap, three after; the Hotel follows on a later
> visit to a three-house city. Direct
> hotels are an explicit custom exception; saved version-2/3 rooms keep their original board and the
> prototype economy. Keep these instructions current when changing commands or
> paths.

## Read before working

| Doc | When |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Any backend, networking, or data work |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Before adding a dependency |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Any rules/engine/balance work |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | Any client↔server message change |
| [docs/ANIMATION.md](docs/ANIMATION.md) | Any rendering, VFX, sound, or UI motion work |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Picking the next task |
| [docs/RELEASING.md](docs/RELEASING.md), [CHANGELOG.md](CHANGELOG.md) | Application version, release preparation or milestone planning |
| [docs/RANDOMNESS.md](docs/RANDOMNESS.md) | Dice, entropy, commitments and proof verification |
| [docs/REFERENCE_PARITY.md](docs/REFERENCE_PARITY.md) | Confirmed values versus provisional balance |

## Stack (short version)

- **Runtime:** Cloudflare Workers + Workers Static Assets, Durable Objects (SQLite
  backend, WebSocket Hibernation API, alarms), D1, R2, Analytics Engine, Turnstile.
- **Server code:** TypeScript, Hono (HTTP routing), Zod (message validation), Drizzle (D1).
- **Client:** React 19 + Vite + `@cloudflare/vite-plugin`, React Three Fiber + drei +
  postprocessing (3D board), GSAP (3D/scene choreography), Motion (DOM/UI animation),
  Tailwind CSS v4, Zustand, Howler.js, `partysocket` (reconnecting WebSocket).
- **Tooling:** pnpm, Biome, Vitest 4 + `@cloudflare/vitest-plugin`, fast-check, Playwright.

The prototype uses Three.js/R3F, GSAP, Motion, ordinary CSS, React state, and a
small reconnecting socket adapter. Drei, postprocessing, Tailwind, Zustand,
Howler and partysocket remain planned; see TECH_STACK.md.

## Layout (planned - single package, one Worker, one deploy)

```
src/
  shared/     # Pure TS, no DOM, no Workers APIs. Imported by both sides.
    engine/   # Rules engine: applyAction(state, seat, action, EngineContext) -> { state, events }; applyEvent reducer
    board/    # Board definition + economy config (data, not code)
    protocol/ # Zod schemas + types for every WS/HTTP message
  worker/     # Worker entry (Hono), GameRoom + Matchmaker Durable Objects, D1 access
  client/     # React app: ui/ (DOM HUD, menus), scene/ (R3F), director/ (animation queue), net/
public/assets # Compressed glTF, KTX2 textures, audio sprites, fonts
tools/sim/    # Headless bot-vs-bot simulator for balancing
tools/ci/     # CI checks: bundle budgets, wrangler.jsonc guard (run with Node, no build step)
e2e/          # Playwright tests against the production build
test/         # Worker/DO integration tests (workerd)
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
pnpm cf-typegen     # wrangler types - rerun after any wrangler.jsonc change
pnpm test:e2e       # desktop UI plus production Worker/socket flows
                    # first run: pnpm exec playwright install chromium
pnpm check:bundle   # after `vite build`: lobby JS budget, asset and Worker size limits
pnpm check:wrangler # DO migrations append-only vs origin/main, SQLite-only, Previews isolated
pnpm check:version # package version/changelog agreement; --tag vX.Y.Z; --base <git-ref>
pnpm test:version  # focused release-tooling tests
pnpm check:fragments # validate changelog.d/ fragments; --base <git-ref> also checks a PR's notes
pnpm release:prepare # release only: fold changelog.d/ fragments into CHANGELOG.md and bump the version
pnpm version:bump patch # low-level manual bump; releases normally use release:prepare
pnpm sim -- --games 1000 # deterministic bot simulations (--players 2|3|4, default 4;
                    # --rules reference|prototype, default reference; --rounds N, default 20)
pnpm check:drand    # live future-round verification; local proof evidence
pnpm verify:dice path/to/proof.json # independent beacon/dice verification
```

`pnpm db:migrate:local` remains planned with the D1 schema. Simulation and dice
verification commands exist; local browser/proof evidence stays gitignored.

## Golden rules (architecture)

1. **Server-authoritative.** Clients send *intents*; the GameRoom DO validates them
   with the engine and broadcasts resulting *events*. Never trust client-side money,
   dice, positions, or turn order.
2. **The engine is pure and deterministic.** `shared/engine` has no I/O, no
   `Date.now()`, no `Math.random()`. Live dice arrive through `EngineContext.dice`
   from fresh server Web Crypto (or verified legacy drand). Live Chance draws use
   fresh server Web Crypto through `EngineContext.chanceEntropy`, with uniform
   rejection sampling among remaining cards. Live callers must supply Chance
   entropy; seeded tests and simulations stay reproducible. Time is passed in as
   input. Same inputs → same outputs.
3. **The RNG seed never leaves the server.** Clients receive dice results and card
   draws as events, never the seed or the remaining deck. Live Chance and dice
   must not depend on the seeded setup sequence, even if public turn order and
   festivals allow that seed to be inferred. Public drand proofs after beacon
   publication are separate from live Chance entropy.
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
  on every wake-up - keep it cheap: check for existing tables inside
  `blockConcurrencyWhile`; create the schema only in `init()`. Unknown and cleaned-up
  rooms must not recreate tables on lookup, join, socket callbacks or alarms.
  Presence comes from `ctx.getWebSockets(tag)`, never from a stored flag.
- Connecting never creates a room: only `init()` (from `POST /api/rooms` or the
  Matchmaker) does. The Worker checks `Origin` before forwarding any WS upgrade.
- `POST /api/rooms` uses the fixed `room-creation` edge key (120/minute per
  Cloudflare location), then the existing Matchmaker named `room-admission`:
  burst 60, refill 1/second, at most 1,000 admissions per UTC day in one persisted
  record. Never derive allocation keys from IPs, cookies or request headers.
  These gates cover creation attempts only; joins, reconnects and moves keep their
  existing path. Rejections return 429 with `Retry-After` and `no-store`; gate
  failures return 503. Health routes answer in the Worker without a DO lookup.
  Shared budgets constrain allocation but can be exhausted by abusive callers;
  they do not guarantee DDoS resistance or fair admission among players.
- **No `setTimeout`/`setInterval` in DOs** (they block hibernation). All timers
  (decision deadline, disconnect grace, bot think time) go in a `timers` SQLite table;
  the single DO alarm is always set to the earliest `fire_at`. Decision deadlines are
  computed by the engine, never by the DO.
- Persist first, then broadcast. Write the new state + event log rows in one
  synchronous `sql.exec` sequence (no `await` between related writes).
- SQLite-backed DO classes only (`new_sqlite_classes` in migrations). DO migrations
  in `wrangler.jsonc` are append-only - never edit or remove a shipped tag.
- D1 holds cross-match data (users, match results, ratings). Game-in-progress state
  lives only in the DO.
- Every deploy restarts all DOs mid-game. New code must load state saved by the
  previous version (`stateVersion` migration) and never change the rules of a match
  already running (`rulesVersion`). See ARCHITECTURE.md → Deploys and games in progress.
- The Rusutsu Studios account is pinned by `account_id` in `wrangler.jsonc`; locally,
  use the `polytour` Wrangler auth profile. Workers Builds deploys production on every
  push to `main` and a Worker Preview for every other branch. Previews get their own
  DO storage but no D1/R2 yet (`previews` block in `wrangler.jsonc`); never bind a
  Preview to production data.
- Secrets: see **Public repo: secrets** below.
- Check current Cloudflare docs before relying on limits, pricing, or compat flags.
  Set `compatibility_date` to the scaffold date; bump deliberately.

## Public repo: secrets

This repository is public. Everything pushed is readable by anyone, and stays
readable after a later commit deletes it (forks, caches, `refs/pull/*`). That covers
every branch, PR head, commit message, PR body, and review or issue comment.

- Never commit a credential. That means Cloudflare API tokens, `wrangler secret`
  values, session or HMAC signing keys, the Turnstile **secret** key, OAuth client
  secrets, private keys, `.dev.vars` / `.env` files, and Wrangler auth state. Real
  player data, D1 exports, and production replays stay out too.
- Where secrets live: the deployed Worker gets them from `wrangler secret put NAME`,
  local dev from `.dev.vars` (gitignored), and CI from GitHub Actions secrets. When
  you add one, commit only its name with a placeholder value in `.dev.vars.example`,
  then rerun `pnpm cf-typegen`.
- These are public on purpose and fine to commit: `account_id`, the D1
  `database_id`, and bucket, Durable Object, and Worker names in `wrangler.jsonc`.
  They are identifiers, and using them needs an API token. The Turnstile **site**
  key is public too.
- Everything `src/client` imports ships to every browser, and so does any `VITE_*`
  variable. Read secrets only from `env` in `src/worker`, never in `src/client` or
  `src/shared`.
- Don't log secrets, session tokens, or raw `Cookie` / `Authorization` headers.
  Workers observability is on, so logs are kept.
- Test fixtures use values that are obviously fake (`test-secret-not-real`), never a
  real token copied from a dashboard.
- Agents never print, paste, or quote a secret value: not in code, commits, PR text,
  comments, or chat. Don't `cat` `.dev.vars` or Wrangler auth files; the tools read
  them themselves.
- The CI `secrets` job runs gitleaks over the full git history and the working tree
  on every PR and every push to `main`. If it flags a false positive, add the
  finding's fingerprint to `.gitleaksignore` with a `#` comment saying why. Never
  allowlist a real secret, a whole file, or a path.
- **If a secret gets committed:** if it is not pushed yet, remove it and fix the
  commit before pushing. If it is pushed, treat it as compromised: revoke or rotate
  it at the provider first, then remove it from the code and tell the maintainers.
  Rewriting history does not undo a leak. Never force-push a shared branch to hide one.

## Client & animation rules

- The board owns the desktop viewport. Four compact player HUDs frame it at the
  corners; the current choice sits near the lower center. Keep history, fairness
  proofs and help behind secondary controls, and show city details on inspection.
- Validate 1280×720, 1440×900 and 1920×1080 desktop layouts. The e2e layout
  checks also cover 2560×1440 and 3840×2160 (`e2e/desktop-sizes.ts`). Mobile is
  best effort and must not force the desktop match into a dashboard or scrolling
  card stack.
- Two animation systems with a hard boundary: **GSAP** for anything inside the R3F
  scene (camera, pawns, dice, buildings, particles) and for sequencing; **Motion** for
  DOM UI (HUD, dialogs, menus). Don't mix them on the same element.
- All game-event animation goes through the **Director** (`client/director`): an
  ordered queue of `event → async handler` that returns when the animation finishes.
  Components don't start game animations on their own.
- Keep two stores: `serverState` (latest authoritative) and `viewState` (what the
  player has seen so far). The Director advances `viewState` as each event finishes.
- Play game-event animations at their normal rate, with automatic catch-up and
  snapshot recovery for delayed views. Respect `prefers-reduced-motion`: no camera
  shake, no slow-mo, camera cuts instead of sweeps.
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
- Use ASCII hyphen-minus (`-`) for minus signs in UI text and formatting, never
  Unicode minus (U+2212).
- Names: `PascalCase` components/classes, `camelCase` functions, `SCREAMING_SNAKE`
  constants, kebab-case filenames except React components (`PascalCase.tsx`).
- Game tuning numbers live in `shared/board/*.ts` config, never inline in logic.
- Commits are authored by a person, never by an agent. An agent records itself
  with a `Co-Authored-By` trailer, so the repository's contributor list stays
  human. Never override `user.name` or `user.email`; the repo config pins them,
  and the `Commit authorship` CI job rejects a pull request that breaks this.

## Verification before calling something done

- Add a changelog fragment to every pull request using the workflow below,
  including documentation-only and maintenance changes.
- `pnpm typecheck && pnpm lint && pnpm test` pass.
- Engine/rules change → engine tests + a quick `pnpm sim` run to catch balance/termination regressions.
- DO/protocol change → a `@cloudflare/vitest-plugin` test covering the message flow
  (connect → intent → broadcast, reconnect with `lastSeq`, alarm firing).
- Visual change → check real browser rendering and gameplay at the three desktop
  sizes above. Review keyboard focus, overlays and reduced motion. A 60 fps desktop
  target requires evidence from the target hardware; emulation does not prove it.
- Worker routing, `wrangler.jsonc`, or app shell change → `pnpm test:e2e`, and
  `pnpm check:wrangler` for `wrangler.jsonc`.

## Application version: required for every pull request

Codex and Claude Code must manage version preparation themselves. Every pull
request, including documentation-only changes, must advance the application
version above its current base. CI enforces this on pull requests and the merge
queue. `package.json` remains the sole source of `APP_VERSION`; do not hardcode a
version in the UI or Worker, and do not change protocol/state/rules counters
unless their own compatibility contract requires it.

Before the final commit or creating/updating a pull request:

1. Add concrete notes for this change under `## [Unreleased]` in `CHANGELOG.md`,
   using `### Added`, `### Changed` or `### Fixed`. Include useful issue or pull
   request references when available. Preserve all dated entries inherited from
   the base; record corrections in the new notes.
2. Fetch the latest base with `git fetch origin main`, then run
   `pnpm version:prepare patch --base origin/main`. Patch is the default for fixes,
   maintenance and documentation; choose `minor` for a feature or substantial
   compatible improvement. Choose `major` only for a deliberate stable launch or
   an incompatible stable public API change. During prototype development,
   breaking prototype changes use `minor` and must be explained in the notes.
3. Review `package.json` and `CHANGELOG.md`, then run
   `pnpm check:version --base origin/main --require-bump`, `pnpm test:version`, and the checks
   required for the change. Include these files in the same pull request.

The preparation command reads the fetched base and defaults to `patch`. It
requires real `Unreleased` notes for a fresh bump and moves them into a dated
release section. It is safe to rerun: when this pull request already has a
prepared version above the base, it keeps that version and folds any additional
`Unreleased` notes into that pull request's existing section. Iterations of the
same open pull request may share its prepared version; every merged pull request
must advance beyond the latest base. If the scope grows, explicitly preparing
`minor` or `major` promotes the prepared section to at least the corresponding
next version of the base without losing its date or notes or downgrading a higher
version. If another pull request makes the prepared version stale, rebase or
merge the latest base, resolve conflicts, and run
preparation and checks again before merging. If targeting another branch, fetch
that branch and pass its remote ref instead of `origin/main`.

Preparation never commits, tags, publishes or deploys. Follow the normal review
workflow; release publication is covered in [docs/RELEASING.md](docs/RELEASING.md).

## CI

`.github/workflows/ci.yml` runs on every pull request, push to `main`, and merge
queue. `verify` is the one check to require: it fails if any job fails.

| Job | What fails it |
| --- | --- |
| `lint` | CLAUDE.md lost `@AGENTS.md`; release version/changelog mismatch or altered dated base history; a PR/merge-queue version that does not exceed its base; a tag that does not match the package version; `biome ci` format/lint errors, including the rules above encoded in `biome.json`: `shared/`↔`client/`↔`worker/` import boundaries, `Math.random` or `Date` in `shared/`, `setTimeout`/`setInterval`/`accept()`/`addEventListener` in `worker/` |
| `typecheck` | `pnpm typecheck`, covering `src/`, `test/`, `e2e/` and `tools/` |
| `test` | `pnpm test:version`, `pnpm test` or the quick bot simulation |
| `build` | `vite build`, `pnpm check:bundle` (job summary shows the sizes), `wrangler deploy --dry-run` |
| `changes` | Decides whether `e2e` runs: skipped only for pull requests that change nothing but `.md` files; a required package-version update also triggers it |
| `e2e` | `pnpm test:e2e`; on failure the Playwright report and traces are uploaded |
| `cloudflare` | `pnpm check:wrangler` against the PR's base commit |
| `secrets` | gitleaks over the full history and the tree |
| `dependency-review` | PRs only: a new dependency or action with a high/critical advisory |
| `authorship` | PRs only: a commit authored or committed by an agent account |

If an architecture rule fires on code that genuinely needs the exception, add a
`// biome-ignore lint/<group>/<rule>: <reason>` comment on that line; don't loosen
`biome.json`. Actions are pinned to commit SHAs; Dependabot bumps them weekly.

## Don'ts

- Don't use "Monopoly", Hasbro, Business Tour, or other trademarked names/art in the
  product, assets, or store listings. Mechanics are fine; branding is not.
- Don't add a dependency that duplicates one in the stack table without updating
  [docs/TECH_STACK.md](docs/TECH_STACK.md) with the reason.
- Don't put game logic in React components or in the Worker/DO glue - it belongs in `shared/engine`.
