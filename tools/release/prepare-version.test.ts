import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { prepareVersion, readRelease, validateBase } from "./release.ts";

const BASE_NOTE = "### Added\n\n- First playable prototype.";
const FIX_NOTE = "### Fixed\n\n- Restore room reconnection.";
const EXTRA_NOTE = "### Changed\n\n- Keep saved games compatible.";
const NOW = new Date("2026-10-03T00:30:00+02:00");

function changelog(notes = "", version = "1.2.3"): string {
  return `# Changelog\n\n## [Unreleased]\n\n${notes}\n\n## [${version}] - 2026-10-01\n\n${BASE_NOTE}\n`;
}

function writePackage(directory: string, version: string): void {
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "fixture", version, scripts: { dev: "vite" } }, null, 2)}\n`,
  );
}

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "polytour-prepare-test-"));
  writePackage(directory, "1.2.3");
  writeFileSync(join(directory, "CHANGELOG.md"), changelog());
  return directory;
}

function cleanupFixture(directory: string): void {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^polytour-prepare-test-[a-zA-Z0-9]+$/);
  rmSync(target, { recursive: true, force: true });
}

function snapshot(directory: string): string[] {
  return ["package.json", "CHANGELOG.md"].map((file) =>
    readFileSync(join(directory, file), "utf8"),
  );
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commitBase(directory: string): string {
  git(directory, "init", "--quiet");
  git(directory, "add", "package.json", "CHANGELOG.md");
  execFileSync("git", ["commit", "--quiet", "-m", "Release fixture"], {
    cwd: directory,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Release Test",
      GIT_AUTHOR_EMAIL: "release-test@example.invalid",
      GIT_COMMITTER_NAME: "Release Test",
      GIT_COMMITTER_EMAIL: "release-test@example.invalid",
    },
  });
  const base = git(directory, "rev-parse", "HEAD").trim();
  git(directory, "update-ref", "refs/remotes/origin/main", base);
  return base;
}

function addNotes(directory: string, notes = FIX_NOTE): void {
  const text = readFileSync(join(directory, "CHANGELOG.md"), "utf8");
  writeFileSync(
    join(directory, "CHANGELOG.md"),
    text.replace(
      /## \[Unreleased\]\s*\n(?=## \[)/,
      `## [Unreleased]\n\n${notes}\n\n`,
    ),
  );
}

function cli(directory: string, script: string, args: string[] = []) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL(script, import.meta.url)), ...args],
    { cwd: directory, encoding: "utf8" },
  );
}

test("prepare defaults to a patch from origin/main and keeps shipped history", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    const shipped = readRelease(directory).sections[1];
    addNotes(directory);
    assert.equal(prepareVersion(directory, undefined, undefined, NOW), "1.2.4");
    const release = readRelease(directory);
    assert.equal(release.version, "1.2.4");
    assert.equal(release.sections[0].body, "");
    assert.equal(release.sections[1].heading, "## [1.2.4] - 2026-10-02");
    assert.equal(release.sections[1].body, FIX_NOTE);
    assert.equal(release.sections[2].heading, shipped.heading);
    assert.equal(release.sections[2].body, shipped.body);
    assert.deepEqual(release.packageData.scripts, { dev: "vite" });
    assert.equal(validateBase(directory, release, base, true), "1.2.3");
    assert.equal(git(directory, "rev-parse", "HEAD").trim(), base);
    assert.equal(git(directory, "tag", "--list"), "");
  } finally {
    cleanupFixture(directory);
  }
});

test("repeated prepare is byte-stable even on a later date and CRLF files", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    addNotes(directory);
    prepareVersion(directory, "patch", base, NOW);
    for (const file of ["package.json", "CHANGELOG.md"]) {
      const path = join(directory, file);
      writeFileSync(path, readFileSync(path, "utf8").replace(/\n/g, "\r\n"));
    }
    const prepared = snapshot(directory);
    assert.equal(
      prepareVersion(
        directory,
        "patch",
        base,
        new Date("2026-10-20T12:00:00Z"),
      ),
      "1.2.4",
    );
    assert.deepEqual(snapshot(directory), prepared);
    assert.equal(
      readRelease(directory).sections[1].heading,
      "## [1.2.4] - 2026-10-02",
    );
  } finally {
    cleanupFixture(directory);
  }
});

test("later PR notes fold into the prepared release without another bump", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    addNotes(directory);
    prepareVersion(directory, "patch", base, NOW);
    const packageBefore = readFileSync(join(directory, "package.json"), "utf8");
    addNotes(directory, EXTRA_NOTE);
    assert.equal(
      prepareVersion(
        directory,
        "patch",
        base,
        new Date("2026-10-20T12:00:00Z"),
      ),
      "1.2.4",
    );
    const release = readRelease(directory);
    assert.equal(release.sections.length, 3);
    assert.equal(release.sections[0].body, "");
    assert.equal(release.sections[1].heading, "## [1.2.4] - 2026-10-02");
    assert.match(release.sections[1].body, /Restore room reconnection\./);
    assert.match(release.sections[1].body, /Keep saved games compatible\./);
    assert.equal(release.sections[2].body, BASE_NOTE);
    assert.equal(
      readFileSync(join(directory, "package.json"), "utf8"),
      packageBefore,
    );
    const folded = snapshot(directory);
    prepareVersion(directory, "patch", base, NOW);
    assert.deepEqual(snapshot(directory), folded);
  } finally {
    cleanupFixture(directory);
  }
});

for (const [bump, expected] of [
  ["minor", "1.3.0"],
  ["major", "2.0.0"],
] as const) {
  test(`${bump} promotes a prepared patch while preserving its date and notes`, () => {
    const directory = fixture();
    try {
      const base = commitBase(directory);
      addNotes(directory);
      prepareVersion(directory, "patch", base, NOW);
      assert.equal(
        prepareVersion(directory, bump, base, new Date("2026-10-20T12:00:00Z")),
        expected,
      );
      const release = readRelease(directory);
      assert.equal(release.sections.length, 3);
      assert.equal(release.sections[0].body, "");
      assert.equal(
        release.sections[1].heading,
        `## [${expected}] - 2026-10-02`,
      );
      assert.equal(release.sections[1].body, FIX_NOTE);
      assert.equal(release.sections[2].body, BASE_NOTE);
      assert.equal(validateBase(directory, release, base, true), "1.2.3");
    } finally {
      cleanupFixture(directory);
    }
  });
}

test("a requested smaller bump never lowers an already prepared version", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    addNotes(directory);
    prepareVersion(directory, "major", base, NOW);
    const prepared = snapshot(directory);
    assert.equal(prepareVersion(directory, "minor", base, NOW), "2.0.0");
    assert.deepEqual(snapshot(directory), prepared);
    addNotes(directory, EXTRA_NOTE);
    assert.equal(prepareVersion(directory, "patch", base, NOW), "2.0.0");
    assert.match(
      readRelease(directory).sections[1].body,
      /Keep saved games compatible\./,
    );
  } finally {
    cleanupFixture(directory);
  }
});

test("a fresh prepare rejects empty or placeholder notes without changing files or Git", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    for (const notes of [
      "",
      "### Fixed",
      "<!-- TODO -->",
      "### Added\n\n<!-- TODO -->",
    ]) {
      writeFileSync(join(directory, "CHANGELOG.md"), changelog(notes));
      const before = snapshot(directory);
      assert.throws(
        () => prepareVersion(directory, "patch", base, NOW),
        /Add release notes/,
      );
      assert.deepEqual(snapshot(directory), before);
    }
    assert.equal(git(directory, "rev-parse", "HEAD").trim(), base);
    assert.equal(git(directory, "tag", "--list"), "");
  } finally {
    cleanupFixture(directory);
  }
});

test("prepare validates inherited release history before any mutation", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    for (const text of [
      changelog(FIX_NOTE).replace(
        "First playable prototype.",
        "Rewritten prototype.",
      ),
      changelog(FIX_NOTE).replace("2026-10-01", "2026-10-02"),
    ]) {
      writeFileSync(join(directory, "CHANGELOG.md"), text);
      const before = snapshot(directory);
      assert.throws(
        () => prepareVersion(directory, "patch", base, NOW),
        /immutable/,
      );
      assert.deepEqual(snapshot(directory), before);
    }
  } finally {
    cleanupFixture(directory);
  }
});

test("prepare refuses decreasing local versions before any mutation", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    writePackage(directory, "1.2.2");
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      changelog(FIX_NOTE, "1.2.2"),
    );
    const before = snapshot(directory);
    assert.throws(
      () => prepareVersion(directory, "patch", base, NOW),
      /cannot decrease/,
    );
    assert.deepEqual(snapshot(directory), before);
  } finally {
    cleanupFixture(directory);
  }
});

test("an unavailable base or missing Git repository cannot mutate release files", () => {
  const directory = fixture();
  try {
    addNotes(directory);
    const before = snapshot(directory);
    assert.throws(() => prepareVersion(directory), /fetch it first/);
    assert.deepEqual(snapshot(directory), before);
    const base = commitBase(directory);
    assert.throws(
      () => prepareVersion(directory, "patch", "missing-base", NOW),
      /fetch it first/,
    );
    assert.deepEqual(snapshot(directory), before);
    assert.equal(git(directory, "rev-parse", "HEAD").trim(), base);
    assert.equal(git(directory, "tag", "--list"), "");
  } finally {
    cleanupFixture(directory);
  }
});

test("a corrupt base package or changelog fails before preparation writes", () => {
  for (const file of ["package.json", "CHANGELOG.md"]) {
    const directory = fixture();
    try {
      const valid = snapshot(directory);
      writeFileSync(join(directory, file), "Corrupt release fixture.\n");
      const base = commitBase(directory);
      writeFileSync(join(directory, "package.json"), valid[0]);
      writeFileSync(join(directory, "CHANGELOG.md"), valid[1]);
      addNotes(directory);
      const before = snapshot(directory);
      assert.throws(() => prepareVersion(directory, "patch", base, NOW));
      assert.deepEqual(snapshot(directory), before);
    } finally {
      cleanupFixture(directory);
    }
  }
});

test("prepare CLI supports omitted bump and base defaults", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    addNotes(directory);
    const result = cli(directory, "prepare-version.ts");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readRelease(directory).version, "1.2.4");
    const prepared = snapshot(directory);
    const repeated = cli(directory, "prepare-version.ts", ["--base", base]);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(snapshot(directory), prepared);
    const promoted = cli(directory, "prepare-version.ts", [
      "minor",
      "--base",
      base,
    ]);
    assert.equal(promoted.status, 0, promoted.stderr);
    assert.equal(readRelease(directory).version, "1.3.0");
    assert.equal(git(directory, "rev-parse", "HEAD").trim(), base);
    assert.equal(git(directory, "tag", "--list"), "");
  } finally {
    cleanupFixture(directory);
  }
});

test("invalid prepare CLI arguments fail without modifying release files", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    addNotes(directory);
    const before = snapshot(directory);
    for (const args of [
      ["prerelease"],
      ["patch", "extra"],
      ["--unknown"],
      ["--base"],
    ]) {
      const result = cli(directory, "prepare-version.ts", args);
      assert.equal(result.status, 1);
      assert.deepEqual(snapshot(directory), before);
    }
    assert.equal(git(directory, "rev-parse", "HEAD").trim(), base);
  } finally {
    cleanupFixture(directory);
  }
});

test("strict base checks catch a forgotten bump while ordinary checks remain permissive", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    addNotes(directory);
    const before = snapshot(directory);
    assert.equal(
      validateBase(directory, readRelease(directory), base),
      "1.2.3",
    );
    assert.throws(() =>
      validateBase(directory, readRelease(directory), base, true),
    );
    const permissive = cli(directory, "check-version.ts", ["--base", base]);
    assert.equal(permissive.status, 0, permissive.stderr);
    const required = cli(directory, "check-version.ts", [
      "--base",
      base,
      "--require-bump",
    ]);
    assert.equal(required.status, 1);
    const missingBase = cli(directory, "check-version.ts", ["--require-bump"]);
    assert.equal(missingBase.status, 1);
    assert.match(missingBase.stderr, /--base/);
    assert.deepEqual(snapshot(directory), before);
    prepareVersion(directory, "patch", base, NOW);
    const advanced = cli(directory, "check-version.ts", [
      "--require-bump",
      "--base",
      base,
    ]);
    assert.equal(advanced.status, 0, advanced.stderr);
  } finally {
    cleanupFixture(directory);
  }
});
