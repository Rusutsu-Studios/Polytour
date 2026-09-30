# Polytour

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Friends who want to play a four-seat property board game in a PC browser with a mouse and keyboard. A player can also start alone with three server-controlled bots. Desktop is the product priority: 1280×720 is the minimum layout target, with 1440×900 and 1920×1080 as the main evaluation sizes. Mobile support is best effort and may become a separate future adaptation; it is not a release gate for this prototype.

## Product Purpose

Create rooms, invite friends with a room code, and finish a real match: roll two dice, travel, buy and develop destinations, collect rent, and compete for the winning portfolio.

## Positioning

The user explicitly asks for a property game without paid advantages and with honest randomness. In strict mode, the server commits to a future drand beacon round before the roll, verifies its signature, and supplies the roll proof. The fast alternative uses fresh cryptographic server randomness. Neither dice selection nor cash is controlled by the client.

## Operating Context

The existing architecture specifies a Cloudflare Worker, one authoritative Durable Object per room, deterministic shared rules, and events driving animation. A room has four seats; empty seats may be filled by bots. Reconnection restores the player's seat from a credential stored in the current browser session. During a match, the board occupies the desktop viewport and four compact player HUDs frame its corners. Contextual decisions appear when needed; journal, proof, instructions, room information and tile details are closed by default.

## Capabilities and Constraints

- The first playable slice uses a 32-tile board, purchase and development choices, rent, island, travel, championship, cards, and bankruptcy rules implemented in the shared engine. A pending payment decision belongs to its actual debtor, even during another player's turn.
- The user confirmed a default 2,000,000 starting cash, 400,000 start salary, three initial festivals, line and triple-collection victories enabled, and an adjustable 20/60/120-minute match duration. Cash, salary, festival count, decision duration, randomness mode, direct hotel purchase, doubles, bot building, and gift bankruptcy are room settings.
- Cheap-end captured costs are 60,000 land, three 50,000 houses, and a 150,000 hotel; Tokyo costs are 400,000 land, three 200,000 houses, and a 500,000 hotel. Intermediate cities, rents, taxes, and card effects are provisional tuning, not an exact-parity claim.
- No payments, paid dice, paid boosts, or account progression belong in the first match.
- Production publication, durable user accounts, trading, audio, advanced physical dice, and cosmetic purchases are separate work.
- drand availability is a real dependency in strict mode: the match waits and retries its committed round rather than silently substituting another source.
- Host settings remain a local draft until explicitly saved. A room cannot start with unsaved edits. The match toolbar counts down to the server-provided end time.

## Brand Commitments

Polytour is the existing name. The user supplied board-game screenshots as references for feel, values, and room settings, and asked about Three.js. On 1 October 2026 the user clarified that the game is for PC and should follow the familiar property-board game composition: a large central isometric board, player information at the corners and discreet menus. This replaces the previous dashboard composition with large permanent panels. Retain the original premium toy geometry, readable motion, ivory board and player symbols, with a sky-blue surround and a grassy center. The user selected a travel progression from affordable French cities toward international cities, finishing with Osaka and Tokyo. Build original geometry; do not import competitor branding, characters, or artwork. The first product interface is French, reflecting the user's working language.

## Evidence on Hand

The architecture and animation documentation live in `docs/`. Screenshots and explicit values supplied in this chat establish the visual reference, default room settings, and two price endpoints. This prototype distinguishes those confirmed values from the intermediate economy still to compare and tune.

## Product Principles

- A complete playable match precedes breadth of features.
- The same server rules govern humans and bots.
- Player choices stay legible while animation catches up.
- Randomness claims require visible, inspectable evidence.
- The room code and reconnect path make playing with friends practical.
- The board leads the PC experience; the interface supports the match without occupying its play area.

## Accessibility & Inclusion

Every player color also has a distinct symbol. All decisions, room controls, and tile inspection have keyboard-accessible DOM controls. Respect reduced motion and provide animation speed and skip controls. Money, deadlines and essential labels must remain legible at the minimum desktop target, and overlays must preserve keyboard focus and dismissal. Optional mobile adaptation must not compromise the desktop board or require a physical phone FPS result to ship this prototype.
