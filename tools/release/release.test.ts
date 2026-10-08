import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bumpVersion,
  nextVersion,
  parseVersion,
  readRelease,
  validateBase,
  validateRelease,
} from "./release.ts";

const NOTE =
  "### Fixed\n\n- Restore room reconnection.\n- Keep saved games compatible.";
const RELEASED_NOTE = "- First playable prototype.";

function changelog(version = "1.2.3", notes = NOTE): string {
  return `# Changelog\n\n## [Unreleased]\n\n${notes}\n\n## [${version}] - 2026-10-01\n\n${RELEASED_NOTE}\n`;
}

function fixture(version = "1.2.3", notes = NOTE): string {
  const directory = mkdtempSync(join(tmpdir(), "polytour-version-test-"));
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({ name: "fixture", version, scripts: { dev: "vite" } }, null, 2)}\n`,
  );
  writeFileSync(join(directory, "CHANGELOG.md"), changelog(version, notes));
  return directory;
}

function cleanupFixture(directory: string): void {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^polytour-version-test-[a-zA-Z0-9]+$/);
  rmSync(target, { recursive: true, force: true });
}

function snapshot(directory: string): string[] {
  return ["package.json", "CHANGELOG.md"].map((file) =>
    readFileSync(join(directory, file), "utf8"),
  );
}

function cli(directory: string, script: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL(script, import.meta.url)), ...args],
    {
      cwd: directory,
      encoding: "utf8",
    },
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
  return git(directory, "rev-parse", "HEAD").trim();
}

test("stable versions reject prereleases, metadata, leading zeroes, and non-strings", () => {
  for (const invalid of [
    "v1.2.3",
    "1.2",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-beta.1",
    "1.2.3+build",
    "1.2.3\n",
    123,
    null,
  ]) {
    assert.throws(() => parseVersion(invalid), /Invalid release version/);
  }
  assert.deepEqual(parseVersion("0.1.0"), [0n, 1n, 0n]);
  assert.equal(
    nextVersion("1.2.9007199254740992", "patch"),
    "1.2.9007199254740993",
  );
});

for (const [bump, expected] of [
  ["patch", "1.2.4"],
  ["minor", "1.3.0"],
  ["major", "2.0.0"],
] as const) {
  test(`${bump} moves release notes, resets lower components, and preserves old entries`, () => {
    const directory = fixture();
    try {
      const before = readRelease(directory);
      // This local date is October 3 in Zurich; the release date must use UTC.
      assert.equal(
        bumpVersion(directory, bump, new Date("2026-10-03T00:30:00+02:00")),
        expected,
      );
      const release = readRelease(directory);
      validateRelease(release);
      assert.equal(release.version, expected);
      assert.equal(release.sections[0].body, "");
      assert.equal(
        release.sections[1].heading,
        `## [${expected}] - 2026-10-02`,
      );
      assert.equal(release.sections[1].body, NOTE);
      assert.equal(release.sections[2].heading, before.sections[1].heading);
      assert.equal(release.sections[2].body, before.sections[1].body);
      assert.deepEqual(release.packageData.scripts, { dev: "vite" });
      assert.deepEqual(
        Object.keys(release.packageData),
        Object.keys(before.packageData),
      );
    } finally {
      cleanupFixture(directory);
    }
  });
}

test("empty, heading-only, or commented Unreleased notes reject the bump without changing either file", () => {
  for (const notes of [
    "",
    "\n\n",
    "### Fixed",
    "<!-- Draft notes only. -->",
    "### Added\n\n<!-- TODO -->",
  ]) {
    const directory = fixture("1.2.3", notes);
    try {
      const before = snapshot(directory);
      assert.throws(() => bumpVersion(directory, "patch"), /Add release notes/);
      assert.deepEqual(snapshot(directory), before);
    } finally {
      cleanupFixture(directory);
    }
  }
});

test("partial staging writes preserve both original files and clean temporary files", () => {
  for (const failAt of [1, 2, 3, 4]) {
    const directory = fixture();
    try {
      writeFileSync(
        join(directory, "CHANGELOG.md"),
        changelog().replace(/\n/g, "\r\n"),
      );
      const before = snapshot(directory);
      let writes = 0;
      assert.throws(
        () =>
          bumpVersion(directory, "patch", new Date("2026-10-03T00:00:00Z"), {
            write: (path, content) => {
              writes += 1;
              if (writes === failAt) {
                writeFileSync(path, content.slice(0, 8), { flag: "wx" });
                throw new Error("Simulated disk-full staging failure.");
              }
              writeFileSync(path, content, { flag: "wx" });
            },
            rename: renameSync,
          }),
        /disk-full staging failure/,
      );
      assert.deepEqual(snapshot(directory), before);
      assert.deepEqual(readdirSync(directory).sort(), [
        "CHANGELOG.md",
        "package.json",
      ]);
    } finally {
      cleanupFixture(directory);
    }
  }
});

test("failed atomic replacements restore both originals without rewriting their contents", () => {
  for (const failAt of [1, 2]) {
    const directory = fixture();
    try {
      writeFileSync(
        join(directory, "CHANGELOG.md"),
        changelog().replace(/\n/g, "\r\n"),
      );
      const before = snapshot(directory);
      let renames = 0;
      assert.throws(
        () =>
          bumpVersion(directory, "patch", new Date("2026-10-03T00:00:00Z"), {
            write: (path, content) =>
              writeFileSync(path, content, { flag: "wx" }),
            rename: (source, destination) => {
              renames += 1;
              if (renames === failAt)
                throw new Error("Simulated replacement failure.");
              renameSync(source, destination);
            },
          }),
        /replacement failure/,
      );
      assert.deepEqual(snapshot(directory), before);
      assert.deepEqual(readdirSync(directory).sort(), [
        "CHANGELOG.md",
        "package.json",
      ]);
    } finally {
      cleanupFixture(directory);
    }
  }
});

test("bad bump arguments fail before mutation and the command works without a Git repository", () => {
  const directory = fixture();
  try {
    const before = snapshot(directory);
    for (const args of [
      [],
      ["1.2.4"],
      ["patch", "extra"],
      ["--major"],
      ["prerelease"],
    ]) {
      const result = cli(directory, "bump-version.ts", args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Usage:/);
      assert.deepEqual(snapshot(directory), before);
    }
    const result = cli(directory, "bump-version.ts", ["patch"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readRelease(directory).version, "1.2.4");
  } finally {
    cleanupFixture(directory);
  }
});

test("invalid package version, missing current entry, and existing target entry fail before mutation", () => {
  const directory = fixture();
  try {
    for (const [packageVersion, text] of [
      ["1.2.3-beta.1", changelog()],
      ["1.2.2", changelog()],
      ["1.2.3", changelog().replace("## [1.2.3]", "## [1.2.4]")],
    ]) {
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ version: packageVersion }),
      );
      writeFileSync(join(directory, "CHANGELOG.md"), text);
      const before = snapshot(directory);
      assert.throws(() => bumpVersion(directory, "patch"));
      assert.deepEqual(snapshot(directory), before);
    }
  } finally {
    cleanupFixture(directory);
  }
});

test("version check requires an exact v-prefixed tag and current release notes", () => {
  const directory = fixture();
  try {
    assert.equal(
      cli(directory, "check-version.ts", ["--tag", "v1.2.3"]).status,
      0,
    );
    for (const args of [
      ["--tag", "1.2.3"],
      ["--tag", "v1.2.4"],
      ["--unknown"],
      ["extra"],
    ]) {
      assert.equal(cli(directory, "check-version.ts", args).status, 1);
    }
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      changelog().replace(RELEASED_NOTE, "### Added"),
    );
    assert.throws(
      () => validateRelease(readRelease(directory)),
      /has no release notes/,
    );
  } finally {
    cleanupFixture(directory);
  }
});

test("malformed, duplicate, wrongly ordered, and invalid-date changelog sections fail", () => {
  const directory = fixture();
  try {
    for (const text of [
      changelog().replace("## [Unreleased]", "## Unreleased"),
      changelog().replace("## [Unreleased]", "## [Unreleased] - 2026-10-01"),
      `${changelog()}\n## [Unreleased]\n`,
      `${changelog()}\n## [1.2.3] - 2026-10-01\n\n- Duplicate.\n`,
      `${changelog()}\n## [2.0.0] - 2026-10-01\n\n- Future.\n`,
      changelog().replace("2026-10-01", "2026-02-30"),
      changelog().replace(" - 2026-10-01", ""),
    ]) {
      writeFileSync(join(directory, "CHANGELOG.md"), text);
      assert.throws(() => readRelease(directory));
    }
  } finally {
    cleanupFixture(directory);
  }
});

test("base check permits ordinary Unreleased edits and valid bumps, without making Git commits or tags", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      changelog("1.2.3", `${NOTE}\n- Another fix.`),
    );
    validateBase(directory, readRelease(directory), base);
    bumpVersion(directory, "patch");
    validateBase(directory, readRelease(directory), base);
    assert.equal(git(directory, "rev-parse", "HEAD").trim(), base);
    assert.equal(git(directory, "tag", "--list"), "");
  } finally {
    cleanupFixture(directory);
  }
});

test("base check rejects decreasing versions and rewritten or removed release entries", () => {
  const directory = fixture();
  try {
    const base = commitBase(directory);
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ version: "1.2.2" }),
    );
    assert.throws(
      () => validateBase(directory, readRelease(directory), base),
      /cannot decrease/,
    );
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ version: "1.2.3" }),
    );
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      changelog().replace(RELEASED_NOTE, "- Rewritten history."),
    );
    assert.throws(
      () => validateBase(directory, readRelease(directory), base),
      /immutable/,
    );
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n- Notes.\n",
    );
    assert.throws(
      () => validateBase(directory, readRelease(directory), base),
      /immutable/,
    );
    assert.throws(
      () => validateBase(directory, readRelease(directory), "missing-base"),
      /fetch it first/,
    );
  } finally {
    cleanupFixture(directory);
  }
});

test("only the exact reviewed player-notes rewrite can change historical notes", () => {
  const directory = fixture("0.7.5");
  try {
    const original = readFileSync(
      new URL("./fixtures/changelog-before-player-notes.md", import.meta.url),
      "utf8",
    );
    const rewritten = readFileSync(
      new URL("../../CHANGELOG.md", import.meta.url),
      "utf8",
    );
    writeFileSync(join(directory, "CHANGELOG.md"), original);
    const base = commitBase(directory);
    const version = /## \[([^\]]+)\] -/.exec(rewritten)?.[1];
    assert.ok(version);
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
    writeFileSync(join(directory, "CHANGELOG.md"), rewritten);
    validateRelease(readRelease(directory));
    validateBase(directory, readRelease(directory), base);
    for (const altered of [
      rewritten.replace(
        "Gameplay and room rules are unchanged.",
        "Changed gameplay.",
      ),
      rewritten.replace("## [0.7.5] - 2026-10-05", "## [0.7.5] - 2026-10-06"),
      rewritten.replace(/## \[0\.7\.5\][\s\S]*?(?=## \[0\.7\.4\])/, ""),
    ]) {
      writeFileSync(join(directory, "CHANGELOG.md"), altered);
      assert.throws(
        () => validateBase(directory, readRelease(directory), base),
        /immutable/,
      );
    }
    writeFileSync(join(directory, "CHANGELOG.md"), rewritten);
    const newBase = commitBase(directory);
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      rewritten.replace(
        "Gameplay and room rules are unchanged.",
        "Changed gameplay.",
      ),
    );
    assert.throws(
      () => validateBase(directory, readRelease(directory), newBase),
      /immutable/,
    );
  } finally {
    cleanupFixture(directory);
  }
});

test("base check accepts initial workflow adoption where no changelog existed", () => {
  const directory = fixture("0.0.0");
  try {
    const base = commitBase(directory);
    git(directory, "rm", "--quiet", "CHANGELOG.md");
    execFileSync("git", ["commit", "--quiet", "-m", "Pre-workflow fixture"], {
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
    const preWorkflow = git(directory, "rev-parse", "HEAD").trim();
    assert.notEqual(base, preWorkflow);
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    writeFileSync(join(directory, "CHANGELOG.md"), changelog("0.1.0"));
    validateBase(directory, readRelease(directory), preWorkflow);
  } finally {
    cleanupFixture(directory);
  }
});
