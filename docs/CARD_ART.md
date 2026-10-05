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
