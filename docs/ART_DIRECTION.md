# Art direction: illustrated toy diorama

Status: **proposal for board-user review** (issue #36). It sets the target look
for the 3D board, buildings, pawns, money and UI. The 3D tasks that wait on it
are hotels and bungalows (#58), a monument per city (#73) and money stacks (#59).
Nothing here changes a rule, an event or a timing budget; those stay in
[GAME_DESIGN.md](GAME_DESIGN.md) and [ANIMATION.md](ANIMATION.md).

Mockups live in [`docs/art/`](art/). They are flat SVG sketches meant to fix
proportions, colours and silhouettes. They are not final assets.

| Mockup | Shows |
| --- | --- |
| [palette.svg](art/palette.svg) | Player, region, environment and UI colours with the toon shading ramp |
| [characters.svg](art/characters.svg) | The four pawn characters, front view, with their expressions |
| [buildings.svg](art/buildings.svg) | House levels, sample city monuments and the four resort bungalows |
| [money.svg](art/money.svg) | Coins, notes, silver and gold bars, with sample stacks for three cash amounts |

## 1. The idea in one paragraph

Polytour should look like a **hand-painted toy diorama seen through a picture
book**. The board stays real 3D with the current isometric camera, but every
surface reads as painted: flat colour in two or three bands of light, soft
coloured outlines on the pieces that matter, rounded chunky shapes and small
characters with big heads. Players should recognise a city by its monument, a
player by their character and colour, and their wealth by the pile of money
in front of them, at a glance and at 1280×720.

What we keep from today: the camera, the board layout, the sky-blue surround,
the ivory track, the living town in the centre, the four player colours and every
animation in ANIMATION.md. What changes is the **rendering style** and the
**models**.

## 2. References (for qualities, never for assets)

We copy no art, names or logos from any game. These are studied for what they
do well:

- **Mobile property-trading games** (the genre our issue names): small chibi
  pawns with big expressive heads, a building per city that looks like the city,
  bright saturated colour on a light board, money you can see.
- **Picture-book and travel-poster illustration** (mid-century tourism posters,
  modern flat illustration): simplified monuments reduced to two or three
  shapes, limited palettes, warm paper tones.
- **Toy and vinyl figure design**: thick rounded forms, no thin parts that
  disappear at small size, a clear base so the toy stands on the board.
- **Stylised 3D games with toon shading** (cel ramps plus a soft rim light):
  how to keep 3D lighting while still reading as drawn.

Rule: a reference may inform proportions, colour or mood. A model, texture,
icon or character must never be traced or rebuilt from another game.

## 3. Rendering style

### Shading

- **Toon ramp.** Pieces, buildings, town and corner structures use
  `MeshToonMaterial` with one shared three-band gradient map (shadow 0.55,
  mid 0.8, light 1.0 of the base colour). One 3×1 `DataTexture`, `NearestFilter`,
  shared by every toon material.
- **Painted ground.** The board top, the track and lot faces keep their canvas
  textures (`board-textures.ts`) but adopt the palette below, rounded label
  plates and a faint paper grain (2–3 % noise, baked once into the canvas).
- **Metal exceptions.** Coins, silver bars, gold bars and gold monument tops
  stay on `MeshStandardMaterial` (metalness 1, roughness 0.25–0.35) so they catch
  the environment map and sparkle. Money must feel valuable.
- **Outlines.** Only pawns, dice and hotel monuments get an outline: an
  inverted-hull back-face copy scaled by 3–4 %, coloured as the base colour
  darkened 45 % (never pure black). Tiles, houses and the town get no outline;
  their silhouettes come from the toon bands and contact shadows. This keeps
  the draw-call budget (< 150 target, outline meshes are instanced alongside
  their source).
- **Rim light.** A soft warm rim (sky colour, 20 % strength) on pawns only, so
  characters pop from the board.

### Lighting and post

- Keep one warm key light with soft shadows and a cool fill. Lower the key's
  intensity by about 15 % because toon bands already add contrast.
- Tone mapping: AgX or Neutral; check every swatch in `palette.svg` against a
  screenshot so saturated player colours do not wash out.
- Selective bloom stays for coins, gold bars, monument tops and UI glows only.
- Low graphics: keep the toon ramp (it costs nothing), drop outlines, rim light
  and shadows.

### Shape language

- Corners are rounded (bevel ≥ 8 % of the smallest dimension). No sharp needles
  except monument spires, which get a rounded tip.
- Everything is slightly chunky: walls 10–15 % thicker than real, windows as
  inset blocks or painted rectangles, roofs overhang.
- Silhouette first: every piece must be recognisable as a solid shadow shape at
  40 px tall.

## 4. Palette

Player colours do not change. They already drive HUDs, flags, roofs and rents,
and changing them would break recognition in saved rooms.

| Role | Name | Hex |
| --- | --- | --- |
| Player seat 0 | Coral | `#be3d24` |
| Player seat 1 | Ocean | `#236cce` |
| Player seat 2 | Lavender | `#8151b5` |
| Player seat 3 | Forest | `#26764c` |
| Ink (text, eyes, outlines of UI) | Deep teal | `#173b45` |
| Paper (panels, track) | Ivory | `#fffaf0` / `#fbf6ec` |
| Sky surround | Sky | `#8fd3f0` → `#cdeefa` gradient |
| Gold accents | Gold | `#ffc83d` |
| Silver | Silver | `#cfd8de` |
| Grass | Lawn | `#8fcf6a` |
| Water | Lagoon | `#4fc3d9` |
| Sand | Sand | `#f3dca4` |
| Warm roof (unowned) | Terracotta | `#e2574a` |
| Glass | Glass | `#56b4d8` |
| Skin tones (characters) | Light, medium, tan, deep | `#f7c88b`, `#e0a26e`, `#b97a4f`, `#7a4a2e` |

Region colours stay as in `REGION_COLORS` (`board-display.ts`). They tint the
painted band on each tile and the plinth of each unowned monument plot.

Rules:

- Saturation lives on the pieces (pawns, roofs, money, monuments). Big surfaces
  (board, track, panels) stay light and low-saturation, so pieces read on top.
- A player's colour appears on everything that player owns: the pawn's body
  and base, the roof of each house, the plinth and pennant of each monument,
  the awning of each bungalow, the strap of each note bundle.
- Never use a player colour for neutral decoration.

## 5. Pawns: four illustrated characters (#36)

The current pawns are a capsule body, a sphere head and a hat that differs by
seat. They become four small travel characters with a shared rig and
proportions. See [characters.svg](art/characters.svg).

| Seat | Colour | Character | Silhouette cue |
| --- | --- | --- | --- |
| 0 | Coral | **The Tourist**: wide sun hat, camera on a strap, small backpack | Wide round brim |
| 1 | Ocean | **The Pilot**: soft cap with goggles, scarf blowing to one side | Goggles on the cap, scarf tail |
| 2 | Lavender | **The Artist**: tall beret with a stalk, paint palette in hand | Tall slanted beret |
| 3 | Forest | **The Explorer**: flat safari hat, binoculars, rolled map | Flat brim, map tube |

The four characters also use four different skin tones from the palette.

Proportions and build:

- **Chibi, about 2.3 heads tall.** The head is ~45 % of the height. Same total
  height and footprint as today's pawn (`PAWN_SCALE`), so the board layout,
  pawn spots and the town visibility tests stay valid.
- **Face:** two oval eyes in ink with one white highlight each, small blush
  marks, a simple mouth. Faces are a small texture atlas (eyes and mouth
  frames) swapped by UV offset, so an expression change costs no geometry.
- **Base:** a rounded disc in the player colour with an ivory top ring, as
  today. It keeps colour as the main identity and gives the character a
  "game piece" feel.
- **Budget per character:** ≤ 1,500 triangles, one 256×256 texture (atlas),
  one toon material plus its outline, glTF with Meshopt, under 60 kB each.
  Until artist glTF exists, a procedural version from primitives (as today)
  follows the same silhouettes and colours.

Identity rules: colour stays the player's identity. The character silhouette is
a second cue that helps colour-blind players; owned tiles, flags and money
straps still use colour only.

Expressions and poses, driven only by Director handlers (never by components):

| Moment | Expression / pose |
| --- | --- |
| Idle (own turn) | Gentle 2 s breathing bob, blink every 3–5 s |
| Hop (`PawnMoved`) | Eyes closed on take-off, open on landing; existing squash 0.85/1.15 |
| Purchase or upgrade | Happy eyes (arcs), small jump with arms up |
| Paying a large rent | Sad eyes, shoulders drop for 0.4 s |
| Sent to the island | Dizzy spiral eyes during the flight, life ring as today |
| Bankrupt | Eyes become crosses, character greys out to 40 % saturation |
| Victory | Big smile, arms up, the hat pops up and lands |

Reduced motion keeps expressions (they carry information) but drops the
jumps and bobs.

HUD avatars (`PlayerAvatar.tsx`) become flat illustrated busts of the same four
characters, drawn as inline SVG in the player colour, so the HUD and the board
show the same person.

## 6. Buildings

### Houses (levels 1–3)

A house is a **cottage**: ivory walls, a pitched roof in the owner's colour, a
chimney, one door and two painted windows. Count must be readable from above:

- 1 house: one cottage centred on the lot.
- 2 houses: a cottage and a narrower townhouse side by side.
- 3 houses: a row of three with alternating roof heights.

Houses stay instanced (body, roof, chimney as separate instanced meshes; roof
takes the instance colour).

### Hotels: one monument per city (#58, #73)

The Hotel level becomes the **city's own monument**: a stylised miniature of a
well-known building, standing on a plinth in the owner's colour with a small
pennant in the owner's colour on top or beside it. The monument itself keeps
its real-world colours (stone, brick, white), so the city is recognisable, and
the plinth plus pennant say who owns it.

Monuments are **original stylised models "inspired by"** the building, reduced
to two or three shapes. They never carry signs, logos or text. The product
names only the city, never the monument.

| City | Monument (inspired by) | Main shapes |
| --- | --- | --- |
| Roubaix | Red-brick textile mill with its tall chimney | Brick block, sawtooth roof, chimney |
| Saint-Étienne | Mining headframe (Puits Couriot) | Steel A-frame, two wheels, brick base |
| Le Havre | Concrete lantern tower of St Joseph's church | Tall octagonal tower with window grid |
| Grenade | Alhambra tower on red walls | Square red tower, crenellations |
| Valence | Torres de Serranos city gate | Two towers joined by an arch |
| Séville | Giralda bell tower | Square tower, belfry, small top statue |
| Faro | Arco da Vila town gate | White gate with bell niche |
| Porto | Clérigos baroque tower | Slim tower, onion cap |
| Lisbonne | Belém riverside tower | Square tower, small turrets, terrace |
| Milan | Gothic cathedral façade with spires | Triangular façade, five spires |
| Berlin | Neoclassical city gate with chariot | Six columns, flat top, small quadriga |
| Prague | Old Town clock tower | Tower with clock face and pointed corners |
| Vienne | Gothic cathedral with zigzag roof | Steep patterned roof, one spire |
| Chicago | Historic water tower | Castle-like stone tower, pinnacles |
| Los Angeles | Hilltop observatory with domes | Long white building, three domes |
| New York | Torch-bearing statue on a star fort | Green figure with torch on a plinth |
| Busan | Hilltop tower | Slim tower with a lantern top |
| Séoul | Great south gate | Two-tier hip roof over a stone base |
| Osaka | Castle keep | Stacked white tiers with green roofs |
| Tokyo | Lattice broadcast tower (Skytree, as requested in #73) | Slim tapering lattice, two observation rings |

Monument rules:

- **Footprint:** the lot's building area. **Height:** at most the current
  hotel height plus 40 %, and always under the town and pawn visibility caps
  checked by `town-layout.test.ts`; a tower that would exceed it is drawn
  shorter and wider, never taller.
- **Readability at 1280×720:** each monument must still read as its shape when
  ~40 px tall. Thin parts (spires, lattice) are thickened, lattice is painted
  on a solid body, not modelled as bars.
- **Budget:** ≤ 1,200 triangles each, a shared 512×512 atlas for all twenty,
  one toon material plus outline. Monuments are not instanced (each is unique)
  but at most 20 exist; they share one material so they batch well.
- **Plain hotel fallback:** until a city's monument is modelled, it uses a
  generic tall hotel with the same plinth and pennant.
- **Legal check before shipping:** some modern buildings and their images are
  protected (for example certain towers or signs). Before a monument ships,
  the maintainers confirm its silhouette may be used. The Tokyo tower in
  particular needs that check; the fallback is a five-storey pagoda. Avoid the
  hillside letter sign in Los Angeles, Cloud Gate in Chicago and similar works.
- Saved rooms with the legacy **Landmark** level show the monument with a gold
  top and the existing light beam.

The town plots in the centre (`Downtown.tsx`) show the same monument at town
scale once a lot reaches the Hotel level, so the city's identity repeats in
the centre.

### Resorts: four bungalows (#58)

Each resort gets its own bungalow model. The owner's colour is on the awning,
umbrella or pool rim.

| Resort | Bungalow |
| --- | --- |
| Côte d'Azur | Striped beach cabana with a fringed parasol and a deck chair |
| Chypre | Whitewashed stone villa, blue shutters, a lemon tree |
| Dubaï | Desert glamping tent with a sail canopy and lanterns (no famous hotel) |
| Bali | Thatched over-water bungalow on stilts with a small lagoon |

All four share one palm and pool kit with the town. Budget ≤ 900 triangles each.

### Corners and town

- Start, Island, Championship stadium and World Tour airport keep their models
  but move to toon materials and the palette.
- Town trees become "lollipop" shapes (sphere crown, two toon bands, short trunk).
  Water gets painted foam lines. Cars are rounder, with a visible windscreen band.

## 7. Money (#59)

The money in front of each player becomes four kinds of piece. The DOM HUD
remains the exact amount. The piles are an illustration and are capped.

| Piece | Value it stands for | Look |
| --- | --- | --- |
| Coin | 1 k each, piled loose | Gold disc, embossed star, metal material |
| Note | 5 k each | Green note with an ivory border, slight curl, lies in a short fan |
| Bundle | 50 k (ten notes) | Stack of notes with a paper strap in the **player colour** |
| Silver bar | 100 k | Trapezoid bar, silver metal, stamped star |
| Gold bar | 500 k | Larger trapezoid bar, gold metal, stamped star, bloom sparkle |

### "Pocket money" rule

The issue asks that a rich player still shows a few coins, a few notes and a few
silver bars, not only gold. The layout is computed in the client from
`viewState` cash only:

1. Start with a greedy split of the cash into gold, silver, bundles, loose notes
   and coins.
2. **Keep change visible.** While there are fewer than 2 silver bars and a gold
   bar exists, break one gold bar into 5 silver. While there are fewer than 2
   bundles and a silver bar exists, break one silver into 2 bundles. Always show
   at least 3 coins when cash is positive.
3. **Caps:** 12 gold bars, 6 silver bars, 6 bundles, 6 loose notes, 8 coins.
   Above the gold cap, the gold stack stops growing and a small gold crown
   appears on the tray instead.
4. Everything sits on a low **wooden tray** outside the track, with fixed slots
   (gold at the back, silver, bundles, notes, coins at the front), so an
   almost empty tray still looks tidy and a full one looks abundant.

Examples (see [money.svg](art/money.svg)):

| Cash | Gold | Silver | Bundles | Notes | Coins |
| --- | --- | --- | --- | --- | --- |
| 120 k | 0 | 0 | 2 | 4 | 3 |
| 2,000 k (start) | 3 | 4 | 2 | 0 | 3 |
| 8,000 k | 12 (capped) + crown | 4 | 2 | 0 | 3 |

Money in flight (salary, rent, purchases) uses the matching piece: small
amounts fly as coins and notes, rents above 500 k fly as gold bars. The flight
paths and budgets in ANIMATION.md do not change. All pieces stay instanced, one
`InstancedMesh` per piece type.

## 8. Dice

Ivory dice with strongly rounded corners, pips in the roller's colour
(the dice already take the roller's colour today; the body becomes ivory so
pips read better), toon shading and an outline. The double gold flash stays.

## 9. UI

The HUD and dialogs follow the same picture-book feel without covering more of
the board.

- **Panels:** ivory paper (`--paper`), 14 px radius, a 2 px ink border at 15 %
  opacity and a soft offset shadow (0 3 px 0 at 12 % ink) so panels look like
  stickers on the board.
- **Corner HUDs:** the character bust replaces the plain avatar; the player
  colour fills the bust's background disc. Cash keeps bold tabular numerals.
- **Icons:** one set, drawn in the same style: 2 px rounded strokes in ink with
  a single flat fill colour from the palette. No emoji, no mixed icon sets.
- **Typography:** keep the system stack for body text. Titles and big numbers
  may use one rounded display font (open licence, self-hosted, subset, under
  40 kB) to be chosen with the board user; until then, use the current stack
  in bold.
- **Illustrated previews** (purchase and upgrade dialogs, `CityIllustration.tsx`)
  draw the same houses, monument and bungalow as the board, flat, so the dialog
  and the 3D piece match.
- **Card art** (`docs/CARD_ART.md`) already uses ivory paper, turquoise, coral
  and gold; it matches and stays.

## 10. Delivery order

Each step is a separate pull request and is checked in a real browser at
1280×720, 1440×900 and 1920×1080, plus reduced motion and Low graphics.

1. Shared toon ramp, outline helper and palette constants (scene-wide look,
   no new models).
2. Four characters as procedural primitives with face atlas and expressions;
   HUD busts.
3. Money tray and the five piece types (#59).
4. Houses and the generic hotel with plinth and pennant; four bungalows (#58).
5. City monuments, a few at a time, after the legal check (#73).
6. glTF replacements by an artist where the procedural pieces fall short.

Performance gate for every step: draw calls stay under the current count plus
10 %, and every static asset stays under the 25 MiB Workers limit (in practice
models are tens of kilobytes).

## Open questions for the board user

1. Characters: one fixed character per seat (proposed), or let players pick a
   character in the waiting room later?
2. Tokyo: keep the requested lattice tower if the legal check allows it, or use
   the pagoda fallback straight away?
3. Notes worth 5 k (as suggested in #59) means ten notes per 50 k bundle. Is
   that the intended scale, given that a player starts with 2,000 k?
