# Original card art

Every Chance card has its own flat drawing in `src/client/ui/CardArt.tsx`:
one subject (a flag, an island, a cracked house, a die and an arrow…) on one
plain colour, readable as a 44-pixel thumbnail. The drawings are inline SVG, so
they need no download and follow the card's die roll. They replaced three
shared, detailed generated illustrations (#61).

In game, a drawn card shows only its title, its drawing and one short line, in a
gold frame for a good card and a wooden one for a bad card. How to play keeps the
full description and rule notes for each card.

No competitor artwork is shipped. Property previews and physical banknote
stacks are original code-native geometry.

## References used

- [Business Tour UI archive](https://interfaceingame.com/games/business-tour/):
  reference for centered purchase decisions, dimmed board, illustrated stages,
  visible price and remaining cash, and money surrounding the board.
- [Hasbro Monopoly instructions](https://www.hasbro.com/common/instruct/Monopoly_Vintage.pdf):
  reference for showing a drawn card and its instructions, and separating
  property price, rent and bank payments. These are interaction references;
  Polytour keeps its own engine rules and existing economy.

The card presenter shares the event Director with the scene. A card stays
visible for up to 2.6 seconds (850 ms when catching up) or until Continue/Escape.
Effects then resume in event order. Automatic recovery, reconnect and snapshot replacement
cancel the reading moment and reconcile to the server. The server's existing
decision clock continues; the popup does not pause a match or change a rule.

## Generated notice scenes

The "cannot afford" notice (#98) shows a generated cartoon scene in its cloud
stage, chosen by the player's colour (`src/client/ui/notice/buy-<seat>.webp`,
`buyout-<buyer>-<owner>.webp`). The images hold no text: the game writes the
real price on the blank sign, and the banner stays HTML in both languages.
No competitor artwork, name or composition is used in prompts or images.

**Recipe**, so later scenes and cards keep exactly this style. The full
prompts, seeds and edit chain are in `tools/art/notice-recipe.json`.

- Local ComfyUI with FLUX.2 [klein] 9B distilled, the Qwen3 8B fp8 text
  encoder and the FLUX.2 VAE: euler, 4 steps, CFG 1, 1344x768.
  `python tools/art/generate.py jobs.json outdir` queues jobs on
  `127.0.0.1:8188`; a job with `"source"` edits that image instead.
- Style sentence, appended to every new scene: vibrant cartoon board-game
  illustration, bold rounded shapes, saturated colours, soft cel shading,
  warm sunny light, big expressive heads, sunny sky, rounded houses, a blank
  cream wooden sign, no text.
- One character family: the buyer is the brown-bob woman of `buy-2`. Never
  redraw her: add new characters into her approved image instead (the
  buyout owner, an ordinary businessman holding the blank sign, was added
  this way), so she stays identical. Make the player colours by editing only
  the jacket colour, and keep her dark purple trousers. These edits keep the
  faces, poses and sign position, so one sign position serves every colour.
- Poses: symmetric and front facing, both hands busy, "exactly two arms, one
  from each shoulder". Calm expressions: frustrated or sheepish, never
  screaming.
- Review every candidate on a full-resolution crop before showing it: trace
  each arm from its shoulder, count the hands and fingers, and check that
  pockets, wallets and coins are what they claim to be. Thumbnails hide
  extra arms and floating objects.
- Run the tools with ComfyUI's bundled Python (it has Pillow, NumPy and
  SciPy). `find-sign.py image.png` measures the blank sign; its
  stage centre and width go in `SIGNS` in `src/client/ui/Notice.tsx`.
