// Lints the fixtures in tools/biome/fixtures with the repo's Biome config and checks
// that Biome reports exactly the diagnostics they expect, so a rule that silently
// stops matching (or starts matching where it shouldn't) fails the build.
//
// Each fixture sits at the path it stands in for: fixtures/apps/desktop/src/lib/format.ts
// is linted as apps/desktop/src/lib/format.ts. The fixtures, biome.jsonc and the plugins
// are copied into a temporary directory with that layout, so the config's own globs
// and plugin paths apply unchanged. (biome.jsonc leaves fixtures/ out of `pnpm lint`.)
//
// A line that should be reported ends with a comment naming the diagnostic's category,
// and optionally text its message contains:
//
//   at.toLocaleString(), // lint-expect: plugin "lib/format"
//   import { useDatabase } from "@platform/DatabaseProvider"; // lint-expect: lint/style/noRestrictedImports
//
// Every other line must not be reported, so a fixture without any is one the rules allow.
//
// Usage: pnpm lint:selftest

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const fixtures = join(repo, "tools/biome/fixtures");
// What the config needs to be the repo's: the config itself and the plugins it loads.
const config = ["biome.jsonc", "tools/biome/plugins"];
const biome = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");

const EXPECT = /\/\/ lint-expect: (\S+)(?: "([^"]*)")?/;

/** Fixture paths relative to fixtures/, which are also the paths they're linted at. */
function listFixtures(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(fixtures, join(entry.parentPath, entry.name)).split(sep).join("/"));
}

/** Every `lint-expect` comment, as `{ path, line, category, text }`. */
function readExpectations(paths) {
  return paths.flatMap((path) =>
    readFileSync(join(fixtures, path), "utf8")
      .split("\n")
      .flatMap((source, i) => {
        const match = EXPECT.exec(source);
        return match ? [{ path, line: i + 1, category: match[1], text: match[2] }] : [];
      }),
  );
}

/** Biome's diagnostics for the fixtures, linted in a copy of the repo's layout. */
function lintFixtures() {
  const root = mkdtempSync(join(tmpdir(), "spoor-lint-selftest-"));
  try {
    for (const path of config) cpSync(join(repo, path), join(root, path), { recursive: true });
    cpSync(fixtures, root, { recursive: true });
    let stdout;
    try {
      // The copy isn't a git repository, so Biome's VCS integration is off for it.
      stdout = execFileSync(
        process.execPath,
        [biome, "lint", "--reporter=json", "--max-diagnostics=none", "--vcs-enabled=false", "."],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      // Biome exits with 1 when it reports errors, which the fixtures do on purpose.
      // Without a report, it didn't get to lint (a plugin that fails to compile, say).
      if (typeof error.stdout !== "string" || error.stdout === "") {
        throw new Error(`Biome did not report.\n${error.stderr ?? error}`);
      }
      stdout = error.stdout;
    }
    return JSON.parse(stdout).diagnostics;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const describe = ({ path, line, category }) => `${path ?? "(no file)"}:${line ?? "?"} ${category}`;

const paths = listFixtures(fixtures);
const expected = readExpectations(paths);
let diagnostics;
try {
  diagnostics = lintFixtures();
} catch (error) {
  console.error(`lint selftest failed: ${error.message}`);
  process.exit(1);
}
const reported = diagnostics.map((d) => ({
  path: d.location?.path,
  line: d.location?.start?.line,
  category: d.category,
  message: d.message,
}));

const failures = [];
const unmatched = [...reported];
for (const expectation of expected) {
  const i = unmatched.findIndex(
    (d) =>
      d.path === expectation.path &&
      d.line === expectation.line &&
      d.category === expectation.category,
  );
  if (i === -1) {
    failures.push(`not reported: ${describe(expectation)}`);
    continue;
  }
  const [found] = unmatched.splice(i, 1);
  if (expectation.text !== undefined && !found.message.includes(expectation.text)) {
    failures.push(
      `${describe(expectation)}: message lacks "${expectation.text}": ${found.message}`,
    );
  }
}
for (const d of unmatched) failures.push(`not expected: ${describe(d)}: ${d.message}`);

if (failures.length > 0) {
  console.error(`lint selftest failed (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `lint selftest passed: ${expected.length} expected diagnostics across ${paths.length} fixtures.`,
);
