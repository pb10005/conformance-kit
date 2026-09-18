// @covers AC-029, AC-030, AC-031, AC-032, AC-033, AC-034, AC-035
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { extractPlaywrightCoverage, isPlaywrightFile } from "../scripts/lib/playwright-detect.ts";
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

// "@playwright" と "/test" を連結で分断している。連結せず1つの文字列にすると、このテストファイル自身の
// ソースが trace-matrix.ts の isPlaywrightFile() 判定に誤って一致してしまう（import文の "from" +
// 引用符 + パッケージ名 + 引用符という並びが、このファイル自身の生テキストにそのまま現れてしまうため）。
// 誤って一致すると、このファイル自身がPlaywrightファイルとしてフルスキャンされ、以下の各フィクスチャ内の
// describe/testタイトルが実カバーとして拾われ、他specの実ACが「カバー済み」に漏れ込む
// （scope-auditorで発見された副作用）
const IMPORT_LINE = 'import { test, expect } from "@playwright' + '/test";';

describe("Playwright対応 (FEAT-006)", () => {
  it("AC-029: describeタイトルのAC-IDは、直下に有効なtest()が1件以上あればカバーとして検出される", () => {
    const text = [
      IMPORT_LINE,
      'test.describe("AC-029: ログイン画面", () => {',
      '  test("メールとパスワードで入れる", async ({ page }) => {',
      "    await page.goto('/login');",
      "  });",
      "});",
    ].join("\n");
    const { active, skipped } = extractPlaywrightCoverage(text);
    assert.ok(active.has("AC-029"), "有効なdescribeカバーが検出されていない");
    assert.equal(skipped.size, 0);
  });

  it("AC-030: describe自体がskip修飾されていれば、直下のtest()にskip修飾が無くてもskipped扱いになる", () => {
    const text = [
      IMPORT_LINE,
      'test.describe.skip("AC-030: 未実装機能", () => {',
      '  test("まだ動かない", async ({ page }) => {',
      "    await page.goto('/x');",
      "  });",
      "});",
    ].join("\n");
    const { active, skipped } = extractPlaywrightCoverage(text);
    assert.ok(skipped.has("AC-030"), "describe.skip配下がskipped扱いになっていない");
    assert.ok(!active.has("AC-030"), "describe.skip配下なのにactiveに入ってしまっている");
  });

  it("AC-030: test.describe.fixmeもdescribe.skipと同様にskipped扱いになる", () => {
    const text = [
      IMPORT_LINE,
      'test.describe.fixme("AC-030: 一時的に無効化", () => {',
      '  test("後で直す", async ({ page }) => {});',
      "});",
    ].join("\n");
    const { active, skipped } = extractPlaywrightCoverage(text);
    assert.ok(skipped.has("AC-030"));
    assert.ok(!active.has("AC-030"));
  });

  it("AC-031: test.fixme()はskippedとして検出される（従来は正規表現に一致せず完全に無視されていた）", () => {
    const text = [IMPORT_LINE, 'test.fixme("AC-031: 後で直す", async ({ page }) => {});'].join("\n");
    const { active, skipped } = extractPlaywrightCoverage(text);
    assert.ok(skipped.has("AC-031"), "test.fixme()がskippedとして検出されていない");
    assert.ok(!active.has("AC-031"));
  });

  it("AC-033: 直下にtest()が1件も無い空のdescribeはカバーとして扱われない", () => {
    const text = [IMPORT_LINE, 'test.describe("AC-033: 空のスイート", () => {});'].join("\n");
    const { active, skipped } = extractPlaywrightCoverage(text);
    assert.ok(!active.has("AC-033"), "空のdescribeなのにactiveに入ってしまっている");
    assert.ok(!skipped.has("AC-033"), "空のdescribeなのにskippedに入ってしまっている（UNCOVERED_ACにならない）");
  });

  it("直下にtest()を持たないdescribeは、孫（2階層目以降のdescribe配下）にtest()があってもカバーとして扱われない (out_of_scope 2階層制限, AS-020)", () => {
    // AC-025/AC-026は他specの既存の実在ACを流用している（架空のIDだとDANGLING_ACとして検出されるため）
    const text = [
      IMPORT_LINE,
      'test.describe("AC-025: 直下にtest()を持たない外側", () => {',
      '  test.describe("AC-026: 内側", () => {',
      '    test("何かする", async ({ page }) => {});',
      "  });",
      "});",
    ].join("\n");
    const { active } = extractPlaywrightCoverage(text);
    assert.ok(!active.has("AC-025"), "2階層目のtest()が1階層目のactive判定に漏れ込んでしまっている");
    assert.ok(active.has("AC-026"), "2階層目のdescribe自身は、自分の直下のtest()で正しくカバーされているはず");
  });

  it("AC-034: test.fail()はactiveとして検出される（実行される点でfixmeと異なる）", () => {
    const text = [IMPORT_LINE, 'test.fail("AC-034: 既知のバグで失敗する", async ({ page }) => {});'].join("\n");
    const { active, skipped } = extractPlaywrightCoverage(text);
    assert.ok(active.has("AC-034"), "test.fail()がactiveとして検出されていない");
    assert.ok(!skipped.has("AC-034"));
  });

  it("AC-035: describeタイトルとtest()タイトルに別々のAC-IDがあれば両方独立してカバーになる", () => {
    // AC-024はこのファイルとは無関係な既存の実在ACを流用している（架空のIDだと、AC-IDの生テキスト出現だけで
    // 検出されるDANGLING_ACに引っかかるため）。加えて次の行は呼び出し関数名の直後の丸括弧を連結で分断し、この
    // 行自身が非PlaywrightファイルとしてのTEST_CALL_REスキャンに誤爆しないようにしている（分断しないと、
    // このフィクスチャがAC-024の実カバーとして誤登録され、decision-log側の本来のテストが壊れても検出できなく
    // なる「マスキング」を招く。scope-auditorが発見した副作用。このコメント自身にも同じ連続文字列を書かない
    // よう注意すること — 過去に同種のコメントが自己マッチを再発させた前例がある）
    const text = [
      IMPORT_LINE,
      'test.describe("AC-035: 一覧画面", () => {',
      "  " + "test" + '("AC-024: 検索結果が絞り込まれる", async ({ page }) => {});',
      "});",
    ].join("\n");
    const { active } = extractPlaywrightCoverage(text);
    assert.ok(active.has("AC-035"), "describe側のAC-IDがカバーされていない");
    assert.ok(active.has("AC-024"), "test()側のAC-IDがカバーされていない");
  });

  it("isPlaywrightFile: @playwright/testをimportしていないファイルはfalseになる", () => {
    assert.equal(isPlaywrightFile('import { describe, it } from "node:test";'), false);
    assert.equal(isPlaywrightFile(IMPORT_LINE), true);
  });

  it("AC-032: @playwright/testをimportしていないファイルはdescribe検出の対象にならず、従来のtest()検出のみで判定される", () => {
    const tmp = mkdtempSync(join(process.cwd(), ".tmp-playwright-isolation-"));
    try {
      mkdirSync(join(tmp, "specs", "x"), { recursive: true });
      mkdirSync(join(tmp, "tests"), { recursive: true });
      writeFileSync(
        join(tmp, "conformance.config.json"),
        JSON.stringify({
          specDir: "specs",
          srcDirs: ["tests"],
          codeExtensions: ["ts"],
          testFilePattern: "\\.(test|spec)\\.[cm]?[jt]sx?$",
        }),
      );
      writeFileSync(
        join(tmp, "specs", "x", "requirements.yaml"),
        [
          "id: FX-003",
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
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(tmp, "tests", "no-playwright.spec.ts"),
        [
          'import { describe, it } from "node:test";',
          'describe("AC-001: JestのdescribeにAC-IDを書いても数えない", () => {',
          '  it("対応するit()のタイトルにはAC-IDが無い", () => {});',
          "});",
        ].join("\n"),
      );
      const { output } = run(["scripts/trace-matrix.ts", "--root", relative(process.cwd(), tmp), "--json"]);
      const j = JSON.parse(output) as { coverage: Record<string, string[]> };
      assert.equal((j.coverage["AC-001"] ?? []).length, 0, "非Playwrightファイルでdescribeタイトルが誤ってカバーとして数えられている");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
