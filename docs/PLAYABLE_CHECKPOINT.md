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

## Historical verification — 1 October 2026, before the PC layout replacement

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

These are recorded checks of the earlier layout and its local/Preview runtime.
They do not establish the replacement PC interface's remote Preview behavior,
public load capacity, or a main-branch production deployment. The phone rendering
result is historical only: mobile and physical phone FPS are not current gates.

## Replacement PC interface — verification, 1 October 2026

The user now prioritizes a PC browser game with a full-screen central isometric
board, compact player HUDs at four corners and contextual decisions. Journal,
proof, instructions, room information and tile details must be closed by default.
The original toy geometry, economy and authoritative randomness remain in place.

- [x] Real browser captures at 1280×720, 1440×900 and 1920×1080: whole-board view,
      no page scroll and no controls outside the viewport
- [x] Local browser UI: real dice roll, refresh, menus, Escape dismissal and focus;
      create/join flows preserve the room's settings
- [x] Four isolated browser contexts: a complete match with reconnect and identical
      authoritative public state on all seats
- [x] Animation speed at 2×, reduced-animation toggle and a visibly decreasing
      match countdown; skip is disabled at rest and works during a real roll's events
- [x] Live future drand round: BLS verification, independent dice recomputation and
      proof export through the UI; proof tools remain closed by default
- [x] TypeScript, production build, Biome across 59 files and bundle/asset budgets
- [x] The existing 68 unit/Worker tests and a 100-game simulation run pass; this
      visual replacement makes no rules-engine or balance changes

Six browser scenarios passed in **38.6 seconds**: the UI flows above, a complete
four-context match, live drand verification/export and two API/SPA smoke checks.
After adding an explicit click on “Passer l’animation ↗” during live event
playback with normal animations enabled, the two UI scenarios passed again in
**20.5 seconds**. These are local browser/Worker results, not confirmation of the
replacement interface on the remote Preview.

The deployed branch Preview at commit `821994b` also passes four production
browser scenarios in **29.6 seconds** over HTTPS/WSS: a complete four-seat match
with reconnect, live drand verification and UI proof export, and both API/SPA
smoke checks. Manual play validates a rent-protection card and a 640 k buyout in
the local real match, including the resulting cash and ownership.

CI then exposed an inspection race: animated pawn movement could overwrite the
city a user selected. Explicit selections now stay pinned; automatic following
applies only before a manual selection. The regression checks the actual city
heading, price and selected value through a guaranteed change of active position.
The focused browser scenario passes in **13.3 seconds** after this correction.

Separate, explicitly authored presentation fixtures show building levels 1–5,
all six purchase choices at 1280×720 without a HUD collision, and an off-turn
debtor's decision. The Worker is not changed for these fixtures; they demonstrate
rendering and decision presentation rather than claiming those exact states
occurred in a live match. The real four-context match supplies gameplay evidence.

| Build report | Reported size |
| --- | --- |
| Lobby JavaScript, gzip | 157.7 kB |
| Scene chunk | 1002.4 kB |
| Worker bundle | 587.1 kB |

All enforced size budgets pass. The final independent visual review found no
remaining material defects in the desktop presentation. A 60 fps result is still
**unmeasured**: captures and automated browser checks do not establish performance
on target PC hardware.

- [x] Confirm the replacement PC interface and production browser flows against
      the remote branch Worker Preview
- [ ] Record target PC/GPU hardware and active-animation FPS before claiming 60 fps

No new main-branch production deployment is established by these checks. Mobile
remains best effort; a dedicated touch adaptation is optional future work.

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

Exact reference economy/settings comparison, balance, desktop performance,
human group playtests, independent browser BLS verification, accounts,
matchmaking, audio and advanced artwork remain future work. Current geometry and
graphics are original; no competitor art or purchasable gameplay boosts are used.
Mobile/touch adaptation and physical phone performance are optional later work,
separate from completing the current PC checkpoint.
