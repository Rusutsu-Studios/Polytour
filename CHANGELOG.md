# Changelog

Changes are recorded here by application release version. See
[RELEASING.md](docs/RELEASING.md) for versioning, milestones and publication.

`0.1.0` is the starting record for the existing playable prototype and the new
release workflow. This entry does not establish that a Git tag or GitHub Release
has been published, and it does not reconstruct earlier development history.

## [Unreleased]

## [0.1.0] - 2026-10-03

### Added

- Initial version record for the playable desktop prototype: private rooms with
  two to four seats, server bots, a Three.js board and saved-room reconnection.
  Remaining product and verification work is tracked in the roadmap.
- Application version from `package.json`, shown in the welcome footer and
  returned by the uncached `GET /api/version` endpoint.
- Version bump and consistency checks, a changelog, and a documented release and
  milestone workflow.
