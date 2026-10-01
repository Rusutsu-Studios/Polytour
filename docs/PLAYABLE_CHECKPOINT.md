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

## Immediate server dice — 1 October 2026

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

## Focused adoption from PR #12 — 1 October 2026

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

## Staged hotels and presentation refinement — 1 October 2026

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

## Illustrated decisions and slider settings — 1 October 2026

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
source references and complete generation prompts are recorded in
[CARD_ART.md](CARD_ART.md) and [card-art-prompts.json](card-art-prompts.json).

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

## Follow-up scope

Exact reference economy/settings comparison, balance, desktop performance,
human group playtests, optional independent browser BLS verification for legacy
drand rooms, accounts,
matchmaking, audio and advanced artwork remain future work. Current geometry and
graphics are original; no competitor art or purchasable gameplay boosts are used.
Mobile/touch adaptation and physical phone performance are optional later work,
separate from completing the current PC checkpoint.
