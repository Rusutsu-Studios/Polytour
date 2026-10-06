# Desktop rendering review — 3 October 2026

## Potato PC proposal — 6 October 2026

Video settings now offer High and Low side by side, with **Potato PC** below.
The new tier is opt-in and saved in the existing local settings record; existing
High/Low and legacy preferences retain their meaning. It applies to the welcome
preview, room lobby and match, and synchronizes across open tabs.

Potato PC uses DPR 0.75 and Low's disabled shadows and ambient animation. It
removes the central town, cash reserves, beach parasols and the three corner
models. Corner names, property levels and ownership, festival and championship
markers, shields, kept cards, dice, pawns, money transfers and legal board
selection remain. All rules and Director event timing are unchanged. Switching
preserves the Canvas, WebGL context, zoom and camera framing.

At the same CSS size, DPR 0.75 draws 43.75% fewer pixels than Low's DPR 1. The
DOM HUD, decision dialogs and projected sale labels retain full resolution.
Printed board text softens; this is a manual tradeoff for weaker computers.
MSAA stays enabled so switching never recreates the graphics context during an
event. No automatic hardware detection, new dependency or renderer is added.

The diagnostic developed-board fixture at 1440 × 900 uses forced Chromium
SwiftShader, requesting direct scene draws for four seconds per sample, in
Low → Potato PC → Low → Potato PC order on the same developed snapshot.
Low submitted 190 draw calls and 33,625 triangles; Potato PC
submitted 113 calls and 12,709 triangles, approximately 40% fewer draw calls and
62% fewer triangles. Active samples were 16.3–21.0 FPS in Low and 37.6–40.3 FPS
in Potato PC. These isolate rendering cost, not whole-turn responsiveness.
Local fixture results and screenshots are saved under `.local/performance/`;
exact FPS depends on host load and does not establish performance on a physical
low-end laptop.

Browser regression coverage checks keyboard access to the third tier, its row
below Low, persistence and cross-tab updates, the unchanged context/frustum,
a real roll and reconnect, reduced motion, and developed-property sale picking
and inspection at 1280 × 720, 1440 × 900 and 1920 × 1080. High and Low keep
their previous rendering settings. The proposal still needs an affected laptop
for target-hardware frame-time validation.

## Scope and baseline

The repository has no v1 tag. This review uses the first playable client,
`0ffd0e4476eb16d8ac74d494c3ecf5d98364eb77`, as v1 and compares it with
`f74b053c425126a509970e62ad4d064afa2d68f9` before the graphics-setting change.
All FPS and geometry figures below refer to those frozen revisions. The PR is
integrated with main at `8d8530f`, which also adds the town in the center;
its rendering performance has not been measured with the same comparison fixture.

The goal is practical support for older PCs and integrated graphics, with small
changes supported by measurements. No rules, protocol or server changes are needed.

## What changed since v1

- Both frozen versions render on demand and render no frames while settled idle.
  Repeated buildings are instanced, effects are bounded, and the scene is lazy loaded.
- The current scene uses a 2048 × 2048 shadow map, versus 1024 × 1024 in v1.
  That is four times as many shadow texels. Shadow mapping draws shadow casters in
  an additional pass; see the [Three.js shadow guide](https://threejs.org/manual/pages/shadows.html).
- Current tile geometry is simpler, and dice pips are instanced. In the developed
  board fixture, total submitted triangles fell from 48,602 to 24,237, while draw
  calls stayed almost unchanged at 237 versus 238, including shadows.
- The current game fills the desktop viewport. Tile textures have about 2.28 times
  v1's texel count, and lawn/road textures and cash reserves add detail. This makes
  fragment/shadow work a better first target than rewriting the geometry.

## Measured rendering fixture

Both frozen scenes were production bundled with the same installed dependencies,
at 1440 × 900 CSS pixels, four players and a developed board. Each variant starts
in a fresh Chromium page with its quality settings already applied. A GSAP camera
tween requests demand frames for six seconds. Native scene framing is retained and
checked in before/after screenshots.

Chromium 153 uses forced ANGLE SwiftShader software rendering on a Ryzen 7 7800X3D
with 63 GiB RAM. These are diagnostic samples, not measurements on an older PC or
integrated GPU. Browser scheduling and host workload affect absolute FPS. The
comparison isolates rendering; it is not a historical whole-app load benchmark.

| Scene and settings | Sampled active FPS |
| --- | ---: |
| v1, DPR 1, native 1024 shadows | 21.4 |
| Current, DPR 1, native 2048 shadows | 17.1 |
| Current, DPR 1, 1024 shadows | 20.2 |
| Current, DPR 1, shadows off | 27.1 |
| v1, DPR 1.5, native shadows | 11.9 |
| Current, DPR 1.5, native shadows | 9.7 |

The current renderer is slower in this software sample despite using fewer
triangles. Disabling its shadows removes 71 draw calls and 9,300 submitted
triangles. Reducing DPR from 1.5 to 1 removes 55.6% of drawing-buffer pixels;
native-DPR-1 PCs already get DPR 1, so shadow removal is the useful part for them.

An experimental DPR 0.75 with shadows off reached 30 FPS in this animation sample,
but visibly softened small city text. It is not part of the implemented setting.

Local evidence lives in `.local/performance/README.md`, `focused-results.json`,
`focused-*.png` and `.local/performance-review/`. Earlier experimental result files
are explicitly marked superseded: runtime DPR changes broke the harness camera
frustum, and direct shadow toggles missed material recompilation. No conclusion
uses those invalid samples. No animation-scheduler bug was established.

## Implemented change

The welcome gear opens **Video** settings before joining. During a match,
**Pause > Settings > Video** opens the same panel. It presents **High** and **Low**
as two explicit choices side by side, with immediate effect and the same saved
local preference.
High is the default for a browser without a saved choice.
Low fixes DPR at 1 and disables live shadows.
It also keeps decorative town life and selection highlights still so the board
can idle between game events. High retains the existing rendering settings,
including the town's capped 30 FPS ambient loop added after the benchmark revision.
MSAA, materials, geometry and game-event choreography are preserved. There is no
hardware detector or new library.

Switching keeps the existing Canvas, WebGL context and Director animator. The
custom orthographic framing is reapplied when DPR changes because R3F's resize
otherwise overwrites the board's frustum. The preference never enters room rules
or the network protocol. The existing DOM board still handles WebGL failure.
The directional light's shadow flag also changes, updating shadow-dependent
material programs when switching modes on an existing Canvas.

## Local verification

- Typecheck, Biome, 182 unit/Worker tests, production build and bundle budgets pass.
- All 24 browser scenarios excluding optional live-beacon tests pass locally.
  The three production scenarios also pass against the actual built Worker/client,
  including a complete four-seat match and reconnect.
- The new browser regression runs with normal motion and verifies persistence,
  default High, bilingual button labels, keyboard switching and synchronized controls,
  DPR and live shadow-light settings, Low idle drawing versus High ambient
  drawing, unchanged Canvas/WebGL context and camera frustum, a real roll and reconnect.
- High and Low welcome/match rendering is checked at 1280 × 720, 1440 × 900
  and 1920 × 1080, with no page overflow or runtime errors. Reduced motion and a
  normal-motion Low roll are checked.

These are local checks. No deployment or target-hardware FPS claim is made.

Occasional SwiftShader captures showed dark lot or town building walls and roofs
in Low after switching quality. Other live bot-game captures and controlled
construction with the first buildings created in either High or Low rendered
correctly. Instrumented successful draws had matching CPU/GPU instance colors
and the expected lighting. The intermittent software-rendering issue remains
unexplained; no speculative renderer workaround was added.

## Further work worth considering

Test High and Low on a physical older integrated-GPU PC with an ordinary roll
and a developed board. Record frame times and hardware/browser versions. A smaller
standard shadow map is a possible later compromise, but its default visual quality
has not been changed. Pawn mesh merging, texture atlases, automatic quality tiers
and a new renderer are not justified by this review.
