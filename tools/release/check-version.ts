import { parseArgs } from "node:util";
import { readRelease, validateBase, validateRelease } from "./release.ts";

try {
  const { values } = parseArgs({
    options: {
      tag: { type: "string" },
      base: { type: "string" },
      "require-bump": { type: "boolean", default: false },
    },
  });
  const directory = process.cwd();
  const release = readRelease(directory);
  validateRelease(release, values.tag);
  if (values["require-bump"] && values.base === undefined) {
    throw new Error("--require-bump requires --base <git-ref>.");
  }
  if (values.base !== undefined) {
    validateBase(directory, release, values.base, values["require-bump"]);
  }
  console.log(
    `Release ${release.version}: package.json and CHANGELOG.md agree.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
