import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type Bump,
  compareVersions,
  hasNotes,
  nextVersion,
  parseVersion,
  readRelease,
  validateRelease,
  writeRelease,
} from "./release.ts";

export const FRAGMENT_DIR = "changelog.d";
const CATEGORIES = ["Added", "Changed", "Fixed"] as const;
const BUMPS: readonly Bump[] = ["patch", "minor", "major"];
const BUMP_MARKER = /^<!--\s*bump:\s*(patch|minor|major)\s*-->\s*$/m;

type Category = (typeof CATEGORIES)[number];
export type Fragment = {
  name: string;
  bump: Bump;
  internal: boolean;
  notes: Record<Category, string[]>;
};

/**
 * A fragment is a small Markdown file: `### Added|Changed|Fixed` headings with
 * bullet notes, and an optional `<!-- bump: minor -->` line (default patch).
 */
export function parseFragment(name: string, text: string): Fragment {
  const normalized = text.replace(/\r\n/g, "\n");
  const marker = BUMP_MARKER.exec(normalized);
  const bump = (marker?.[1] ?? "patch") as Bump;
  const body = normalized.replace(BUMP_MARKER, "");
  if (!hasNotes(body)) {
    throw new Error(`${FRAGMENT_DIR}/${name} has no release notes.`);
  }
  const notes: Record<Category, string[]> = {
    Added: [],
    Changed: [],
    Fixed: [],
  };
  let category: Category | null = null;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (line.trim() === "") continue;
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (!(CATEGORIES as readonly string[]).includes(heading[1])) {
        throw new Error(
          `${FRAGMENT_DIR}/${name}: unknown heading "${heading[1]}"; use ${CATEGORIES.join(", ")}.`,
        );
      }
      category = heading[1] as Category;
    } else if (category === null) {
      throw new Error(
        `${FRAGMENT_DIR}/${name}: put notes under a ### Added, ### Changed or ### Fixed heading.`,
      );
    } else if (/^[-*+]\s/.test(line)) {
      notes[category].push(line.replace(/^[-*+]\s+/, "- ").trimEnd());
    } else if (notes[category].length > 0) {
      notes[category][notes[category].length - 1] += `\n  ${line.trim()}`;
    } else {
      throw new Error(`${FRAGMENT_DIR}/${name}: start each note with "- ".`);
    }
  }
  return {
    name,
    bump,
    internal: /^<!--\s*internal\s*-->\s*$/m.test(normalized),
    notes,
  };
}

export function isFragmentName(name: string): boolean {
  return name.endsWith(".md") && name !== "README.md";
}

export function collectFragments(directory: string): Fragment[] {
  const folder = join(directory, FRAGMENT_DIR);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter(isFragmentName)
    .sort()
    .map((name) =>
      parseFragment(name, readFileSync(join(folder, name), "utf8")),
    );
}

function highestBump(fragments: Fragment[]): Bump {
  return fragments.reduce<Bump>(
    (top, fragment) =>
      BUMPS.indexOf(fragment.bump) > BUMPS.indexOf(top) ? fragment.bump : top,
    "patch",
  );
}

/** Folds every fragment into a new dated release, then deletes the fragments. */
export function prepareRelease(
  directory: string,
  bump?: Bump,
  now = new Date(),
): string {
  const release = readRelease(directory);
  validateRelease(release);
  if (hasNotes(release.sections[0].body)) {
    throw new Error(
      `CHANGELOG.md ## [Unreleased] has notes. Move them into ${FRAGMENT_DIR}/ fragments first.`,
    );
  }
  const fragments = collectFragments(directory);
  if (fragments.length === 0) {
    throw new Error(`No fragments in ${FRAGMENT_DIR}/ to release.`);
  }
  const version = nextVersion(release.version, bump ?? highestBump(fragments));
  if (release.sections.some((section) => section.version === version)) {
    throw new Error(`CHANGELOG.md already contains release ${version}.`);
  }
  const body =
    CATEGORIES.flatMap((category) => {
      const items = fragments
        .filter((fragment) => !fragment.internal)
        .flatMap((fragment) => fragment.notes[category]);
      return items.length ? [`### ${category}\n\n${items.join("\n")}`] : [];
    }).join("\n\n") ||
    "### Changed\n\n- Maintenance release. Gameplay and room rules are unchanged.";
  const unreleased = release.sections[0];
  const date = now.toISOString().slice(0, 10);
  const changelog = `${release.changelog.slice(0, unreleased.start)}## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n\n${release.changelog.slice(unreleased.end)}`;
  const packageText = `${JSON.stringify({ ...release.packageData, version }, null, 2)}\n`;
  writeRelease(directory, release, packageText, changelog);
  for (const fragment of fragments) {
    rmSync(join(directory, FRAGMENT_DIR, fragment.name));
  }
  return version;
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function packageVersionAt(directory: string, revision: string): string {
  const parsed: unknown = JSON.parse(
    git(directory, "show", `${revision}:package.json`),
  );
  const version = (parsed as { version?: unknown }).version;
  parseVersion(version);
  return version as string;
}

/**
 * A feature pull request adds a fragment and leaves CHANGELOG.md and the
 * package version alone. A release pull request (prepareRelease) does the
 * opposite: it removes fragments and changes those two files.
 */
export function checkFragments(directory: string, ref: string): void {
  collectFragments(directory);
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
  let from = revision;
  try {
    from = git(directory, "merge-base", revision, "HEAD").trim();
  } catch {
    // A shallow CI checkout may lack the merge base; the base is its parent.
  }
  const changes = git(
    directory,
    "diff",
    "--name-status",
    "--no-renames",
    from,
    "HEAD",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t") as [string, string]);
  const inFragments = (path: string) =>
    path.startsWith(`${FRAGMENT_DIR}/`) &&
    isFragmentName(path.slice(FRAGMENT_DIR.length + 1));
  const added = changes.filter(
    ([status, path]) => status === "A" && inFragments(path),
  );
  const removed = changes.filter(
    ([status, path]) => status === "D" && inFragments(path),
  );
  const changelogEdited = changes.some(([, path]) => path === "CHANGELOG.md");
  const versionChanged =
    compareVersions(
      readRelease(directory).version,
      packageVersionAt(directory, from),
    ) !== 0;
  if (changelogEdited || versionChanged) {
    if (removed.length === 0 || added.length > 0) {
      throw new Error(
        `Don't edit CHANGELOG.md or the package version in a feature pull request: add a fragment in ${FRAGMENT_DIR}/ instead. Only a release (pnpm release:prepare) changes them, and it removes the fragments.`,
      );
    }
    return;
  }
  if (added.length === 0) {
    throw new Error(
      `Every pull request needs release notes: add a fragment such as ${FRAGMENT_DIR}/my-change.md (see ${FRAGMENT_DIR}/README.md).`,
    );
  }
}
