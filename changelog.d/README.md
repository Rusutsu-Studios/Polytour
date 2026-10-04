# Changelog fragments

Every pull request adds **one file here** describing its change, and does not
edit `CHANGELOG.md` or the `package.json` version. Fragments never collide, so
pull requests can merge in any order. A release (`pnpm release:prepare`) folds the
pending fragments into `CHANGELOG.md`, bumps the version and deletes them.
See [docs/RELEASING.md](../docs/RELEASING.md).

Name the file after your branch or change, for example `changelog.d/lobby-leave.md`:

```md
<!-- bump: minor -->

### Added

- A room option to ... (#123).

### Fixed

- A long note can wrap onto an indented
  continuation line.
```

- Headings are `### Added`, `### Changed` or `### Fixed`; use only the ones you need.
- Each note starts with `- `. Mention the issue or pull request number when known.
- The first-line `<!-- bump: minor -->` marker is optional. Patch (the default)
  is for fixes, maintenance and documentation; `minor` for a feature or a
  breaking prototype change; `major` only for a deliberate stable launch.
- `pnpm check:fragments` validates every fragment in this folder.
