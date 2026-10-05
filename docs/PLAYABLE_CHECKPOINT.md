# First playable checkpoint

Branch: `codex/playable-four-player-mockup`. New-room rules version: 3; legacy
rooms retain version 2. Stored-state version: 1. The feature connects the shared engine, private authoritative rooms and the
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

## Historical verification - 1 October 2026, before the PC layout replacement

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

## Replacement PC interface - verification, 1 October 2026

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

## Immediate server dice - 1 October 2026

The subsequent 1 October dice change makes new-room rolls immediate with fresh
Worker Web Crypto. Drand is absent from normal new-room settings; its resolver
and proof UI remain for saved-room compatibility. The historical drand results
above establish that legacy path, not a requirement for new gameplay. See
[RANDOMNESS.md](RANDOMNESS.md) for why an initial public drand seed is unnecessary.

The 69 unit/Worker tests, TypeScript, Biome, production build and bundle budgets
pass. A regression starts a default room with network fetch disabled, resolves
the roll immediately and confirms the stored result uses Web Crypto without a
drand round or signature.

Six local browser scenarios pass in **46.7 seconds**, including the full
four-seat match using the default source, UI settings and last-roll information,
refresh and both routing smoke checks. The explicit legacy drand scenario still
verifies and exports its proof, then checks that leaving it and creating a new
room uses `secure` rather than inheriting the hidden legacy mode. Creation also
forces the new default when “Rejouer” uses the previous render's settings.

## Focused adoption from PR #12 - 1 October 2026

PR #15 adopts only PR #12's amount-based salary calculation. `SalaryPaid.amount`
credits the player's current cash and debits the bank by the same value. The
existing complete engine already has a numeric bank ledger, exhaustive event and
action handling, and replay/conservation tests; merging the older engine would
duplicate those parts. The legacy absolute `cash` event field remains for stored
events and previously opened clients, while the current reducer ignores it.
Valid saved games keep the same balances and rules without a version migration.

The 71 unit/Worker tests, TypeScript, Biome, production build and bundle budgets
pass. Two focused regressions cover a conflicting legacy `cash` value, immutable
input, and successive or zero salaries. A fresh 100-game simulation also passes
the per-event money, replay, ownership, card and termination invariants.

CI also exposed a browser-test race unrelated to salary: at 2× speed, animation
could finish between the skip button's visibility check and the mouse hit-test.
The trace shows the button disappear before the canvas receives that coordinate.
The regression still checks 2× selection, then uses normal 1× animation for the
real roll, verifies the button is the pointer target and clicks it normally.
Three consecutive full executions of that UI scenario pass in **43.6 seconds**.
No presentation or CSS change was needed.

## Staged hotels and presentation refinement - 1 October 2026

New rooms freeze rules version 3: an initial purchase or an upgrade from fewer
than three houses stops at House III. Hotel purchase requires a later landing on
an owned three-house city after a completed lap. The explicit direct-hotel setting
remains an exception. Previously saved version-2 active matches and unstarted
lobbies keep their lap-only progression. No protocol or state-schema migration is
introduced; contradictory markers and attempts to set the internal marker through
the public settings API are rejected.

The 86 unit/Worker tests, TypeScript, Biome across 60 files and production build pass, including
stale pending caps, the same legal choices for bots, zero-lap restrictions, direct
hotel exceptions, version-2 cold loads/lobby starts and non-mutating rent previews.
Unknown lobby state/rule versions reject connection, settings and start before
any durable table changes; the two regressions failed before the correction.
Lobby JavaScript is 158.9 kB gzip, the scene asset 1005.4 kB and the Worker 588.8 kB;
all enforced bundle and deployment-config checks pass.

Construction choices show building silhouettes, cost and candidate-state rent
from the shared engine. The hotel explanation uses the rule cap before checking
cash, so lack of funds is not confused with a construction prerequisite. Four
corner HUDs have clearer pawn identities. Instanced bases, cornices, entrances,
hotel shapes and landmark terraces refine the original board. The Director's
0.45-second ownership accent respects skip/reset/reduced motion; a fresh effect
remains visible when an older cancelled handler resumes.

Six local browser scenarios pass in **43.4 seconds**: a full four-context game
with reconnection, actual UI play and controls, settings-preserving create/join,
both API/SPA routing checks, and the explicit legacy drand proof scenario. The
two UI cases also pass separately in **30.8 seconds** after the review corrections.
The skip regression checks a real pointer target and normal click, then observes
the public Director immediately after that click; subsequent bot events can
legitimately begin another animation. A prior overlapping pair of test runs
conflicted over artifacts and server lifetime; the final full run was serial.

The deployed branch Preview at `f985ff0` passes all four production browser
scenarios in **31.9 seconds** over HTTPS/WSS, including the complete four-seat
match with reconnect and the legacy proof/new-room flow. The served JavaScript
asset matches the locally verified production build. Both GitHub verification
runs and the Cloudflare Preview build pass for that revision. No main-branch
merge or production publication is implied by this branch verification.

Authored presentation fixtures have been visually examined at 1280×720,
1440×900 and 1920×1080. They cover staged purchases, festival rent, the custom
hotel option, all building levels, and a victory where the actual winner differs
from the wealth leader. The result overlay fits without internal scrolling at
all three sizes. These fixtures change only their isolated client view; gameplay
evidence comes from the real Worker/browser match above. Target-hardware FPS is
still unmeasured. Manual Impeccable detector findings and the narrow roof/fallback
exceptions are recorded in DESIGN.md.

The [new-rule simulation report](../tools/sim/staged-hotels.json) records 1,000
seeds with four medium bots and a **20-round cap**, separate from the live two-hour
deadline. Every game terminates and preserves money, replay, cards, ownership and
legal decisions. Median/p90 rounds are 20/20; 928 matches reach the cap, 55 end by
resort collection, 12 by triple collection, four by last standing and one by line.
First/last turn win rates are 34.8%/14.9%. This strengthens the need for a separate
balance pass; the construction correction does not claim to resolve that issue.

## Illustrated decisions and slider settings - 1 October 2026

Settings now open in a central dialog with money and festival sliders, exact
numeric inputs, duration choices and custom rule switches. The host's explicit
save and unsaved draft behavior remain intact; other seats see read-only settings.
Purchase, construction, buyout, travel, protection and forced-sale decisions use
central illustrated confirmations. Adjusting a slider or selecting a destination
does not send an action. Escape minimizes a decision and returns focus to its
resume control without declining it.

Chance draws have original painted illustrations, their actual effect and a
Continue button. The Director coordinates the scene and card presentation;
skip, reset, reconnect and a following card cancel the earlier presentation.
The reading interval is bounded at 2.6 seconds (850 ms while catching up). It
does not pause the authoritative decision clock. Reduced motion suppresses the
entry animation and reading progress decoration.

Original banknote reserves and coin piles surround the board. Cancellable cash
transfers show salaries, rent, purchases, upgrades, buyouts and sales using the
existing animation budgets. The player HUD retains the exact balances. Artwork,
source references and the card drawings are recorded in
[CARD_ART.md](CARD_ART.md).

Review corrections preserve the free dice option during travel, show the exact
payment after Guardian/Coupon protection (including odd-value rounding), and
identify both cities before a land exchange. The rent preview and engine use the
same pure calculation; game rules and the saved-state format are unchanged.
Resort decisions explain their collection-based rent and lack of construction;
hotel prerequisites appear only for cities.

- 88 unit/Worker tests, TypeScript, Biome across 69 files, production build,
  bundle budgets, deployment-config checks and a deployment dry run pass.
- Nine local browser scenarios pass in **1.2 minutes**, including a complete
  four-seat match and reconnect, legacy proof/new-room compatibility, settings,
  card sequencing/focus/cancellation and travel/protection/exchange regressions.
  A separate controlled movement queue verifies a real pointer click on Skip;
  the random real-roll check no longer races that short animation window.
- Browser captures at 1280×720, 1440×900 and 1920×1080 cover the new dialogs and
  cash reserves. The settings controls fit at 1280×720 without page scrolling.
  Authored presentation fixtures remain separate from the real match evidence.
- One manual Impeccable scan reports three warnings and 440 advisories. The
  warnings concern legacy CSS roof borders and the flat-board country strip;
  actual rendered dialogs and the 3D board have been inspected. This is a reviewed
  visual result, not a claim that the detector produced zero findings.
- Latest deployed Preview evidence and its exact revision are recorded in
  [PR #15](https://github.com/Rusutsu-Studios/Polytour/pull/15). Earlier remote
  checks above remain tied to their stated revisions.

Independent Preview inspection reproduced a fast-input regression: moving a
money slider and immediately filling its exact field could concatenate the prior
draft with the entered value, then clamp the result to the maximum. Draft
synchronization now completes before input events and a synchronous focus guard
protects edited text. Twenty repetitions without an intermediate Tab preserve
2 M; the browser create/join regression verifies that same amount on the second
seat. Empty and out-of-range inputs still normalize safely.

The existing balance reports still apply. Target-hardware FPS has not been
measured; this presentation change does not establish the balance targets.

## Durable Object incident and clearer board - 1 October 2026

The user's reported Preview failure is confirmed in Cloudflare's GameRoom logs:
`Exceeded allowed rows written in Durable Objects free tier.` The write allowance
was exhausted; 9.21k requests in the billing-period screenshot were not evidence
of reaching the request limit. See [CLOUDFLARE_OPERATIONS.md](CLOUDFLARE_OPERATIONS.md)
for the incident, limits and recovery time.

Rooms without an open player socket now stop bot moves and retry work, retaining
their original match deadline and one-shot disconnect grace. Clock sync performs
no SQL operations. An unchanged timer refresh now writes zero rows versus five
for the previous sequence, measured using actual SQLite cursor counters. Cleanup
returns JSON404 to later requests without orphan timers. Lobby departures retain
presence updates and offline humans get disconnect grace when the game starts.
JSON503 errors identify the confirmed quota failure; clients safely handle text
and HTML failures, suppress duplicate submissions and bound unsuccessful retries.

The visual replacement uses thin board edges, flat long rectangular lilac/ivory
tiles and small simple gabled buildings. Names and amounts follow the route on
the clear portion of each tile. Pawns use an inner lane, with a tile marker joining
their foot to their exact destination. Cash reserves, original cards, central
illustrated decisions, slider settings and corner HUDs remain in place.

- 112 unit/Worker tests pass, including quota/API response handling and abandoned,
  expired, reconnecting and pre-game disconnected rooms. TypeScript and Biome pass.
- 13 local browser scenarios pass, including a complete four-seat match,
  reconnect, real UI play, settings/cards/decisions and five intercepted network
  failure scenarios. No remote Durable Object is used by these regressions.
- Nine local captures cover empty/developed fixtures and real server dice/movement
  at 1280×720, 1440×900 and 1920×1080, without overflow or browser exceptions.
  Developed boards are explicitly presentation fixtures, not a remote match.
- A fresh manual detector scan retains the three previously explained CSS warnings
  and 330 token advisories. Actual real/developed board renders have been inspected;
  this is not a zero-findings detector claim.
- Runtime/network review found the pre-game disconnect issue; its presence and
  bot-grace fixes are covered by focused Worker regressions. No rules, state-format,
  protocol-version, migration or billing-plan change is made.

The Preview deployment cannot replenish the account's already consumed daily
write allowance. Remote room creation remains blocked until Cloudflare resets it
at 00:00 UTC; the first subsequent local-date reset is 2 October at 02:00 in Zurich.
Localhost is usable during that interval. Do not interpret earlier successful
remote matches as evidence that this incident has recovered.

## Simulator findings (earlier lap-only rules)

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

## Welcome, sliders and two languages - 1 October 2026

French and English now cover the interface, board labels, decisions, all 16 card
titles/effects, tools, standings and known connection errors. Language is stored
locally and can change during a game without a new socket or a room action.
Existing player names and unknown server explanations remain verbatim; already
displayed errors retain their original text. See [LANGUAGES.md](LANGUAGES.md).

The welcome screen removes the promotional headings, repeated fairness slogans
and decorative pawn captions. A compact setup sheet offers solo play, create and
join, while the board occupies the remaining area. Three visible native sliders
share starting cash, salary and festivals with the complete settings dialog.
Duration and decision time also have discrete sliders beside their presets.

- 112 unit/Worker tests, TypeScript and Biome pass.
- 15 local browser scenarios pass, including the two new language/sliders flows,
  a full four-seat game, reconnect and the existing illustrated decision/card flows.
- French and English welcome views are inspected at 1280×720, 1440×900 and
  1920×1080. Bounds checks cover the board and sliders, including after resizing
  from the largest viewport. Keyboard operation and reduced motion are preserved.
- The manual design scan retains three known CSS warnings (roof triangles and
  fallback tile color bands), plus 359 token advisories. It is not a zero-warning
  claim. Copy scanners find no phrase/structure/silhouette issues; their prose
  cadence/condensation checks are unsuitable for short UI labels and the expressly
  requested deletion of marketing text. The actual rendered copy is reviewed.

No rules, protocol, storage schema, billing or Durable Object behavior changes in
this follow-up. These checks use local rooms or intercepted failures, never remote
Durable Objects. Static Preview publication does not restore the exhausted quota.

## Tabletop orientation and board look - 2 October 2026

The user asked for the board to start on the right and play to go left, like the
classic printed board and the reference screenshots. The camera now looks at the
board from its Start corner: Start is at the front, a pawn leaving it walks left
toward the island, then on to the festival at the back and the world tour on the
right. This is the clockwise movement the rules already describe; no tile index,
rule or protocol changes.

- Geometry moved into `client/scene/board-layout.ts`. Unit tests check the
  orientation and that play runs clockwise on screen. They also cover lots
  filling the ring without overlaps, upright left-to-right printing on every
  side, building plots above the print, facades toward the camera, pawns on the
  road, and pawns of different players never colliding (including beside
  corners). Each cash reserve also lies beside its own HUD.
- Lots use classic proportions (large corner squares, seven deep lots per side)
  with a strong colored plot, small name and large compact price. Corners carry
  a printed Start, a palm island, a festival arena and an airport; a road rings
  the mown lawn.
- Corner HUDs become a portrait tile, a player-colored name ribbon and an ivory
  cash plate. The sky gains a radial gradient and faint floating tiles.
- Dice take the roller's color, leave from the roller's side and reveal their
  total. A later pacing pass lengthens their budget to 1.7 s (see ANIMATION.md).

Verification on this machine:

- 122 unit/Worker tests (10 new layout tests), TypeScript and Biome pass.
- The 15 CI browser scenarios (`--grep-invert @live`) pass. The language
  switch scenario fails intermittently, about one run in three, on this branch
  and equally on unchanged `main`, so that flakiness predates this change.
- Welcome and match views are inspected at 1280×720, 1440×900 and 1920×1080,
  plus a 390×844 phone view (best effort). A real roll shows the throw, the total
  and the pawn walking left from Start.
- The debug monitor reads about 240 draw calls per frame including the shadow
  pass, after instancing the dice pips. That is above the 150 planning target in
  ANIMATION.md; the four pawns (about 17 meshes each) are the largest remaining
  cost. Software-rendered FPS figures are not hardware evidence.
- On the two back sides, a pawn standing on the road can hide part of the price
  of its own lot; the inspector and decision dialogs still show it.

## Living town in the center - 2 October 2026

The user found the middle of the board empty and asked for a livelier center
that builds up during the match, as in familiar mobile and console property
games, while the board stays readable. The lawn became a small original town
(see DESIGN.md and ANIMATION.md → Current town in the center). No rule, event,
protocol or Worker code changes.

- `client/scene/town-layout.ts` places a paved dice plaza, a roundabout, four
  avenues with turning circles and one street of six plots per side, one plot
  per city or resort in play order. `town-layout.test.ts` adds four tests:
  plots match the board, nothing overlaps or sits on a road, the car circuit
  stays on paved roads, and no town envelope hides a pawn spot, a lot print,
  the board road or a die at rest when projected through the camera.
- `client/scene/Downtown.tsx` draws the plots from `viewState` (tree when
  unsold, then the lot's level under the owner's color) and replays their
  construction with a crane inside the existing property animation.
- Ambient cars, big wheel, carousel, boat, helicopter and fountains render at
  30 fps between game animations on the match board; lobby previews and
  reduced motion keep them still. A first CI run showed why previews must stay
  still: the fake-clock socket scenarios advance minutes of browser time in a
  room lobby, and an animated preview turned that into thousands of software
  renders.

Verification on this machine:

- 132 unit/Worker tests (4 new town tests), TypeScript and Biome pass.
- The match was inspected at 1280×720, 1440×900 and 1920×1080 at the start
  of a match, with a partly owned fixture and with every plot owned. A
  synthetic landmark upgrade shows the crane and the rising tower. Prices,
  names, pawns and dice stay unobstructed.
- A WebGL hook counts 295 draw calls per frame with the town, against 239
  before, both including the shadow pass. Software-rendered frame rates are
  not hardware evidence; the 60 fps desktop target still needs a hardware run.
## Property sale values and board selection - 2 October 2026

New rooms freeze rules version 4 and return 100% of the nominal land and standing
building costs when a property is sold. Existing version-2 and version-3 rooms,
including their pre-existing lobbies, retain their 50% refund. Rent modifiers and
buyout premiums do not increase the sale value. This is Polytour tuning; the
reference screenshot establishes the interaction, but not its refund formula.

Forced sales now select cities directly on the board. Sellable owned lots stay
white, other lots dim, and selecting a city marks it and shows its refund. A
compact lower-center panel shows the debt, proceeds and projected balance before
an explicit confirmation. The normal board appearance returns after the sale
decision. Keyboard selection works through the quoted board buttons, and the
flat-board fallback uses the same contrast and legal targets.

Selection is cleared on a new decision or recovery snapshot. Clicks on other
properties cannot replace the selected city, and pending actions block further
input. Protocol version 2 requires older clients to refresh before quoting the
new rules; the server remains authoritative for ownership and money.

Verification on this branch:

- TypeScript, Biome and 138 unit/Worker tests pass.
- 100 deterministic simulations terminate and preserve money, replay, card,
  ownership and legal-decision invariants.
- Production build, bundle budgets, Cloudflare configuration guard and deploy
  dry run pass.
- Four sale-specific browser scenarios pass using local HTTP/WebSocket fixtures
  and shared-engine events. Real Chromium rendering is inspected at 1280×720,
  1440×900 and 1920×1080 with normal and reduced motion. All 24 city/resort targets
  are selected at each size (72 clicks), plus keyboard confirmation, off-turn debt,
  pending-action blocking, successive sales and snapshot recovery.
- All 21 end-to-end scenarios pass, including the local production Worker's
  four-seat match, reconnect and legacy drand verification.

## Pause menu preparation - 3 October 2026

Branch: `codex/pause-menu-settings`, based on `f74b053`. The pause icon opens
Continue, Settings and Leave while the match, deadlines and Director keep
running. Settings use Game, Video, Audio and Debug tabs. Audio is marked coming
soon for issue #35; Debug measures the same-origin static Cloudflare asset's HTTP round trip
each second while its panel and browser page are visible and online, and
displays the game service, host and actual Cloudflare
entry point with its code, location and broad region. The location mapping is
bundled from Cloudflare's official Status API (341 geographic POPs). A tiny
bottom-right `AMS · 42 ms` indicator keeps the last sample outside Debug. The
probe validates a static text sentinel and reads the current response's `Cf-Ray`
suffix. Existing asset-first routing serves it without invoking a Worker or DO;
the browser ping does not call `/api/health`. The
sliders icon displays fixed room rules, while
the invitation tool displays the room code.

User animation speed and both manual finish/skip controls have been removed.
Automatic catch-up, reconnect recovery and reduced motion remain. This replaces
the speed/skip controls described in the historical checks above.

Local verification: TypeScript, Biome, 143 unit/Worker tests, production build,
bundle budgets and Wrangler configuration checks pass. All 20 browser scenarios
passed for the initial pause-menu commit, including the complete four-seat
authoritative match, reconnect and live legacy drand verification. For the static
probe revision, all 16 existing browser scenarios and eight focused menu scenarios
pass. The focused rerun follows a commit-phase teardown fix: closing Debug stops
its timer and network listeners before any further browser event can start a probe.
They use authored protocol fixtures to
test modal priority, local settings, ping success/failure/timeout/cleanup and
leave confirmation, and distinguish Cloudflare, local and unknown POP responses.
Network and game reconnects immediately restart the measurement. Tests also cover
one-second scheduling, offline/hidden suspension, a transport ignoring cancellation,
five-second timeout recovery and rejecting responses from superseded measurements.
Browser captures cover 1280x720, 1440x900 and 1920x1080; Debug and the tiny badge
additionally cover 390x844 without horizontal overflow or player-card overlap.
Metadata shown in these captures is a fixture.
No remote runtime or production deployment is asserted by these local checks.

## Room routing and latency diagnostics - 3 October 2026

Debug now joins the connected seats' Cloudflare ingress POPs and regions to their
shared GameRoom and its local SQLite storage. The current socket's public Worker
endpoint is shown separately from the static HTTP probe. Physical DO location and
server hostname are explicitly unavailable; an optional jurisdiction is a placement
restriction, not an execution DC. No internal Cloudflare credentials, player IPs,
seat capabilities, object identifiers or database contents reach the diagnostic UI.

A bounded graph holds sixty real room WebSocket RTT samples, with minimum, mean
and maximum. Samples run every five seconds only while Debug and the page are
visible and online. A fixed native DO WebSocket auto-response avoids waking game
JavaScript, SQL and alarms. The existing one-second static HTTP probe remains
asset-first. At five-second cadence, the room probes account for about 36 DO
compute-request equivalents per active debugger-hour under the 20:1 incoming
WebSocket ratio; they create no additional Worker HTTP polling. One authenticated
metadata message on opening/reconnect reads socket attachments, without querying
game rows. It can wake the DO; after the room-allocation integration below, its
constructor only checks for an existing schema rather than creating tables.

The client accepts newer optional capability numbers without rejecting the game
welcome, but sends diagnostic messages only for the supported version. Per-socket
FIFO slots preserve expired requests so delayed fixed replies cannot invent a new
latency after menu closure, visibility changes or a same-socket resync. New sockets
reset samples and refresh routing metadata. Gameplay protocol version and frozen
rules remain unchanged.

Local TypeScript, Biome, 162 unit/Worker tests, 100 simulated games, production build,
bundle budgets, Wrangler configuration and deployment dry run pass. Backend tests
exercise real workerd authenticated sockets and hibernation: the fixed ping does
not enter the JavaScript message handler, touch SQL, change alarms or mutate state.

The 16 existing browser scenarios pass, including the complete authoritative match,
reconnect and live legacy drand verification. All 11 pause/settings/debug cases are
verified: 26 of 27 scenarios passed in the full run, then the graph capture and the
remaining stale-pong case passed after a test-only WebSocket observer setup fix.
Coverage includes five-second socket cadence, one-time metadata, old capability
fallback, hidden/offline/close suspension, reconnection, FIFO late-reply rejection,
real timed samples, sixty-point history, pause gaps and FR/EN accessibility.
Captures at 1280x720, 1440x900, 1920x1080 and 390x844 have no horizontal overflow.
The illustrated FRA/Europe and IAD/North America paths are authored fixtures,
not evidence of geographically distributed remote players.

A real browser check of the Cloudflare branch Preview at implementation revision
`a9b3261` on 3 October 2026 succeeds: room creation returns 201, the server advertises
debug capability 1, the socket reports ZRH / Zurich / Europe, and two real room RTT
samples produce the graph (64 ms latest, 75 ms mean). Its DO location and jurisdiction
remain null. Closing Debug stops both probe streams; reconnecting renews metadata
and the graph. The check observes one metadata request per opening/connection,
zero health calls and zero page errors. This verifies one connection to a branch
Preview, not a geographically distributed group or production deployment. The
previously recorded remote SQLite quota blockage is no longer present in this check.

## Five-second match HUD and concise room details - 3 October 2026

The user's follow-up makes the static HTTP badge a live match indicator: it
refreshes every five seconds even with Debug closed, while the game connection is
online and the page is visible. Debug shares that same stream. Hiding the page,
going offline or leaving the match stops the probe; connectivity changes still
refresh it immediately. These requests remain asset-first and do not execute
Worker or DO code. The room WebSocket graph and its metadata stay Debug-only.

The jurisdiction and physical DO host/DC rows are removed from the FR/EN interface,
along with their unused formatting. The protocol retains its compatible metadata
shape. This supersedes the earlier one-second Debug-only HTTP probe and the
explicit unavailable DO location rows described above.

TypeScript, Biome, 162 unit/Worker tests, production build and bundle budgets pass.
All 26 non-live browser scenarios pass in one run, including the real production
gameplay/reconnection flow and 11 pause/settings/debug cases. HTTP checks cover
five-second cadence outside Debug, one shared stream, hidden/offline/leave cleanup,
network refresh and timeout recovery. Room diagnostics remain Debug-only. The
removed labels are absent in FR/EN; captures at 1280x720, 1440x900, 1920x1080 and
390x844 retain usable layout without horizontal overflow. Some clock-controlled
fixtures leave the 3D backdrop unrendered; their diagnostic values are illustrative.

## Integration with current main - 3 October 2026

Merge `8d8530f` into the pause/settings branch. The new country board, central town,
title-deed inspection, board destination/sale selection, player turn timers and
full cash balances remain. Shared dice help and saved-match migration retain their
upstream behavior. The pause menu, fixed room settings, five-second static HTTP
badge and Debug-only room WebSocket diagnostics remain together. Newly added UI
components use fixed motion durations after the animation-speed control removal.

TypeScript, Biome, all 214 unit/Worker tests, 100 reference-economy simulations,
production build, bundle budgets, Cloudflare configuration and deployment dry run
pass. All 34 non-live browser scenarios pass in one run, including four isolated
seats finishing an authoritative local Worker match and reconnecting. The merged
protocol, room-rule markers, title-deed and board selection paths are exercised
alongside the pause/settings/debug flows. Desktop captures and bounds checks cover
1280x720, 1440x900, 1920x1080, 2560x1440 and 3840x2160; Debug also covers 390x844.

## Follow-up scope

Exact reference economy/settings comparison, balance, desktop performance,
human group playtests, optional independent browser BLS verification for legacy
drand rooms, accounts,
matchmaking, audio and advanced artwork remain future work. Current geometry and
graphics are original; no competitor art or purchasable gameplay boosts are used.
Mobile/touch adaptation and physical phone performance are optional later work,
separate from completing the current PC checkpoint.


## Combined PR integration - 3 October 2026

The candidate composes PRs #19, #21–24, #26–28 and #47. New rooms use rules
version 5 and protocol version 3. Version-2/3 saves and pre-existing lobbies keep
their original board, prices, Hotel progression, refunds and travel choices;
clients refresh for the protocol change. This supersedes the separate version-4
branch checkpoints above without remapping existing saved tile indices.

The country board uses all twenty reference city rows. Deeds, legal construction
choices, travel/hosting/card picks, refunds and town plots select the same frozen
room rules. Scene integration preserves passing pawns at corners, resort
bungalows, festival markers, the living town and the lawn roll control. Large
screen projection avoids double scaling; informative timers remain accurate
across rerenders and visible with reduced motion.

Local verification on the combined candidate:

- TypeScript and Biome pass; 182 unit/Worker tests pass.
- 100 reference/country and 100 prototype/legacy simulated games preserve money,
  cards, ownership, replay and legal decisions, and all terminate.
- All 23 standard browser scenarios pass, including the local production
  Worker's authoritative four-seat match/reconnect and actual board picking.
  The separate live legacy-drand scenario also passes: a future commitment,
  verified public beacon, independent verification, reconnect and proof download.
- Desktop controls and sale targets work at 1280×720, 1440×900, 1920×1080,
  2560×1440 and 3840×2160. A country-board travel and championship regression
  verifies pointer/keyboard selection and explicit confirmation.
- Production build, bundle budgets, append-only Cloudflare configuration checks
  and deploy dry run pass. Initial JavaScript is 178.7 kB gzip (250 kB limit).
- Five sequential solo starts each send one start and receive the created game,
  with no page errors. An earlier startup failure did not reproduce after the
  code stopped changing during the browser run.

These checks validate the local candidate. They do not establish GitHub merge,
production publication, hardware frame rate or human-playtest balance. With a
20-round simulation cap, 95% of reference and 91% of prototype matches reach the
cap; the small sample is a correctness check, not proof of a balanced economy.

## Nickname-only invitation entry - 3 October 2026

Invitation links open a focused nickname form and the board preview. Enter joins
the invited room; bot play, room creation and room settings are absent from this
entry. The room code is absent from the invitation markup, including labels and
hidden fields, in preparation for streamer-mode privacy (#37). Leave clears the
invitation and returns to the normal start screen. Matching saved credentials
resume the existing seat without a second join; credentials for another room do
not override the invitation. Invalid links fail locally, and rejected joins keep
the nickname and target available for retry.

Local verification:

- TypeScript, Biome and all 182 unit/Worker tests pass.
- All 32 standard browser scenarios pass in 4.9 minutes, including eight
  invitation regressions, the real production-build invitation join/refresh
  scenario, and a complete authoritative four-seat match with reconnection.
- French and English invitation captures fit 1280×720, 1440×900 and 1920×1080
  without scrolling. Keyboard focus, Enter submission, pending-state guards,
  restored focus after errors and reduced motion are checked.
- The production build and bundle budgets pass; initial lobby JavaScript is
  179.2 kB gzip against the 250 kB limit.

These results use the local Worker. They do not establish a production deployment.


## Pause settings integration with graphics and room protection - 3 October 2026

The integration retains main through `3f74335`: nickname-only invitations,
card catalogue and saved-economy explanations, application version, town
occlusion, High/Low graphics, secure Chance entropy and room-allocation guards.
A shared graphics control remains on the welcome screen and match toolbar and
also appears in the pause menu's Video tab. Card-help motion uses a fixed duration
after removing the animation-speed preference. Match rules stay behind the
sliders tool; personal settings remain in the pause menu.

The GameRoom native WebSocket reply and authenticated attachment-only metadata
path coexist with `schemaReady`. The constructor checks for an existing schema;
only `init()` creates tables. Cleanup retains empty storage. Every live engine
context retains fresh Chance entropy, and the new admission and Worker-only
health paths are preserved.

Local verification:

- TypeScript, Biome, all 268 unit/Worker tests and 14 release-tooling tests pass.
  One initial Worker HTTP diagnostic test exceeded the five-second startup
  timeout; the complete suite then passed without changing code or timeouts.
- All 48 non-live browser scenarios pass on the UI integration (`cf39fd0`),
  including the real four-seat match, invitations, graphics and all eleven
  pause/settings/debug cases. Desktop coverage includes 1280x720, 1440x900,
  1920x1080, 2560x1440 and 3840x2160; Debug also covers 390x844.
- After the latest backend integration, 23 targeted scenarios pass across two
  runs: all eleven pause/settings/debug cases, graphics persistence/render cost/
  real roll/reconnect, cards, invitations, authoritative match/reconnection,
  version and Worker routing. Client assets are unchanged by that backend merge.
- One hundred reference-economy simulations terminate and preserve per-event
  money, card, ownership and replay invariants. Production build, bundle budgets,
  version consistency, Cloudflare configuration and deployment dry run pass.

These are local integration checks. GitHub CI and remote deployment verification
are recorded in the pull request separately.

## Match controls and room portraits — 3 October 2026

During a match, Pause > Settings > Video is the only graphics-quality control,
with High and Low choices side by side. The toolbar magnifier is removed.
Clicked-space details retain the deed and close controls, without previous/next
navigation. Board clicks, keyboard access and forced-sale selection remain usable.
The room panel shows every occupied seat's avatar and name, marks the current
leader and allows that leader to choose another eligible human. The shared avatar
renderer accepts an optional custom portrait and falls back to the pawn on failure.

Local verification on the branch based on `2d27b37`:

- TypeScript, Biome and all 285 unit/Worker tests pass.
- All 49 standard browser scenarios pass across local dev and production-build
  runs. Existing lobby tests now wait for each command's server acknowledgment,
  rather than issuing another command as soon as the preceding lobby update arrives.
- A real Alice/Bea/Cora/bot room transfers leadership Alice → Cora → Alice during
  play. Both browser clients receive the new role and permissions; local players
  and bots remain ineligible, and pending transfers disable the portrait choices.
- Graphics switching, keyboard radio selection, persisted quality, a real roll
  and reconnection pass. French and English labels remain usable.
- Room and Video captures fit 1280×720, 1440×900 and 1920×1080. Existing sale,
  decision and menu layout scenarios also cover 2560×1440 and 3840×2160.
- The production build, bundle budgets, Wrangler configuration, version check
  and deployment dry run pass. The initial lobby JavaScript is 197.7 kB gzip.
- After integrating the `d9e1c82` release-workflow update from main, version 0.2.1
  is prepared and validated against that base; all 28 release-tooling tests pass.

The mechanical design detector retains advisories about the established toy-game
palette, compact typography and physical-control styling. Browser captures provide
the visual acceptance evidence. These results establish local behavior; production
publication has not been performed for this change.
