# Bot difficulty proposal (#75)

## Why the setting was missing

[PR #116](https://github.com/Rusutsu-Studios/Polytour/pull/116) was merged into
`polytour/integration`, not `main`. Its bot policy and selector were absent from
the production branch when this proposal was prepared. The deployed game reported
0.7.5 on 6 October 2026 and its served client had no difficulty field. This PR
adapts that implementation to the current Chance cards and saved-room rules.

## What difficulty can change

The dice create uncertainty, but decisions still matter: buying buildings,
keeping enough cash for nearby rent, completing a country, preventing an
opponent's instant win, choosing a flight and deciding which property to lose.
The engine already exposes public state and legal actions, so three decision
policies can use the same server rules and random sources.

| Level | Decisions | Intended use |
| --- | --- | --- |
| Easy | Uses Medium's normal purchases, construction and buyouts, but occasionally buys one building level less, postpones an upgrade or misses a buyout. | A gentler opponent that still develops its cities. |
| Medium | Keeps the existing development, buyout and fixed cash-margin policy. | Familiar default challenge; unmarked saves keep this level. |
| Hard | Values complete countries and progress toward them, takes affordable instant wins, blocks winning acquisitions, reserves cash based on probable next-roll rent, and considers strategic loss in forced sales, swaps and Gifts. | A more deliberate opponent. |

Easy's occasional lapses use a public, reproducible cycle: round, seat and the
decision's tile modulo four. On those opportunities it chooses one level less
than Medium's affordable construction, postpones an upgrade if no lower legal
level exists, or skips a buyout Medium would accept. Other decisions retain
Medium's behavior, including its cash reserve. This is not a claim that exactly
one quarter of decisions in a real match will be weaker.

Hard is a deterministic heuristic, not a human intelligence model. It has no
access to future dice, the private deck, the RNG seed or another player's private
information. It can still make a poor choice and lose to Easy. Its reserve is an
estimate over the 36 possible next rolls, not a prediction. Player decisions and
Chance effects make longer-term outcomes harder to estimate.

## What players see

- Three labelled default choices directly on the welcome screen and in room
  settings, with a short French or English explanation of the selected policy.
- A visible button on each bot's lobby card cycles Easy, Medium and Hard. Only
  the leader can change it, before starting. A room can contain different levels;
  bots without an individual choice follow the default. Changing that default
  preserves choices already made on individual cards.
- Each bot's choice survives reload and freezes in the match's player state.
  Match HUDs show that bot's level. Returning to the lobby permits new choices;
  reconnecting preserves the existing match's levels. Temporary bots replacing
  humans use the frozen room default. A human who takes over a bot's seat drops
  its previous bot-specific level.
- The separate "Bots can build" custom rule still overrides construction at all
  levels. Cash, prices, dice and cards receive no difficulty bonuses.

## Validation and limits

Decision fixtures cover affordable wins, rent reserves, country preservation,
blocking, shielded swaps, Power Cut transfer, prototype championship cleanup and
the construction override. Worker tests exercise settings, starting, eviction,
reconnection and a real bot alarm for each level. Browser tests exercise the
French and English controls, keyboard focus, reduced motion, frozen settings and
1280x720, 1440x900 and 1920x1080 layouts.

The simulator rotates policies across seats and uses repeatable seeds. Every
game checks legal actions, event replay, ownership, money conservation, card
conservation and termination. Its mixed-level games are a diagnostic comparison
of the same policies available on the lobby cards. They cannot establish how strong
Hard is against humans or under every custom setting.

Final results use seeds beginning at 300, excluded from the initial 0-299
diagnostic run, default reference rules, three festivals and a 60-round cap:

| Format | Games | Easy wins | Medium wins | Hard wins |
| --- | ---: | ---: | ---: | ---: |
| One bot of each level | 1,000 | 291 (29.1%) | 309 (30.9%) | 400 (40%) |
| Medium versus Hard | 200 | - | 82 (41%) | 118 (59%) |
| Easy, two Medium bots, Hard | 200 | 42 (21%) | 100 combined (25% per Medium seat) | 58 (29%) |

Hard has an advantage in the two- and three-player samples. The four-player
sample is too small to establish a clear advantage over Medium per seat. Easy is
close to Medium in the three-player sample and remains competitive. These results
support a gentler mode and a strategic mode; they do not prove a universal
strength ranking. All 1,400 games passed the invariants above. The exact commands
and complete results are in
[`tools/sim/bot-difficulty.json`](../tools/sim/bot-difficulty.json).

The proposed acceptance criterion is a visible, persistent choice with distinct
legal decision policies. Human-level play would need human playtesting and a
defined benchmark; it is not an acceptance claim for this PR. Further search or
new levels should follow demonstrated decision mistakes and recorded matches.
