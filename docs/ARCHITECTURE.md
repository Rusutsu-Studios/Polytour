# Architecture

## Implemented prototype boundary

The first playable slice uses a Worker and one SQLite-backed GameRoom per private
four-seat match. It stores state, events, proof receipts, commands and timers in
that room. Create/join issues a cryptographically random seat capability; only its
hash is stored. The WebSocket sends the token in `Sec-WebSocket-Protocol`, never
the URL. The client keeps it in sessionStorage, so refresh restores its seat in
that browser session. Accounts, Turnstile, signed cookies, D1 results and R2 replay
archives below remain the planned launch architecture rather than implemented auth.

Persisted alarms drive bots, decision deadlines, disconnect grace, real-time match
expiry. New-room rolls resolve immediately through server Web Crypto, without a
network fetch. Legacy drand-round alarms remain supported: a saved commitment
survives retry/reconnect and keeps its original source. See [RANDOMNESS.md](RANDOMNESS.md).
State version1 and rules version2 are pinned for this first playable schema;
unknown saved versions are rejected rather than loaded under changed rules.

The React client lazy-loads the Three.js/R3F board and uses a Director to advance
the rendered state separately from authoritative state. Original procedural
geometry avoids an external asset dependency. No production deploy is implied by
local verification.

Polytour is one Cloudflare Worker that serves the web client, an HTTP API, and
WebSocket upgrades. Each live match is a `GameRoom` Durable Object: a single-threaded,
strongly consistent actor that owns the game state, the players' sockets, and the
turn timers. Everything that outlives a match (accounts, results, ratings) goes to D1.

## System overview

```mermaid
flowchart LR
  subgraph Browser
    UI[React UI + R3F scene]
    NET[partysocket client]
  end

  subgraph Cloudflare
    W[Worker<br/>Hono router + static assets]
    MM[(Matchmaker DO<br/>one per queue)]
    GR[(GameRoom DO<br/>one per match<br/>SQLite + alarms)]
    D1[(D1<br/>users, matches, ratings)]
    R2[(R2<br/>replays, avatars)]
    AE[(Analytics Engine<br/>telemetry)]
  end

  UI -->|GET /, /assets/*| W
  UI -->|/api/*| W
  NET -->|WS /ws/room/:code| W --> GR
  NET -->|WS /ws/queue/:mode| W --> MM
  MM -->|assigns room code| GR
  W --> D1
  GR -->|match end: results| D1
  GR -->|match end: event log| R2
  GR --> AE
```

## Cloudflare products and why

| Product | Role in Polytour | Why this one |
| --- | --- | --- |
| **Workers + Static Assets** | Serves the SPA, `/api/*`, and WS upgrades. One deploy. | Static asset requests are free and globally cached; SPA fallback via `not_found_handling: "single-page-application"`. |
| **Durable Objects (SQLite)** | `GameRoom` per match, `Matchmaker` per queue. | Exactly the "coordination atom" pattern: single-threaded, strongly consistent state + WebSockets in one place. |
| **DO WebSocket Hibernation** | All player connections. | Turn-based games are idle most of the time; hibernation keeps sockets open while the DO is evicted, so idle rooms cost almost nothing. |
| **DO Alarms** | Turn deadlines, disconnect grace, bot moves, room cleanup. | Durable timers that survive eviction; `setTimeout` would pin the DO in memory. |
| **D1** | Users, match history, ratings, cosmetics/inventory. | Relational queries across matches (leaderboards, profile history). |
| **R2** | Compressed match event logs (replays), user avatars, oversized assets. | Cheap blob storage, no egress fees. |
| **Analytics Engine** | Game telemetry: turn durations, abandon rate, money curves, win condition distribution. | High-cardinality events written straight from the DO; queryable with SQL for balancing. |
| **Turnstile** | Guest account creation and room creation. | Stops bot farms without CAPTCHAs for real users. |
| **Workers Rate Limiting binding** | `/api/*` and WS connect attempts. | Cheap abuse control at the edge. |

Not needed at launch: KV (no read-heavy global config yet), Queues (post-match work
fits in the DO's alarm), Workflows, Workers AI (bots are heuristic and run in the DO).
Add them only when a concrete requirement appears.

## Routing

`wrangler.jsonc` (sketch — fill in at scaffold time):

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "polytour",
  "main": "./src/worker/index.ts",
  "compatibility_date": "<scaffold date>",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/ws/*"]
  },
  "durable_objects": {
    "bindings": [
      { "name": "GAME_ROOM", "class_name": "GameRoom" },
      { "name": "MATCHMAKER", "class_name": "Matchmaker" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameRoom", "Matchmaker"] }],
  "d1_databases": [{ "binding": "DB", "database_name": "polytour", "database_id": "<id>" }],
  "r2_buckets": [{ "binding": "REPLAYS", "bucket_name": "polytour-replays" }],
  "analytics_engine_datasets": [{ "binding": "TELEMETRY", "dataset": "polytour_events" }],
  "observability": { "enabled": true }
}
```

| Route | Handler |
| --- | --- |
| `GET /*` (non-API) | Static assets / SPA shell (Worker not invoked) |
| `POST /api/auth/guest` | Verify Turnstile, create guest user in D1, set signed session cookie |
| `GET /api/me` | Current user profile |
| `POST /api/rooms` | Create private room: generate a 6-char code, call `GAME_ROOM.getByName(code).init()`; on "already initialized", retry with a new code → returns the code |
| `GET /api/leaderboard` | Top ratings from D1 (cache with Workers Cache) |
| `GET /api/matches/:id/replay` | Stream event log from R2 |
| `GET /ws/room/:code` | Check `Origin`, authenticate cookie → `env.GAME_ROOM.getByName(code).fetch(req)` |
| `GET /ws/queue/:mode` | Check `Origin`, authenticate → `env.MATCHMAKER.getByName(mode).fetch(req)` |

The Worker authenticates **before** forwarding a WS upgrade and passes the verified
`userId` to the DO in a header it sets itself (strip any incoming copy of that header first).
It also rejects upgrades whose `Origin` header is not one of our own origins (403);
browsers don't apply CORS to WebSockets, so this is the defense against cross-site
WebSocket hijacking on top of `SameSite=Lax`.

## GameRoom Durable Object

### Lifecycle

```mermaid
stateDiagram-v2
  [*] --> Lobby: init() from POST /api/rooms or the Matchmaker
  Lobby --> Playing: host starts (2–4 seats filled, bots fill empties)
  Playing --> Playing: intents → engine → events
  Playing --> Finished: win condition or round limit
  Finished --> Archived: results → D1, log → R2
  Archived --> [*]: alarm deletes storage after grace period
```

Connecting never creates a room. A WebSocket upgrade for a code whose DO has not
been initialized (never created, or already cleaned up) is rejected, so guessing
codes can't spawn rooms. `init()` refuses to run twice, which also turns a room-code
collision into a retry with a fresh code.

### Storage (DO SQLite)

```sql
CREATE TABLE IF NOT EXISTS meta    (k TEXT PRIMARY KEY, v TEXT NOT NULL);         -- phase, roomCode, createdAt, config
CREATE TABLE IF NOT EXISTS seats   (seat INTEGER PRIMARY KEY, user_id TEXT, is_bot INTEGER);
CREATE TABLE IF NOT EXISTS state   (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events  (seq INTEGER PRIMARY KEY, json TEXT NOT NULL); -- append-only log
CREATE TABLE IF NOT EXISTS timers  (kind TEXT PRIMARY KEY, fire_at INTEGER NOT NULL, payload TEXT);
```

- `state` holds the full engine state (including PRNG state) as of `seq`.
- `events` is the append-only log. It powers reconnect catch-up and replays.
- Presence is **not** stored: a seat is online iff `ctx.getWebSockets("seat:<n>")`
  returns an open socket. A persisted `connected` flag would go stale whenever the
  runtime drops sockets without a close handler running (e.g. a deploy restart).
- `timers` works around "one alarm per DO": after any change, set the alarm to
  `MIN(fire_at)`. The `alarm()` handler processes every due timer, then re-arms.

### Handling an intent

```mermaid
sequenceDiagram
  participant C as Client (seat 2)
  participant DO as GameRoom DO
  participant E as shared/engine
  participant S as DO SQLite
  participant All as All sockets

  C->>DO: {type:"intent", id, atSeq, action:{type:"roll"}}
  DO->>DO: Zod-parse, check synced + seat from ws attachment
  alt atSeq ≠ current seq
    DO-->>C: {type:"reject", id, reason:"stale"}
  else current
    DO->>E: applyAction(state, seat, action, { now })
    alt illegal
      E-->>DO: error
      DO-->>C: {type:"reject", id, reason}
    else legal
      E-->>DO: { state', events[] }
      DO->>S: UPDATE state, INSERT events, UPSERT decision timer = state'.pending.deadline (no await between)
      DO->>DO: setAlarm(min fire_at)
      DO-->>C: {type:"ack", id}
      DO-->>All: {type:"events", fromSeq, toSeq, events}
    end
  end
```

Per-player redaction: events are broadcast identically to everyone *unless* an
event carries private data (none planned in v1 — card draws are public). If hidden
info is added later, redact per socket using the seat in the attachment.

### Timers and disconnects

| Timer | Fires | Effect |
| --- | --- | --- |
| `decision` | `state.pending.deadline` (computed by the engine) | `applyTimeout` applies the rule-defined default for a human seat (auto-roll, decline purchase, auto-sell cheapest to cover debt). |
| `grace:<seat>` | 60 s after socket close | Seat becomes a bot seat (`botAction`, medium) until the player reconnects. |
| `bot` | 0.8–1.5 s after a bot seat's decision opens | Bot picks an action via `botAction`; bot seats never hit the `decision` timeout. |
| `cleanup` | 10 min after `Finished` | `deleteAll()` storage. |

The DO never computes deadlines itself: the engine sets
`deadline = now + decisionSeconds + animationBudget(events)` and puts it in the
events and in `state.pending`, so the countdown clients see and the alarm always
agree. `animationBudget` and the per-event animation durations live together in
`shared/board/timing.ts`: the budget is each event's 1× animation duration plus a
fixed slack (e.g. 20%), so a slow animation never eats a player's decision time and
the server and the client Director can't drift apart.

### Reconnect

The client keeps `lastSeq`. On connect it sends `{type:"sync", lastSeq}`. The DO
always answers with `welcome` first (protocol version, seat, current `seq`), then:
- If `lastSeq` is within the last 500 events → `welcome.snapshot = null`, followed by
  `events WHERE seq > lastSeq`.
- Otherwise → `welcome` carries a full snapshot; the client snaps `viewState` to it
  (no animation).

### Deploys and games in progress

Every deploy restarts every Durable Object and drops all WebSockets; no Cloudflare
setting prevents it. A deploy must cost players a 1–2 s "reconnecting…", never the
game:

- Nothing lives only in memory: state, event log, and timers are in SQLite (persist
  first, then broadcast), and the alarm survives the restart.
- Clients reconnect on their own and resync through `welcome` + `lastSeq`; a
  protocol mismatch reloads the page ([PROTOCOL.md → Versioning](PROTOCOL.md#versioning)).
- The 60 s `grace:<seat>` timer is far longer than a deploy reconnect, so a deploy
  never hands a seat to a bot.
- **New code must load games saved by the previous version.** `meta` stores a
  `stateVersion`; on load the DO migrates older state JSON step by step before
  handing it to the engine. Never ship a state shape change without its migration
  and a test that loads the previous shape.
- **Rule and balance changes never rewrite a match in progress.** The game state
  records the `rulesVersion` it was created with and the engine honors it until the
  game ends (matches last ~20 minutes, so old rules only need to survive briefly).
- A DO class lifecycle change (new, renamed, or deleted class in `migrations`) cannot
  be rolled back or deployed gradually: ship it on its own.

## Matchmaker Durable Object

One instance per queue, e.g. `getByName("quick-4p")`. Holds hibernatable sockets of
waiting players, groups them by rating band (widening over time via a timer), then:
1. Generates a room code, calls `env.GAME_ROOM.getByName(code).init(seats, config)` over RPC
   (retrying with a new code if that room is already initialized).
2. Sends each waiting socket `{type:"matched", roomCode}` and closes it.

If a single queue ever becomes a bottleneck, shard by region or rating band
(`quick-4p:eu`, `quick-4p:na`). Pass a `locationHint` when creating rooms for a
regional queue so the DO lives near its players.

## Auth

- **v1: guest-first.** `POST /api/auth/guest` (Turnstile-protected) creates a user
  row and sets an `HttpOnly; Secure; SameSite=Lax` cookie holding a signed session
  token (HMAC via Web Crypto, secret from `wrangler secret`). No passwords stored.
- **v2: account linking.** OAuth (Google, Discord, Apple) to upgrade a guest to a
  permanent account (Better Auth with the D1 adapter, or Arctic for bare OAuth).
- WebSocket auth rides on the same cookie (sent on the upgrade request, same origin).

## D1 schema (initial)

```sql
users         (id TEXT PK, display_name TEXT, avatar TEXT, created_at INTEGER, is_guest INTEGER)
matches       (id TEXT PK, room_code TEXT, mode TEXT, started_at INTEGER, ended_at INTEGER,
               win_condition TEXT, rounds INTEGER, replay_key TEXT)
match_players (match_id TEXT, user_id TEXT, seat INTEGER, placement INTEGER,
               final_net_worth INTEGER, rating_delta INTEGER, PRIMARY KEY (match_id, seat))
ratings       (user_id TEXT, mode TEXT, rating INTEGER, games INTEGER, PRIMARY KEY (user_id, mode))
```

Managed with Drizzle schema + `wrangler d1 migrations`. Leaderboard queries are
cached for 60 s with Workers Cache.

## Security & abuse checklist

- Validate every inbound message with Zod; drop sockets that send malformed frames repeatedly.
- Check `Origin` on every WebSocket upgrade; reject upgrades to uninitialized rooms.
- Cap message size (e.g. 4 KB) and rate (e.g. 20 msgs/s per socket) in the DO.
- Chat: length limit, rate limit, profanity filter, per-player mute. Emotes preferred over free text for quick-match.
- Room codes: 6 chars from an unambiguous alphabet (no 0/O/1/I), ~1B combinations; rate-limit join attempts.
- Never expose the PRNG seed, other players' session tokens, or internal user ids beyond what the UI needs.

## Environments and deploys

One production Worker, `polytour` (D1 `polytour`, R2 `polytour-replays`), served on
`*.workers.dev`. Workers Builds deploys it on every push to `main`. Pushes that only
touch docs or Markdown are excluded (watch-path excludes `docs/*` and `*.md`), since
every deploy restarts the running games (see
[Deploys and games in progress](#deploys-and-games-in-progress)). Build: `pnpm run build`,
deploy: `npx wrangler deploy`, build caching on; configured under the Worker's
**Settings → Build** in the dashboard.

Every other branch gets a **Worker Preview**: Workers Builds runs `pnpm run build` then
`npx wrangler preview`, which creates or updates a Preview named after the branch with
its own public URL. Previews do not inherit production bindings; they use the
`previews` block in `wrangler.jsonc`:

- Each Preview gets its own Durable Object namespaces and storage, so a branch never
  touches production games. State persists across pushes to the same branch and is
  deleted with the Preview.
- D1 and R2 are **not bound** in Previews yet (`env.DB` / `env.REPLAYS` are undefined
  there). Before code on a branch reads them, create preview-only resources and bind
  them under `previews` (ROADMAP Phase 4). Never point a Preview at production data.
- Preview URLs are public; protect them with Cloudflare Access if that ever matters.

- The Worker lives in the Rusutsu Studios account, pinned by `account_id` in
  `wrangler.jsonc` so no command can reach another account. Locally, create a
  Wrangler auth profile and bind it to the repo directory
  (`wrangler auth create polytour`, then `wrangler auth activate polytour <repo>`),
  which leaves other Cloudflare logins untouched.
- Workers Builds and CI take pnpm from `packageManager` in `package.json` and Node
  from `.node-version`. Bump them there, not in the dashboard or the workflow.
- There is no shared staging environment: Worker Previews cover per-branch testing. If
  one is ever added as an `env.staging` block, remember that with the Cloudflare Vite
  plugin the environment is chosen at **build** time (`CLOUDFLARE_ENV=staging`), not
  with `wrangler deploy --env`.

## Cost model (rough)

A match is ~20 minutes, 4 sockets, a few hundred messages. With hibernation the DO
is billed for active wall-clock time handling messages and alarms, not the whole 20
minutes. Static assets are free. Check current pricing at
https://developers.cloudflare.com/durable-objects/platform/pricing/ before launch and
run a load test (`tools/sim` can drive fake clients) to measure real cost per match.
