import { parseArgs } from "node:util";
import { prepareRelease } from "./fragments.ts";
import type { Bump } from "./release.ts";

try {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });
  const bump = positionals[0];
  if (
    positionals.length > 1 ||
    (bump !== undefined && !["patch", "minor", "major"].includes(bump))
  ) {
    throw new Error("Usage: pnpm release:prepare [patch|minor|major]");
  }
  const version = prepareRelease(process.cwd(), bump as Bump | undefined);
  console.log(
    `Prepared release ${version} from changelog.d/. Review package.json and CHANGELOG.md, then commit, merge, and tag explicitly.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
