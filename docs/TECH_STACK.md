# Tech stack and why

Target: a **web-first** game (desktop + mobile browsers, installable as a PWA) that
feels like a premium mobile board game. Pin exact versions at scaffold time and
record them in `package.json`; this doc records the *choices* and the reasons.

## The picks

| Layer | Choice | Why | Rejected alternatives |
| --- | --- | --- | --- |
| Hosting | **Cloudflare Workers + Static Assets** | SPA, API, and WebSockets in one deploy at the edge; asset requests free. | Pages (Workers is the recommended path for new projects). |
| Game server | **Durable Objects** (SQLite, Hibernation API, alarms) | One actor per match = no locking, no race conditions, sockets + state co-located. | Colyseus/Node servers (you run and scale them), Firebase/Supabase realtime (no authoritative logic next to the state). |
| HTTP routing | **Hono** | Tiny, typed, built for Workers. | itty-router (fewer batteries), raw `fetch` switch (fine but grows messy). |
| Validation | **Zod 4** | Single schema → runtime check + TS type, shared by client and server. | Valibot (smaller; switch if client bundle budget gets tight). |
| DB access | **Drizzle ORM** on D1 | Typed SQL, thin, good D1 support and migrations. | Prisma (heavier on Workers), raw SQL (OK for the DO's own tables — use raw SQL there). |
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
| Verifiable entropy | **drand-client** | Official signature verification against pinned quicknet metadata; committed future rounds, uniform rejection sampling. | Trusting a relay's JSON or using an already known latest beacon. |
| Simulator runner | **tsx** (development only) | Runs the same TypeScript engine with Node, without a separate emit/build step. | A second implementation of the rules in a simulator. |
| PWA | **vite-plugin-pwa** | Installable, offline shell, precached assets. | Hand-written service worker. |

The playable prototype installs only the layers it uses. It keeps ordinary CSS
and React state for this first HUD; Tailwind and Zustand remain planned rather
than adding unused dependencies. Original scene geometry is generated in Three.js
and does not require external glTF/drei/postprocessing assets yet. The prototype
connection uses a small reconnecting WebSocket client with no offline intent queue;
the planned `partysocket` replacement must preserve that behavior. See
[RANDOMNESS.md](RANDOMNESS.md) for drand's guarantees and limitations.

## Key decision: 3D (R3F) vs 2D (PixiJS)

**Recommendation: 3D with React Three Fiber.** The "wow" of Business Tour–style
games comes from things that are cheap in 3D and expensive in 2D:

- A tilted board you can dolly and orbit, with the camera following a pawn's hops.
- Buildings that physically rise out of tiles with real lighting and soft shadows.
- Dice that tumble and land with contact shadows.
- One set of models works at any resolution and camera angle — no redrawing sprites
  for every building level and rotation.

Choose **PixiJS v8** instead only if the art direction becomes flat/illustrated or
if the target is very low-end phones. That decision should be made in Phase 3 with
a prototype on real devices, not in the abstract.

Keep WebGL 2 as the target. Three.js's WebGPU renderer can be evaluated later behind
a flag; don't depend on it for launch.

## Performance budgets

| Budget | Target |
| --- | --- |
| Frame rate | 60 fps on a mid-range 2022 Android phone at quality tier "medium" |
| Draw calls | < 150 in the main board view (instance tiles, houses, coins) |
| Initial JS (lobby) | < 250 KB gzipped; 3D scene, Rapier, and audio are lazy chunks |
| First match download | < 12 MB total (models + textures + audio) |
| Per-file asset size | < 25 MiB (hard Workers Static Assets limit) |
| Device pixel ratio | clamp to `[1, 2]` desktop, `[1, 1.5]` mobile |

CI enforces the lobby JS budget and the per-file asset limit on every pull request
(`pnpm check:bundle`, constants in `tools/ci/check-bundle-size.ts`); change the
budget here and there together.

Use drei's `<PerformanceMonitor>` to step quality down (shadows → bloom → DPR)
automatically, and `@pmndrs/detect-gpu` to pick the initial tier.

## Asset pipeline

1. Model in **Blender** (low-poly, stylized; bake AO into textures).
2. Export glTF → `gltf-transform` (`meshopt` + `ktx2`/`etc1s` for textures, `uastc` for normal maps).
3. `gltfjsx --types` to generate typed R3F components into `src/client/scene/models/`.
4. Audio: author at 48 kHz, export `.webm` (Opus) + `.mp3` fallback; pack SFX into
   sprites with `audiosprite`.
5. Fonts: one display face + one UI face, self-hosted `woff2`, subset.

## Web-first, platform later

- Ship as a responsive web app + PWA (landscape and portrait layouts, touch-first input).
- Haptics via `navigator.vibrate` where supported (Android); silently skip elsewhere.
- If app-store presence is needed later, wrap the same build with **Capacitor**.
  Nothing in the stack blocks this — keep native-only features behind feature checks.
