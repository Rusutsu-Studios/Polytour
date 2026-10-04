# Releases and milestones

## Application version

`package.json` is the sole source of the application release version. The client
and Worker import it through `src/shared/version.ts`; the welcome footer displays
`vX.Y.Z` and `GET /api/version` returns `{ "version": "X.Y.Z" }` with
`Cache-Control: no-store`. Rebuild both sides after changing the package version.

The initial `0.1.0` entry records the playable prototype and workflow adoption on
3 October 2026; it is a starting record, not a published release. Every pull
request, including documentation-only and maintenance changes, advances the
application version above its current base. Codex and Claude Code prepare it
automatically as part of their required [shared workflow](../AGENTS.md#application-version-required-for-every-pull-request).
CI rejects a pull request or merge-queue entry whose version has not advanced.

Iterations of the same open pull request may share its prepared version. Include
the Git commit and deployment URL in bug reports and verification records to
identify the exact build. A prepared version alone does not establish a production
deployment or a published GitHub Release.

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

## Preparing every pull request

1. Add concrete changes and useful issue or pull request references under `## [Unreleased]`
   in [CHANGELOG.md](../CHANGELOG.md), using `### Added`, `### Changed` or
   `### Fixed`. Keep exactly one first `Unreleased` section and dated
   `## [X.Y.Z] - YYYY-MM-DD` entries in descending version order. Preserve every
   dated entry inherited from the base; put corrections to earlier records in
   the new notes.
2. Fetch the latest base, choose the bump, and run:

   ```sh
   git fetch origin main
   pnpm version:prepare patch --base origin/main
   pnpm check:version --base origin/main --require-bump
   pnpm test:version
   ```

   `patch` is optional and is the default; use `minor` or `major` according to the
   table above. The helper reads the fetched base. For a fresh bump, it requires
   actual `Unreleased` notes, moves them to a new section with the current UTC
   date, updates `package.json` and leaves `Unreleased` empty. It performs no Git
   commits, tags, publication or deployment. Review both changed files.

   Rerunning preparation keeps an already prepared version above the base and
   folds new `Unreleased` notes into this pull request's existing release section.
   If the scope grows, explicitly preparing `minor` or `major` promotes that
   section to at least the corresponding next version of the base, preserving
   its date and notes; it never downgrades a higher prepared version. Use a
   different fetched remote ref with `--base` when targeting another branch.
   The lower-level `pnpm version:bump patch` remains available for manual use;
   `version:prepare` is the normal pull request command.
3. Complete the preparation before the final commit or creating/updating the
   pull request, and include both files in that pull request. If another merged
   pull request makes the version stale, rebase or merge the latest base, resolve
   conflicts, and rerun preparation and the relevant checks before merging.

   CI checks package/changelog consistency and unchanged dated base history on
   pushes and tags. Pull requests and merge-queue runs additionally require a
   version strictly greater than their base. Pushed `v*` tags must exactly match
   the package version. The existing test job also runs the focused tooling tests.
   Keep `main` protected with required `verify` checks and an up-to-date base,
   including for administrators. Require pull requests with zero mandatory
   review approvals so agents can still complete the normal workflow themselves.
4. Complete [the checks required for the changes](../AGENTS.md#verification-before-calling-something-done),
   then review and merge the pull request. Wait for the
   exact `main` commit's required CI checks and production deployment. Verify its
   version endpoint, visible version and gameplay; record the commit, deployment
   URL and results.

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
