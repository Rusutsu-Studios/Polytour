# Prototype Durable Object operations

## Incident - 1 October 2026

The branch Preview's GameRoom logs at 07:19:30 UTC+2 explicitly report
`Exceeded allowed rows written in Durable Objects free tier.` The user-facing
`Unexpected token 'I'` was the client trying to parse the resulting plain-text
`Internal Server Error` as a successful room response.

The screenshot's 9.21k requests, 230 errors and 143.58k SQLite rows written cover
the billing period, not a single day. Those totals alone do not prove a daily
quota breach; the actual error log confirms the write-limit failure.

Prior live browser tests created rooms which could continue running server bots
after their browsers closed: human disconnect grace turned them into bot matches
with a move every 900 ms until the two-hour match deadline. Repeated timer refreshes
also deleted/replaced unchanged rows and reset alarms. This contributed unnecessary
work after tests had ended. CI browser tests use local Workers and do not consume
the Cloudflare account's remote Durable Object quota.

## Corrected lifecycle

- Bot moves, decision timers and randomness retries stop when no OPEN player socket
  remains. A socket in CLOSING state does not keep the game running.
- Disconnect grace runs once per disconnected seat. The original match deadline
  remains durable; an abandoned room finishes once, without a bot catch-up.
- Lobby departure still broadcasts presence without adding move/grace alarms.
  Starting a match grants offline human seats 60 seconds of reconnect grace,
  so a guest who left before the start does not remain an unattended human forever.
- Reconnect resumes the authoritative state and pending work without extending
  decision or match deadlines. Legacy randomness commitments are retained.
- Timer upserts change rows only when their deadline changes. Platform alarms are
  only reset when the next wake changes. Secure dice resolve in the request without
  an additional immediate alarm.
- Ping/pong clock synchronization performs no SQL operations.
- Cleanup closes sockets and deletes room data. Later close callbacks do not write
  orphan grace timers, and subsequent fetch/join returns JSON404. The constructor
  checks for an existing schema; only `init()` creates it. Unknown lookups and
  cleanup callbacks do not create or recreate tables.
- HTTP failures are validated by the client; storage-limit failures get an explicit
  message. Repeated failed upgrades cannot reconnect indefinitely. Duplicate room
  submissions and unconfirmed commands are suppressed before React renders.

Focused local tests measure one unchanged timer refresh with
`SqlStorageCursor.rowsWritten`: the previous DELETE/REPLACE sequence writes five
rows, while the corrected refresh writes zero. This is a measured operation,
not a claim of zero writes per game. State, event history, proof receipts and actual
timer changes still require durable writes.

## Room allocation controls

`POST /api/rooms` applies two server-owned gates before room allocation:

| Gate | Scope and budget |
| --- | --- |
| `ROOM_CREATION_RATE_LIMIT`, fixed key `room-creation` | 120 requests per 60 seconds per Cloudflare location, before body reads or durable storage |
| Existing Matchmaker named `room-admission` | Burst 60, refill 1 admission/second, at most 1,000 admissions per UTC day; one transactional `room-creation-budget` record |

The durable gate runs after Origin and request validation. Only successful
admissions update its record; rejected requests add no per-caller records. An
admitted creation attempt consumes budget even if initialization fails. Up to five
room-code collision retries share that admission. Production and Preview use
separate edge namespaces and Durable Object storage.

Neither gate keys on IP, cookies or request headers, so many hosts behind one LAN
address can create rooms and inventing new identities grants no extra budget.
The gates apply only to creation attempts; joining, reconnecting and game moves
keep their existing path. Denials return JSON 429 with `Retry-After` and
`Cache-Control: no-store` (60 seconds at the edge; refill/day-reset wait at the
durable gate). Gate failures return JSON 503 instead of allocating without admission.

All health routes answer in the Worker without a Durable Object lookup. Unknown
room lookups may wake a GameRoom, but its constructor only checks for existing
tables: `init()` alone creates the schema. Cleanup uses `deleteAll()` and leaves
tables absent through later callbacks, alarms and lookups.

These controls constrain room allocation rather than guaranteeing complete DDoS
resistance or fair admission. Abusive callers can exhaust the shared budget and
deny legitimate new hosts. The [Cloudflare edge counter](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#locality)
is location-local and eventually consistent; it is not global quota accounting.
The durable gate enforces the shared budget across locations, but neither gate
bounds all Worker requests, existing-game writes or account-wide platform usage.

## Free-tier budget and recovery

Cloudflare's [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
lists 100,000 requests/day, 13,000 GB-s/day, 5 million SQLite rows read/day and
100,000 SQLite rows written/day for Free. Deletes and alarm changes also count
toward writes. Free daily allowances reset at 00:00 UTC (02:00 in Zurich on
1 October 2026). A deploy does not replenish consumed quota; Preview namespaces
are isolated storage, but share the account's allowance.

Do complete matches and repeated browser regressions against localhost first.
Remote Preview verification should be a single bounded smoke check with explicitly
closed clients, not repeated complete matches or a load test. Never change the
account's billing plan or delete unrelated/player rooms as incident recovery.
