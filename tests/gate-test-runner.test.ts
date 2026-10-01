// @covers AC-099, AC-100, AC-101, AC-102, AC-103, AC-104
import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveTestInvocation, resolveNpmCli } from "../scripts/lib/test-runner.ts";
import { resolveTsxCli } from "../scripts/lib/tsx-cli.ts";

function project(pkgScripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "conformance-kit-gate-runner-"));
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "tests", "a.test.ts"), "");
  writeFileSync(join(dir, "tests", "helper.ts"), "");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", version: "1.0.0", scripts: pkgScripts }));
  return dir;
}

describe("gate test runner (FEAT-011)", () => {
  it("AC-099: testRunner未指定なら従来どおりnode --testとtests/*.test.tsの起動内容を返す", () => {
    const dir = project({});
    try {
      const args = resolveTestInvocation(dir, {});
      assert.deepEqual(args, [
        "--test",
        "--test-concurrency=1",
        "--experimental-strip-types",
        join("tests", "a.test.ts"),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-100: npm-scriptではpackage.jsonのscripts.testが実行されマーカーファイルが作られる", () => {
    const dir = project({ test: `node -e "require('fs').writeFileSync('marker.txt','ran')"` });
    try {
      const args = resolveTestInvocation(dir, { testRunner: "npm-script" });
      const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(dir, "marker.txt")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-101: testScriptを指定すると末尾がrun test:unitの起動内容を返す", () => {
    const args = resolveTestInvocation(".", { testRunner: "npm-script", testScript: "test:unit" });
    assert.deepEqual(args.slice(-2), ["run", "test:unit"]);
  });

  it("AC-102: 不正なtestRunnerではテストを実行せずexit 2で終了し値をエラー出力に含む", () => {
    const dir = mkdtempSync(join(tmpdir(), "conformance-kit-gate-bad-"));
    try {
      cpSync(resolve("scripts"), join(dir, "scripts"), { recursive: true });
      symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "junction");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", type: "module" }));
      writeFileSync(join(dir, "conformance.config.json"), JSON.stringify({ testRunner: "vitest" }));
      const r = spawnSync(process.execPath, [resolveTsxCli(), join(dir, "scripts", "gate.ts")], {
        cwd: dir,
        encoding: "utf8",
      });
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.ok(r.stderr.includes("vitest"), r.stderr);
      assert.ok(!r.stdout.includes("3/4"), r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-103: npm_execpath未設定ならnode実行ファイルの位置から見つけたnpm-cli.jsを第1引数に返す", () => {
    const args = resolveTestInvocation(".", { testRunner: "npm-script" }, {}, process.execPath);
    assert.match(args[0], /npm-cli\.js$/);
    assert.ok(existsSync(args[0]));
    const nodeDir = dirname(process.execPath);
    assert.ok(resolve(args[0]).startsWith(resolve(nodeDir, "..")), args[0]);
    assert.equal(resolveNpmCli({}, process.execPath), args[0]);
  });

  it("AC-104: npm-scriptのscripts.testがexit 1なら非0の終了コードを返す", () => {
    const dir = project({ test: `node -e "process.exit(1)"` });
    try {
      const args = resolveTestInvocation(dir, { testRunner: "npm-script" });
      const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
      assert.notEqual(r.status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
