# Tech stack and why

Target: a **desktop browser** property-board game, played on PC with a mouse and
keyboard. A large isometric board and compact corner HUDs define the experience;
mobile adaptation and PWA installation are optional future work. Pin exact
versions at scaffold time and record them in `package.json`; this doc records the
*choices* and the reasons.

## The picks

| Layer | Choice | Why | Rejected alternatives |
| --- | --- | --- | --- |
| Hosting | **Cloudflare Workers + Static Assets** | SPA, API, and WebSockets in one deploy at the edge; asset requests free. | Pages (Workers is the recommended path for new projects). |
| Game server | **Durable Objects** (SQLite, Hibernation API, alarms) | One actor per match = no locking, no race conditions, sockets + state co-located. | Colyseus/Node servers (you run and scale them), Firebase/Supabase realtime (no authoritative logic next to the state). |
| HTTP routing | **Hono** | Tiny, typed, built for Workers. | itty-router (fewer batteries), raw `fetch` switch (fine but grows messy). |
| Validation | **Zod 4** | Single schema → runtime check + TS type, shared by client and server. | Valibot (smaller; switch if client bundle budget gets tight). |
| DB access | **Drizzle ORM** on D1 | Typed SQL, thin, good D1 support and migrations. | Prisma (heavier on Workers), raw SQL (OK for the DO's own tables - use raw SQL there). |
| Build | **Vite + `@cloudflare/vite-plugin`** | Worker + DOs run in real `workerd` during `pnpm dev`, with HMR for the client. | Separate Wrangler + Vite processes. |
| UI framework | **React 19** | Largest ecosystem for 3D (R3F) and UI motion; team familiarity. | Svelte/Solid (great, but R3F/drei ecosystem is the deciding factor). |
| 3D rendering | **React Three Fiber + drei** (Three.js) | Declarative scene graph, huge helper library (cameras, shadows, text, performance monitor, instancing, glTF loaders). | PixiJS 2D (see below), Babylon.js (heavier, less React-native), PlayCanvas (editor-centric). |
| Post-processing | **@react-three/postprocessing** | Selective bloom, tone mapping, SMAA, vignette in one merged pass. | Hand-rolled EffectComposer. |
| Scene animation | **GSAP** (incl. CustomEase, MotionPath) | Best-in-class timelines/sequencing; tweens any JS object (Vector3, Quaternion, uniforms). Free for commercial use including plugins. | anime.js (weaker sequencing), react-spring (physics-y, harder to choreograph precise sequences). |
| UI animation | **Motion** (`motion/react`) | Layout animations, `AnimatePresence`, gestures for DOM HUD and menus. | GSAP for DOM too (possible, but Motion is more idiomatic in React UI). |
| Dice physics (Phase 5) | **Rapier** (`@react-three/rapier` / `@dimforge/rapier3d-compat`) | Fast, stable WASM physics; used for the "pre-simulate, record, remap faces, play back" dice trick. Lazy-loaded. | cannon-es (unmaintained-ish, less stable). |
| Styling | **Tailwind CSS v4** | Fast iteration on HUD/menus; design tokens as CSS vars. | CSS modules (fine, slower to iterate). |
| Client state | **Zustand** | Tiny; works inside and outside React (Director and R3F `useFrame` read it without re-renders). | Redux Toolkit (more ceremony), Jotai (fine, but Zustand fits the two-store model better). |
| Networking | **`partysocket`** client | Reconnecting WebSocket with backoff; made for DO-backed rooms. Use it with `maxEnqueuedMessages: 0`: its offline buffer would replay stale intents before `sync` (see PROTOCOL.md). | Hand-rolled reconnect logic. |
| Audio | **Howler.js** | Audio sprites, pooling, mobile unlock quirks handled. | Raw Web Audio (more work), Tone.js (music-focused, overkill). |
| Tests | **Vitest 4** + **`@cloudflare/vitest-plugin`**, **fast-check**, **Playwright** | Engine unit + property tests, DO tests inside `workerd`, end-to-end multi-tab games. | Jest (not supported for Workers). |
| Lint/format | **Biome** | One fast tool for lint + format. | ESLint + Prettier (slower, more config). |
| Package manager | **pnpm** | Fast, strict. | npm/yarn. |
| Live dice entropy | **Worker Web Crypto** | Fresh cryptographically secure bytes for every roll, uniform rejection sampling, no network wait. | `Math.random`, client-chosen dice, a public deterministic seed. |
| Legacy beacon compatibility | **drand-client** | Retained signature verification for saved drand rooms and compatibility tools; absent from normal new-room settings. | Breaking saved commitments or mislabelling server draws as publicly verified. |
| Simulator runner | **tsx** (development only) | Runs the same TypeScript engine with Node, without a separate emit/build step. | A second implementation of the rules in a simulator. |
| PWA | **vite-plugin-pwa** | Installable, offline shell, precached assets. | Hand-written service worker. |

The playable prototype installs only the layers it uses. It keeps ordinary CSS
and React state for this first HUD; Tailwind and Zustand remain planned rather
than adding unused dependencies. Original scene geometry is generated in Three.js
and does not require external glTF/drei/postprocessing assets yet. The prototype
connection uses a small reconnecting WebSocket client with no offline intent queue;
the planned `partysocket` replacement must preserve that behavior. See
[RANDOMNESS.md](RANDOMNESS.md) for the CSPRNG rationale and saved drand-room compatibility.

## Key decision: 3D (R3F) vs 2D (PixiJS)

**Recommendation: 3D with React Three Fiber.** The "wow" of Business Tour–style
games comes from things that are cheap in 3D and expensive in 2D:

- An isometric board with a stable whole-board camera, dimensional buildings and
  readable pawn hops; optional action shots return to that frame.
- Buildings that physically rise out of tiles with real lighting and soft shadows.
- Dice that tumble and land with contact shadows.
- One set of models works at any resolution and camera angle - no redrawing sprites
  for every building level and rotation.

Three.js remains the chosen renderer for the PC prototype. Reconsider **PixiJS v8**
only if a future product decision deliberately changes the art direction to a
flat illustration. Optional support for low-end phones does not determine the
desktop renderer or block the current release.

Keep WebGL 2 as the target. Three.js's WebGPU renderer can be evaluated later behind
a flag; don't depend on it for launch.

## Performance budgets

| Budget | Target |
| --- | --- |
| Desktop viewport | 1280×720 minimum; review at 1440×900 and 1920×1080 as well |
| Frame rate | Aim for 60 fps on a documented PC/GPU during active animation; record the measured hardware and result before claiming it |
| Draw calls | < 150 in the main board view (instance tiles, houses, coins) |
| Initial JS (lobby) | < 250 KB gzipped; 3D scene, Rapier, and audio are lazy chunks |
| First match download | < 12 MB total (models + textures + audio) |
| Per-file asset size | < 25 MiB (hard Workers Static Assets limit) |
| Device pixel ratio | clamp to `[1, 2]` on desktop; tune against measured GPU cost |

CI enforces the lobby JS budget and the per-file asset limit on every pull request
(`pnpm check:bundle`, constants in `tools/ci/check-bundle-size.ts`); change the
budget here and there together.

Use measured desktop scene cost to decide quality reductions (shadows → bloom →
DPR). Drei's `<PerformanceMonitor>` and `@pmndrs/detect-gpu` remain planned helpers,
not claims about dependencies already present. No physical phone frame-rate
criterion is required for this prototype.

## Asset pipeline

1. Model in **Blender** (low-poly, stylized; bake AO into textures).
2. Export glTF → `gltf-transform` (`meshopt` + `ktx2`/`etc1s` for textures, `uastc` for normal maps).
3. `gltfjsx --types` to generate typed R3F components into `src/client/scene/models/`.
4. Audio: author at 48 kHz, export `.webm` (Opus) + `.mp3` fallback; pack SFX into
   sprites with `audiosprite`.
5. Fonts: one display face + one UI face, self-hosted `woff2`, subset.

## Desktop first, other platforms later

- Ship the browser PC experience first: viewport-filling board, compact corner
  information, keyboard-accessible decisions and overlays, mouse tile inspection.
- Preserve best-effort narrow-screen behavior without making portrait or touch
  design a desktop acceptance criterion. A dedicated mobile/PWA adaptation can
  later add touch controls, audio unlocking and optional haptics.
- If app-store presence is needed later, wrap the same build with **Capacitor**.
  Nothing in the stack blocks this - keep native-only features behind feature checks.
