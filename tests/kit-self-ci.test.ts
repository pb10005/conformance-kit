// @covers AC-001, AC-002, AC-003, AC-004, AC-006
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, renameSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function run(args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync("npx", ["tsx", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: e.status ?? 1, output: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

describe("kit self-conformance (FEAT-002)", () => {
  it("AC-001: spec-lintはexample-login由来のID衝突・プレースホルダを出さずexit 0を返す", () => {
    const { code, output } = run(["scripts/spec-lint.ts"]);
    assert.ok(!output.includes("DUPLICATE_ID"), output);
    assert.ok(!output.includes("PLACEHOLDER_LEFT"), output);
    assert.equal(code, 0, output);
  });

  it("AC-002: trace-matrixはrogue.ts・example-login由来のfindingとNO_BASE_REFを出さずexit 0を返す", () => {
    const { code, output } = run(["scripts/trace-matrix.ts", "--base", "origin/master", "--strict"]);
    assert.ok(!output.includes("UNTRACED_CHANGE"), output);
    assert.ok(!output.includes("example-login"), output);
    assert.ok(!output.includes("NO_BASE_REF"), output);
    assert.equal(code, 0, output);
  });

  it("AC-003: install.shは--with-samplesでサンプル一式を移設前と同一内容で作成する", () => {
    const tmp = mkdtempSync(join(tmpdir(), "conformance-kit-install-"));
    try {
      execFileSync("bash", ["install.sh", tmp, "--with-samples"], { stdio: ["ignore", "pipe", "pipe"] });
      const req = join(tmp, "specs/example-login/requirements.yaml");
      const authTs = join(tmp, "src/auth.ts");
      const rogueTs = join(tmp, "src/rogue.ts");
      const testTs = join(tmp, "tests/auth.test.ts");
      assert.ok(existsSync(req), req);
      assert.ok(existsSync(authTs), authTs);
      assert.ok(existsSync(rogueTs), rogueTs);
      assert.ok(existsSync(testTs), testTs);
      assert.equal(
        readFileSync(req, "utf8"),
        readFileSync("examples/with-samples/specs/example-login/requirements.yaml", "utf8"),
      );
      assert.equal(readFileSync(authTs, "utf8"), readFileSync("examples/with-samples/src/auth.ts", "utf8"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-004: サンプルソースが欠落してもinstall.shはエラー終了せず欠落分の警告を出す", () => {
    const rogueTs = "examples/with-samples/src/rogue.ts";
    const backup = rogueTs + ".bak";
    const tmpTarget = mkdtempSync(join(tmpdir(), "conformance-kit-target-"));
    renameSync(rogueTs, backup);
    try {
      const output = execFileSync("bash", ["install.sh", tmpTarget, "--with-samples"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.ok(output.includes("見つかりません: src/rogue.ts"), output);
      assert.ok(output.includes("導入完了"), output);
      assert.ok(existsSync(join(tmpTarget, "src/auth.ts")));
      assert.ok(!existsSync(join(tmpTarget, "src/rogue.ts")));
    } finally {
      renameSync(backup, rogueTs);
      rmSync(tmpTarget, { recursive: true, force: true });
    }
  });

  it("AC-006: examples/with-samples/を--rootで検査すると意図的な違反が引き続き検出される", () => {
    const { code, output } = run(["scripts/trace-matrix.ts", "--root", "examples/with-samples", "--base", "samples-baseline"]);
    assert.ok(output.includes("UNCOVERED_AC"), output);
    assert.ok(output.includes("NO_EVIDENCE"), output);
    assert.ok(output.includes("UNTRACED_CHANGE"), output);
    assert.notEqual(code, 0, output);
  });
});
