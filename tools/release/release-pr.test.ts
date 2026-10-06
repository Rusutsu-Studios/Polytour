import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("release PR handles policy denial without hiding other failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "polytour-release-pr-"));
  const workflow = readFileSync(
    new URL("../../.github/workflows/release-pr.yml", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const script = workflow.split("        run: |\n").at(-1);
  assert.ok(script);
  const bash =
    process.platform === "win32"
      ? resolve(
          execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
          "../../../bin/bash.exe",
        )
      : "bash";
  try {
    const path = join(directory, "run.sh");
    writeFileSync(
      path,
      `git() { return 0; }
gh() {
  case "$1 $2" in
    'pr view') echo "$PR_STATE" ;;
    'pr edit') echo edited ;;
    'pr create')
      if [ -n "$PR_ERROR" ]; then echo "$PR_ERROR" >&2; return 42; fi
      echo created ;;
  esac
}
${script.replace(/^ {10}/gm, "")}`,
    );
    for (const [state, error, status, output] of [
      ["OPEN", "", 0, "edited"],
      ["CLOSED", "", 0, "created"],
      [
        "CLOSED",
        "GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)",
        0,
        "::warning::",
      ],
      ["CLOSED", "GraphQL: Resource not accessible by integration", 42, ""],
    ] as const) {
      const summary = join(directory, "summary.md");
      writeFileSync(summary, "");
      const result = spawnSync(bash, ["-e", path.replaceAll("\\", "/")], {
        encoding: "utf8",
        env: {
          ...process.env,
          PR_STATE: state,
          PR_ERROR: error,
          VERSION: "0.8.0",
          RUNNER_TEMP: directory.replaceAll("\\", "/"),
          GITHUB_STEP_SUMMARY: summary.replaceAll("\\", "/"),
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "fixture/polytour",
        },
      });
      assert.equal(
        result.status,
        status,
        result.stderr || result.error?.message,
      );
      assert.ok(result.stdout.includes(output));
      const note = readFileSync(summary, "utf8");
      if (output === "::warning::") {
        assert.ok(
          note.includes(
            "https://github.com/fixture/polytour/compare/main...release/next?expand=1",
          ),
        );
      } else {
        assert.equal(note, "");
      }
      if (status !== 0) assert.ok(result.stderr.includes(error));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
