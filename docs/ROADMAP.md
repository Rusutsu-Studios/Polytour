# Roadmap

Build order is chosen so the riskiest things are proven first: **rules are fun →
multiplayer is solid → it looks amazing → people can find games → launch**. Art never
blocks gameplay; the 3D scene is a consumer of events and can be built in parallel
once the protocol is stable.

## First playable checkpoint — October 2026

A vertical slice now joins the rules engine, authoritative private rooms and the
Three.js client. Four friends can join by room code; empty seats can become bots.
The user preset is 2 M / 400 k / 3 festivals / 120 minutes with line and triple
wins, and future drand commitments provide verified uniform dice. Costs at the
first city and Tokyo match supplied captures; the remaining economy is provisional.

The checklist below records implemented parts, not completion of every phase's
acceptance criteria. The user clarified on 1 October 2026 that PC is the priority:
the board fills the desktop viewport, player HUDs sit at its corners and details
open only when requested. Minimum layout target: 1280×720; main review sizes:
1440×900 and 1920×1080. Mobile is best effort, with a dedicated adaptation optional
later. The replacement desktop layout is locally verified at all three sizes,
including a full four-context match, real drand proof export and an independent
visual review with no remaining material defects. The deployed Preview passes
the four production browser scenarios. Target-PC FPS, human group playtest,
exact economy comparison and balance pass
remain to verify. See [PLAYABLE_CHECKPOINT.md](PLAYABLE_CHECKPOINT.md) for dated
results and the distinction between live gameplay and presentation fixtures.

## Phase 0 — Scaffold (½ week)

- [x] `pnpm create cloudflare` React + Vite template, restructure into `src/{shared,worker,client}`
- [x] `wrangler.jsonc` with GameRoom/Matchmaker DOs (SQLite), D1, R2 bindings (Analytics Engine
      deferred to Phase 6: it must first be enabled on the account)
- [x] Biome, strict TS, Vitest 4 (+ `@cloudflare/vitest-plugin` project for worker tests)
- [x] GitHub Actions: typecheck, lint, test on PR
- [x] Cloudflare account (Rusutsu Studios) provisioned: D1 + R2, `account_id` pinned
- [x] First production deploy (`polytour` on `*.workers.dev`)
- [x] Workers Builds connected: push to `main` → production, any other branch → its own
      Worker Preview (see
      [ARCHITECTURE.md → Environments and deploys](ARCHITECTURE.md#environments-and-deploys))
- [x] Update CLAUDE.md "Commands" with the real scripts

**Done when:** `pnpm dev` serves a page that opens a WebSocket to a hello-world DO, and CI is green.

## Phase 1 — Rules engine (1–2 weeks)

- [x] Board + economy config (`shared/board`)
- [x] `createGame`, `applyAction`, `applyTimeout`, `applyEvent`, `legalActions` with seeded PRNG
- [x] All tiles, Chance deck, buyouts, forced selling, bankruptcy, five original win conditions plus real-time expiry
- [x] Easy/medium heuristic bots
- [x] fast-check invariants: money conservation (player cash + bank ledger), no stuck states,
      always terminates, `reduce(applyEvent)` over emitted events reproduces the public state
- [x] `tools/sim` with stats output and a recorded 10,000-game baseline
- [ ] First balance pass (baseline misses round-limit and turn-position targets)

**Done when:** 10,000 simulated games finish with sane length and win-condition mix.

## Phase 2 — Multiplayer backbone (1–2 weeks)

- [x] Zod protocol package
- [x] GameRoom DO: hibernatable sockets, attachments, SQLite state + event log, timers table + alarm
- [x] Reconnect with `lastSeq`; bot takeover after grace period
- [x] Private rooms: `POST /api/rooms`, join by code, lobby (seats, bots, start)
- [x] Accessible DOM board fallback alongside the 3D client; full four-browser game test
- [x] DO tests: intent flow, reject (illegal and `stale`), reconnect replay (always `welcome` first),
      connect to an uninitialized room rejected, alarm-driven timeout
- [ ] Deploy safety: `stateVersion` migration on load, `rulesVersion` in game state, and a test
      that restarts a DO mid-game and checks every client resumes (see
      [ARCHITECTURE.md → Deploys and games in progress](ARCHITECTURE.md#deploys-and-games-in-progress))

**Done when:** four people can finish a full game over the internet with refreshes and dropped connections mid-game.

## Phase 3 — 3D board & Director (2–3 weeks)

- [ ] Art direction spike: 1 country + 1 pawn + dice + tile in Blender → glTF pipeline
- [ ] R3F scene: board, tiles (instanced), pawns, buildings per level, camera rig
- [x] Director queue + `viewState`/`serverState` stores, speed control, catch-up
- [ ] Handlers for every event in [PROTOCOL.md](PROTOCOL.md) (placeholder-quality where needed)
- [x] Keyframed dice
- [x] Initial HUD, money, decision and countdown implementation (before the PC layout replacement)
- [x] PC match composition: viewport-filling board, four compact corner HUDs,
      contextual decisions and closed-by-default journal/proof/help/inspection tools
- [x] Verify mouse/keyboard UI, overlay dismissal, reduced-animation toggle and whole-board
      visibility at 1280×720, 1440×900 and 1920×1080
- [x] Verify 2× speed, real match countdown and active-event skip through a real roll
- [x] Presentation fixtures: building levels 1–5, six purchase choices at 1280×720
      without HUD collisions, and an off-turn debtor's decision (Worker unmodified)
- [x] Confirm the PC replacement against the remote Worker Preview
- [ ] Measure active-animation FPS on a documented desktop PC/GPU; retain Three.js
      without making optional phone support determine the renderer

**Done when:** a full four-seat match is playable in the desktop 3D client at all
three layout targets, essential choices are visible without opening unrelated
tools, and measured performance on the documented target PC meets the chosen
budget. Aiming for 60 fps is a PC target, not an unverified claim or a phone gate.

## Phase 4 — Accounts & matchmaking (1–2 weeks)

- [ ] Guest auth with Turnstile + signed session cookie
- [ ] D1 schema (users, matches, match_players, ratings) with Drizzle migrations
- [ ] Preview-only D1 database (migrated) and R2 bucket bound under `previews` in
      `wrangler.jsonc`, so branch Previews can use `env.DB` / `env.REPLAYS` without
      touching production data
- [ ] Match results written at game end; event log archived to R2
- [ ] Matchmaker DO: quick match 2p/4p, bot backfill after timeout
- [ ] Profile page (history), leaderboard

## Phase 5 — Juice & polish (2–3 weeks, ongoing)

- [ ] Full sound pass (Howler sprites, music bed, ducking)
- [ ] Signature moments from [ANIMATION.md](ANIMATION.md): landmark, bankrupt, game over
- [ ] Physics dice with face remapping (Rapier)
- [ ] Particles, post-processing, quality tiers, reduced-motion mode
- [ ] PWA: manifest, icons, precaching, "update available" flow
- [ ] Cosmetic dice throw controls only (uniform outcomes; weighted power gauge removed by user requirement)
- [ ] Emotes

## Phase 6 — Launch readiness (1 week)

- [ ] Rate limits, message size caps, chat filter, abuse reporting
- [ ] Analytics Engine telemetry + a balancing dashboard query set (enable Analytics Engine in the
      dashboard, then add the `TELEMETRY` binding in `wrangler.jsonc`)
- [ ] Error tracking (Workers Logs/Traces + client error reporting)
- [ ] Load test: 500 concurrent simulated rooms; measure cost per match
- [ ] Custom domain, OG images, landing page, privacy policy

## Phase 7 — Post-launch

- Ranked mode + seasons, 2v2 teams, spectating, replay viewer (from R2 logs),
  cosmetics (pawn skins, dice skins, board themes), friends & invites; optional
  mobile/touch adaptation, PWA installation and Capacitor app-store build.
