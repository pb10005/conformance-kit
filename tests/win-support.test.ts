// @covers AC-010, AC-011, AC-016, AC-017
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, renameSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { toPosixPath } from "../scripts/lib/posix-path.ts";
import { resolveTsxCli } from "../scripts/lib/tsx-cli.ts";

function run(args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [resolveTsxCli(), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: e.status ?? 1, output: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

describe("Windows対応 (FEAT-003)", () => {
  it("AC-010: バックスラッシュ区切りのパスをgit diff由来のフォワードスラッシュパスと大文字小文字を区別した完全一致で同一視できる", () => {
    const winStyle = "examples\\with-samples\\src\\rogue.ts";
    const gitStyle = "examples/with-samples/src/rogue.ts";
    assert.equal(toPosixPath(winStyle), gitStyle);
    assert.notEqual(toPosixPath("Examples\\With-Samples\\src\\rogue.ts"), gitStyle);
  });

  it("AC-011: --root指定時のgit diff --relative出力にも同じパス正規化ロジックが使える", () => {
    const winStyle = "specs\\example-login\\requirements.yaml";
    assert.equal(toPosixPath(winStyle), "specs/example-login/requirements.yaml");
  });

  it("AC-016: 存在しない--baseを指定してもNO_BASE_REF警告のみでexit codeは0のまま処理が継続する", () => {
    // 本体リポジトリの他spec(FEAT-003自体を含む)は未検証ACを多数抱えており、その他findingの
    // 影響を受けずにNO_BASE_REFフォールバック単体の挙動を見るため、完結した最小fixtureを --root で検査する。
    const tmp = mkdtempSync(join(tmpdir(), "conformance-kit-nobase-"));
    try {
      mkdirSync(join(tmp, "specs", "x"), { recursive: true });
      writeFileSync(
        join(tmp, "conformance.config.json"),
        JSON.stringify({ specDir: "specs", srcDirs: [], baseRef: "origin/master" }),
      );
      writeFileSync(
        join(tmp, "specs", "x", "requirements.yaml"),
        [
          "id: FX-001",
          'title: "fixture"',
          "status: frozen",
          "out_of_scope:",
          '  - "n/a"',
          "acceptance:",
          "  - id: FIX-900",
          "    kind: functional",
          '    given: "g"',
          '    when: "w"',
          '    then: "成功を返す"',
          "    priority: could",
          "    verify: manual",
          "    status: pass",
          '    evidence: "fixture"',
          "",
        ].join("\n"),
      );
      // --root は invocationDir からの相対パスとして join() される実装のため、絶対パスのtmpdirをそのまま渡さない
      const { code, output } = run([
        "scripts/trace-matrix.ts",
        "--root",
        relative(process.cwd(), tmp),
        "--base",
        "does-not-exist-ref",
      ]);
      assert.ok(output.includes("NO_BASE_REF"), output);
      assert.equal(code, 0, output);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-017: サンプルソースが欠落してもinstall.mjsはエラー終了せず欠落分の警告を出す", () => {
    const authTestTs = "examples/with-samples/tests/auth.test.ts";
    const backup = authTestTs + ".bak";
    const tmpTarget = mkdtempSync(join(tmpdir(), "conformance-kit-win-target-"));
    renameSync(authTestTs, backup);
    try {
      const output = execFileSync(process.execPath, ["install.mjs", tmpTarget, "--with-samples"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.ok(output.includes("見つかりません: tests/auth.test.ts"), output);
      assert.ok(output.includes("導入完了"), output);
      assert.ok(existsSync(join(tmpTarget, "src/auth.ts")));
      assert.ok(!existsSync(join(tmpTarget, "tests/auth.test.ts")));
    } finally {
      renameSync(backup, authTestTs);
      rmSync(tmpTarget, { recursive: true, force: true });
    }
  });
});
