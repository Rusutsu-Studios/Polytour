# Changelog

Changes are recorded here by application release version. See
[RELEASING.md](docs/RELEASING.md) for versioning, milestones and publication.

`0.1.0` is the starting record for the existing playable prototype and the new
release workflow. This entry does not establish that a Git tag or GitHub Release
has been published, and it does not reconstruct earlier development history.

## [Unreleased]

### Added

- Play opens a lobby with three bots instead of starting at once; friends who
  enter the room code take a bot's place (#30).
- A transferable room leader who can lock the room and approve newcomers, hand
  a bot's place to someone who arrived mid-game, and bring everyone back to the
  lobby during or after a match. People who join mid-game watch until they get
  a place (#33).
- Players sharing one PC: any seated player can seat a local player, whose
  decisions appear on that screen labelled with their name (#44).

### Changed

- Protocol version 4: open browsers reload after the deploy that ships it.

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
