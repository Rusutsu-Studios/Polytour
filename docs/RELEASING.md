# Releases and milestones

## Application version

`package.json` is the sole source of the application release version. The client
and Worker import it through `src/shared/version.ts`; the welcome footer displays
`vX.Y.Z` and `GET /api/version` returns `{ "version": "X.Y.Z" }` with
`Cache-Control: no-store`. Rebuild both sides after changing the package version.

The initial `0.1.0` entry records the playable prototype and workflow adoption on
3 October 2026; it is a starting record, not a published release. Every pull
request, including documentation-only and maintenance changes, adds a changelog
fragment in `changelog.d/` and does not touch the version or `CHANGELOG.md`.
The version advances only when a release is prepared (see below). Codex and
Claude Code follow the same [shared workflow](../AGENTS.md#release-notes-required-for-every-pull-request).
CI rejects a pull request or merge-queue entry without a valid fragment, or that
edits the version or changelog outside a release.

Include the Git commit and deployment URL in bug reports and verification
records to identify the exact build, because several merged pull requests can
share one release version. A prepared version alone does not establish a
production deployment or a published GitHub Release.

## Choosing a version

Polytour follows [Semantic Versioning 2.0.0](https://semver.org/). Tooling accepts
normal `MAJOR.MINOR.PATCH` values without leading zeroes, prerelease suffixes or
build metadata.

| Change | Bump | Example |
| --- | --- | --- |
| Compatible bug fix, maintenance or documentation | `patch` (default) | `0.1.0` → `0.1.1` |
| Feature or substantial compatible improvement | `minor` | `0.1.0` → `0.2.0` |
| Stable launch; later, an incompatible public API change | `major` | `0.y.z` → `1.0.0`; `1.x.y` → `2.0.0` |

During `0.y.z` development, breaking prototype changes use a minor release and
are called out in its notes. Choose `1.0.0` deliberately for the stable public API
and launch boundary.

## Compatibility versions

These counters are separate from application releases. Values at workflow adoption:

| Counter | Value | Purpose |
| --- | --- | --- |
| `PROTOCOL_VERSION` | `3` | Client/Worker message compatibility; stale clients reload |
| `CURRENT_STATE_VERSION` / `stateVersion` | `1` | Persisted state shape and its migration ladder |
| `RULES_VERSION` / `rulesVersion` | `8` for new rooms | Rules frozen when each room is created |

Bump a counter only for its own compatibility requirement, with relevant tests.
Saved rooms retain their earlier rules; new releases must load their state and
preserve those rules. See [ARCHITECTURE.md](ARCHITECTURE.md#deploys-and-games-in-progress)
and [PROTOCOL.md](PROTOCOL.md).

## Release notes for every pull request

A pull request never edits `CHANGELOG.md` or the `package.json` version. Those
two spots are the same for every open pull request, so editing them made
concurrent pull requests conflict whenever another one merged. Each pull request
instead adds one fragment file, so nothing collides.

1. Create `changelog.d/<short-name>.md`, unique to the pull request. Use `### Added`,
   `### Changed` or `### Fixed` headings with concrete bullet notes and useful
   issue or pull request references. Wrap a long note by indenting its
   continuation lines. A first line `<!-- bump: minor -->` (or `major`) asks for
   that bump at the next release; patch is the default. Choose the bump with the
   table above. See [changelog.d/README.md](../changelog.d/README.md).
2. Run:

   ```sh
   pnpm check:fragments
   pnpm test:version
   ```

   `pnpm check:fragments --base origin/main` runs the same check CI does: it adds
   the rule that the pull request contains a new fragment and does not edit
   `CHANGELOG.md` or the version.
3. Complete [the checks required for the changes](../AGENTS.md#verification-before-calling-something-done),
   then review and merge the pull request. Iterations of the same pull request
   edit its fragment. Wait for the exact `main` commit's required CI checks and
   production deployment, and record the commit, deployment URL and results.

CI checks fragment syntax everywhere, and on pull requests and the merge queue
requires a new fragment, rejects edits to the version or changelog, and checks
that dated base history is unchanged. Pushed `v*` tags must exactly match the
package version. The existing test job also runs the focused tooling tests. Keep
`main` protected with required `verify` checks and an up-to-date base, including
for administrators. Require pull requests with zero mandatory review approvals so
agents can still complete the normal workflow themselves.

## Preparing a release

The `Release PR` workflow (`.github/workflows/release-pr.yml`) does this for you: on
every push to `main` it rebuilds one rolling `release/next` pull request that folds
the pending fragments into the changelog and version. Merge it to ship. Add a
`RELEASE_TOKEN` secret (PAT or app token with contents and pull-request write) so
CI runs on that PR; without it, close and reopen the PR to trigger CI.
To do it by hand instead, open a release pull request:

```sh
pnpm release:prepare            # bump = the highest one requested by the fragments
pnpm release:prepare minor      # or force patch, minor or major
pnpm check:version --base origin/main
pnpm test:version
```

`release:prepare` groups every fragment's notes under `### Added`, `### Changed`
and `### Fixed` in a new dated `CHANGELOG.md` section, updates `package.json`,
deletes the fragments it consumed and leaves `## [Unreleased]` empty. It refuses
to run with no fragments or with notes left under `Unreleased`. It performs no Git
commits, tags, publication or deployment; review both changed files, commit them
and merge the release pull request, which is the only kind allowed to change the
version and changelog.
The lower-level `pnpm version:bump patch` remains for manual use.

## Tagging and publishing

Tag the verified `main` commit containing the intended version and changelog.
For an approved `0.2.0` release, replace `VERIFIED_MAIN_COMMIT` with its full SHA
and run the following sequentially from a clean checkout, stopping on any failure:

```sh
git fetch origin main --tags
git merge-base --is-ancestor VERIFIED_MAIN_COMMIT origin/main
git switch --detach VERIFIED_MAIN_COMMIT
pnpm check:version --tag v0.2.0
git tag -a v0.2.0 VERIFIED_MAIN_COMMIT -m "Polytour v0.2.0"
git push origin refs/tags/v0.2.0
```

Use the chosen release version in place of the example. `--tag` requires exactly
`v` plus the package version. Once tag CI passes, create the GitHub Release from that tag,
copy its changelog notes and link the verified deployment. See GitHub's
[release instructions](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
Keep published tags fixed. Production deployment follows `main`, independently
of tag and GitHub Release publication.

## Planning milestones

Open **Issues → Milestones → New milestone** on GitHub and title the milestone
with its intended release tag. Describe the agreed scope and acceptance criteria;
set a due date only when agreed. GitHub provides
[milestone instructions](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/creating-and-editing-milestones-for-issues-and-pull-requests).

`v0.2.0` and `v1.0.0` are example names for a next prototype release and a stable
launch milestone. Select their scope from the [roadmap](ROADMAP.md), assign
related issues and pull requests, and explicitly defer unfinished work before
releasing. Close the milestone after its acceptance criteria and published release
have been verified.

## Browser checks

GitHub CI keeps the complete Playwright suite, excluding the separate `@live`
randomness check. It distributes individual scenarios across three isolated
runners using `--fully-parallel --workers 1 --shard N/3`. Each runner has one
browser worker, so graphics-heavy scenarios do not compete on that machine.
The required `verify` check waits for all three shards; failures retain separate
`playwright-report-N` artifacts. New feature-branch pushes cancel obsolete runs;
main and release-tag runs always finish.

Run the full suite locally with `pnpm test:e2e --grep-invert @live`.
