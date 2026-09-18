// @covers AC-024, AC-025, AC-026, AC-027, AC-028
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveTsxCli } from "../scripts/lib/tsx-cli.ts";

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, "scripts", "record-decision.ts");

function run(args: string[], cwd: string): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [resolveTsxCli(), scriptPath, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: e.status ?? 1, output: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

describe("decisions.md 記録 (FEAT-005)", () => {
  it("AC-024: 初回実行でdecisions.mdが新規作成され、日付・ref・reasonを含む1件目が書き込まれる", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-decision-log-"));
    try {
      mkdirSync(join(tmp, "specs", "sample"), { recursive: true });
      writeFileSync(join(tmp, "specs", "sample", "requirements.yaml"), "id: FX-001\n");

      const { code, output } = run(["--spec", "sample", "--ref", "AC-001", "--reason", "検証で判明した欠落を追加"], tmp);
      assert.equal(code, 0, output);

      const decisionsPath = join(tmp, "specs", "sample", "decisions.md");
      assert.ok(existsSync(decisionsPath), "decisions.mdが作成されていない");
      const content = readFileSync(decisionsPath, "utf8");
      assert.match(content, /\d{4}-\d{2}-\d{2}/, "日付が含まれていない");
      assert.ok(content.includes("[AC-001]"), "refが含まれていない");
      assert.ok(content.includes("検証で判明した欠落を追加"), "reasonが含まれていない");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-025: 既存のエントリを残したまま2件目が末尾に追記される", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-decision-log-"));
    try {
      mkdirSync(join(tmp, "specs", "sample"), { recursive: true });
      writeFileSync(join(tmp, "specs", "sample", "requirements.yaml"), "id: FX-001\n");

      run(["--spec", "sample", "--ref", "AC-001", "--reason", "1件目の理由"], tmp);
      const { code } = run(["--spec", "sample", "--ref", "AC-002", "--reason", "2件目の理由"], tmp);
      assert.equal(code, 0);

      const content = readFileSync(join(tmp, "specs", "sample", "decisions.md"), "utf8");
      assert.ok(content.includes("1件目の理由"), "1件目のエントリが消えている");
      assert.ok(content.includes("2件目の理由"), "2件目が追記されていない");
      assert.ok(content.indexOf("1件目の理由") < content.indexOf("2件目の理由"), "追記順が末尾になっていない");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-026: --reasonまたは--refが空(trim後空白のみ含む)だと記録されずexit非0になる", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-decision-log-"));
    try {
      mkdirSync(join(tmp, "specs", "sample"), { recursive: true });
      writeFileSync(join(tmp, "specs", "sample", "requirements.yaml"), "id: FX-001\n");
      const decisionsPath = join(tmp, "specs", "sample", "decisions.md");

      const noReason = run(["--spec", "sample", "--ref", "AC-001"], tmp);
      assert.notEqual(noReason.code, 0);
      assert.ok(!existsSync(decisionsPath), "reason無しなのにdecisions.mdが作成されている");

      const blankReason = run(["--spec", "sample", "--ref", "AC-001", "--reason", "   "], tmp);
      assert.notEqual(blankReason.code, 0);
      assert.ok(!existsSync(decisionsPath), "reasonが空白のみなのにdecisions.mdが作成されている");

      const blankRef = run(["--spec", "sample", "--ref", "  ", "--reason", "理由"], tmp);
      assert.notEqual(blankRef.code, 0);
      assert.ok(!existsSync(decisionsPath), "refが空白のみなのにdecisions.mdが作成されている");

      const noRef = run(["--spec", "sample", "--reason", "理由"], tmp);
      assert.notEqual(noRef.code, 0);
      assert.ok(!existsSync(decisionsPath), "ref未指定なのにdecisions.mdが作成されている");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-027: specs/<slug>/requirements.yamlが存在しないとexit非0でエラー出力し、decisions.mdを作成しない", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-decision-log-"));
    try {
      // ディレクトリ自体が無いケース
      const noDir = run(["--spec", "missing", "--ref", "AC-001", "--reason", "理由"], tmp);
      assert.notEqual(noDir.code, 0);
      assert.ok(!existsSync(join(tmp, "specs", "missing", "decisions.md")));

      // ディレクトリはあるがrequirements.yamlが無いケース
      mkdirSync(join(tmp, "specs", "empty-dir"), { recursive: true });
      const noReqFile = run(["--spec", "empty-dir", "--ref", "AC-001", "--reason", "理由"], tmp);
      assert.notEqual(noReqFile.code, 0);
      assert.ok(noReqFile.output.length > 0, "エラーメッセージが出力されていない");
      assert.ok(!existsSync(join(tmp, "specs", "empty-dir", "decisions.md")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-028: reconcile.mdは要件の欠落/スコープの誤り/仮定の確定の3分類にrecord-decision.tsの手順を含み、実装のバグには含まない", () => {
    const content = readFileSync(join(repoRoot, ".claude", "commands", "reconcile.md"), "utf8");
    const bugSection = content.slice(content.indexOf("**実装のバグ**"), content.indexOf("**要件の欠落**"));
    const missingAcSection = content.slice(content.indexOf("**要件の欠落**"), content.indexOf("**スコープの誤り**"));
    const scopeSection = content.slice(content.indexOf("**スコープの誤り**"), content.indexOf("**仮定の確定**"));
    const assumptionSection = content.slice(
      content.indexOf("**仮定の確定**"),
      content.indexOf("要件を弱めることで検証を通すのは禁止"),
    );

    assert.ok(!bugSection.includes("record-decision.ts"), "実装のバグ分類にrecord-decision.tsが含まれてしまっている");
    assert.ok(missingAcSection.includes("record-decision.ts"), "要件の欠落分類にrecord-decision.tsの手順が無い");
    assert.ok(scopeSection.includes("record-decision.ts"), "スコープの誤り分類にrecord-decision.tsの手順が無い");
    assert.ok(assumptionSection.includes("record-decision.ts"), "仮定の確定分類にrecord-decision.tsの手順が無い");
  });
});
