# Changelog

Changes are recorded here by application release version. See
[RELEASING.md](docs/RELEASING.md) for versioning, milestones and publication.

`0.1.0` is the starting record for the existing playable prototype and the new
release workflow. This entry does not establish that a Git tag or GitHub Release
has been published, and it does not reconstruct earlier development history.

## [Unreleased]

### Changed

- Board lots are printed in two parts: the city ground, with its buildings and
  name on a pavement of its country's own style and color, and a concrete price
  strip showing only the price or the owner's rent. Beaches are one piece of
  sand, the tax and chance squares are smooth concrete, and unsold plots in the
  central town no longer hold trees (#57).
- Players are identified by color only; per-player symbols are removed from
  the board, pawns, corner HUDs, cards and menus (#57).

### Fixed

- Invitation links ask only for a nickname and join the invited room, with
  retryable errors, saved-seat recovery and a return to the start screen (#54).

## [0.1.0] - 2026-10-03

### Added

- Initial version record for the playable desktop prototype: private rooms with
  two to four seats, server bots, a Three.js board and saved-room reconnection.
  Remaining product and verification work is tracked in the roadmap.
- Application version from `package.json`, shown in the welcome footer and
  returned by the uncached `GET /api/version` endpoint.
- Version bump and consistency checks, a changelog, and a documented release and
  milestone workflow.
