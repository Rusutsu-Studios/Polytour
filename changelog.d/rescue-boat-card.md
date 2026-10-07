<!-- bump: minor -->

### Changed

- Renamed the Chance card that clears the Island from "Jailbreak" ("Liberté") to
  "Rescue boat" ("Bateau de secours"), so the card speaks of the island it
  empties instead of a prison. Its artwork is now a rescue boat with a life ring
  calling at the island, and the card text, the Stranded card's release note and
  the luck-card catalogue follow.
- Saved matches keep playing: stored state climbs a new state-version-4 rung that
  renames the card in the draw pile, the discard pile and the last drawn card,
  and event rows replayed to a reconnecting client are rewritten the same way.
