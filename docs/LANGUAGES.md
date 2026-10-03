# Interface languages

The prototype supports **French and English**. French is the default. Choose the
language in the welcome header or under the in-game View and animation tool.
The preference is saved locally; it does not change the room, rules, randomness,
players or authoritative state. Players on different computers can use different
languages in the same match. The document's `lang` attribute follows the choice.

`src/client/i18n.ts` owns the preference and React subscription. `useLocale()`
subscribes components; `translate(fr, en)` selects complete messages in presentation
helpers. Do not translate protocol identifiers or mutate engine data. Board,
construction and card names use `tileName`, `levelName` and `cardName`; card
instructions use engine amounts. City names use established names in each locale.
Money and slider accessible values use `fr-CH` or `en-GB` number formatting.

Coverage includes welcome/lobby, settings, instructions, board textures and
accessible fallback, player HUDs, decisions, cards, inspection, event log,
standings and known network errors. Names chosen by players are preserved. Errors
already displayed keep their text; subsequent errors use the current language.
An unknown custom server explanation is shown verbatim. Original card artwork is
language-neutral. Other languages are not implemented.

Browser regressions verify language persistence, document language, keyboard
sliders that set the created room, desktop bounds and a real local match
switching language without changing credentials or opening another socket. A
mocked quota response checks English error handling without a remote room request.

Visual references: the supplied screenshots and [Business Tour interface
collection](https://interfaceingame.com/games/business-tour/). Product artwork,
geometry and branding remain original.
