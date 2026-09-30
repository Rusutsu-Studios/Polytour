// Checks the production build (`vite build`) against the performance budgets in
// docs/TECH_STACK.md and the Cloudflare platform limits that would otherwise
// only fail at deploy time. Writes a table to the GitHub job summary when run
// in Actions, so every run shows how the bundle is trending.
//
// Usage: node tools/ci/check-bundle-size.ts   (after `vite build`)

import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

// docs/TECH_STACK.md → Performance budgets. kB = 1000 bytes, as Vite reports.
const LOBBY_JS_GZIP_BUDGET = 250_000;
// https://developers.cloudflare.com/workers/platform/limits/
const MAX_ASSET_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ASSET_FILES = 20_000; // Workers Free; Paid allows 100,000.
const MAX_WORKER_BYTES = 64 * 1024 * 1024; // Uncompressed; no gzip limit.

// `ok: null` marks an informational row with no budget.
type Row = { check: string; actual: string; limit: string; ok: boolean | null };

type DeployRedirect = { configPath: string };
type BuiltWranglerConfig = { main: string; assets?: { directory?: string } };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function listFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  }
  return `${(bytes / 1000).toFixed(1)} kB`;
}

function gzipSize(path: string): number {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

// The Cloudflare Vite plugin records where it wrote the deployable Worker.
const redirectPath = ".wrangler/deploy/config.json";
let workerConfigPath: string;
let workerConfig: BuiltWranglerConfig;
try {
  const redirect = readJson<DeployRedirect>(redirectPath);
  workerConfigPath = resolve(dirname(redirectPath), redirect.configPath);
  workerConfig = readJson<BuiltWranglerConfig>(workerConfigPath);
} catch {
  console.error("✗ No production build found: run `vite build` first.");
  process.exit(1);
}
const workerDir = dirname(workerConfigPath);
const assetsDir = resolve(workerDir, workerConfig.assets?.directory ?? "");
const rows: Row[] = [];

// Initial lobby payload: what index.html makes the browser fetch up front.
const html = readFileSync(join(assetsDir, "index.html"), "utf8");
const initialJs = new Set<string>();
const initialCss = new Set<string>();
for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
  const url = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
  if (!url || /^(?:[a-z]+:)?\/\//i.test(url)) {
    continue;
  }
  const file = join(assetsDir, url);
  if (tag.startsWith("<script") || /\brel="modulepreload"/.test(tag)) {
    initialJs.add(file);
  } else if (/\brel="stylesheet"/.test(tag)) {
    initialCss.add(file);
  }
}
const sumGzip = (files: Set<string>) =>
  [...files].reduce((total, file) => total + gzipSize(file), 0);
const lobbyJs = sumGzip(initialJs);
rows.push({
  check: `Lobby initial JS, gzip (${initialJs.size} file(s))`,
  actual: formatBytes(lobbyJs),
  limit: formatBytes(LOBBY_JS_GZIP_BUDGET),
  ok: lobbyJs <= LOBBY_JS_GZIP_BUDGET,
});
rows.push({
  check: `Lobby initial CSS, gzip (${initialCss.size} file(s))`,
  actual: formatBytes(sumGzip(initialCss)),
  limit: "—",
  ok: null,
});

// Static assets: every uploaded file, minus what .assetsignore excludes
// (exact paths only, which is all the Vite plugin writes there).
let ignored = new Set([".assetsignore"]);
try {
  const lines = readFileSync(join(assetsDir, ".assetsignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  ignored = new Set([...ignored, ...lines]);
} catch {
  // No .assetsignore: every file is uploaded.
}
const assets = listFiles(assetsDir)
  .filter((file) => !ignored.has(file))
  .map((file) => ({ file, bytes: statSync(join(assetsDir, file)).size }))
  .sort((a, b) => b.bytes - a.bytes);
const oversized = assets.filter((asset) => asset.bytes > MAX_ASSET_FILE_BYTES);
const largest = assets[0];
rows.push({
  check: `Largest static asset${largest ? ` (${largest.file})` : ""}`,
  actual: largest ? formatBytes(largest.bytes) : "—",
  limit: formatBytes(MAX_ASSET_FILE_BYTES),
  ok: oversized.length === 0,
});
rows.push({
  check: "Static asset files",
  actual: String(assets.length),
  limit: MAX_ASSET_FILES.toLocaleString("en-US"),
  ok: assets.length <= MAX_ASSET_FILES,
});

// Worker bundle: modules uploaded with the script (not config or source maps).
const workerModules = listFiles(workerDir).filter(
  (file) =>
    file !== "wrangler.json" &&
    !file.startsWith(".vite") &&
    !file.endsWith(".map"),
);
const workerBytes = workerModules.reduce(
  (total, file) => total + statSync(join(workerDir, file)).size,
  0,
);
rows.push({
  check: `Worker bundle, uncompressed (${workerModules.length} module(s))`,
  actual: formatBytes(workerBytes),
  limit: formatBytes(MAX_WORKER_BYTES),
  ok: workerBytes <= MAX_WORKER_BYTES,
});

const table = [
  "| Check | Actual | Limit | |",
  "| --- | ---: | ---: | :---: |",
  ...rows.map(
    (row) =>
      `| ${row.check} | ${row.actual} | ${row.limit} | ${row.ok === null ? "" : row.ok ? "✅" : "❌"} |`,
  ),
].join("\n");
console.log(table);
for (const asset of oversized) {
  console.error(
    `✗ ${asset.file} is ${formatBytes(asset.bytes)}; Workers Static Assets rejects files over 25 MiB.`,
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Bundle budgets\n\n${table}\n\nBudgets: docs/TECH_STACK.md → Performance budgets; limits: Cloudflare Workers platform limits.\n`,
  );
}
if (rows.some((row) => row.ok === false)) {
  console.error("✗ Bundle budget exceeded.");
  process.exitCode = 1;
}
