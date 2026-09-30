# First playable checkpoint

Branch: `codex/playable-four-player-mockup`. Rules version: 2; stored-state version:
1. The feature connects the shared engine, private authoritative rooms and the
Three.js client. No production migration or main-branch deployment is part of this
checkpoint.

## What can be played

Four individual seats, friends invited by code or server bots filling open places.
The default is 2 M starting cash, 400 k per lap, three initial festivals, line and
triple wins enabled, and a 120-minute maximum. Host settings freeze at start.
Buy/build/rent/buyout, cards, island, travel, festivals, forced sales, bankruptcy
and standings are available. Refresh resumes the saved seat; disconnection has a
60-second grace period before bot takeover.

The board starts with Roubaix and Saint-Étienne and ends with Osaka and Tokyo.
Resorts cost 200 k and have no buildings. Captured endpoint building costs are
implemented; intermediate costs and rents remain provisional.

## Verification evidence

- TypeScript, Biome, 68 unit/Worker tests and production build pass.
- A complete game runs through four isolated Chromium contexts against the real
  local Worker, including reconnection and matching public state on all seats.
- The same four-browser match and live drand/proof-export scenarios also pass
  against the deployed branch Worker Preview over HTTPS and secure WebSockets.
- Browser checks cover settings, a human dice roll, tile inspection, refresh,
  create/join and desktop/mobile controls. Four browser scenarios are verified,
  including a regression fixture for a debtor deciding during another seat's turn
  and preservation of an unsaved settings draft when another seat joins.
- A live future drand round was committed before publication, signature-verified
  and independently recomputed. Proofs survive sync/replay and can be exported.
- Worker regression tests retain the durable randomness retry through an
  interrupted resolver and eviction, retry the same round after an outage, end a
  timed match while entropy is pending, and reject late human decisions.
- Desktop (1440 px) and phone (390 px) rendering checks show no runtime exceptions
  or horizontal overflow. Phone layout keeps the decision before the board.

These are local/Preview runtime and browser-emulation checks. They do not establish
physical phone frame rate, public load capacity, or a main-branch production deployment.

## Simulator findings

The committed [baseline](../tools/sim/baseline.json) records 10,000 seeded games
with four medium bots and a **20-round simulation cap**, separate from the live
two-hour preset. Every game terminates and preserves per-event money, event
replay, cards, ownership and legal-decision invariants.

| Metric | Result |
| --- | --- |
| Median / p90 rounds | 20 / 20 |
| Round-limit endings | 90.54% |
| Resort / last-standing / triple / line endings | 660 / 187 / 90 / 9 |
| First turn win rate | 33.33% |
| Last turn win rate | 17.87% |

The balance targets are **not met**: short capped games often end by ranking and
turn order has a material advantage. Turn order is shuffled, and there are no paid
advantages, but fair dice alone do not establish balanced strategy. Landmarks can
also earn less than some modified hotels. Further playtests should tune these
values after the remaining reference prices and rents are captured.

## Follow-up scope

Exact reference economy/settings comparison, balance, physical phone performance,
human group playtests, independent browser BLS verification, accounts,
matchmaking, audio and advanced artwork remain future work. Current geometry and
graphics are original; no competitor art or purchasable gameplay boosts are used.
