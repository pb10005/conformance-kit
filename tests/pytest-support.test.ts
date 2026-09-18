// @covers AC-018, AC-019, AC-020, AC-021, AC-022
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { extractPytestCoverage } from "../scripts/lib/pytest-detect.ts";
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

describe("pytest対応 (FEAT-004)", () => {
  it("AC-018: docstringに書かれたAC-IDが単数・複数・async def問わず有効なカバーとして検出される", () => {
    const text = [
      "def test_foo():",
      '    """AC-018: 単一のAC-ID"""',
      "    assert True",
      "",
      "async def test_bar():",
      '    """AC-018, AC-019: 複数のAC-IDをカンマ区切りで"""',
      "    assert True",
    ].join("\n");
    const { active, skipped } = extractPytestCoverage(text);
    assert.deepEqual([...active].sort(), ["AC-018", "AC-019"]);
    assert.equal(skipped.size, 0);
  });

  it("AC-018: CRLF改行のPythonファイル（Windows上でよく見られる）でも検出できる", () => {
    const lf = ["def test_foo():", '    """AC-018: CRLFでも検出できる"""', "    assert True", ""].join("\n");
    const crlf = lf.replace(/\n/g, "\r\n");
    const { active, skipped } = extractPytestCoverage(crlf);
    assert.ok(active.has("AC-018"), "CRLF改行のファイルでAC-IDが検出できていない");
    assert.equal(skipped.size, 0);
  });

  it("AC-019: @pytest.mark.skipが付与されたテストはSKIPPED_TEST相当（skippedへ分類）になる", () => {
    const text = [
      "@pytest.mark.skip",
      "def test_skip_no_reason():",
      '    """AC-019: 理由なしskip"""',
      "    assert True",
      "",
      '@pytest.mark.skip(reason="temporarily disabled")',
      "def test_skip_with_reason():",
      '    """AC-019: 理由ありskip"""',
      "    assert True",
    ].join("\n");
    const { active, skipped } = extractPytestCoverage(text);
    assert.ok(skipped.has("AC-019"), "skipped扱いになっていない");
    assert.ok(!active.has("AC-019"), "activeにも入ってしまっている");
  });

  it("AC-020: docstringが無い/AC-IDが無い/docstring以外での言及はカバーとして扱わない", () => {
    const text = [
      "def test_no_docstring():",
      "    assert True",
      "",
      "def test_no_ac_id():",
      '    """説明のみでAC-IDは無い"""',
      "    assert True",
      "",
      "# AC-021 が対象関数のdocstring以外（コメント）で言及されているケース",
      "def test_mentioned_only_in_comment():",
      '    """このdocstringにはAC-IDが無い"""',
      "    assert True",
    ].join("\n");
    const { active, skipped } = extractPytestCoverage(text);
    assert.equal(active.size, 0, "docstring外の言及がカバーとして拾われてしまっている");
    assert.equal(skipped.size, 0);
  });

  it("AC-022: @pytest.mark.skipif（条件付き）は無条件skipとして扱わず、有効なカバーとして残る", () => {
    const text = [
      '@pytest.mark.skipif(sys.platform == "win32", reason="not on windows")',
      "def test_conditionally_skipped():",
      '    """AC-022: 条件付きskip"""',
      "    assert True",
    ].join("\n");
    const { active, skipped } = extractPytestCoverage(text);
    assert.ok(active.has("AC-022"), "skipifなのに有効カバーとして残っていない");
    assert.ok(!skipped.has("AC-022"), "skipifなのに無条件skip扱いになっている");
  });

  it("AC-021: .pyファイルと.tsファイルが混在しても拡張子を跨いだ誤検出は発生しない", () => {
    const tmp = mkdtempSync(join(process.cwd(), ".tmp-pytest-isolation-"));
    try {
      mkdirSync(join(tmp, "specs", "x"), { recursive: true });
      mkdirSync(join(tmp, "tests"), { recursive: true });
      writeFileSync(
        join(tmp, "conformance.config.json"),
        JSON.stringify({
          specDir: "specs",
          srcDirs: ["tests"],
          codeExtensions: ["ts", "py"],
          testFilePattern: "(^|/)test_[^/]+\\.py$|\\.(test|spec)\\.[cm]?[jt]sx?$",
        }),
      );
      writeFileSync(
        join(tmp, "specs", "x", "requirements.yaml"),
        [
          "id: FX-002",
          'title: "fixture"',
          "status: frozen",
          "out_of_scope:",
          '  - "n/a"',
          "acceptance:",
          "  - id: AC-001",
          "    kind: functional",
          '    given: "g"',
          '    when: "w"',
          '    then: "成功を返す"',
          "    priority: could",
          "    verify: test",
          "  - id: AC-002",
          "    kind: functional",
          '    given: "g"',
          '    when: "w"',
          '    then: "成功を返す"',
          "    priority: could",
          "    verify: test",
          "  - id: AC-003",
          "    kind: functional",
          '    given: "g"',
          '    when: "w"',
          '    then: "成功を返す"',
          "    priority: could",
          "    verify: test",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(tmp, "tests", "test_fixture.py"),
        [
          "def test_real():",
          '    """AC-001: python docstring由来の正規のカバー"""',
          "    assert True",
          "",
          "# 以下はJS風の呼び出しを模した文字列だが、.pyファイルなのでJS側の検出には一切かからないはず",
          // 次の行はit呼び出し風の文字列を連結で分断している。連結せず1つの文字列にすると、
          // このテストファイル自身のソースがTEST_CALL_RE誤爆でAC-002をカバーしたことになってしまう
          // （検証ループで実際に見つかった副作用）
          "# " + "it" + '("AC-002: fake js call embedded in a .py file", lambda: None)',
        ].join("\n"),
      );
      writeFileSync(
        join(tmp, "tests", "decoy.test.ts"),
        [
          "// 以下はPython docstring風の文字列を模したコメントだが、.tsファイルなのでpytest側の検出には一切かからないはず",
          "// def test_decoy():",
          '// """AC-003: fake python docstring embedded in a .ts file"""',
          "export const noop = () => {};",
        ].join("\n"),
      );
      const { output } = run(["scripts/trace-matrix.ts", "--root", relative(process.cwd(), tmp), "--json"]);
      const j = JSON.parse(output) as { coverage: Record<string, string[]> };
      assert.ok((j.coverage["AC-001"] ?? []).length > 0, "pythonのdocstring由来の正規カバーが検出されていない");
      assert.equal((j.coverage["AC-002"] ?? []).length, 0, ".py内のJS風文字列が誤ってJS側で検出されている");
      assert.equal((j.coverage["AC-003"] ?? []).length, 0, ".ts内のpython風文字列が誤ってpytest側で検出されている");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
