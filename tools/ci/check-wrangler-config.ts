// Guards the Cloudflare rules from AGENTS.md that `wrangler` itself does not
// enforce, so a bad wrangler.jsonc fails CI instead of a production deploy:
//
// 1. Durable Object migrations are append-only: every migration shipped on the
//    base revision is still present, unchanged and in the same order.
// 2. Migration tags are unique.
// 3. Durable Objects are SQLite-backed: no migration uses `new_classes`.
// 4. Migrations replay cleanly, and every DO binding (production and previews)
//    names a class that the migrations created and did not delete or rename away.
// 5. Worker Previews never bind production data: no D1 database, R2 bucket or KV
//    namespace is shared between the top level and the `previews` block.
//
// Usage: node tools/ci/check-wrangler-config.ts [--base <git-ref>] [--config <path>]
// Without --base, rule 1 compares against origin/main when that ref exists.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual, parseArgs } from "node:util";
import ts from "typescript";

type DurableObjectBinding = {
  name: string;
  class_name: string;
  script_name?: string;
};

type Migration = {
  tag: string;
  new_classes?: string[];
  new_sqlite_classes?: string[];
  renamed_classes?: { from: string; to: string }[];
  deleted_classes?: string[];
};

type Bindings = {
  durable_objects?: { bindings?: DurableObjectBinding[] };
  d1_databases?: { binding: string; database_id?: string }[];
  r2_buckets?: { binding: string; bucket_name?: string }[];
  kv_namespaces?: { binding: string; id?: string }[];
};

// Only the fields read below; `wrangler deploy --dry-run` validates the rest.
type WranglerConfig = Bindings & {
  migrations?: Migration[];
  previews?: Bindings;
};

const DEFAULT_BASE = "origin/main";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    config: { type: "string", default: "wrangler.jsonc" },
  },
});
const configPath = values.config;
const errors: string[] = [];

function parseConfig(text: string, source: string): WranglerConfig {
  const { config, error } = ts.parseConfigFileTextToJson(source, text);
  if (error) {
    const message = ts.flattenDiagnosticMessageText(error.messageText, "\n");
    throw new Error(`${source}: ${message}`);
  }
  const parsed: unknown = config;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${source}: expected a JSON object`);
  }
  return parsed as WranglerConfig;
}

function git(...args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function refExists(ref: string): boolean {
  try {
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function readBaseConfig(): { ref: string; config: WranglerConfig } | null {
  const ref = values.base ?? DEFAULT_BASE;
  if (!refExists(ref)) {
    if (values.base !== undefined) {
      throw new Error(`Base revision ${ref} is not available; fetch it first.`);
    }
    console.log(`• ${DEFAULT_BASE} not found: skipping the append-only check.`);
    return null;
  }
  let text: string;
  try {
    text = git("show", `${ref}:${configPath}`);
  } catch {
    console.log(
      `• ${configPath} does not exist at ${ref}: nothing shipped yet.`,
    );
    return null;
  }
  return { ref, config: parseConfig(text, `${ref}:${configPath}`) };
}

function checkAppendOnly(
  head: Migration[],
  base: Migration[],
  baseRef: string,
): void {
  base.forEach((shipped, index) => {
    const current = head[index];
    if (current === undefined) {
      errors.push(
        `Migration "${shipped.tag}" (#${index + 1}) exists on ${baseRef} but was removed. DO migrations are append-only.`,
      );
    } else if (!isDeepStrictEqual(current, shipped)) {
      errors.push(
        `Migration #${index + 1} differs from ${baseRef} (was ${JSON.stringify(shipped)}, now ${JSON.stringify(current)}). Never edit a shipped migration: append a new tag instead.`,
      );
    }
  });
}

function replayMigrations(migrations: Migration[]): Set<string> {
  const tags = new Set<string>();
  const classes = new Set<string>();

  for (const migration of migrations) {
    const at = `migration "${migration.tag}"`;
    if (tags.has(migration.tag)) {
      errors.push(`Duplicate migration tag "${migration.tag}".`);
    }
    tags.add(migration.tag);

    if (migration.new_classes?.length) {
      errors.push(
        `${at} uses new_classes (KV storage backend). Durable Objects must be SQLite-backed: use new_sqlite_classes.`,
      );
    }
    for (const name of [
      ...(migration.new_classes ?? []),
      ...(migration.new_sqlite_classes ?? []),
    ]) {
      if (classes.has(name)) {
        errors.push(`${at} creates "${name}", which already exists.`);
      }
      classes.add(name);
    }
    for (const { from, to } of migration.renamed_classes ?? []) {
      if (!classes.delete(from)) {
        errors.push(`${at} renames "${from}", which does not exist.`);
      }
      classes.add(to);
    }
    for (const name of migration.deleted_classes ?? []) {
      if (!classes.delete(name)) {
        errors.push(`${at} deletes "${name}", which does not exist.`);
      }
    }
  }
  return classes;
}

function checkBindings(
  scope: string,
  bindings: Bindings | undefined,
  classes: Set<string>,
): void {
  for (const binding of bindings?.durable_objects?.bindings ?? []) {
    // Bindings to another Worker's class are that Worker's migrations' job.
    if (binding.script_name === undefined && !classes.has(binding.class_name)) {
      errors.push(
        `${scope} binding ${binding.name} → ${binding.class_name}: no migration creates this class (or it was deleted/renamed).`,
      );
    }
  }
}

function checkPreviewIsolation(config: WranglerConfig): void {
  const previews = config.previews;
  if (previews === undefined) {
    return;
  }
  const shared = <T>(
    kind: string,
    production: T[] | undefined,
    preview: T[] | undefined,
    id: (resource: T) => string | undefined,
  ) => {
    const productionIds = new Set(production?.map(id));
    for (const resource of preview ?? []) {
      const value = id(resource);
      if (value !== undefined && productionIds.has(value)) {
        errors.push(
          `previews binds production ${kind} "${value}". Previews must never touch production data: create a preview-only resource.`,
        );
      }
    }
  };
  shared(
    "D1 database",
    config.d1_databases,
    previews.d1_databases,
    (db) => db.database_id,
  );
  shared(
    "R2 bucket",
    config.r2_buckets,
    previews.r2_buckets,
    (bucket) => bucket.bucket_name,
  );
  shared(
    "KV namespace",
    config.kv_namespaces,
    previews.kv_namespaces,
    (namespace) => namespace.id,
  );
}

function main(): void {
  const head = parseConfig(readFileSync(configPath, "utf8"), configPath);
  const migrations = head.migrations ?? [];

  const base = readBaseConfig();
  if (base) {
    checkAppendOnly(migrations, base.config.migrations ?? [], base.ref);
  }
  const classes = replayMigrations(migrations);
  checkBindings("durable_objects", head, classes);
  checkBindings("previews.durable_objects", head.previews, classes);
  checkPreviewIsolation(head);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`✗ ${error}`);
      if (process.env.GITHUB_ACTIONS === "true") {
        console.log(`::error file=${configPath}::${error}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  const against = base ? ` (append-only vs ${base.ref})` : "";
  console.log(
    `✓ ${configPath}: ${migrations.length} migration(s)${against}, DO classes ${[...classes].join(", ") || "none"}, previews isolated.`,
  );
}

try {
  main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
