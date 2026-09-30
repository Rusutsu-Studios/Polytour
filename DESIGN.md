---
name: Polytour
description: A playful travel-board diorama with a precise, readable match interface.
colors:
  ink: "#173b45"
  muted-ink: "#47666c"
  table: "#9fded2"
  table-deep: "#54b6b0"
  paper: "#fffaf0"
  primary: "#e95131"
  primary-dark: "#bd3620"
  gold: "#ffcb55"
  sea: "#57bfcd"
  player-coral: "#d84929"
  player-blue: "#236cce"
  player-violet: "#8151b5"
  player-green: "#26764c"
typography:
  display:
    fontFamily: "Trebuchet MS, Segoe UI, sans-serif"
    fontSize: "clamp(3rem, 5.7vw, 5.6rem)"
    fontWeight: 900
    lineHeight: 0.98
    letterSpacing: "-0.04em"
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
  section: "40px"
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

**Creative North Star: “A little world on the table.”**

A daylight tabletop experience: friends sit around an original world-travel diorama, beginning in French cities and ending in Tokyo. The turquoise surface owns the whole viewport. An ivory board, tiny roofs, seaside palms, rounded pawns, and physical-looking dice supply the game’s personality. Menus remain direct and functional beside that object.

The scene is the artifact. Build it with React Three Fiber and original geometry rather than imitating 3D in a screenshot. GSAP owns the scene’s choreographed events; Motion owns DOM transitions. Authoritative state is separate from the state already shown to the player.

## Colors

The table and sea establish the setting; paper carries controls and prices; ink gives contrast. Coral names the primary action. Four player colors have circle, diamond, triangle, and square identifiers. Ownership always combines color and the corresponding symbol.

**The Identity Rule.** No gameplay information is carried by color alone.

## Typography

Use the existing system-font capability without a network font dependency. Trebuchet’s compact, friendly forms suit the toy-box title. Segoe UI is the functional body face. Cash, prices, turn numbers, and dice values use tabular numerals. Display tracking stops at the documented floor.

## Layout

The lobby introduces the playable world at substantial scale, with name, create/join actions, and settings immediately accessible. During a match, a compact room toolbar and four player strips frame the scene; the current decision and tile inspector sit beside it on desktop. On phones, a compact two-column roster leads directly to the current decision so its action remains in the first viewport; the board and inspection follow. All secondary panels stay reachable by natural scroll.

## Elevation & Depth

Panel shadows offset downward with a diffuse blur; buttons have a darker lower edge so their press reads physically. The board has an extruded ivory base, warm directional lighting, soft contact shadows, and original raised landmarks. Avoid expensive persistent animation while idle.

**The Material Rule.** Depth describes the physical toy or the functional panel, rather than a decorative glow.

## Shapes

Small controls use softly curved corners; functional panels use the documented panel radius. Chips are reserved for short status labels. Original roofs, palms, flags, and pawns share a chunky low-poly language. Player symbols repeat on the pawn, roster, ownership badge, and inspector.

## Components

The decision panel leads with whose turn it is and the actual required choice. A roll has one strong action. Multi-destination choices use a labeled select and a clear confirm action. Legal choices come from the shared engine rather than being inferred in the UI.

Pending decisions identify the actual decision-maker, including off-turn debts. Purchase and buyout panels name the city, its current owner, and rent immediately beside the choices. Festival cities carry raised gold multiplier markers; ownership flags repeat the player's symbol. Host settings have an explicit save action with a visible draft state.

Tile selection works through the scene and a keyboard-accessible index. Inspectors show name, ownership, cost, rent, and building level. A room-code copy control and share link make invitation immediate. The randomness panel exposes the committed drand round and proof, with an honest waiting state. Game-end standings name the actual winner and support reviewing the event history or starting another match.

**The Timing Rule.** Decisions appear only once the Director has shown their leading events. Speed and skip apply consistently; reduced motion retains informative state changes without spectacle.

## Do's and Don'ts

- Do let the board occupy the visual center and retain clear prices in DOM inspection.
- Do keep busy, reconnecting, rejected, empty, and finished states explicit.
- Do make every action usable with keyboard focus and touch.
- Do use original geometry and the confirmed France-to-world geography.
- Don't claim reference prices were verified when they are prototype values.
- Don't display a cryptographic verification badge without a server-supplied proof.
- Don't mutate money, ownership, turn order, or dice in rendering code.
