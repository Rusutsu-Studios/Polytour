---
version: 1
slug: "src-client-app-tsx"
primary_target: "src/client/App.tsx"
related_targets: ["src/client/App.css","src/client/scene/BoardScene.tsx"]
---

# PC match surface

## Scope and mode

Primary target: src/client/App.tsx, with related match styles and BoardScene. Mode: Experience. The user is inside a property-board match, not operating a dashboard.

## Audience, task and constraints

Four friends in PC browsers, or a human against three server bots, use a mouse and keyboard to roll, acquire destinations and finish a match. The board leads the first viewport; the current legal decision stays immediately actionable. Preserve the shared rules, room credentials, reconnection, event Director and honest randomness states.

## Chosen direction

The user pinned the conventional property-board game composition on 1 October 2026: a large central isometric board, four compact corner HUDs, a discreet bottom-center decision and closed-by-default detail tools. Original toy geometry and player symbols carry identity. Journal, proof, help, room information and inspection open as dismissible contextual tools.

## Memorable moment

The two dice settle to the server's exact values, the pawn traverses the visible track and the destination's choice appears after arrival, without replacing the board with interface panels.

## Verification and unresolved work

The user removed drand from normal new-room play on 1 October 2026 because the
per-roll beacon wait was too slow. New rooms use fresh Worker Web Crypto bytes
with rejection sampling. The closed dice-information tool explains equal chances
without a public-proof claim; the source selector is removed. Saved drand rooms
keep their committed source and proof UI. The PC board composition is unchanged.

Local captures validate 1280×720, 1440×900 and 1920×1080 without scrolling or off-screen controls. Six browser scenarios passed in 38.6 seconds, covering real UI play and refresh, settings-preserving create/join, a full four-context match with reconnect and matching state, live future drand BLS verification/recomputation/UI export and two API/SPA smoke checks. Final independent visual review found no remaining material defects.

Two UI scenarios also passed again in 20.5 seconds with an explicit skip during a real roll's event playback. Speed at 2×, the reduced-animation toggle, decreasing match time and skip disabled at rest are verified. Authored presentation fixtures separately show levels 1–5, six purchase choices at 1280×720 without HUD collisions and an off-turn debtor; they do not modify the Worker or substitute for the real match.

Build, TypeScript, Biome and size budgets pass; the existing 68 tests and 100-game simulation run pass without an engine change. The deployed Preview passes four production browser scenarios in 29.6 seconds, including a full match and live proof export. An inspection regression ensures an explicitly chosen city stays selected when a pawn moves. The dated evidence and verified revision are in docs/PLAYABLE_CHECKPOINT.md. Target-PC FPS remains unmeasured. Mobile remains best effort and may receive a separate future touch adaptation. Economy comparison and balance remain unchanged.
