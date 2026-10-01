#!/usr/bin/env node
// @covers AC-012, AC-013, AC-099, AC-100, AC-101, AC-102, AC-103, AC-104
/**
 * gate.ts
 *
 * 適合性ゲート。ここを通らないものはマージしない。
 *
 * POSIXシェルに一切依存しない: npx/npm という .cmd シムを経由せず、tsx/tsc/node
 * の実行ファイルを直接 resolve して spawnSync(process.execPath, ...) で呼び出す。
 * child_process の shell オプションも使わないため、Windowsのネイティブ
 * PowerShell/cmd.exe からも `npm run gate` でそのまま動く。
 *
 * usage:
 *   npx tsx scripts/gate.ts [-- trace-matrixへの追加引数]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveTsxCli } from "./lib/tsx-cli.ts";
import { resolveTestInvocation, TestRunnerConfigError } from "./lib/test-runner.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const tsxCli = resolveTsxCli();
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

// テスト段の起動内容は最初に決める。設定が不正なら何も実行せずに止める（FEAT-011）
const cfgPath = join(root, "conformance.config.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
let testArgs: string[];
try {
  testArgs = resolveTestInvocation(root, cfg);
} catch (err) {
  if (!(err instanceof TestRunnerConfigError)) throw err;
  console.error(`conformance.config.json: ${err.message}`);
  process.exit(2);
}

function run(args: string[]): void {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("── 1/4 要件の健全性");
run([tsxCli, "scripts/spec-lint.ts"]);

console.log("── 2/4 トレーサビリティ");
run([tsxCli, "scripts/trace-matrix.ts", ...process.argv.slice(2)]);

console.log("── 3/4 テスト");
run(testArgs);

console.log("── 4/4 型");
run([tscBin, "--noEmit"]);

console.log("✔ 適合性ゲート通過");
