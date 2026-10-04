# Changelog

Changes are recorded here by application release version. See
[RELEASING.md](docs/RELEASING.md) for versioning, milestones and publication.

`0.1.0` is the starting record for the existing playable prototype and the new
release workflow. This entry does not establish that a Git tag or GitHub Release
has been published, and it does not reconstruct earlier development history.

## [Unreleased]

### Changed

- The four-resort win is now called the four-beach win in the interface (French: plages).
- The room settings dialog saves the leader's changes when it closes; the Save
  settings button is gone.

## [0.5.1] - 2026-10-04

### Changed

- The four-resort win is now an optional room setting, off by default. Saved
  matches made before the option keep the win enabled.

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
