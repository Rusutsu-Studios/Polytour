---
version: 1
slug: "src-client-app-tsx"
primary_target: "src/client/App.tsx"
related_targets: ["src/client/App.css","src/client/scene/BoardScene.tsx"]
---

# PC match surface

## Scope and mode

App.tsx, App.css and BoardScene.tsx. Experience: the board is the play surface.

## Audience, task and constraints

Four friends on PC, or one human with three server bots. Roll, buy, build and finish
a match using mouse and keyboard. Preserve authoritative rules, credentials,
reconnect, the Director, central illustrated decisions and hidden detail tools.

## Chosen direction

The user explicitly pinned the familiar property-board composition and then asked
for a clearer, less raised board: thin physical edge, shallow long rectangular
tiles, simple small buildings in their outer band, readable printed city names and
amounts, and pawns along an inner lane with an exact tile marker. Four compact
corner HUDs frame the board. The current action sits at bottom center. Temporary
illustrated decisions and slider settings dim the board only while open.

## Memorable moment

The dice settle to server values, the pawn walks the visible route, a city opens
with construction stages and prices, and only confirmation changes the game.
Illustrated card moments and small cash reserves keep money and events tangible.

## Welcome and languages

The welcome view is a compact ivory setup sheet beside the board, with a blue
play button, create/join actions and a separate row of three native sliders for
starting cash, salary and festivals. Full settings retain precise number inputs,
rule toggles and discrete duration/decision sliders. Remove promotional slogans
and decorative captions. French/English switching is a local display preference;
it updates board labels, cards, decisions and tools without reconnecting the room.

## Verification and unresolved work

Check 1280x720, 1440x900 and 1920x1080; use both a real local match and authored
developed-board fixtures. Remote runtime is presently blocked by a confirmed
Cloudflare free-tier SQLite write quota. Local checks do not establish a playable
remote Preview until the allowance resets. Record dated evidence and revision in
PLAYABLE_CHECKPOINT.md. Balance remains provisional and target-PC FPS unmeasured.
