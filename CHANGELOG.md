# Changelog

Changes are recorded here by application release version. See
[RELEASING.md](docs/RELEASING.md) for versioning, milestones and publication.

`0.1.0` is the starting record for the existing playable prototype and the new
release workflow. This entry does not establish that a Git tag or GitHub Release
has been published, and it does not reconstruct earlier development history.

## [Unreleased]

## [0.7.4] - 2026-10-05

### Added

- Pause solo matches from the pause menu and resume with the remaining turn and
  match time intact. Multiplayer pauses require every human player's approval,
  with one request per room every five minutes (#55).
- New Chance cards for new rooms (#100): Tailwind moves you forward 1 to 6
  spaces on a die; Power Cut stops an opponent's city from earning rent until
  its owner passes Start three times; Forced Sale sends an opponent's property
  back to the bank with its refund (a Hotel only drops to three houses);
  Shield floats over one of your properties and blocks the next attack;
  Patron adds a level to your city, paid by the richest opponent; Roll Again
  gives you another roll. Two new bad cards: the rare Fan Trip sends you to
  pay rent in the championship's host city, and Gift makes you give a city
  to the poorest opponent.
- Earthquake, Power Cut and Land Swap now play on the board: the hit city
  shakes and sinks into dust, a cut city goes dark, and swapped cities flash
  in their new owners' colours. The game log names the affected city and
  owner (#85).
- Bare land now carries a small stand with a flag in its owner's colour, and
  the flag pops up when the land is bought (#70).
- Kept Chance cards lie face up beside their holder's cash on the table, and
  the player HUD shows a round ×N badge instead of the "N cards" label (#71).
- Each player's kept cards also appear as mini cards beside their name;
  hovering or focusing one springs up the full card with its art and rule.
  A truncated player name shows in full on hover.
- Persistent streamer mode hides room codes in the lobby and match, masks the
  manual join input, and removes invitation codes from the address bar (#37).
- Missing pages show a roundabout and car with a keyboard-accessible link home
  while returning HTTP 404 (#92).
- New rooms include a retained Escape card that releases its holder from Lost
  Island for free; saved rooms retain their existing card decks (#48).
- The welcome menu opens video settings from a gear button. The network status
  beside the credits and in a match opens the same settings panel on Debug.
- First visits follow the browser's French or English language preference;
  an explicitly saved language choice takes priority.

### Changed

- New rooms (rules version 10) rework the Chance deck: Tax audit moves you to
  the Tax office, Detour rolls a die for 1 to 6 spaces back, and bad cards
  make up half the draws. Rooms created earlier keep their sixteen
  cards (#100).
- In game, a drawn card shows only its title, one simple drawing and one
  short line, in a gold frame for good cards and a wooden one for bad cards.
  How to play keeps the full details (#100).
- Every card has its own flat drawing instead of three shared detailed
  illustrations (#61).
- The Lost Island decision shows the flat island drawing instead of a line
  icon, and the Escape card (#123) joins the reworked deck with its own drawing.
- Protocol version 7: clients from before this release reload.
- Pull requests no longer edit `CHANGELOG.md` or bump the package version, which
  made concurrent pull requests conflict. Each adds a `changelog.d/` fragment
  instead; `pnpm release:prepare` folds the pending fragments into a dated
  changelog section and bumps the version at release time. CI now requires a
  fragment per pull request and rejects version or changelog edits outside a
  release. `pnpm version:prepare` and `--require-bump` are removed.

### Fixed

- Card ranges, the search description and the share-card text use the ASCII
  hyphen (`1-6`, `2-4 players`) instead of en dashes. AGENTS.md now covers en
  and em dashes too, and CI rejects them in code.
- Align the home and room-lobby header, content, connection status and footer
  on desktop, including large-screen interface scaling (#93).
- Remove the running-game notice from the pause menu in both languages (#111).
- Cover Lost Island bot alarms for paying to leave and rolling to escape (#84).
- Stabilize the existing card/tax browser test's clock setup (from #119).
- Preserve solo pause and unanimous multiplayer voting when removing the notice.
- Held-card previews use the current card drawings, and the Island Escape
  card appears beside the player's cash and in their hand after the Chance
  card rework (#126). New board effects remain intact.
- The welcome toolbar removes the Prototype badge and gives graphics and streamer
  mode the same text-control styling as language; active streamer mode uses red
  text (#37).
- Interface minus signs use the standard ASCII hyphen-minus (-).
- The pause menu uses a gear button for settings, and the language shortcut
  remains available in the welcome toolbar.
- Lobby departures and player removals shift occupied seats left, preserving
  leadership, reconnect credentials and local player controls. New players and
  bots fill the first open seat (#94).
- Lost Island displays its title once, uses an island icon and keeps unavailable
  escape choices visible with explanations (#48).
- Lost Island descriptions include the Escape card when available under the
  room’s rules, and the turn decision shows how many failed rolls remain until
  automatic release (#87).
- Regression coverage confirms Championship choices work during the first lap,
  including a city acquired during doubles in the same turn (#83).
- Keep the game log behind its top-bar icon in a compact, scrollable panel above
  the bottom-left player, and remove the permanent bottom event caption (#45).
- Identify log actions with icons, color player names by seat, and show dice
  totals with a clear doubles label (#45).
- The "Reduce motion" choice in Pause → Settings → Video is now kept. It was
  read from the operating system on every load, so a player whose system asks
  for less motion lost the animations again at each reload and could not keep
  them on. The system setting now only supplies the first default, and the
  player's own answer wins from then on.

## [0.7.3] - 2026-10-04

### Changed

- Share the ponytail Claude Code plugin with every project member through a committed `.claude/settings.json` (marketplace plus enabled plugin).

## [0.7.2] - 2026-10-04

### Added

- Shared Codex marketplace and project configuration to install and enable the
  Ponytail plugin for trusted Polytour checkouts.

## [0.7.1] - 2026-10-04

### Changed

- The four-resort win is now an optional room setting, off by default, and is
  called the four-beach win in the interface (French: plages). Saved matches made
  before the option keep the win enabled.
- The room settings dialog saves the leader's changes when it closes; the Save
  settings button is gone.
- The arrow on the Start tile has a longer, clearer arrowhead on its left end.
- The French Start tile is named "Départ" instead of "Grand départ".

## [0.7.0] - 2026-10-04

### Added

- The player who buys out another player's city can build on it at once: up to
  three houses (two before a first completed lap), or the Hotel on a three-house
  city once the first lap is complete (#101).

### Changed

- Owning all four resorts pays 200 k rent instead of the third resort's 100 k,
  and the resort card lists the fourth row (#99).
- New rooms freeze rules version 7 for these two rules; rooms already created
  keep the rules they started with.

### Fixed

- Once the dice show their total, the space the pawn is about to reach is
  outlined in the roller's colour, through the walk and the decision there (#97).

## [0.6.1] - 2026-10-04

### Fixed

- Money flies to and from the tile it belongs to instead of the Start tile: a
  purchase or upgrade is paid into its city, a sale refunds from it, and taxes,
  the island fee, the World Tour fare and the championship fee are paid on their
  own tile (#89).
- The Start salary is paid the moment the pawn passes Start, with a "+400K"
  floating up from the tile and fading, instead of after the whole move or
  World Tour flight has finished (#88, #89).

## [0.6.0] - 2026-10-04

### Added

- A small bank is printed on Start. Salaries, taxes, fees and card payments fly
  to and from it instead of the bare tile, while purchase, building and sale
  money flies between the player and the lot; the Start salary is printed just
  below the bank (#60).
- Pause > Settings > Debug shows the bank's account: paid to players, received
  from players and its balance, which starts at 0. Property money is not part of
  it (#60).

### Changed

- Match state version 2 records the bank's account. Saved version-1 matches
  load with an empty account (#60).

## [0.5.2] - 2026-10-04

### Added

- Room option, enabled by default, to send a player to the Island after a third
  consecutive double; switching it off lets the third double move normally (#102).

## [0.5.1] - 2026-10-04

### Fixed

- Restrict festivals to cities in new matches, including rent and beach details;
  preserve existing matches with their original frozen festival rules (#96).
- Explain unavailable actions in small ivory popups on hover or keyboard focus,
  including construction prerequisites, insufficient cash, reconnecting and
  unsaved room settings (#32).
- Keep room preparation and joining feedback inline, without loading popups.
- Keep Surprise cards visible for eight seconds and show tax payments to every
  player in a matching six-second popup; reserve reading time before the next
  decision and bot action (#31).
- Show the current language as a simple globe-and-text FR/EN button beside How
  to play; click or keyboard activation switches directly to the other language (#43).
- Use a minimize icon on decision windows and a compact bottom tab that keeps
  the countdown and reopens the same selection (#50).

## [0.5.0] - 2026-10-03

### Added

- A French/English win-condition summary above Save settings, updated from the
  current room settings and available in the fixed rules during a match.
- An explanation of Birthday/Charity payments and how gift bankruptcy changes
  forced sales and payment limits.

### Fixed

- Keep the settings footer within short desktop viewports while longer settings
  content scrolls.

## [0.4.4] - 2026-10-03

### Changed

- Refresh French/English welcome copy, show creator credits and a GitHub link,
  and use simple hyphens in titles and unavailable-value labels (#90).

## [0.4.3] - 2026-10-03

### Fixed

- The room lobby board fills its preview instead of shrinking into a short canvas (#82).

## [0.4.2] - 2026-10-03

### Fixed

- Leaving a lobby releases the player's places and room connections and passes
  leadership to another player, including rooms with local or waiting players (#81).

## [0.4.1] - 2026-10-03

### Changed

- During a match, graphics quality lives only in Pause > Video, with separate
  High and Low choices. Removed the toolbar magnifier and previous/next arrows
  from clicked-space details (#80).
- Room leaders choose a successor from compact player portraits in the room
  panel. The shared avatar renderer also accepts future custom portraits (#80).

### Fixed

- Run the complete browser suite in three isolated CI shards and cancel superseded branch checks to reduce waiting.
- Keep protocol-only browser clients independent of 3D rendering during authoritative match checks.

## [0.4.0] - 2026-10-03

### Added

- Polytour browser and home-screen icons, a share image, French/English search
  metadata and structured game data (#41).
- A production homepage sitemap and crawl policy that excludes private room
  pages and previews from indexing, with proper missing-page responses.

### Fixed

- Feature-branch push checks compare released history with main, allowing draft
  release versions to be updated after another pull request merges.

## [0.3.1] - 2026-10-03

### Changed

- Festival cities return to the garland of pennants between two masts, now in
  vivid colors, instead of the face-on banner; the floating multiplier stays
  gone and the championship host keeps its searchlights (#78).
- Milan/Berlin and Prague/Vienne stand on smooth concrete slabs, square and long
  staggered, in muted slate-lavender and warm-taupe colors that no other region
  uses, so they no longer resemble Tokyo and Osaka (#78).

## [0.3.0] - 2026-10-03

### Changed

- The version in the welcome footer opens a scrollable release history sourced
  directly from CHANGELOG.md, with localized controls and keyboard navigation.
- The Championship corner is now a stadium with a spinning gold trophy; it
  lights up in the host's colour while a championship runs. The World Tour
  corner is now a jet port with a terminal, a control tower and an airliner
  taking off. Both share the town's ambient motion and keep the draw-call
  budget (#77).

## [0.2.0] - 2026-10-03

### Added

- Automatic version preparation for each pull request, with shared instructions
  for Codex and Claude and a CI check that rejects an unchanged application version.

- Play opens a lobby with three bots instead of starting at once; friends who
  enter the room code take a bot's place (#30).
- A transferable room leader who can lock the room and approve newcomers, hand
  a bot's place to someone who arrived mid-game, and bring everyone back to the
  lobby during or after a match. People who join mid-game watch until they get
  a place (#33).
- Players sharing one PC: any seated player can seat a local player, whose
  decisions appear on that screen labelled with their name (#44).
- A pause menu with Game, Video, Audio and Debug settings; the game continues
  while the menu is open, and audio controls are marked coming soon (#35).
- A five-second Cloudflare ping indicator and on-demand room routing and
  WebSocket latency diagnostics for connected players.

### Changed

- Protocol version 4: open browsers reload after the deploy that ships it.
- Personal settings live in the pause menu; the sliders tool shows fixed match
  rules. Video settings retain the High/Low graphics control.
- Removed manual animation finish/skip and speed controls, preserving reduced
  motion, automatic catch-up and reconnect recovery.
- World Tour can fly to your own cities and resorts as well as unowned ones in
  rooms created from now on (rules version 6). Rooms already created keep their
  destinations.
- Road markings around the board and in the town are softer, so they no longer
  compete with the spaces' names and prices.
- Board lots are printed in two parts: the city ground, with its buildings and
  name on a pavement of its country's own style and color, and a concrete price
  strip showing only the price or the owner's rent. Beaches are one piece of
  sand, the tax and chance squares are smooth concrete, and unsold plots in the
  central town no longer hold trees (#57).
- Country colors are spread further apart so no two groups look alike, and the
  tax square is named "Impôts" in French and "Taxes" in English (#57).
- Festival cities fly a tall, vivid swallowtail banner facing the camera with a
  garland of pennants; the floating multiplier medallion is gone, and the
  championship host flies a gold banner (#57).
- Players are identified by color only; per-player symbols are removed from
  the board, pawns, corner HUDs, cards and menus (#57).

### Fixed

- Invitation links ask only for a nickname and join the invited room, with
  retryable errors, saved-seat recovery and a return to the start screen (#54).
- Chance draws use fresh server cryptographic randomness, including saved games,
  so public setup and observed cards cannot reveal the next draw (#46).
- Shared room-creation limits bound anonymous storage allocation without IP keys;
  health probes and unknown-room requests no longer create room tables (#46).
- World Tour and long card moves walk the pawn along the board route, past Start
  when they cross it, instead of jumping across the board. The destination picker
  counts the Start salary a flight collects (#29).

## [0.1.0] - 2026-10-03

### Added

- Initial version record for the playable desktop prototype: private rooms with
  two to four seats, server bots, a Three.js board and saved-room reconnection.
  Remaining product and verification work is tracked in the roadmap.
- Application version from `package.json`, shown in the welcome footer and
  returned by the uncached `GET /api/version` endpoint.
- Version bump and consistency checks, a changelog, and a documented release and
  milestone workflow.
