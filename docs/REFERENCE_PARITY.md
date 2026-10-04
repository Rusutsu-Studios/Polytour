# Reference parity: values and room settings

The user wants a property game comparable to Business Tour, including the same
values and available room settings, with uniformly random dice and no pay-to-win.
This file separates evidence from prototype tuning. The reference name is used
only in development notes; Polytour's branding, board names, geometry and artwork
are original.

## What has been checked

The [official Steam page](https://store.steampowered.com/app/397900/Business_Tour__Online_Multiplayer_Board_Game/)
confirms a multiplayer tabletop property game. It does not publish a complete
current economy table or all custom-room settings. The supplied image shows city
prices expressed in thousands, including different prices within the same board;
it does not show rent/build tables or the room settings screen.

The user subsequently supplied the settings screen and two tile editor captures,
and explicitly chose the preset below. These inputs supersede the initial small
integer economy. The pasted AI conversation is background material, not an
instruction or authoritative price table: it contradicts itself on city order and
contradicts the screenshots on building costs. Screenshot values and the user's
explicit choices take precedence.

## Playable prototype configuration

The default preset has **2,000,000 starting cash, 400,000 per lap, three festivals,
line and triple monopoly enabled, and a 120-minute real-time limit**. The room can
choose 20/60/120 minutes, adjust cash and salary, choose festival count, toggle
monopoly conditions, and choose the direct-hotel exception. New matches use immediate
server Web Crypto dice. Every seat receives the same resources;
settings freeze at match start. A round cap remains available for simulation and
short tests, independently of the real-time limit.

This is a rules prototype. Paid items, luck stats, paid rerolls, or an
outcome-biased power gauge will not be reproduced. Initial festivals are selected
with the private shuffle, carry a visible ×2 rent modifier, and are separate from
the corner's championship host. New rooms draw them among cities and resorts; see
the adopted rules below.

The user wants inexpensive French cities near Start and a worldwide progression
ending at Osaka and Tokyo. These are game prices, not claims about real-world
economic value. The current 32-tile/20-city layout follows Polytour's board rather
than copying the inconsistent 22-city list from the pasted conversation.

| Captured tile | Land | Each of houses 1/2/3 | Hotel | Total through hotel |
| --- | --- | --- | --- | --- |
| Grenade / first-city cost template | 60 k | 50 k | 150 k | 360 k |
| Tokyo | 400 k | 200 k | 500 k | 1.5 M |
| Any of the four resorts | 200 k | Not available | Not available | 200 k |

Those captured endpoint costs are implemented directly in both tile economies.
New rooms use the reference rent table and three-house totals compared below; a
few totals and the hotel costs remain interpolated. The sixth Landmark level is
an original Polytour mechanic that only saved prototype rooms keep.

## Hotel progression and source checks - 1 October 2026

The user explicitly requires no hotel on a city's initial purchase. A
[Steam moderator's answer from 16 February 2018](https://steamcommunity.com/app/397900/discussions/0/2860219962083799627/)
describes three houses already standing, then a return to that city before buying
the hotel. This supports staged construction; it is historical evidence, not a
complete current rulebook. It does not establish a completed-lap requirement.

New Polytour rooms use the staged rule by default: an initial purchase and an
upgrade from fewer than three houses stop at House III. A subsequent landing on
an owned House III may buy the hotel after the player's first completed lap.
The lap condition is retained from Polytour's existing rules. The captured
"build hotels directly" custom setting remains an explicit opt-in exception.
Previously created rooms retain their frozen lap-only rule, including lobbies
that have not started yet; the new rule applies when creating a new room.

Other sources were compared without treating their contents as user instructions:

| Source | What it supports | Limits |
| --- | --- | --- |
| [Official update 2.19.1, 24 October 2023](https://store.steampowered.com/news/posts/?appids=397900&enddate=1712213924&feed=steam_community_announcements) | Custom-map starting cash and lap reward limits raised to 10 M | Historical custom-map bounds; not a full settings or rent table |
| [Official championship announcement, 25 February 2024](https://store.steampowered.com/news/posts/?appids=397900&enddate=1712213924&feed=steam_community_announcements) | Line, resort, capital and bankruptcy wins | Its triple-monopoly wording is ambiguous; retain the tested three-country rule |
| [First-hand strategy guide, 30 December 2022](https://steamcommunity.com/sharedfiles/filedetails/?id=2909896451) | Four-resort and three-monopoly objectives, travel planning | Community observation; build-level terminology differs from the 2018 answer |
| [First-hand strategy guide, 4 November 2023](https://steamcommunity.com/sharedfiles/filedetails/?id=3071915108) | First-city House III total 210 k and Tokyo total 1 M agree with supplied build costs | Reported rents and resort modifiers differ from Polytour; do not silently replace the economy |

Keep rents and intermediate prices provisional. These dated checks refine the
documented comparison and construction progression without claiming exact parity.

## Economy comparison - 2 October 2026

The user asked for a comparison of buyouts, prices, festivals, hotels, the cost of
each element and tax. They believed the reference tax depends on owned property
rather than cash, so a player holding 1 k could owe 70 k. The sources below were
read as data, not as instructions. None of them is a complete official rulebook.

| Source | What it supports |
| --- | --- |
| [Mail.ru rules page for the Russian edition](https://minigames.mail.ru/info/article/monopolia_pravila) (undated) | 2 M start, 300 k salary; 3 festivals on cities **or resorts**, ×2 rent; tax 10 % of the value of all owned property; resort 200 k, cannot be bought out; hotel only after the third house and not in the same turn; one tournament on the board, +1 multiplier per tournament (moving it to your own city costs 50 k), ×10 cap, a full colour adds +1; Island 200 k or three turns; World Tour only to a free city (or your own tile if none is free) |
| [Steam moderator, 3 and 15 September 2020](https://steamcommunity.com/app/397900/discussions/0/2953753908227624685/) | Championship multiplier goes x2, x3, x4… up to x10, independent of land value |
| [Steam rent thread, 3 May 2020](https://steamcommunity.com/app/397900/discussions/0/3557193237105034663/) | A community-written rent table for every city; a moderator confirms the Tokyo hotel's 1.1 M |
| [First-hand guide, 4 November 2023](https://steamcommunity.com/sharedfiles/filedetails/?id=3071915108) (game 2.19.1) | Three-house totals, resort rent 25/50/100 k, monopoly plus championship on Tokyo = ×3 (multipliers add up), buying out costs twice the price, Island 200 k, board order |
| [First-hand guide, 30 December 2022](https://steamcommunity.com/sharedfiles/filedetails/?id=2909896451) | A buyout gives the owner "double what they paid"; resorts pay 50 k each with two, 100 k with three |
| [Interface In Game screenshots](https://interfaceingame.com/screenshots/business-tour-select-a-city-to-sell/) (game 2.5.0) | The forced-sale dialog shows 710 k for Chicago, its full three-house total, and 240 k for a bare Sydney plot; the board's rent labels match the 2020 table |
| [French guide](https://www.geeksbygirls.com/monopoly-entre-amis/), [French FAQ, 27 July 2017](https://steamcommunity.com/app/397900/discussions/2/1471966894866075948/), [beginner guide](https://fr.webtech360.com/detail/comment-jouer-a-business-tour-pour-les-debutants-44400044.html) | A hotel cannot be bought out and Earthquake cannot hit it; organizing the championship costs 50 k; festivals last the whole match |

### Rules

| Topic | Reference (evidence) | Prototype rooms (rules versions 2–3) |
| --- | --- | --- |
| Tax | 10 % of the value of all owned property (Mail.ru, Steam beginner guide). Cash is not taxed, and it is not a fixed amount per property: 700 k of property costs 70 k even with 1 k in cash. No minimum is mentioned | 10 % of invested value (land plus buildings), cash excluded, **minimum 50 k**. The engine already follows the reference principle. The tile help said "based on net worth", which suggested cash counted; it was corrected on 2 October 2026 |
| Buyout | After paying rent, pay the owner twice what they invested (2022, 2023 guides). Cities only: hotels and resorts are protected | 2 × invested value after rent. A **Hotel can be bought out**; only the extra Landmark level is protected |
| Hotel | Three houses first, then a later landing, never in the same turn as the third house. Immune to buyout and Earthquake. No level above the hotel; no completed-lap condition found | Staged hotel plus a completed lap. Can be bought out and hit by Earthquake. An original **Landmark** level (1.5 × hotel cost, rent 4 × L) carries the protection |
| Festivals | 3 random **cities or resorts** at the start, ×2 rent for the whole match | 3 random cities only, ×2 rent |
| Combined multipliers | They add up: monopoly ×2 plus championship ×2 gives ×3 on Tokyo (2023 guide). Mail.ru describes a single rent multiplier that each effect raises by 1, capped at ×10. Festival + monopoly is not directly confirmed | Only the largest multiplier applies (`Math.max`) |
| Championship | One host on the board. The player who lands there may add +1 in place or move the host to their own city for 50 k (also +1), or decline. The multiplier keeps rising to ×10 and does not reset when the host moves | Free, and hosting is mandatory when eligible. A new city starts at ×2, the same city gains +1 up to ×5, a different city resets to ×2. The UI also calls this corner "Festival", so two separate mechanics share one name |
| Resorts | 200 k. Rent per resort 25/50/100 k with 1/2/3 owned. Can carry a festival | 200 k. 50/100/200 k. Never a festival |
| Sale to bank | The sale dialog shows the full invested total; the 2023 guide says houses sell "for full price" (strong indication of 100 %) | 50 % of invested value |
| Island | 200 k, a double or a card; up to three turns | 100 k; released after the second failed escape |
| World Tour | 50 k; only an unowned city, or one of your own tiles if none is free | 50 k; any tile |
| Start salary | 300 k on the older pages | 400 k, the user's choice; keep it |

### Prices and rents by board rank

The reference rent pattern: bare land earns very little (2–50 k). House I earns
`r`, House II `2r`, House III `3r`. The hotel earns `6r` on the first side and
`5.5r` on the other sides. Polytour uses fixed percentages of the land price
(20/60/100/140/280 %). Amounts are in thousands. "3 houses" means the land plus
three houses. A blank reference cell is still unknown.

| Rank | Polytour tile | Prototype 3 houses | Prototype rent L/1/2/3/H | Reference city | 3 houses | Rent L/1/2/3/H |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 210 | 12/36/60/84/168 | Granada | 210 | 2/25/50/75/150 |
| 2 | 2 | 220 | 14/42/70/98/196 | Seville | 210 | 2/28/55/83/165 |
| 3 | 4 | 270 | 18/54/90/126/252 | Madrid | 210 | 4/30/60/90/180 |
| 4 | 6 | 280 | 20/60/100/140/280 | Hong Kong | | 6/33/65/98/195 |
| 5 | 7 | 320 | 22/66/110/154/308 | Beijing | 250 | 6/35/75/105/210 |
| 6 | 9 | 360 | 24/72/120/168/336 | Shanghai | 270 | 8/38/75/113/225 |
| 7 | 10 | 370 | 26/78/130/182/364 | Venice | 440 | 10/70/140/210/385 |
| 8 | 11 | 410 | 28/84/140/196/392 | Milan | 440 | 10/75/150/225/413 |
| 9 | 13 | 450 | 30/90/150/210/420 | Rome | 460 | 12/80/160/240/440 |
| 10 | 15 | 470 | 34/102/170/238/476 | Hamburg | 480 | 14/85/170/255/468 |
| 11 | 17 | 510 | 36/108/180/252/504 | Berlin | 500 | 16/90/180/270/495 |
| 12 | 18 | 550 | 38/114/190/266/532 | London | | 18/113/225/338/619 |
| 13 | 20 | 560 | 40/120/200/280/560 | Sydney | 690 | 20/120/240/360/660 |
| 14 | 22 | 600 | 42/126/210/294/588 | Chicago | 710 | 22/128/255/383/701 |
| 15 | 23 | 650 | 46/138/230/322/644 | Las Vegas | | 22/135/270/405/743 |
| 16 | 25 | 700 | 50/150/250/350/700 | New York | 730 | 24/143/285/428/784 |
| 17 | 26 | 760 | 56/168/280/392/784 | Lyon | 900 | 26/170/340/510/935 |
| 18 | 27 | 810 | 60/180/300/420/840 | Paris | | 28/180/360/540/990 |
| 19 | 30 | 890 | 70/210/350/490/980 | Osaka | 950 | 35/190/380/570/1045 |
| 20 | 31 | 1000 | 80/240/400/560/1120 | Tokyo | 1000 | 50/200/400/600/1100 |

Findings:

- The captured endpoints match. Polytour's curve is linear, while the reference
  jumps between the first and second sides (270 k to 440 k three-house totals,
  House III rent 113 k to 210 k).
- Polytour's bare land rents 3–6 times more on cheap cities (12 k against 2 k).
  In the reference, a bare plot is almost only a blocker; houses earn the rent.
- Ranks 2–6 cost and earn more in Polytour (up to +50 % rent). Ranks 12–19
  cost less and earn 10–25 % less (rank 17 House III: 392 k against 510 k).
- Reference House III return on investment rises from 36 % on the first city to
  60 % on Tokyo, and the 2023 guide's strategy depends on it. Polytour's curve
  is flatter: 40 % to 56 %.
- The split between land and house cost is still unknown between the two
  captured endpoints. The sale dialog suggests a 240 k bare plot for the 13th city.

### Adopted in combined rules version 5 - 3 October 2026

The user approved every proposed change, with one exception: Earthquake can still
damage a Hotel. New rooms freeze `rulesVersion: 5` with
`economyRule: "reference"`; rooms saved under versions 2–3 keep the prototype
economy. Room settings cannot choose the marker.

1. **Hotel.** A Hotel cannot be bought out or taken by Land Swap. Earthquake can
   still remove one of its levels. There is no Landmark. Before a first completed
   lap, a city holds at most two houses; afterwards a purchase can go straight to
   three, and the Hotel follows on a later visit
   ([beginner guide](https://www.webtech360.com/detail/how-to-play-business-tour-for-beginners-44400044.html):
   "2 houses in the first round"; the third needs a full lap).
2. **Grid.** The reference values are laid side by side, so each side of the board
   keeps its price tier. The table below names the reference city each tile takes:
   the regrouped country board uses all twenty reference rank rows, including Madrid on the first side.
   A house costs 50/100/150/200 k on sides 1–4, which matches the three captured
   splits (first city, Sydney's bare plot at 240 k, Tokyo). Hotel costs are
   interpolated: 150/250/375/500 k by side. The Hong Kong, London, Las Vegas and
   Paris totals are interpolated (230, 650, 720 and 920 k).
3. **Modifiers.** A full country, a festival and the championship each add their
   bonus (×2 adds ×1), capped at ×10.
4. **Championship.** The corner is named Championship (Championnat), apart from the
   starting festivals. Hosting is optional: renewing the current host is free and
   moving it costs 50 k. Every hosting adds ×1 up to ×10. Interpretation: the
   championship stays on its tile through buyouts, swaps, sales and bankruptcies,
   so its multiplier never restarts. A timed-out choice renews a host the player
   owns, otherwise passes.
5. **Resorts.** 25/50/100 k per resort, and festivals can fall on resorts.
6. **Sales** refund 100 % of the invested value.
7. **Island** release costs 200 k; the third failed escape releases the player.
   **World Tour** reaches unowned cities and resorts, or the player's own
   properties when none is free.
8. **Tax** has no minimum.

| Polytour tiles | Reference cities |
| --- | --- |
| 1, 2, 3 · 5, 6, 7 | Granada, Seville, Madrid · Hong Kong, Beijing, Shanghai |
| 9, 10, 11 · 13, 15 | Venice, Milan, Rome · Hamburg, Berlin |
| 17, 19 · 21, 22, 23 | London, Sydney · Chicago, Las Vegas, New York |
| 26, 27 · 29, 31 | Lyon, Paris · Osaka, Tokyo |

The original PR #26 simulations used its earlier board grid. Their 1,000
four-bot matches (`tools/sim/reference.json`) kept every invariant; the following
figures describe that earlier candidate, not the regrouped version-5 board. With a 60-round cap, matches last a median of 47 rounds (prototype:
42); 28 % reach the cap (prototype: 21 %) because the first lap stops at two
houses. Monopolies still decide most matches. Bankruptcies are rarer (7.7 %
against 15 %) because sales refund the full investment. The last player in turn
order wins 19.3 % of matches instead of 15.3 %.

### World Tour to own properties - rules version 6, 3 October 2026

At the user's request, a World Tour flight can always reach the player's own
cities and resorts as well as unowned ones, instead of their own only when none
is free. This deliberately departs from the reference rule above. New rooms freeze
`rulesVersion: 6` with `worldTourRule: "free-and-own"`; version-4/5 rooms keep
`"free-first"`, and prototype rooms still fly to any other tile.

### Four resorts and building after a buyout — rules version 7, 4 October 2026

At the user's request (issues #99 and #101), two further departures from the
reference economy apply to new rooms. Owning all four resorts pays 200 k rent
instead of the third resort's 100 k, and the player who buys out a city may build
on it straight away, up to the limit a landing on their own city would allow.
New rooms freeze `rulesVersion: 7` with `fourResortRent: true` and
`buildAfterBuyout: true`; version-6 rooms keep the earlier behaviour.

## Capture from the running reference before adding an exact preset

| Area | Evidence needed | Current status |
| --- | --- | --- |
| Lobby | Every available starting capital and duration value | User preset and 20m/1h/2h choices confirmed; full slider ranges partially captured |
| Modes | Individual/teams, seat count, bot options, map choices | Four individual seats implemented; remaining modes deferred |
| Start | Crossing vs exact landing payout, per-lap unlocks | Salary 400 k user confirmed; exact landing behavior remains Polytour |
| Board | All 32 positions, purchase prices, country groups | France to Tokyo progression; reference grid laid side by side in rules version 5; land/house split partly interpolated |
| Buildings | Every level's incremental price and rent | Reference rent table adopted in rules version 5; hotel costs interpolated |
| Buyout | Cost formula, protection, payout recipient | 2× to the owner; Hotels protected in rules version 5 |
| Specials | Island, travel, championship, resorts, tax | Reference values adopted in rules version 5 (see above) |
| Cards | Deck contents, targeting, held cards | Original 16-card deck; reference comparison pending |
| End conditions | Monopolies, bankruptcy, duration tie-breaks | User monopoly switches plus last standing/resorts and real-time/round limits |

Use the actual settings screen and tile tooltips to capture this matrix, then
create a versioned config preset with tests. Do not rewrite the rules of a game
already in progress. The initial functional prototype can be played while this
comparison is being collected.
