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

## Match menu

The toolbar's pause icon opens Continue, Settings and Leave. Solo play pauses
immediately and resumes on closing. Multiplayer requires every human's consent,
including local players, with a 30-second vote and one request per room every five
minutes. Any human can resume an agreed pause; dismissing the menu keeps multiplayer
paused and its visible status reopens the menu. Personal settings share one panel
between the lobby gear and pause menu, with a language row and the streamer-mode
shortcut above Video, Accessibility and Audio tabs. Video holds High/Low
graphics, Default view, a board view lock, a persisted 80-200 % board zoom
slider and fullscreen; Accessibility offers System/On/Off reduced motion. Audio remains
marked coming soon. A versioned browser preference store preserves legacy
choices and synchronizes open tabs. Debug is last and appears only in development
or with ?debug. Room rules use a separate sliders icon and clear rules label.
Board inspection opens only from a clicked space, without step arrows.
The room panel presents player avatars with names below; the leader chooses an
eligible successor there. Avatars share one renderer prepared for custom portraits.
In debug mode the match HUD measures the HTTP round trip to a static Cloudflare asset every five
seconds while the match is connected and the browser page is visible and online,
restarting on connectivity changes. Debug shares this stream,
with the contacted host and Cloudflare entry point (code, location and region).
A tiny bottom-right `AMS · 42 ms` indicator keeps refreshing outside Debug,
without a background card or extra controls. Probes bypass Worker execution.
The expanded Debug sheet draws connected players' ingress routes toward one
shared GameRoom with local SQLite and plots real room WebSocket round trips.
Room pings run every five seconds only while this view is visible. Jurisdiction
and unknown DO DC/server rows are omitted. Diagrams do not infer the object's
location from an ingress POP or show SQLite as a remote network hop.
New decisions and cards keep progressing without replacing the menu's focus.
The sliders icon separately displays the fixed room rules, and the invitation
icon displays the room code. Playback has normal pacing and automatic recovery;
there are no manual speed or finish-animation controls.

## Verification and unresolved work

Check 1280x720, 1440x900 and 1920x1080; use both a real local match and authored
developed-board fixtures. A real Cloudflare branch Preview room was verified on
3 October 2026 at implementation revision a9b3261, including ZRH socket metadata,
room RTT, stopped Debug traffic and reconnect recovery. Record dated evidence and
revision in PLAYABLE_CHECKPOINT.md; one connection does not establish distributed
human gameplay or production. Balance remains provisional and target-PC FPS unmeasured.
