import { parseArgs } from "node:util";
import { checkFragments, collectFragments } from "./fragments.ts";

try {
  const { values } = parseArgs({ options: { base: { type: "string" } } });
  if (values.base === undefined) {
    const count = collectFragments(process.cwd()).length;
    console.log(`${count} changelog fragment(s) are valid.`);
  } else {
    checkFragments(process.cwd(), values.base);
    console.log("This pull request's release notes are in order.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
