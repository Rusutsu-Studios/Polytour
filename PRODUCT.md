# Polytour

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Friends who want to play a property board game for two to four players in a PC browser with a mouse and keyboard. A player can also start alone with three server-controlled bots. Desktop is the product priority: 1280×720 is the minimum layout target, with 1440×900 and 1920×1080 as the main evaluation sizes. Mobile support is best effort and may become a separate future adaptation; it is not a release gate for this prototype.

## Product Purpose

Create rooms, invite friends with a room code, and finish a real match: roll two dice, travel, buy and develop destinations, collect rent, and compete for the winning portfolio.

## Positioning

The user asks for a property game without paid advantages and with honest randomness. Each new match uses fresh cryptographic randomness on Cloudflare for every roll, without waiting for drand. Dice use uniform rejection sampling. Neither dice selection nor cash is controlled by the client. Saved drand matches keep their existing commitments and proof export for compatibility.

## Operating Context

The existing architecture specifies a Cloudflare Worker, one authoritative Durable Object per room, deterministic shared rules, and events driving animation. A room has four seats and starts with two to four players. Play opens the lobby with three bots; a friend entering the code takes a bot's place, and any seated player can seat someone sharing their screen. The room leader (its creator until they pass the role on) adds or removes bots, starts, locks the room so newcomers wait for approval, hands a bot's place to someone who arrived mid-game, and brings everyone back to the lobby for another game. Reconnection restores the player's seat from a credential stored in the current browser session. During a match, the board occupies the desktop viewport and up to four compact player HUDs frame its corners. Contextual decisions appear when needed; journal, proof, instructions, room information and tile details are closed by default.

## Capabilities and Constraints

- The first playable slice uses a 32-tile board, purchase and development choices, rent, island, travel, championship, cards, and bankruptcy rules implemented in the shared engine. A pending payment decision belongs to its actual debtor, even during another player's turn.
- The user confirmed a default 2,000,000 starting cash, 400,000 start salary, three initial festivals, line and triple-collection victories enabled, and an adjustable 20/60/120-minute match duration. Cash, salary, festival count, decision duration, direct hotel purchase, doubles, bot building, and gift bankruptcy are room settings. New matches automatically use server Web Crypto.
- Cheap-end captured costs are 60,000 land, three 50,000 houses, and a 150,000 hotel; Tokyo costs are 400,000 land, three 200,000 houses, and a 500,000 hotel. Intermediate cities, rents, taxes, and card effects are provisional tuning, not an exact-parity claim.
- New rooms limit an initial purchase to three houses. A hotel requires a later landing on an owned three-house city and a completed lap, unless the host explicitly enables direct hotels. Existing rooms keep their frozen earlier rule. Construction choices show the total cost or additional payment and the rent from the shared engine's candidate-state calculation.
- No payments, paid dice, paid boosts, or account progression belong in the first match.
- Production publication, durable user accounts, trading, audio, advanced physical dice, and cosmetic purchases are separate work.
- New rolls require no external randomness service. Saved drand matches still honor their committed round, without silently changing their source mid-game.
- Host settings remain a local draft until explicitly saved. A room cannot start with unsaved edits. The match toolbar counts down to the server-provided end time.
- Room sliders support precise cash/salary entry; duration and decision time use discrete choices. Illustrated central decisions separate comparing an option from confirming it. Chance cards show their effect before event playback resumes; the server clock continues while the bounded reading moment is open.

## Brand Commitments

Polytour is the existing name. The user supplied board-game screenshots as references for feel, values, and room settings, and asked about Three.js. On 1 October 2026 the user clarified that the game is for PC and should follow the familiar property-board game composition: a large central isometric board, player information at the corners and discreet menus. The latest reference requires a shallow, clear board with simple low-poly buildings, readable printed city names and prices, and much less raised scenery. Retain readable motion and player symbols, with a sky-blue surround and grassy center. The user selected a travel progression from affordable French cities toward international cities, finishing with Osaka and Tokyo. Build original geometry; do not import competitor branding, characters, or artwork. The interface now supports French and English, with French as the default. Instructions name the actual game action; remove hollow marketing slogans. The welcome screen offers play, room creation/joining and three quick-setting sliders beside the board.

## Evidence on Hand

The architecture and animation documentation live in `docs/`. Screenshots and explicit values supplied in this chat establish the visual reference, default room settings, and two price endpoints. This prototype distinguishes those confirmed values from the intermediate economy still to compare and tune.

## Product Principles

- A complete playable match precedes breadth of features.
- The same server rules govern humans and bots.
- Player choices stay legible while animation catches up.
- Explain server randomness honestly; never claim a publicly verifiable proof for Web Crypto dice.
- The room code and reconnect path make playing with friends practical.
- The board leads the PC experience; the interface supports the match without occupying its play area.

## Connection diagnostics

Debug shows connected players' Cloudflare ingress routes toward their shared GameRoom and its local SQLite database. A small history graph measures the room WebSocket round trip every five seconds only while the view is visible. The public Worker endpoint is shown; unhelpful jurisdiction and physical DO host/DC rows are omitted. No player IPs, credentials or database contents are exposed. Latency probes add no Worker HTTP calls and do not touch SQLite. A routing snapshot is requested once on opening or reconnecting; its handler reads no game database rows, though waking the DO may run its normal schema initialization.

## Accessibility & Inclusion

Every player color also has a distinct symbol. All decisions, room controls, and tile inspection have keyboard-accessible DOM controls. Respect reduced motion and recover automatically from delayed events or hidden tabs. A pause menu offers continue, personal settings and leave while the match keeps running. Settings use Game, Video, Audio and Debug tabs; Audio is reserved for the upcoming sound work. Cloudflare's HTTP round-trip time is measured through a static asset that bypasses the Worker; Debug shares that measurement and shows the contacted host and Cloudflare entry point with its region. A small bottom-right indicator such as `AMS · 42 ms` refreshes every five seconds throughout the visible, connected match. Room WebSocket diagnostics run only while Debug is open. Money, deadlines and essential labels must remain legible at the minimum desktop target, and overlays must preserve keyboard focus and dismissal. Optional mobile adaptation must not compromise the desktop board or require a physical phone FPS result to ship this prototype.
