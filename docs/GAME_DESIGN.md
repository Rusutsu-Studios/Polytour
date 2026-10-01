# Game design (playable rules v0.2)

Polytour is a fast, aggressive property game. This prototype uses four seats,
with server bots filling empty places. Compared to classic
Monopoly: a smaller board (32 tiles), bigger rents, **buyouts** (you can take an
opponent's city), several **instant-win monopolies**, and a round limit so a match
has a configurable duration. The user's default is a two-hour maximum; instant
wins and bankruptcies can end a match earlier.

All numbers here are **prototype starting values**, not a verified reproduction
of the reference game's current economy. They live in `src/shared/board/` as config
and get tuned with the simulator (`pnpm sim`) — never hard-code them in logic.
See [REFERENCE_PARITY.md](REFERENCE_PARITY.md) for the live comparison still needed
to reproduce the requested reference values and room settings accurately.

## Design pillars and v1 boundaries

- **Fast, decisive, and legible.** A player should have one meaningful decision at a
  time, and a match must finish inside the round limit without a stalemate rule.
- **Luck creates a problem; choices solve it.** Dice and cards create uncertainty,
  while buying, building, buyouts, and positioning decide the result.
- **No pay-to-win.** Match rules, starting resources, RNG, and available decisions
  are identical for every seat. Cosmetic items may never affect a match.
- **No negotiated trades in v1.** Direct player-to-player offers are intentionally
  out of scope: they slow a 20-minute match, are difficult to time out fairly, and
  make bots much weaker. Buyouts are the fast, public property-transfer mechanic.

The server owns turn order, deck order, and all random draws. Live dice come from
fresh server Web Crypto for each new match, without an external beacon wait.
Saved drand matches retain their committed-round mode. The private seeded PRNG is used for deck/turn-order shuffles
and repeatable simulations. See [RANDOMNESS.md](RANDOMNESS.md). The rules below are
written to be deterministic: when several legal targets are otherwise equivalent,
the lowest tile index wins the tie.

## Match setup, laps, and rounds

1. The server shuffles occupied seats with the match PRNG to create `turnOrder`.
   Every player starts on Start with configured cash (default 2,000,000), no property, no cards, and zero
   completed laps. The first seat in `turnOrder` starts round 1.
2. A **lap** is a clockwise crossing from tile 31 to tile 0. Crossing it immediately
   pays the Start salary and increments that player's lap count. Landing on Start by
   clockwise movement *is* that crossing: salary is paid once and one lap is counted,
   never twice. Every clockwise move (dice, World Tour, forward movement cards) pays
   salary exactly when its path crosses Start. Backward movement and "go to Island"
   never pay salary or count a lap.
3. A **round** ends when every non-bankrupt seat that was still in `turnOrder` at
   the start of that round has completed one turn. Extra rolls from doubles remain
   part of that same turn. Bankrupt seats are skipped thereafter.
4. The match's wall-clock deadline is `startedAt + timeLimitMinutes * 60,000`.
   A persistent server alarm ends it at the configured 20/60/120-minute limit.
   Pending landing effects and owed payments settle deterministically without a
   new dice roll before highest net worth wins using the standings tie-breaks.
   A separate round limit
   applies to short tests/simulations; the timed preset uses a 10,000-round safety
   cap. Twenty rounds are not labelled twenty minutes.
5. Three initial festival cities are selected by the seeded shuffle by default.
   Their visible ×2 rent effect uses the same maximum-only modifier rule as
   country ownership and the single championship host. Festival count is configurable.

> Mechanics are not protected by copyright, but names and art are trademarks. Board
> theme, city names, card names, and visuals must be our own.

## Board (32 tiles)

Corners at 0, 8, 16, 24. Each side has 7 tiles between corners. Prices rise clockwise.

| # | Side 1 | # | Side 2 | # | Side 3 | # | Side 4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | **Start** | 8 | **Island** | 16 | **Championship** | 24 | **World Tour** |
| 1 | A1 | 9 | C1 | 17 | E1 | 25 | G1 |
| 2 | A2 | 10 | C2 | 18 | E2 | 26 | G2 |
| 3 | Chance | 11 | C3 | 19 | Chance | 27 | G3 |
| 4 | B1 | 12 | Resort 2 | 20 | E3 | 28 | Resort 4 |
| 5 | Resort 1 | 13 | D1 | 21 | Resort 3 | 29 | Tax |
| 6 | B2 | 14 | Chance | 22 | F1 | 30 | H1 |
| 7 | B3 | 15 | D2 | 23 | F2 | 31 | H2 |

8 countries (A–H), 20 cities, 4 resorts, 3 Chance, 1 Tax.

## Economy (starting values)

| Parameter | Value |
| --- | --- |
| Starting cash | 2,000,000 (configurable) |
| Salary for passing/landing on Start | 400,000 (configurable) |
| Players | 4 (bots can fill empty seats) |
| Time limit | 20/60/120 minutes; default 120 (then highest net worth wins) |
| Round limit | 10,000 safety cap; custom tests/simulations use shorter caps |
| Initial festivals | 3 (configurable); neutral city squares with ×2 rent |
| Sell-back to bank | 50% of invested value |
| Buyout price | 2× invested value (paid to owner) |

**Tile-specific economy:** prices increase from 60,000 on the early French cities
to 400,000 at Tokyo. Each city has independent land, house and hotel costs in
`src/shared/board/city-economy.ts`. The actual first-city and Tokyo costs come from the
supplied editor captures; intermediate costs and all rents are provisional.

**Build levels** (each cost is incremental; rent is a provisional percentage of
that tile's land price `L`):

| Level | Name | Build cost | Rent | Notes |
| --- | --- | --- | --- | --- |
| 0 | Land | Tile land price | 0.2 × L | |
| 1 | House I | Tile house price | 0.6 × L | |
| 2 | House II | Tile house price | 1.0 × L | |
| 3 | House III | Tile house price | 1.4 × L | |
| 4 | Hotel | Tile hotel price | 2.8 × L | Unlocked after your first lap unless direct hotels enabled |
| 5 | Landmark | Tile landmark price | 4.0 × L | Only on your own Hotel; **cannot be bought out** |

`invested value` is a pure function of a tile and current level: the sum
of the build costs of every level from Land up to that level. It does not depend on
what was actually paid, so a free Contractor level counts, a level destroyed by
Earthquake no longer counts, and rent, tax, Championship effects, and buyout prices
never count. The first city's Hotel has invested value 360,000 and Tokyo's 1,500,000.
A resort's invested value is its price.

**Integer money and rounding.** Money is always an integer. Coefficients are stored
   in config as integer percentages (e.g. House III rent `140` = 1.4 × L) and evaluated
with integer arithmetic, never floating-point multiplication. Whenever a rule takes
a fraction of an amount, charges to a player round **up** (tax, Audit, Coupon rent)
and payouts to a player round **down** (sell-back refunds).

On an unowned city, the active player may decline or buy it at any level from Land
through their current unlock cap, paying every intervening cost in one transaction.
On their own city, they may decline or raise it to any higher unlocked level in one
transaction. The three Houses are unlocked from the start; Hotel unlocks after that
player completes their first lap. Landmark is only available when that player lands
on their own Hotel. An action is legal only when its full cost leaves the buyer with
cash of at least zero.

Owning every city of a country doubles the base rent of that country's Land through
Hotel properties. It does not affect Landmark rent. Championship is a separate
modifier (defined below), and the two modifiers never multiply each other: apply
whichever single modifier is larger.

> **Open balance question.** With these numbers a Landmark (4.0 × L, no modifier)
> earns less than a Hotel in a full country (5.6 × L) or a hosted Hotel (up to
> 14 × L), so upgrading can lower rent; its only gain is buyout immunity. Keep the
> rule for this prototype, but the simulator must report it (see below) before rents are tuned.

**Resorts:** price 200,000, no building. Rent by resorts owned: 1 → 50,000, 2 → 100,000, 3 → 200,000,
4 → instant win. Resorts are not cities: they cannot be bought out, hosted, targeted
by Earthquake or Land Swap, or upgraded. The only ways a resort changes hands are
buying it while unowned and its owner selling it to the bank.

## Corners and special tiles

- **Start:** collect salary when passing or landing (once per crossing, see laps above).
- **Island:** landing here, a "go to Island" effect, or a third consecutive double
  sends the pawn to tile 8 with `islandTurns = 0` and **ends the turn immediately**,
  forfeiting any pending doubles roll; it does not pass Start or resolve Island
  again. At the start of each trapped turn, the player chooses one of:
  - **Pay 100,000** (legal only with enough cash): released, then a normal roll.
    A double on that roll grants the usual extra roll.
  - **Escape roll** (free; also the timeout default): a double releases the pawn and
    those same dice move it — there is no second roll, and an escape roll never
    grants an extra roll. A non-double increments `islandTurns` and ends the turn
    without moving.

  After the second failed escape roll (`islandTurns = 2`) the player is released on
  the spot; their next turn is a normal turn.
- **Championship:** if the active player owns at least one non-Landmark city, they
  must select a host on landing here. There is one host on the board at a time,
  shared by all players. A newly selected host has a ×2 Championship modifier.
  Selecting the current host again increases its modifier by ×1, to a maximum of ×5;
  selecting a different host resets the modifier to ×2. Landmark cities cannot host:
  a host that is upgraded to Landmark, changes owner, or is sold is cleared. Rent
  uses the larger of the Championship and full-country multiplier, never both.
- **World Tour:** landing here **ends the turn immediately**, forfeiting any pending
  doubles roll, and gives that player a travel option for their next turn. At its
  start they may pay 50,000 (legal only with enough cash) to travel clockwise to
  any other tile, resolving the destination normally; otherwise, or on timeout, they
  roll normally. The option expires after that choice. A World Tour move neither
  counts as a dice roll nor creates a doubles bonus.
- **Tax:** pay 10% of your total invested property value, rounded up (minimum 50,000).
- **Chance:** draw from a 16-card deck. When its draw pile is empty, shuffle the
  discard pile to make the next draw pile; held keep cards remain unavailable.

### Payment, rent, buyout, and insolvency

1. Resolve each mandatory payment in full before offering an optional action. Rent
   is the property's current base rent with its applicable one modifier; resorts use
   the resort-rent table and have no modifier.
2. After paying rent on an opponent's non-Landmark city, the visitor may buy it out
   once. A buyout costs `2 × invested value`, paid directly to the current owner.
   The city, its level, and its invested value then transfer to the buyer. It is
   legal only if the buyer can pay without going negative. A buyout never includes a
   Championship host; ownership transfer clears the host before monopoly checks.
   Resorts cannot be bought out. A buyout ends that landing's resolution; the buyer
   can upgrade the city on a later landing.
3. Cash may become negative only after a mandatory payment. This immediately opens
   a forced-sell phase. The debtor may sell any owned cities or resorts to the bank;
   each sale returns 50% of that property's invested value (rounded down) and resets
   it to unowned Land. Selling a Championship host also clears that host. They may
   sell in any order until solvent, then continue the interrupted resolution.
4. If selling every property they own could not bring cash back to zero, the engine
   skips the forced-sell decision and the player is bankrupt immediately; otherwise
   they are bankrupt if cash is still negative once no properties remain. A bankrupt
   player's remaining property is returned to the bank, their held keep-cards are
   discarded, and they are removed from turn order. Their negative balance is set
   to zero: the bank absorbs that amount, and the bankruptcy event records it as
   `writtenOff` so that money conservation (player cash + bank ledger) still holds.
   The creditor is recorded for presentation only; it receives no extra property or
   payment. This is deliberately simple and prevents debt cascades from making
   games unwinnable.

## Turn flow

```mermaid
flowchart TD
  S[Turn starts] --> I{On Island?}
  I -- yes --> IE{Pay 100 or escape roll?}
  I -- no --> WT{World Tour pending?}
  WT -- yes --> TR{Pay 50 to travel?}
  WT -- no --> R[Roll 2d6]
  IE -- pay --> R
  IE -- "escape: double" --> M
  IE -- "escape: non-double" --> E
  TR -- travel --> M
  TR -- roll --> R
  R --> TD{3rd consecutive double?}
  TD -- yes --> ISL[Go to Island] --> E
  TD -- no --> M[Move pawn, pay salary if crossing Start]
  M --> T{Tile}
  T -- unowned city/resort --> B[Offer purchase + builds]
  T -- own city --> U[Offer upgrade / landmark]
  T -- "opponent city/resort" --> P[Rent card offer → pay rent → buyout offer if city, not Landmark]
  T -- "Island / World Tour" --> E
  T -- other --> X[Resolve tile/card]
  B & U & P & X --> D{Cash negative?}
  D -- yes --> SELL[Forced sell phase → bankrupt if still negative]
  D -- no --> W{Win condition?}
  SELL --> W
  W -- yes --> END[Game over]
  W -- no --> DB{"Extra roll earned? (dice double, not escape roll, turn not ended)"}
  DB -- yes --> R
  DB -- no --> E[End turn]
```

The turn also ends immediately whenever a card or tile sends the pawn to Island or
lands it on World Tour, even in the middle of a doubles streak.

## Win conditions and standings

1. **Last standing** — every other player is bankrupt.
2. **Triple Monopoly** — own every city of any 3 countries; enabled by default, configurable.
3. **Line Monopoly** — own every city and resort on one side; enabled by default, configurable.
4. **Resort Monopoly** — own all 4 resorts.
5. **Time limit / round cap** — highest net worth (cash + invested value) wins.

Check instant wins after any change of ownership (purchase, buyout, Land Swap, sale)
and after any forced-sell or bankruptcy phase has completed, never while a
mandatory payment or decision is pending. If one change satisfies an instant
condition for several players at once (Land Swap can complete a monopoly on both
sides), the active player wins; otherwise the first such player in `turnOrder`
after the active player. For that winner, the reported win kind is the first
satisfied condition in the list above. A line contains every city and resort
strictly between its two corner tiles; corners, Chance, and Tax never count toward
line ownership.

**Standings** (used for the game-over screen, `placement`, and ratings): the winner
is first. Remaining non-bankrupt players follow, ranked by net worth, then cash,
then number of resorts, then earliest position in the randomized `turnOrder`.
Bankrupt players come last, the most recently eliminated first. At the round limit
the same ordering picks the winner, so every match has exactly one winner.

Instant wins are the dramatic core: they force players to buy out opponents'
properties to *block* a monopoly, which is where the tension comes from.

## Chance deck (16 cards)

| Card | Effect | Keep? |
| --- | --- | --- |
| Grand Tour | Advance to Start, collect salary | |
| Stranded | Go to Island | |
| Jet Set | Move to World Tour | |
| Stadium Call | Move to Championship | |
| Windfall | Collect 150,000 | |
| Parking Fine | Pay 100,000 | |
| Birthday | Collect 50,000 from every other non-bankrupt player | |
| Audit | Pay 10% of your cash, rounded up | |
| Guardian Angel | Cancel one rent payment | ✅ |
| Coupon | Halve one rent payment | ✅ |
| Earthquake | Downgrade one opponent building by 1 level (not Landmarks) | |
| Land Swap | Optionally choose an opponent city; exchange it with your eligible city of lowest land price (not Landmarks) | |
| Detour | Move back 3 tiles | |
| Contractor | Upgrade one of your cities by 1 level for free | |
| Jailbreak | Everyone on the Island is released | |
| Charity | Give 100,000 to the poorest player | |

### Chance resolution details

- Drawn, non-keep cards resolve immediately, then enter the discard pile. Keep cards
  leave the deck until used; a player can hold at most one Guardian Angel and one
  Coupon. When used, they enter the discard pile. When the draw pile is empty, its
  discard pile is shuffled to replenish it; held cards remain out of that shuffle.
- A movement card moves and resolves its destination as though the pawn landed there.
  It cannot grant a doubles roll. Grand Tour, Jet Set, and Stadium Call move
  **clockwise** along the board, so the lap rule applies: Grand Tour always pays
  salary once and counts a lap, and Stadium Call drawn on tile 19 goes all the way
  round and does too. (The client may animate a long card move as a teleport; the
  rule still follows the clockwise path.) Detour moves counter-clockwise and never
  pays Start, even when it lands on Start. Jet Set ends the turn on World Tour, and
  Stranded sends the pawn to Island; both use those tiles' rules.
- A card with no legal target (or no legal effect) does nothing and is discarded.
- Guardian Angel is offered after a rent amount is known and before it is paid; it
  reduces that rent to zero. Coupon is offered at the same time and halves the rent,
  rounded up. At most one of these cards may be used for a single rent payment.
- Earthquake targets an opponent's House, Villa, or Hotel; its invested value drops
  with its level (no refund). Land Swap targets an opponent non-Landmark city whose
  land price is no greater than the drawer's cheapest eligible non-Landmark city;
  the engine exchanges it with that cheapest city. Each city keeps its current
  level, and therefore its invested value, as it changes owner. The drawer may
  decline the swap. This preserves a single-tile target decision. Any Championship
  host involved in a swap is cleared.
- Contractor targets one of the drawer's non-Landmark cities and raises it exactly
  one legal level for free (Hotel still requires a completed lap); the free level
  counts toward invested value. It cannot create a Landmark, so a Hotel is not a
  legal target. Jailbreak clears Island status without moving pawns.
- Birthday payments resolve one payer at a time in `turnOrder`, and each payer may
  enter forced selling before the next payer is charged. Charity chooses the
  non-bankrupt player with the lowest cash, excluding the drawer; ties use earliest
  position in `turnOrder`. If no other player remains, it has no effect.

"Keep" cards are held as described above; the engine prompts to use them only when
they are legal and relevant.

## Dice

- Uniform 2d6 from server-injected entropy. A double on a normal roll (including the roll
  after paying to leave Island) grants another roll after the current landing is
  fully resolved, unless that landing ended the turn (Island, World Tour). Island
  escape rolls never grant one. A third consecutive double sends the player to
  Island instead of moving; the counter resets whenever the turn ends.
- **No biased power gauge.** The user explicitly requires genuinely random dice.
  Holding a button, account history, spending, cosmetics, or bot difficulty must
  never change the dice distribution. Any future throwing gesture is cosmetic.

## Timers (defaults)

| Decision | Time | Timeout default |
| --- | --- | --- |
| Roll (incl. Island pay-or-escape, World Tour travel-or-roll) | 10 s | Auto-roll (escape roll on Island, no travel on World Tour) |
| Buy / build / buyout | 15 s | Decline |
| Choose host / card target | 15 s | Deterministic legal default |
| Forced sell | 30 s | Sell cheapest properties until solvent |

Animation time is added on top of these. The engine computes each decision's
`deadline` as `now + decision time + animationBudget(events)`, from timing config in
`shared/board` (see [ARCHITECTURE.md](ARCHITECTURE.md#timers-and-disconnects)).

Timeout defaults must be rules, not an opaque "best move" heuristic: a timed-out
World Tour is declined; a Championship chooses the eligible city with the highest
current rent (then lowest tile). Earthquake targets the opponent city with the
highest current rent, and Contractor targets the city with the greatest next-level
base-rent increase (each then breaks ties by lowest tile). A timed-out Land Swap or
keep-card prompt declines. A timed-out forced sell chooses the lowest refund first,
then lowest tile, and repeats until the player is solvent or bankrupt.

These defaults are deterministic from public state and are what `applyTimeout`
applies to a **human** seat whose decision timer expires, whether that player is
connected or inside the disconnect grace period. **Bot** seats never time out: they
act through `botAction` at their difficulty. A disconnected human seat becomes a
bot seat (medium difficulty) when its grace period ends, until the player reconnects.

## Engine contract

```ts
// src/shared/engine/index.ts
// GameState = PublicState + server-only secrets (PRNG state, deck order).
export function createGame(config: GameConfig, seats: SeatInfo[], seed: number, ctx: { now: number }): { state: GameState; events: GameEvent[] };

export function applyAction(
  state: GameState,
  seat: Seat,
  action: Action,
  ctx: { now: number; dice?: readonly [number, number] },
): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: RuleError };

export function applyTimeout(state: GameState, ctx: { now: number }): { state: GameState; events: GameEvent[] };

export function applyEvent(state: PublicState, event: GameEvent): PublicState; // pure reducer, used by server and client

export function toPublic(state: GameState): PublicState; // strips secrets; this is the snapshot

export function legalActions(state: PublicState, seat: Seat): Action[]; // drives UI buttons and bots

export function botAction(state: PublicState, seat: Seat, difficulty: BotDifficulty): Action;
```

`applyAction`, `applyTimeout`, and `createGame` decide *what happens* and emit
events; every change to public state is then made by folding those events with
`applyEvent`. The client uses the same reducer to advance `serverState` and the
Director's `viewState`, so both sides agree by construction. Two rules keep that
true:

- **Events are complete.** The reducer never re-derives a rule (it doesn't compute
  rent, laps, or hosts); every public change is carried by some event field.
- **Each money movement appears in exactly one event.** Events with a dedicated
  amount (`SalaryPaid`, `PropertyBought`, `PropertyUpgraded`, `RentPaid`,
  `BoughtOut`, `PropertySold`) are not duplicated by `MoneyTransferred`, which is
  only for movements without their own event (tax, card effects, Island and World
  Tour fees).

`SalaryPaid.amount` is the single accounting input: the reducer adds it to the
player's existing cash and subtracts it from the bank ledger. The redundant
absolute `cash` field remains on the wire for previously opened clients and
stored-event compatibility; the current reducer ignores it. This adopts only the
salary-calculation improvement from PR #12 into the complete prototype engine.

Property test: for any action sequence,
`toPublic(next) == events.reduce(applyEvent, toPublic(prev))`.

`PublicState.pending` describes exactly which seat must decide what (e.g.
`{ kind: "buy", seat: 2, tile: 13, maxLevel: 2 }`), so the UI never guesses whose turn
it is or what's allowed. The engine must expose the legal target set for every
choice; neither the UI nor a bot may infer it from board state.

## Balancing with the simulator

`tools/sim` runs thousands of bot-vs-bot games in Node using the same engine. Track:

- Median and p90 game length (target: 14–18 rounds median, few games hitting the limit).
- Win condition mix (target: bankruptcies and monopolies both common; round-limit wins < 25%).
- Seat advantage (first player win rate should be within ±3% of fair share).
- Termination: no game ever exceeds the round limit or loops.
- Money conservation: player cash + bank ledger (including bankruptcy `writtenOff`)
  is unchanged by every event.
- Per-condition instant-win rates. Resorts can't be bought out, so one resort can
  block Resort Monopoly and its side's Line Monopoly for good; if either rate is
  near zero, revisit that rule.
- Landmark build rate and rent earned per Landmark vs. full-country or hosted
  Hotels (see the open balance question under Economy).

Change one parameter at a time and commit the sim output alongside the config change.

## Modes (roadmap)

- **Private room** (friends, room code, bots optional) — implemented in this prototype.
- **Quick match** (2p / 4p, matchmaking) — Phase 4.
- **Ranked** (rating per mode) — Phase 7.
- **2v2 teams** (shared win conditions, can't pay rent to teammates) — Phase 7.
