# Changelog

Changes are recorded here by application release version. See
[RELEASING.md](docs/RELEASING.md) for versioning, milestones and publication.

`0.1.0` is the starting record for the existing playable prototype and the new
release workflow. This entry does not establish that a Git tag or GitHub Release
has been published, and it does not reconstruct earlier development history.

## [Unreleased]

### Changed

- World Tour can fly to your own cities and resorts as well as unowned ones in
  rooms created from now on (rules version 6). Rooms already created keep their
  destinations.

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
