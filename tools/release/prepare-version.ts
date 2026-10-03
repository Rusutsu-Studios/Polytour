import { parseArgs } from "node:util";
import { type Bump, prepareVersion } from "./release.ts";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { base: { type: "string", default: "origin/main" } },
  });
  const bump = positionals[0] ?? "patch";
  if (positionals.length > 1 || !["patch", "minor", "major"].includes(bump)) {
    throw new Error(
      "Usage: pnpm version:prepare [patch|minor|major] [--base <git-ref>]",
    );
  }
  const version = prepareVersion(process.cwd(), bump as Bump, values.base);
  console.log(
    `PR release ${version} is prepared against ${values.base}. Review package.json and CHANGELOG.md, then commit them with the change.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
