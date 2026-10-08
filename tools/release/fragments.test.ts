import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkFragments,
  collectFragments,
  parseFragment,
  prepareRelease,
} from "./fragments.ts";

const NOW = new Date("2026-10-04T12:00:00Z");
const CHANGELOG =
  "# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-10-01\n\n- First playable prototype.\n";

function write(directory: string, file: string, content: string): void {
  mkdirSync(dirname(join(directory, file)), { recursive: true });
  writeFileSync(join(directory, file), content);
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Release Test",
      GIT_AUTHOR_EMAIL: "release-test@example.invalid",
      GIT_COMMITTER_NAME: "Release Test",
      GIT_COMMITTER_EMAIL: "release-test@example.invalid",
    },
  });
}

function commit(directory: string, message: string): string {
  git(directory, "add", "-A");
  git(directory, "commit", "--quiet", "-m", message);
  return git(directory, "rev-parse", "HEAD").trim();
}

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "polytour-fragment-test-"));
  git(directory, "init", "--quiet");
  write(
    directory,
    "package.json",
    `${JSON.stringify({ name: "fixture", version: "1.2.3" }, null, 2)}\n`,
  );
  write(directory, "CHANGELOG.md", CHANGELOG);
  write(directory, "changelog.d/README.md", "How to write a fragment.\n");
  return directory;
}

function cleanup(directory: string): void {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^polytour-fragment-test-[a-zA-Z0-9]+$/);
  rmSync(target, { recursive: true, force: true });
}

test("fragments parse categories, multi-line notes and the bump marker", () => {
  const fragment = parseFragment(
    "a.md",
    "<!-- bump: minor -->\n\n### Added\n\n- A thing that\n  wraps (#1).\n- Another.\n\n### Fixed\n\n- A bug.\n",
  );
  assert.equal(fragment.bump, "minor");
  assert.deepEqual(fragment.notes.Added, [
    "- A thing that\n  wraps (#1).",
    "- Another.",
  ]);
  assert.deepEqual(fragment.notes.Fixed, ["- A bug."]);
  assert.equal(parseFragment("b.md", "### Fixed\n\n- x\n").bump, "patch");
});

test("empty, headingless or oddly headed fragments are rejected", () => {
  assert.throws(
    () => parseFragment("a.md", "### Added\n\n"),
    /no release notes/,
  );
  assert.throws(
    () => parseFragment("a.md", "- loose note\n"),
    /under a ### Added/,
  );
  assert.throws(
    () => parseFragment("a.md", "### Other\n\n- x\n"),
    /unknown heading/,
  );
  assert.throws(
    () => parseFragment("a.md", "### Added\n\nloose\n"),
    /start each note/,
  );
});

test("release prepare folds fragments into a dated section, bumps and deletes them", () => {
  const directory = fixture();
  try {
    write(directory, "changelog.d/one.md", "### Fixed\n\n- Fix one.\n");
    write(
      directory,
      "changelog.d/two.md",
      "<!-- bump: minor -->\n### Added\n\n- Add two.\n\n### Fixed\n\n- Fix two.\n",
    );
    assert.equal(prepareRelease(directory, undefined, NOW), "1.3.0");
    assert.equal(
      JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version,
      "1.3.0",
    );
    assert.equal(
      readFileSync(join(directory, "CHANGELOG.md"), "utf8"),
      "# Changelog\n\n## [Unreleased]\n\n## [1.3.0] - 2026-10-04\n\n### Added\n\n- Add two.\n\n### Fixed\n\n- Fix one.\n- Fix two.\n\n## [1.2.3] - 2026-10-01\n\n- First playable prototype.\n",
    );
    assert.equal(collectFragments(directory).length, 0);
    assert.ok(existsSync(join(directory, "changelog.d/README.md")));
  } finally {
    cleanup(directory);
  }
});

test("release prepare honours an explicit bump and refuses to run empty or with Unreleased notes", () => {
  const directory = fixture();
  try {
    assert.throws(
      () => prepareRelease(directory, "patch", NOW),
      /No fragments/,
    );
    write(directory, "changelog.d/one.md", "### Fixed\n\n- Fix one.\n");
    assert.equal(prepareRelease(directory, "major", NOW), "2.0.0");
    write(directory, "changelog.d/two.md", "### Fixed\n\n- Fix two.\n");
    write(
      directory,
      "CHANGELOG.md",
      readFileSync(join(directory, "CHANGELOG.md"), "utf8").replace(
        "## [Unreleased]\n",
        "## [Unreleased]\n\n- Legacy note.\n",
      ),
    );
    assert.throws(
      () => prepareRelease(directory, undefined, NOW),
      /Move them into/,
    );
    assert.ok(existsSync(join(directory, "changelog.d/two.md")));
  } finally {
    cleanup(directory);
  }
});

test("internal fragments count for the bump but stay out of mixed player notes", () => {
  const directory = fixture();
  try {
    write(
      directory,
      "changelog.d/internal.md",
      "<!-- bump: minor -->\n<!-- internal -->\n### Fixed\n\n- Repair CI.\n",
    );
    write(
      directory,
      "changelog.d/player.md",
      "### Fixed\n\n- Restore room reconnection.\n",
    );
    assert.equal(collectFragments(directory)[0].internal, true);
    assert.equal(prepareRelease(directory, undefined, NOW), "1.3.0");
    const notes = readFileSync(join(directory, "CHANGELOG.md"), "utf8");
    assert.match(notes, /Restore room reconnection/);
    assert.doesNotMatch(notes, /Repair CI|Maintenance release/);
    assert.equal(collectFragments(directory).length, 0);
  } finally {
    cleanup(directory);
  }
});

test("internal-only releases get a truthful maintenance note and still require valid notes", () => {
  const directory = fixture();
  try {
    assert.throws(
      () => parseFragment("internal.md", "<!-- internal -->\n"),
      /no release notes/,
    );
    write(
      directory,
      "changelog.d/internal.md",
      "<!-- internal -->\n### Fixed\n\n- Repair CI.\n",
    );
    assert.equal(prepareRelease(directory, undefined, NOW), "1.2.4");
    const notes = readFileSync(join(directory, "CHANGELOG.md"), "utf8");
    assert.match(
      notes,
      /Maintenance release. Gameplay and room rules are unchanged/,
    );
    assert.doesNotMatch(notes, /Repair CI/);
  } finally {
    cleanup(directory);
  }
});

test("a feature pull request needs a fragment and must leave the changelog and version alone", () => {
  const directory = fixture();
  try {
    const base = commit(directory, "base");
    write(directory, "src.txt", "change");
    commit(directory, "no notes");
    assert.throws(() => checkFragments(directory, base), /needs release notes/);

    write(directory, "changelog.d/feature.md", "### Added\n\n- Feature.\n");
    commit(directory, "fragment");
    checkFragments(directory, base);

    write(directory, "CHANGELOG.md", `${CHANGELOG}\n- sneaky edit\n`);
    commit(directory, "edit changelog");
    assert.throws(() => checkFragments(directory, base), /add a fragment/);
  } finally {
    cleanup(directory);
  }
});

test("a version bump in a feature pull request is rejected but a release pull request passes", () => {
  const directory = fixture();
  try {
    write(directory, "changelog.d/feature.md", "### Added\n\n- Feature.\n");
    const base = commit(directory, "base with a pending fragment");

    write(
      directory,
      "package.json",
      `${JSON.stringify({ name: "fixture", version: "1.2.4" }, null, 2)}\n`,
    );
    write(directory, "changelog.d/other.md", "### Fixed\n\n- Other.\n");
    commit(directory, "bump while adding a fragment");
    assert.throws(() => checkFragments(directory, base), /add a fragment/);

    git(directory, "reset", "--quiet", "--hard", base);
    prepareRelease(directory, undefined, NOW);
    commit(directory, "release");
    checkFragments(directory, base);
  } finally {
    cleanup(directory);
  }
});

test("the CLIs report usage errors and a clean fragment directory", () => {
  const directory = fixture();
  try {
    const run = (script: string, args: string[]) =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL(script, import.meta.url)), ...args],
        {
          cwd: directory,
          encoding: "utf8",
        },
      );
    assert.notEqual(run("./release-prepare.ts", ["huge"]).status, 0);
    assert.notEqual(run("./release-prepare.ts", []).status, 0);
    write(directory, "changelog.d/ok.md", "### Fixed\n\n- Ok.\n");
    assert.match(
      run("./check-fragments.ts", []).stdout,
      /1 changelog fragment/,
    );
    write(directory, "changelog.d/bad.md", "no headings\n");
    assert.notEqual(run("./check-fragments.ts", []).status, 0);
  } finally {
    cleanup(directory);
  }
});
