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
| Easy | Buys bare land; declines voluntary construction and buyouts. Other choices use the ordinary legal fallback. | Learning the board without facing fully developed bot cities. |
| Medium | Keeps the existing development, buyout and fixed cash-margin policy. | Familiar default challenge; unmarked saves keep this level. |
| Hard | Values complete countries and progress toward them, takes affordable instant wins, blocks winning acquisitions, reserves cash based on probable next-roll rent, and considers strategic loss in forced sales, swaps and Gifts. | A more deliberate opponent. |

Hard is a deterministic heuristic, not a human intelligence model. It has no
access to future dice, the private deck, the RNG seed or another player's private
information. It can still make a poor choice and lose to Easy. Its reserve is an
estimate over the 36 possible next rolls, not a prediction. Player decisions and
Chance effects make longer-term outcomes harder to estimate.

## What players see

- Three labelled choices directly on the welcome screen and in room settings,
  with a short French or English explanation of the selected policy.
- One shared level for every bot in the room, editable by the leader before
  starting. Lobby labels and match HUDs show that level.
- The match freezes its setting. Returning to the lobby permits a new choice;
  reconnecting preserves the existing match's level. Temporary disconnect
  replacements use the same frozen setting.
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
conservation and termination. Its mixed-level games are a diagnostic comparison;
a real room applies one level to all its bots. They cannot establish how strong
Hard is against humans or under every custom setting.

Final results use seeds beginning at 300, excluded from the initial 0-299
diagnostic run, default reference rules, three festivals and a 60-round cap:

| Format | Games | Easy wins | Medium wins | Hard wins |
| --- | ---: | ---: | ---: | ---: |
| One bot of each level | 1,000 | 4 (0.4%) | 435 (43.5%) | 561 (56.1%) |
| Medium versus Hard | 200 | - | 82 (41%) | 118 (59%) |
| Easy, two Medium bots, Hard | 200 | 0 | 133 combined (33.25% per Medium seat) | 67 (33.5%) |

Hard has an advantage in the two- and three-player samples. The four-player
sample shows no clear advantage over Medium per seat. These results support a
distinct weaker learning mode and a strategic mode; they do not prove a universal
strength ranking. All 1,400 games passed the invariants above. The exact commands
and complete results are in
[`tools/sim/bot-difficulty.json`](../tools/sim/bot-difficulty.json).

The proposed acceptance criterion is a visible, persistent choice with distinct
legal decision policies. Human-level play would need human playtesting and a
defined benchmark; it is not an acceptance claim for this PR. Further search or
new levels should follow demonstrated decision mistakes and recorded matches.
