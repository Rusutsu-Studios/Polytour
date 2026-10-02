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
from city tiles using the private shuffle, carry a visible ×2 rent modifier, and
are separate from the corner's championship host. Their full reference behavior
is still a balance comparison item.

The user wants inexpensive French cities near Start and a worldwide progression
ending at Osaka and Tokyo. These are game prices, not claims about real-world
economic value. The current 32-tile/20-city layout follows Polytour's board rather
than copying the inconsistent 22-city list from the pasted conversation.

| Captured tile | Land | Each of houses 1/2/3 | Hotel | Total through hotel |
| --- | --- | --- | --- | --- |
| Grenade / first-city cost template | 60 k | 50 k | 150 k | 360 k |
| Tokyo | 400 k | 200 k | 500 k | 1.5 M |
| Any of the four resorts | 200 k | Not available | Not available | 200 k |

Those captured endpoint costs are implemented directly in the tile economy.
Intermediate cities and rent tables are provisional, not verified reference
values. A sixth Landmark level remains an original Polytour mechanic from the
repository rules; it is not claimed to be shown in the supplied editor captures.

## Hotel progression and source checks — 1 October 2026

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

## Forced sale comparison — 2 October 2026

The user's liquidation screenshot shows selection directly on highlighted board
tiles, displayed proceeds of 240 k and 710 k, a selected-city checkmark, and a
separate sale confirmation. It also shows debt and the projected remaining cash.
This supports board-based selection and an explicit quote before committing.
The purchase/build costs of those two properties are not visible, so the image
does not establish a refund percentage or a rent-based formula.

The [official Steam page](https://store.steampowered.com/app/397900/Business_Tour__Online_Multiplayer_Board_Game/)
and [publisher FAQ on Epic](https://store.epicgames.com/p/business-tour-board-game-with-online-multiplayer-faq-27319a?lang=en-US)
were checked for sale rules; neither gives a city liquidation calculation.
Polytour's previous 50% refund was a provisional tuning choice, not a confirmed
reference rule. To address the reported low sale prices, new Polytour rooms return
100% of land plus all standing buildings. For example, the first city's House III
returns 210 k and Tokyo Hotel returns 1.5 M. Resorts return their 200 k price.
Rent bonuses, tax, and buyout premiums do not increase proceeds. This is an explicit
Polytour adjustment; exact reference liquidation parity remains unverified.
Existing rooms retain 50% under their frozen rules version.

## Capture from the running reference before adding an exact preset

| Area | Evidence needed | Current status |
| --- | --- | --- |
| Lobby | Every available starting capital and duration value | User preset and 20m/1h/2h choices confirmed; full slider ranges partially captured |
| Modes | Individual/teams, seat count, bot options, map choices | Four individual seats implemented; remaining modes deferred |
| Start | Crossing vs exact landing payout, per-lap unlocks | Salary 400 k user confirmed; exact landing behavior remains Polytour |
| Board | All 32 positions, purchase prices, country groups | France to Tokyo progression; intermediate reference table pending |
| Buildings | Every level's incremental price and rent | First-city/Tokyo costs captured; rent table pending |
| Buyout | Cost formula, protection, payout recipient | Polytour v0.1 config; reference comparison pending |
| Forced sale | Proceeds relative to land and standing buildings | Board selection captured; new-room 100% is Polytour tuning, reference ratio unverified |
| Specials | Island, travel, championship, resorts, tax | Polytour v0.1 rules; reference comparison pending |
| Cards | Deck contents, targeting, held cards | Original 16-card deck; reference comparison pending |
| End conditions | Monopolies, bankruptcy, duration tie-breaks | User monopoly switches plus last standing/resorts and real-time/round limits |

Use the actual settings screen and tile tooltips to capture this matrix, then
create a versioned config preset with tests. Do not rewrite the rules of a game
already in progress. The initial functional prototype can be played while this
comparison is being collected.
