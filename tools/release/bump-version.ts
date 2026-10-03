import { type Bump, bumpVersion } from "./release.ts";

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["patch", "minor", "major"].includes(args[0])) {
    throw new Error("Usage: pnpm version:bump patch|minor|major");
  }
  const version = bumpVersion(process.cwd(), args[0] as Bump);
  console.log(
    `Prepared release ${version}. Review package.json and CHANGELOG.md, then commit and tag explicitly.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
