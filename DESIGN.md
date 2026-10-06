---
name: Polytour
description: A PC property-board game seen from its Start corner, with a classic printed board and corner player HUDs.
colors:
  ink: "#173b45"
  muted-ink: "#47666c"
  sky: "#75d4ed"
  sky-light: "#b7edfa"
  sky-deep: "#5bc3e5"
  grass: "#a5c957"
  grass-light: "#badb72"
  grass-deep: "#95b949"
  grass-detail: "#d5e698"
  paper: "#fffaf0"
  primary: "#c74024"
  primary-dark: "#98291a"
  primary-hover: "#b8331b"
  gold: "#ffcb55"
  sea: "#67cbe3"
  player-coral: "#be3d24"
  player-blue: "#236cce"
  player-violet: "#8151b5"
  player-green: "#26764c"
typography:
  display:
    fontFamily: "Trebuchet MS, Segoe UI, sans-serif"
    fontWeight: 900
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  small: "8px"
  panel: "16px"
spacing:
  small: "8px"
  control: "12px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.small}"
    padding: "14px 22px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.small}"
    padding: "12px 18px"
---

## Overview

**Creative North Star: “The board is the game.”**

The user confirmed the familiar PC property-board game composition on 1 October 2026: an original isometric toy board fills the play viewport, four compact player HUDs occupy the corners and discreet controls expose the current decision. The old dashboard composition with a persistent sidebar and stacked information panels is replaced. Local browser captures verify that composition at 1280×720, 1440×900 and 1920×1080 without page scroll or off-screen controls. Dated evidence, the verified Preview revision and the remaining hardware FPS check live in `docs/PLAYABLE_CHECKPOINT.md`; each later refinement requires its own browser verification.

On 2 October 2026 the user asked for the familiar tabletop orientation: the board starts on the right and play goes left. The camera now looks at the board from its Start corner, which sits at the front of the screen; a pawn leaving Start walks left toward the island, then on to the festival at the back and the world tour on the right. Play is clockwise on screen, as the rules have always described it. Lots follow classic proportions: four large corner squares and seven deeper, narrower lots per side, each printed in two parts: the city ground with its buildings and a small city name, then a strip with a large price. Beaches are the exception: one piece of sand from the sea to the edge, with the price on the sand.

Retain the travel progression from French cities to Tokyo, rounded pawns, flags and dice. The latest user reference asks for less visual depth and clearer tiles: a shallow lilac-and-ivory track, small simple buildings and an unobstructed printed name and price on each city. A sky-blue surround and grassy center provide the setting. The board carries the story; interface tools open on demand rather than sharing equal visual weight with it.

The user's later 1 October reference explicitly asks for centered illustrated
decisions. Purchases, development, buyouts and other choices now temporarily dim
the board and open an ivory dialog with a title ribbon. Original isometric city
previews and selectable building stages precede one final confirmation. Price,
projected rent and remaining cash use shared engine helpers.
Escape minimizes a decision without sending an action; the bottom prompt reopens
it. Roll and opponent turns keep their compact bottom prompt.

Unavailable choices explain their prerequisite in a small ivory popup with a
gold heading, on hover or keyboard focus. Loading and room preparation use inline
labels and spinners, without popups. Minimized decisions use a bottom tab with
their title and live countdown. The welcome screen's settings gear opens the shared personal settings panel. Its language row shows
French and English in a native select, separate from the room rules.
Changing it switches directly to the other language; Enter and Space do the same.
Chance cards hold for eight seconds; tax payments use the same reading window
for six seconds, visible to all players. Continue or Escape ends a reading hold.

On 2 October 2026 the user found the game too fast and too wordy. A turn now
reads like a tabletop game: dice shake, fly and settle, pawns hop tile by tile,
cards hold long enough to read, and houses rise out of their plot. Bots wait for
those animations, then pause before acting. Dialogs drop sentences that repeat
their title or numbers; a hotel the player cannot take yet stays on screen,
greyed out with a padlock. A healthy connection, the round counter of an
unlimited match and secondary HUD lines stay off screen.

Later on 2 October 2026 the user found the middle of the board empty and asked
for a living center that builds up during the match, like the familiar mobile
and console property games, while staying readable. The lawn becomes a small
town: a paved plaza where the dice land, a roundabout, four avenues to the
corners, and facing each side one street of six plots, one per city or resort
of that side. An unsold plot stays an empty outline in its country's color, with
no tree; a bought one shows the lot's own level (flag, house, town house, block,
hotel tower, landmark with a gold spire) under the owner's color. A crane works
beside a plot while the Director plays its construction. Cars, a big wheel, a
carousel, a sailing pond, a helicopter and four fountains add ambient motion
during a match; lobby previews stay still.
Nothing in the town may hide a pawn, a lot, the board road or a die at rest;
layout tests project every town envelope through the camera to prove it.

Drawn cards have a separate illustrated reading moment, using three original
painted image families with individual effect text. Four small banknote reserves,
gold coins and owner-coloured straps sit outside the board track; quantities are
illustrative and capped, while HUD figures remain exact. Money transfers follow
the payer and recipient in the server event. Room settings open in a centered
dialog with sliders, exact entry and discrete duration choices. No permanent
sidebar or additional dashboard is introduced.

Build the scene with React Three Fiber and Three.js. GSAP owns scene choreography and Motion owns DOM transitions. The Director separates authoritative state from the events already shown to the player. The screen's strategy is recorded in its Experience surface brief, not a marketing-page layout.

## Colors

Sky blue owns the viewport as a soft radial gradient with a few faint floating tiles, a green park town with pale paving owns the board center and ivory carries the track and compact functional controls. Each country paves its cities its own way, in its own color, as on the reference boards: a lawn, flagstones, a Portuguese wave mosaic, smooth concrete slabs for Italy-Germany (square) and Czechia-Austria (long, staggered), crazy paving, slate and a timber deck. Stones vary slightly in tone and carry a soft lit and shaded edge so the ground reads as built, not printed; their joints stay only a little deeper than the stones, so a pavement never competes with names and prices. Six country colors are vivid hues spread around the wheel (blue, orange, green, yellow, teal, orchid pink) and the two concrete regions take muted tones (slate lavender, warm taupe), so none reads as another; look-alike pairs sit on different sides of the board and yellow stays away from the beaches' sand. Price strips, the tax square and the chance squares are smooth light concrete. Ink preserves readable prices and names; coral identifies the current primary action; gold identifies festivals and their multiplier. Four player colors identify the players.

**The Identity Rule.** Players are told apart by color only (user decision, 3 October 2026). Pawns, roofs, flags, rents, corner HUDs and the inspector use the player's color; no circle, diamond, triangle or square symbols appear anywhere. The four colors stay far apart in hue and lightness, and names accompany colors wherever a player is referred to in text.

## Typography

Keep system fonts and avoid a network font requirement. Trebuchet supplies the compact toy-game identity; Segoe UI supplies functional labels. Cash, prices, dice values and countdowns use tabular numerals. Essential desktop HUD labels remain at least 14 px at the minimum layout target. Large marketing headlines do not occupy the match viewport.

Primary player names, decision prompts, deadlines and choices use at least 14 px.
Supporting portfolio counts and connection/seat captions may use 9–12 px; money
uses 24–31 px, contextual titles 21–24 px, and the lobby alone uses display sizes.
Construction-choice prices use 19 px at the main target and 17 px at 1280×720;
their rent and hotel prerequisites use at least 14 px.
Solid coral actions use a darker tone so ivory button text exceeds 4.5:1 contrast.

Board lettering is part of the track: town names and prices sit on their tiles. Prices use the compact printed form (350K, 1,2M) so they can be large; the corner names use white letters with a dark outline. Selected and decision-related destinations receive a readable DOM label with their price, owner and rent; small perspective labels never become the only way to understand a choice.

## Layout

PC browser play with a mouse and keyboard is the priority. Validate 1280×720 as the minimum, with 1440×900 and 1920×1080 as the main targets. During a match, the board sits between the match title and tools above and the current choice below, centered, and all four corners stay visible through a fixed isometric orthographic camera aimed from the Start corner. The page must not require vertical scrolling to find a required action. On 1440p and 4K screens at 100 % scaling, the DOM interface zooms in steps (×1.25 to ×2) to keep the 1920×1080 proportions; the board framing reserves the zoomed bands, and the WebGL canvases never zoom.

Place four compact player HUDs at the corners, approximately 296×98 px at the main target: a portrait tile in the screen corner, a ribbon in the player's color carrying the name, and an ivory plate with the cash and concise portfolio status. Bottom seats carry the ribbon below the plate; right seats mirror left seats. Each seat's banknote reserve lies beside the board edge nearest its HUD. Keep room/connection state, remaining match time and animation controls discreet. Rolls, opponent turns and minimized choices use the compact bottom-center prompt. A player's other legal decisions open a temporary centered illustrated dialog, up to 850 px wide, as requested in the later reference. Settings use a 900 px sheet. Fit each dialog within the minimum PC viewport, then return focus to play. Keep the board's camera and size throughout.

Journal, randomness proof, instructions, room information and tile details are closed by default. Open them as dismissible popovers or dialogs through labeled controls. Selecting a board tile opens details for that tile, without previous/next navigation or a toolbar magnifier. During a match, graphics quality is selected only in Pause > Video with High and Low choices side by side. The room panel shows compact player portraits with names below, and the leader can choose an eligible successor there. The shared avatar renderer keeps cosmetic appearance independent of seat color and room role, ready for future custom portraits. The lobby exposes name, create/join and settings alongside the world; it does not determine the match's composition.

Mobile is best effort. A future touch adaptation may use its own layout; portrait stacking and physical phone FPS do not constrain the PC design or block this prototype.

## Elevation & Depth

The board has a two-tone physical edge and slightly raised lot faces. Each lot is printed in two parts, as on the reference boards (issue #57); only beaches are a single piece of sand. The city ground takes the end nearest the top of the screen (the inner end on the two front sides, the outer end on the two back sides): small original buildings stand at its top and the city name sits below them. The price strip takes the other end and shows only the amount: the purchase price in ink, or once the lot is sold the rent in the owner's color. A crisp dark seam and the strip's lit edge separate the two parts. No other label repeats ownership or development, because the buildings already show both. Buildings never hide the name or the amount below them. Pawns walk on a road just inside the lots; on the corners they stand on the free inner quarter, beside the landmark. Gabled houses, a compact hotel and a restrained landmark distinguish development without tall towers or layered cornices. Reduce vegetation and corner scenery to recognizable small silhouettes: a palm island, an open-air festival arena and an airport with its tower and airliner. Start is printed flat, with a checkered line, an arrow toward the first lot and the room's salary, so nothing tall stands at the front of the board. The center is a low town around a paved plaza that stays available to the dice, which take the roller's color and show their total on a small scoreboard. Town heights follow a visibility rule: an object may be no taller than its distance to the lawn edge behind it, so the back road, back lots and pawns always stay in view; the tallest town building (0.68 units) stands lower than a die's top face. Lot buildings remain the authoritative development display; the town plots echo them.

Compact ivory controls use restrained structural shadows, and action buttons retain a darker lower edge for a physical press. Avoid permanent glass overlays across the board. Hover, ownership changes and festivals add local feedback, not general interface ornament.

**The Material Rule.** Depth describes a physical toy or a usable control.

## Shapes

Softly curved controls belong to the toy-game language. Corner HUDs remain compact rather than becoming a repeated grid of large cards. Roofs, palms, flags and pawns retain simple low-poly geometry. Building levels must remain distinguishable; a festival city hangs a garland of vivid pennants between two masts along its plot, which reads well from the board's angle; a championship host adds two searchlights. No multiplier floats over the board: the inspector shows it. Ownership flags carry the player's color.

## Components

The contextual decision names its actual decision-maker using `pending.seat`, including off-turn debts. Purchase and development options pair a building silhouette with the total cost or additional payment and the resulting rent computed by the shared engine. They expose only legal levels and explain the staged hotel requirement when locked. Rent protection and buyout decisions show the destination and relevant cost/owner/rent beside their legal choices. A roll has one strong action. Multi-destination choices use a labeled select and confirm control. Legal actions come from the shared engine.

Host settings remain a visible local draft until explicitly saved; starting with unsaved changes is blocked. Room-code copy and sharing support invitation. The match timer counts down to the server-provided deadline. Busy, reconnecting, rejected, waiting and finished states stay explicit without exposing engine implementation details in the main play flow.

How to play explains the server's fresh cryptographic draws and equal face probabilities, with the Cloudflare Web Crypto documentation link. The same French/English help is available from the welcome screen and during a match. The dice tool shows the last roll and a shortcut to that help; new-room settings keep the explanation out of their controls and have no randomness-mode selector. Never suggest a public signature or exportable beacon proof for server Web Crypto. Saved drand rooms retain their honest waiting/error state, source-specific help and proof export. Game-end standings emphasize the actual winner, victory condition and final fortune, then show the final ranking supplied by the server. The winner leads that ranking even when a collection victory leaves another player richer. Preserve the board behind the overlay.

Menus restore keyboard focus on dismissal, support Escape where appropriate and retain a visible focus indicator. Reduced motion keeps informative changes without camera spectacle.

The pause icon opens a compact ivory menu with Continue, Settings and Leave. A solo match pauses immediately; closing the menu or continuing resumes it. Multiplayer keeps running until every human agrees to a request in this menu. The vote names each human and their answer, including people sharing a screen, and expires after 30 seconds. One request is allowed per room every five minutes. An accepted pause freezes turns and clocks, and Resume game is available to any human; dismissing the multiplayer menu keeps the match paused with a toolbar status that reopens it. Personal settings share one panel between the lobby gear and the pause subpage. Language is always visible; Video contains graphics, persisted board size and fullscreen. Accessibility offers System, On and Off for reduced motion. One versioned browser preference record migrates the previous language, graphics and motion choices, and synchronizes open tabs. Audio says "Coming soon". Debug is available in development or with ?debug. Only that mode measures the HTTP round trip to a same-origin static Cloudflare asset every five seconds while connected, visible and online. Debug shares this stream and shows the host and Cloudflare entry point (code, location and region). A tiny bottom-right indicator such as `AMS · 42 ms` keeps refreshing outside Debug. Local execution and unavailable entry-point metadata are explicit. The separate sliders icon displays the fixed room rules; the invitation icon displays the room code.

The expanded Debug sheet keeps actual transport measurements separate: static Cloudflare HTTP and room WebSocket round trips. Connected players' ingress POPs and regions converge toward one GameRoom containing SQLite. Jurisdiction and physical DO host/DC placeholder rows are omitted, and no precise Worker-to-DO latency is inferred from subtracting these different measurements. A small timestamped RTT chart breaks gaps and includes readable summary values; room-diagnostic traffic stops as soon as the view closes or becomes hidden. The static HUD probe continues while the visible match is connected and debug mode is enabled.

**The Timing Rule.** The Director shows the events leading to a decision before the choice opens. Playback uses fixed normal pacing with automatic catch-up and recovery. New decisions and reading cards cannot take focus from the open pause menu.

Browser verification covers the reduced-animation toggle, a decreasing match countdown, automatic recovery and the pause menu's keyboard navigation. Separate presentation fixtures demonstrate levels 1–5, staged purchases, the direct-hotel exception and off-turn debt presentation; the Worker remains unmodified for these fixtures. Dated complete-match, legacy drand and routing results for each local/Preview revision live in PLAYABLE_CHECKPOINT.md. Hardware frame rate remains unmeasured.

An explicitly inspected city stays selected while pawns move. Until the user
selects a city, the highlight follows the active pawn automatically. The city
heading, selection and price are verified through a change of active position.

### Detector review of the refinement

The manual Impeccable detector was run for App.tsx, App.css and BoardScene.tsx on
1 October. Its two side-border warnings identify the transparent CSS triangle
forming the landmark miniature's roof (`.building-miniature[data-level="5"]
i::before`), not a card accent. Keep that geometric construction. The rounded
accent warning identifies the accessible flat-board tile's country-colour strip,
which communicates the board grouping alongside its text; keep it for WebGL
fallback. Palette/type/radius advisories span the existing toy materials and
compact HUD styles; the prose above records their purpose and minimum essential
label size. This detector output is not a clean machine verdict; browser captures
and interaction checks remain the visual acceptance evidence.

## Do's and Don'ts

- Do keep the whole board dominant at all three desktop target sizes.
- Do keep four compact corner HUDs and the required action visible together.
- Do open detail tools only when requested and make dismissal clear.
- Do preserve mouse and keyboard access, distinct player colors and reduced motion.
- Do use original geometry and the confirmed France-to-world geography.
- Do keep Start at the front corner with play leaving to the left; the orientation is covered by unit tests.
- Don't rebuild the match as a dashboard, permanent sidebar or scrolling panel stack.
- Don't claim new desktop tests or frame rates passed before measured evidence exists.
- Don't claim reference prices are confirmed when they remain prototype values.
- Don't show a verified randomness badge without the matching proof.
- Don't mutate rules, money, ownership, turn order or dice in rendering code.
