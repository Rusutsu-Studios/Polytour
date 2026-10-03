import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?$/;

export type Bump = "patch" | "minor" | "major";
export type Section = {
  version: string;
  heading: string;
  body: string;
  start: number;
  end: number;
};
export type Release = {
  packageText: string;
  packageData: Record<string, unknown>;
  changelogText: string;
  changelog: string;
  version: string;
  sections: Section[];
};

type FileOperations = {
  write: (path: string, content: string) => void;
  rename: (source: string, destination: string) => void;
};

const FILE_OPERATIONS: FileOperations = {
  write: (path, content) => writeFileSync(path, content, { flag: "wx" }),
  rename: renameSync,
};

export function parseVersion(value: unknown): [bigint, bigint, bigint] {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !STABLE_VERSION.test(value)
  ) {
    throw new Error(
      `Invalid release version ${JSON.stringify(value)}: expected stable MAJOR.MINOR.PATCH without leading zeroes.`,
    );
  }
  const [major, minor, patch] = value.split(".").map(BigInt);
  return [major, minor, patch];
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

function parsePackage(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("package.json must contain a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function hasNotes(body: string): boolean {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .some((line) => {
      const content = line
        .trim()
        .replace(/^(?:[-*+]\s*|\d+[.)]\s*)/, "")
        .trim();
      return content !== "" && !/^#{1,6}(?:\s|$)/.test(content);
    });
}

export function parseChangelog(text: string): Section[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const headings = [...normalized.matchAll(/^## .+$/gm)];
  const sections = headings.map((match, index) => {
    const heading = match[0];
    const parsed = RELEASE_HEADING.exec(heading);
    if (!parsed) {
      throw new Error(`Invalid CHANGELOG.md release heading: ${heading}`);
    }
    const [, version, date] = parsed;
    if (version === "Unreleased") {
      if (date !== undefined) {
        throw new Error("The Unreleased section must not have a release date.");
      }
    } else {
      parseVersion(version);
      if (
        date === undefined ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
      ) {
        throw new Error(
          `Release ${version} must have a valid YYYY-MM-DD date.`,
        );
      }
    }
    const start = match.index;
    const end = headings[index + 1]?.index ?? normalized.length;
    return {
      version,
      heading,
      body: normalized.slice(start + heading.length, end).trim(),
      start,
      end,
    };
  });
  if (
    sections[0]?.version !== "Unreleased" ||
    sections.filter((section) => section.version === "Unreleased").length !== 1
  ) {
    throw new Error(
      "CHANGELOG.md must start with exactly one ## [Unreleased] section.",
    );
  }
  const seen = new Set<string>();
  for (const [index, section] of sections.entries()) {
    if (seen.has(section.version)) {
      throw new Error(`Duplicate CHANGELOG.md section ${section.version}.`);
    }
    seen.add(section.version);
    if (
      index > 1 &&
      compareVersions(sections[index - 1].version, section.version) <= 0
    ) {
      throw new Error(
        "CHANGELOG.md releases must be in decreasing version order.",
      );
    }
  }
  return sections;
}

export function readRelease(directory: string): Release {
  const packageText = readFileSync(join(directory, "package.json"), "utf8");
  const packageData = parsePackage(packageText);
  parseVersion(packageData.version);
  const version = packageData.version as string;
  const changelogText = readFileSync(join(directory, "CHANGELOG.md"), "utf8");
  const changelog = changelogText.replace(/\r\n/g, "\n");
  const sections = parseChangelog(changelog);
  return {
    packageText,
    packageData,
    version,
    changelogText,
    changelog,
    sections,
  };
}

export function validateRelease(release: Release, tag?: string): void {
  if (release.sections[1]?.version !== release.version) {
    throw new Error(
      `package.json version ${release.version} must match the newest CHANGELOG.md release section.`,
    );
  }
  if (!hasNotes(release.sections[1].body)) {
    throw new Error(
      `CHANGELOG.md release ${release.version} has no release notes.`,
    );
  }
  if (tag !== undefined && tag !== `v${release.version}`) {
    throw new Error(
      `Release tag must be v${release.version}; received ${JSON.stringify(tag)}.`,
    );
  }
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function validateBase(
  directory: string,
  release: Release,
  ref: string,
): void {
  let revision: string;
  try {
    revision = git(
      directory,
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ).trim();
  } catch {
    throw new Error(`Base revision ${ref} is not available; fetch it first.`);
  }
  const basePackage = parsePackage(
    git(directory, "show", `${revision}:package.json`),
  );
  parseVersion(basePackage.version);
  const baseVersion = basePackage.version as string;
  if (compareVersions(release.version, baseVersion) < 0) {
    throw new Error(
      `Release version cannot decrease from ${baseVersion} to ${release.version}.`,
    );
  }
  // The initial adoption of this release workflow can add a changelog to a
  // repository that previously had only package.json's placeholder version.
  let baseChangelog: string;
  try {
    baseChangelog = git(directory, "show", `${revision}:CHANGELOG.md`);
  } catch {
    return;
  }
  const baseSections = parseChangelog(baseChangelog);
  for (const shipped of baseSections.slice(1)) {
    const current = release.sections.find(
      (section) => section.version === shipped.version,
    );
    if (
      !current ||
      current.heading !== shipped.heading ||
      current.body !== shipped.body
    ) {
      throw new Error(
        `Released CHANGELOG.md section ${shipped.version} differs from ${ref}; released entries are immutable.`,
      );
    }
  }
  if (
    compareVersions(release.version, baseVersion) > 0 &&
    baseSections[1]?.version !== baseVersion
  ) {
    throw new Error(
      `Base revision ${ref} has no changelog release for ${baseVersion}.`,
    );
  }
}

export function nextVersion(version: string, bump: Bump): string {
  const [major, minor, patch] = parseVersion(version);
  switch (bump) {
    case "major":
      return `${major + 1n}.0.0`;
    case "minor":
      return `${major}.${minor + 1n}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1n}`;
    default:
      throw new Error("Usage: pnpm version:bump patch|minor|major");
  }
}

export function bumpVersion(
  directory: string,
  bump: Bump,
  now = new Date(),
  files: FileOperations = FILE_OPERATIONS,
): string {
  const release = readRelease(directory);
  validateRelease(release);
  const version = nextVersion(release.version, bump);
  if (release.sections.some((section) => section.version === version)) {
    throw new Error(`CHANGELOG.md already contains release ${version}.`);
  }
  const unreleased = release.sections[0];
  if (!hasNotes(unreleased.body)) {
    throw new Error(
      "Add release notes under ## [Unreleased] before bumping the version.",
    );
  }
  const date = now.toISOString().slice(0, 10);
  const changelog = `${release.changelog.slice(0, unreleased.start)}## [Unreleased]\n\n## [${version}] - ${date}\n\n${unreleased.body}\n\n${release.changelog.slice(unreleased.end)}`;
  const packageData = { ...release.packageData, version };
  const packageText = `${JSON.stringify(packageData, null, 2)}\n`;
  const suffix = randomUUID();
  const packagePath = join(directory, "package.json");
  const changelogPath = join(directory, "CHANGELOG.md");
  const stagedPackage = join(directory, `.package.json.${suffix}.new`);
  const stagedChangelog = join(directory, `.CHANGELOG.md.${suffix}.new`);
  const originalPackage = join(directory, `.package.json.${suffix}.backup`);
  const originalChangelog = join(directory, `.CHANGELOG.md.${suffix}.backup`);
  let replacing = false;
  let rollbackFailed = false;
  // Stage complete new files and recoverable originals before replacing either
  // destination. Each rename is atomic; the pair is not crash-proof as a unit.
  try {
    files.write(stagedPackage, packageText);
    files.write(stagedChangelog, changelog);
    files.write(originalPackage, release.packageText);
    files.write(originalChangelog, release.changelogText);
    replacing = true;
    files.rename(stagedPackage, packagePath);
    files.rename(stagedChangelog, changelogPath);
  } catch (error) {
    if (replacing) {
      const rollbackErrors: unknown[] = [];
      for (const [backup, destination] of [
        [originalPackage, packagePath],
        [originalChangelog, changelogPath],
      ]) {
        try {
          files.rename(backup, destination);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        rollbackFailed = true;
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Release files could not be restored. Recover the remaining backups ${originalPackage} and ${originalChangelog}.`,
        );
      }
    }
    throw error;
  } finally {
    for (const path of [stagedPackage, stagedChangelog]) {
      rmSync(path, { force: true });
    }
    if (!rollbackFailed) {
      for (const path of [originalPackage, originalChangelog]) {
        rmSync(path, { force: true });
      }
    }
  }
  return version;
}
