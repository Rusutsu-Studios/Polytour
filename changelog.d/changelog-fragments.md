<!-- bump: minor -->

### Changed

- Pull requests no longer edit `CHANGELOG.md` or bump the package version, which
  made concurrent pull requests conflict. Each adds a `changelog.d/` fragment
  instead; `pnpm release:prepare` folds the pending fragments into a dated
  changelog section and bumps the version at release time. CI now requires a
  fragment per pull request and rejects version or changelog edits outside a
  release. `pnpm version:prepare` and `--require-bump` are removed.
