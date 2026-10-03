import { parseArgs } from "node:util";
import { readRelease, validateBase, validateRelease } from "./release.ts";

try {
  const { values } = parseArgs({
    options: {
      tag: { type: "string" },
      base: { type: "string" },
    },
  });
  const directory = process.cwd();
  const release = readRelease(directory);
  validateRelease(release, values.tag);
  if (values.base !== undefined) validateBase(directory, release, values.base);
  console.log(
    `Release ${release.version}: package.json and CHANGELOG.md agree.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
