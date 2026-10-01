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

On 2 October 2026 the user asked for the familiar tabletop orientation: the board starts on the right and play goes left. The camera now looks at the board from its Start corner, which sits at the front of the screen; a pawn leaving Start walks left toward the island, then on to the festival at the back and the world tour on the right. Play is clockwise on screen, as the rules have always described it. Lots follow classic proportions: four large corner squares and seven deeper, narrower lots per side, each printed with a colored plot, a small city name and a large price.

Retain the travel progression from French cities to Tokyo, rounded pawns, flags and dice. The latest user reference asks for less visual depth and clearer tiles: a shallow lilac-and-ivory track, small simple buildings and an unobstructed printed name and price on each city. A sky-blue surround and grassy center provide the setting. The board carries the story; interface tools open on demand rather than sharing equal visual weight with it.

The user's later 1 October reference explicitly asks for centered illustrated
decisions. Purchases, development, buyouts and other choices now temporarily dim
the board and open an ivory dialog with a title ribbon. Original isometric city
previews, selectable building stages and a comparison slider precede one final
confirmation. Price, projected rent and remaining cash use shared engine helpers.
Escape minimizes a decision without sending an action; the bottom prompt reopens
it. Roll and opponent turns keep their compact bottom prompt.

Drawn cards have a separate illustrated reading moment, using three original
painted image families with individual effect text. Four small banknote reserves,
gold coins and owner-coloured straps sit outside the board track; quantities are
illustrative and capped, while HUD figures remain exact. Money transfers follow
the payer and recipient in the server event. Room settings open in a centered
dialog with sliders, exact entry and discrete duration choices. No permanent
sidebar or additional dashboard is introduced.

Build the scene with React Three Fiber and Three.js. GSAP owns scene choreography and Motion owns DOM transitions. The Director separates authoritative state from the events already shown to the player. The screen's strategy is recorded in its Experience surface brief, not a marketing-page layout.

## Colors

Sky blue owns the viewport as a soft radial gradient with a few faint floating tiles, grass owns the board center and ivory carries the track and compact functional controls. Each city group prints its plot in a strong pastel of its country color. Ink preserves readable prices and names; coral identifies the current primary action; gold identifies festivals and their multiplier. Four player colors retain circle, diamond, triangle and square identifiers.

**The Identity Rule.** Ownership combines player color and symbol on the pawn, flag, corner HUD and inspector. Color alone never carries a rule or player identity.

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

PC browser play with a mouse and keyboard is the priority. Validate 1280×720 as the minimum, with 1440×900 and 1920×1080 as the main targets. During a match, the board sits between the match title and tools above and the current choice below, centered, and all four corners stay visible through a fixed isometric orthographic camera aimed from the Start corner. The page must not require vertical scrolling to find a required action.

Place four compact player HUDs at the corners, approximately 296×98 px at the main target: a portrait tile in the screen corner, a ribbon in the player's color carrying the name, and an ivory plate with the cash and concise portfolio status. Bottom seats carry the ribbon below the plate; right seats mirror left seats. Each seat's banknote reserve lies beside the board edge nearest its HUD. Keep room/connection state, remaining match time and animation controls discreet. Rolls, opponent turns and minimized choices use the compact bottom-center prompt. A player's other legal decisions open a temporary centered illustrated dialog, up to 850 px wide, as requested in the later reference. Settings use a 900 px sheet. Fit each dialog within the minimum PC viewport, then return focus to play. Keep the board's camera and size throughout.

Journal, randomness proof, instructions, room information and tile details are closed by default. Open them as dismissible popovers or dialogs through labeled controls. An inspector opened by selecting a tile or Explorer may show the keyboard-accessible tile index. The lobby exposes name, create/join and settings alongside the world; it does not determine the match's composition.

Mobile is best effort. A future touch adaptation may use its own layout; portrait stacking and physical phone FPS do not constrain the PC design or block this prototype.

## Elevation & Depth

The board has a two-tone physical edge and slightly raised lot faces. Each lot reserves the end nearest the top of the screen for small original buildings (the inner end on the two front sides, the outer end on the two back sides), so buildings never hide the printed name and amount below them. Pawns walk on a road just inside the lots; on the corners they stand on the free inner quarter, beside the landmark. Gabled houses, a compact hotel and a restrained landmark distinguish development without tall towers or layered cornices. Reduce vegetation and corner scenery to recognizable small silhouettes: a palm island, an open-air festival arena and an airport with its tower and airliner. Start is printed flat, with a checkered line, an arrow toward the first lot and the room's salary, so nothing tall stands at the front of the board. The grassy center, with a chalk circle, stays available to the dice, which take the roller's color and show their total on a small scoreboard.

Compact ivory controls use restrained structural shadows, and action buttons retain a darker lower edge for a physical press. Avoid permanent glass overlays across the board. Hover, ownership changes and festivals add local feedback, not general interface ornament.

**The Material Rule.** Depth describes a physical toy or a usable control.

## Shapes

Softly curved controls belong to the toy-game language. Corner HUDs remain compact rather than becoming a repeated grid of large cards. Roofs, palms, flags and pawns retain simple low-poly geometry. Building levels must remain distinguishable; festival markers show a star and multiplier, while ownership flags repeat the player's symbol.

## Components

The contextual decision names its actual decision-maker using `pending.seat`, including off-turn debts. Purchase and development options pair a building silhouette with the total cost or additional payment and the resulting rent computed by the shared engine. They expose only legal levels and explain the staged hotel requirement when locked. Rent protection and buyout decisions show the destination and relevant cost/owner/rent beside their legal choices. A roll has one strong action. Multi-destination choices use a labeled select and confirm control. Legal actions come from the shared engine.

Host settings remain a visible local draft until explicitly saved; starting with unsaved changes is blocked. Room-code copy and sharing support invitation. The match timer counts down to the server-provided deadline. Busy, reconnecting, rejected, waiting and finished states stay explicit without exposing engine implementation details in the main play flow.

The closed dice tool explains the server's fresh cryptographic draws and equal face probabilities. New-room settings have no randomness-mode selector. It must not suggest a public signature or exportable beacon proof for server Web Crypto. Saved drand rooms retain their honest waiting/error state and proof export. Game-end standings emphasize the actual winner, victory condition and final fortune, then show the final ranking supplied by the server. The winner leads that ranking even when a collection victory leaves another player richer. Preserve the board behind the overlay.

Menus restore keyboard focus on dismissal, support Escape where appropriate and retain a visible focus indicator. Reduced motion keeps informative changes without camera spectacle.

**The Timing Rule.** The Director shows the events leading to a decision before the choice opens. Speed and skip apply consistently.

Browser verification covers 2× speed, the reduced-animation toggle, a decreasing match countdown and skip during a real roll's event playback. Skip is disabled at rest; a real click is checked against the public Director's synchronous state so later bot events cannot invalidate that observation. Separate presentation fixtures demonstrate levels 1–5, staged purchases, the direct-hotel exception and off-turn debt presentation; the Worker remains unmodified for these fixtures. Dated complete-match, legacy drand and routing results for each local/Preview revision live in PLAYABLE_CHECKPOINT.md. Hardware frame rate remains unmeasured.

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
- Do preserve mouse and keyboard access, player symbols and reduced motion.
- Do use original geometry and the confirmed France-to-world geography.
- Do keep Start at the front corner with play leaving to the left; the orientation is covered by unit tests.
- Don't rebuild the match as a dashboard, permanent sidebar or scrolling panel stack.
- Don't claim new desktop tests or frame rates passed before measured evidence exists.
- Don't claim reference prices are confirmed when they remain prototype values.
- Don't show a verified randomness badge without the matching proof.
- Don't mutate rules, money, ownership, turn order or dice in rendering code.
