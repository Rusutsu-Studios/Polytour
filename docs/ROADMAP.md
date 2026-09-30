# Roadmap

Build order is chosen so the riskiest things are proven first: **rules are fun →
multiplayer is solid → it looks amazing → people can find games → launch**. Art never
blocks gameplay; the 3D scene is a consumer of events and can be built in parallel
once the protocol is stable.

## Phase 0 — Scaffold (½ week)

- [ ] `pnpm create cloudflare` React + Vite template, restructure into `src/{shared,worker,client}`
- [ ] `wrangler.jsonc` with GameRoom/Matchmaker DOs (SQLite), D1, R2, Analytics Engine bindings
- [ ] Biome, strict TS, Vitest 4 (+ `@cloudflare/vitest-plugin` project for worker tests)
- [ ] GitHub Actions: typecheck, lint, test on PR; Workers Builds for preview deploys per branch
- [ ] Update CLAUDE.md "Commands" with the real scripts

**Done when:** `pnpm dev` serves a page that opens a WebSocket to a hello-world DO, and CI is green.

## Phase 1 — Rules engine (1–2 weeks)

- [ ] Board + economy config (`shared/board`)
- [ ] `createGame`, `applyAction`, `applyTimeout`, `legalActions` with seeded PRNG
- [ ] All tiles, Chance deck, buyouts, forced selling, bankruptcy, all 5 win conditions
- [ ] Easy/medium heuristic bots
- [ ] fast-check invariants: money conservation, no stuck states, always terminates
- [ ] `tools/sim` with stats output; first balance pass

**Done when:** 10,000 simulated games finish with sane length and win-condition mix.

## Phase 2 — Multiplayer backbone (1–2 weeks)

- [ ] Zod protocol package
- [ ] GameRoom DO: hibernatable sockets, attachments, SQLite state + event log, timers table + alarm
- [ ] Reconnect with `lastSeq`; bot takeover after grace period
- [ ] Private rooms: `POST /api/rooms`, join by code, lobby (seats, bots, start)
- [ ] **Debug 2D board** (plain SVG/DOM) to play full games in 4 browser tabs
- [ ] DO tests: intent flow, reject, reconnect replay, alarm-driven timeout

**Done when:** four people can finish a full game over the internet with refreshes and dropped connections mid-game.

## Phase 3 — 3D board & Director (2–3 weeks)

- [ ] Art direction spike: 1 country + 1 pawn + dice + tile in Blender → glTF pipeline
- [ ] R3F scene: board, tiles (instanced), pawns, buildings per level, camera rig
- [ ] Director queue + `viewState`/`serverState` stores, speed control, catch-up
- [ ] Handlers for every event in [PROTOCOL.md](PROTOCOL.md) (placeholder-quality where needed)
- [ ] Keyframed dice
- [ ] HUD: player cards, money counters, decision cards, countdown rings (Motion)
- [ ] Decide 3D vs 2D for good based on a mid-range phone test (see TECH_STACK.md)

**Done when:** a full game is playable in the 3D client at 60 fps on a mid-range phone.

## Phase 4 — Accounts & matchmaking (1–2 weeks)

- [ ] Guest auth with Turnstile + signed session cookie
- [ ] D1 schema (users, matches, match_players, ratings) with Drizzle migrations
- [ ] Match results written at game end; event log archived to R2
- [ ] Matchmaker DO: quick match 2p/4p, bot backfill after timeout
- [ ] Profile page (history), leaderboard

## Phase 5 — Juice & polish (2–3 weeks, ongoing)

- [ ] Full sound pass (Howler sprites, music bed, ducking)
- [ ] Signature moments from [ANIMATION.md](ANIMATION.md): landmark, bankrupt, game over
- [ ] Physics dice with face remapping (Rapier)
- [ ] Particles, post-processing, quality tiers, reduced-motion mode
- [ ] PWA: manifest, icons, precaching, "update available" flow
- [ ] Experimental dice power gauge (playtest-gated)
- [ ] Emotes

## Phase 6 — Launch readiness (1 week)

- [ ] Rate limits, message size caps, chat filter, abuse reporting
- [ ] Analytics Engine telemetry + a balancing dashboard query set
- [ ] Error tracking (Workers Logs/Traces + client error reporting)
- [ ] Load test: 500 concurrent simulated rooms; measure cost per match
- [ ] Custom domain, OG images, landing page, privacy policy

## Phase 7 — Post-launch

- Ranked mode + seasons, 2v2 teams, spectating, replay viewer (from R2 logs),
  cosmetics (pawn skins, dice skins, board themes), friends & invites, Capacitor app-store build.
