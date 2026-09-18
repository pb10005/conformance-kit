// @covers AC-036, AC-037, AC-038, AC-039, AC-040, AC-041, AC-042, AC-043
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveTsxCli } from "../scripts/lib/tsx-cli.ts";

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, "scripts", "record-trend.ts");

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

describe("TREND_BACKLOG.md 記録 (FEAT-007)", () => {
  it("AC-036: 初回実行でTREND_BACKLOG.mdが新規作成され、日付・技術名・decision・reason・revisitを含む1件目が書き込まれる", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-trend-watch-"));
    try {
      const { code, output } = run(
        ["--tech", "Jev (TypeSafe AI)", "--decision", "defer", "--reason", "依存を増やすコストが便益を上回る", "--revisit", "LLM往復コストがボトルネック化したとき"],
        tmp,
      );
      assert.equal(code, 0, output);

      const backlogPath = join(tmp, "TREND_BACKLOG.md");
      assert.ok(existsSync(backlogPath), "TREND_BACKLOG.mdが作成されていない");
      const content = readFileSync(backlogPath, "utf8");
      assert.match(content, /\d{4}-\d{2}-\d{2}/, "日付が含まれていない");
      assert.ok(content.includes("[Jev (TypeSafe AI)]"), "技術名が含まれていない");
      assert.ok(content.includes("defer"), "decisionが含まれていない");
      assert.ok(content.includes("依存を増やすコストが便益を上回る"), "reasonが含まれていない");
      assert.ok(content.includes("LLM往復コストがボトルネック化したとき"), "revisitが含まれていない");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-037: 既存のエントリを残したまま2件目が末尾に追記される", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-trend-watch-"));
    try {
      run(["--tech", "技術A", "--decision", "reject", "--reason", "1件目の理由", "--revisit", "再検討条件A"], tmp);
      const { code } = run(["--tech", "技術B", "--decision", "adopt", "--reason", "2件目の理由"], tmp);
      assert.equal(code, 0);

      const content = readFileSync(join(tmp, "TREND_BACKLOG.md"), "utf8");
      assert.ok(content.includes("1件目の理由"), "1件目のエントリが消えている");
      assert.ok(content.includes("2件目の理由"), "2件目が追記されていない");
      assert.ok(content.indexOf("1件目の理由") < content.indexOf("2件目の理由"), "追記順が末尾になっていない");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-038: --techまたは--reasonが空(trim後空白のみ含む)だと記録されずexit非0になる", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-trend-watch-"));
    try {
      const backlogPath = join(tmp, "TREND_BACKLOG.md");

      const noTech = run(["--decision", "adopt", "--reason", "理由"], tmp);
      assert.notEqual(noTech.code, 0);
      assert.ok(!existsSync(backlogPath));

      const blankTech = run(["--tech", "   ", "--decision", "adopt", "--reason", "理由"], tmp);
      assert.notEqual(blankTech.code, 0);
      assert.ok(!existsSync(backlogPath));

      const blankReason = run(["--tech", "技術X", "--decision", "adopt", "--reason", "  "], tmp);
      assert.notEqual(blankReason.code, 0);
      assert.ok(!existsSync(backlogPath));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-039: --decisionがadopt/defer/reject以外の値だとexit非0で記録されない", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-trend-watch-"));
    try {
      const backlogPath = join(tmp, "TREND_BACKLOG.md");

      const badValue = run(["--tech", "技術X", "--decision", "maybe", "--reason", "理由"], tmp);
      assert.notEqual(badValue.code, 0);
      assert.ok(!existsSync(backlogPath));

      const missing = run(["--tech", "技術X", "--reason", "理由"], tmp);
      assert.notEqual(missing.code, 0);
      assert.ok(!existsSync(backlogPath));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-040: decisionがdefer/rejectで--revisitが空だと記録されずexit非0になる", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-trend-watch-"));
    try {
      const backlogPath = join(tmp, "TREND_BACKLOG.md");

      const deferNoRevisit = run(["--tech", "技術X", "--decision", "defer", "--reason", "理由"], tmp);
      assert.notEqual(deferNoRevisit.code, 0);
      assert.ok(!existsSync(backlogPath));

      const rejectBlankRevisit = run(["--tech", "技術X", "--decision", "reject", "--reason", "理由", "--revisit", "  "], tmp);
      assert.notEqual(rejectBlankRevisit.code, 0);
      assert.ok(!existsSync(backlogPath));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-042: decision adoptでrevisit省略時、固定文言で他エントリと区別できる形で記録される", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-trend-watch-"));
    try {
      const { code } = run(["--tech", "技術X", "--decision", "adopt", "--reason", "採用する理由"], tmp);
      assert.equal(code, 0);

      const content = readFileSync(join(tmp, "TREND_BACKLOG.md"), "utf8");
      assert.ok(content.includes("再検討条件なし"), "revisit省略時の固定文言が記録されていない");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-043: decision adoptでrevisitを明示指定した場合、その内容がそのまま記録される", () => {
    const tmp = mkdtempSync(join(repoRoot, ".tmp-trend-watch-"));
    try {
      const { code } = run(
        ["--tech", "技術X", "--decision", "adopt", "--reason", "採用する理由", "--revisit", "バージョンアップ時に再確認"],
        tmp,
      );
      assert.equal(code, 0);

      const content = readFileSync(join(tmp, "TREND_BACKLOG.md"), "utf8");
      assert.ok(content.includes("バージョンアップ時に再確認"), "adoptで明示指定したrevisitが記録されていない");
      assert.ok(!content.includes("再検討条件なし"), "revisitを指定したのに固定文言が入ってしまっている");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("AC-041: trend-watch.mdは、承認を得た上でrecord-trend.tsを呼び出す旨、および自動導入・無承認記録を行わない旨の記述を含む", () => {
    const content = readFileSync(join(repoRoot, ".claude", "commands", "trend-watch.md"), "utf8");
    assert.ok(content.includes("WebSearch"), "WebSearchによる調査手順が無い");
    assert.ok(content.includes("承認を得てから"), "承認を得てから記録する旨の記述が無い");
    assert.ok(content.includes("record-trend.ts"), "record-trend.tsの呼び出し手順が無い");
    assert.ok(content.includes("承認を得ずに"), "無承認での記録を禁止する旨の記述が無い");
  });
});
