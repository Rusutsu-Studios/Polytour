# Original card art

Three original illustrations made with the built-in ImageGen tool on 1 October
2026 are stored in `public/cards/`: `fortune.webp`, `travel.webp` and `city.webp`.
The production files are 960 × 640 WebP images, 238 kB combined. They load when
a card is shown, outside the initial lobby download. The source prompts are
preserved in [card-art-prompts.json](card-art-prompts.json).

The illustrations share ivory paper, turquoise travel objects, coral roofs,
green banknotes and gold. Sixteen cards reuse these three visual families;
their names, amounts, destinations and protection effects remain distinct.
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
