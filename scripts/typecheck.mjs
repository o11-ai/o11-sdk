#!/usr/bin/env bun
/**
 * Typecheck runner.
 *
 * Every package has exactly one typecheck config (`tsconfig.check.json`) that
 * both compilers accept, so tsc and tsgo can never disagree about which files,
 * libs, types, or path mappings are in scope.
 *
 * That config is deliberately self-contained rather than extending the package's
 * build tsconfig, because TS7 removed `baseUrl` and `downlevelIteration` (both
 * hard errors, TS5102) while the build configs still need them to emit. Build
 * and emit therefore keep their own tsconfig, untouched by this runner.
 *
 * tsgo (the native Go compiler) is the only type checker. tsc is strictly banned
 * in that role: it is 15-20x slower here and, worse, tends to be pointed at a
 * different tsconfig than this runner, which is how a package passes locally and
 * fails at deploy time. There is no fallback and no escape hatch.
 * Set O11_TYPECHECK_CHECKERS to override the per-project checker count.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.cwd();
const project = process.argv[2] ?? "tsconfig.check.json";
const extraArgs = process.argv.slice(3);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

const tsgoBin = resolve(
  repoRoot,
  "node_modules/@typescript/native-preview/bin/tsgo",
);

/**
 * tsgo runs a pool of independent checkers (default 4) and statically assigns
 * files to them round-robin. Each checker holds its own type state, so any type
 * surface shared across files is instantiated once per checker while wall-clock
 * time is still bound by the slowest single file. On this repo the default pool
 * multiplied instantiations ~4x for no gain, and Turborepo already saturates the
 * machine by running packages concurrently. One checker per project keeps total
 * threads proportional to task concurrency and cuts peak memory ~4x.
 */
const checkers = process.env.O11_TYPECHECK_CHECKERS ?? "1";

if (process.env.O11_TYPECHECK) {
  console.error(
    "\n[typecheck] O11_TYPECHECK is no longer supported." +
      "\n[typecheck] tsc is strictly banned as a type checker in this repo and" +
      "\n[typecheck] this runner has no fallback. See docs/typechecking.md.\n",
  );
  process.exit(1);
}

if (!existsSync(tsgoBin)) {
  // Never silently fall back to tsc: that would make every check 15-20x slower
  // with no signal, which is exactly the failure this runner exists to prevent.
  console.error(
    "\n[typecheck] tsgo not found at:" +
      `\n[typecheck]   ${tsgoBin}` +
      "\n[typecheck] Run `bun install` to restore @typescript/native-preview." +
      "\n[typecheck] Refusing to fall back to tsc; see docs/typechecking.md.\n",
  );
  process.exit(1);
}

run(process.execPath, [
  tsgoBin,
  "-p",
  project,
  "--noEmit",
  "--checkers",
  checkers,
  ...extraArgs,
]);
