# Desktop rendering review - 3 October 2026

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

One compact monitor-icon button shows **High** or **Low** before joining and in
the match toolbar. Clicking switches the quality immediately; the tooltip names
the current quality and the next choice. **View and animation** shows the same
saved local preference. High is the default for a browser without a saved choice.
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
