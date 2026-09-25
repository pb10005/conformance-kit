#!/usr/bin/env node
// @covers AC-012, AC-013, AC-017, AC-049, AC-059, AC-060, AC-081, AC-082, AC-083, AC-084, AC-085, AC-086, AC-087, AC-091, AC-092, AC-093, AC-094, AC-095, AC-096, AC-097
//
// conformance-kit を対象リポジトリへ導入する。プレーンなNode ESM（追加依存なし）で書かれており、
// 対象リポジトリで `npm i` する前でも実行できる。POSIXシェルに一切依存しないため、
// Windowsのネイティブ PowerShell/cmd.exe からもそのまま動く。
//
//   node install.mjs <対象リポジトリのパス> [--with-samples] [--default-branch <name>]
//
// 既存ファイルは上書きしない（.claude/ scripts/ 配下の同名ファイルのみ常に更新）。
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const KIT = dirname(fileURLToPath(import.meta.url));

// 引数は位置に依存せずに解釈する。--default-branch の値は検証してから使う（CI定義とJSONへそのまま埋め込むため）
// @assumption AS-046
const BRANCH_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const args = process.argv.slice(2);
let TARGET;
let WITH_SAMPLES = false;
let branchArg;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--with-samples") WITH_SAMPLES = true;
  else if (a === "--default-branch") {
    branchArg = args[++i];
    if (branchArg === undefined || !BRANCH_RE.test(branchArg)) {
      console.error(`--default-branch のブランチ名が不正です: ${branchArg ?? "(値なし)"}`);
      process.exit(2);
    }
  } else if (TARGET === undefined) TARGET = a;
}

if (!TARGET) {
  console.error("usage: node install.mjs <target-repo> [--with-samples] [--default-branch <name>]");
  process.exit(2);
}
if (!existsSync(TARGET)) {
  console.error(`not a directory: ${TARGET}`);
  process.exit(2);
}

// 配布用の設定はキット自身の conformance.config.json（scripts/ と install.mjs を検査対象に含む）ではなく
// templates/ から配る。キット用の設定を配ると、導入先で配布済み scripts/ の @covers が DANGLING_AC になる（FEAT-008 AS-031）。
// 中途半端な導入状態を残さないよう、何かを書き込む前に存在を確かめる。
// CI定義も同じく templates/ から配る。キット自身の定義にはキット専用のジョブ（samples/windows）が入っている（FEAT-010）。
// @assumption AS-043
const CONFIG_TEMPLATE = join(KIT, "templates", "conformance.config.json");
const WORKFLOW_TEMPLATE = join(KIT, "templates", "conformance.yml");
for (const [p, name] of [[CONFIG_TEMPLATE, "templates/conformance.config.json"], [WORKFLOW_TEMPLATE, "templates/conformance.yml"]]) {
  if (!existsSync(p)) {
    console.error(`${name} が見つかりません。キットのコピーが不完全です`);
    process.exit(2);
  }
}

// キット自身の開発にだけ使うファイル。導入先には配らない。キット専用ファイルを足したらここにも足す
// @assumption AS-042
const KIT_ONLY = new Set([join(".claude", "commands", "trend-watch.md"), join("scripts", "record-trend.ts")]);

// 導入先の既定ブランチ: --default-branch > origin/HEAD > main。作業ブランチは使わない。
// gitが無い・リポジトリでない場合も黙って main にフォールバックする（gitの標準エラーは表示しない）
function detectDefaultBranch() {
  if (branchArg) return { name: branchArg, source: "--default-branch" };
  try {
    const ref = execFileSync("git", ["-C", TARGET, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const name = ref.replace(/^refs\/remotes\/origin\//, "");
    if (name !== ref && BRANCH_RE.test(name)) return { name, source: "origin/HEAD" };
  } catch {
    // リポジトリでない / origin/HEAD が無い / git が無い
  }
  return { name: "main", source: "fallback" };
}
const branch = detectDefaultBranch();
console.log(`default branch: ${branch.name} (${branch.source})`);
if (branch.source === "fallback") console.log("  --default-branch で指定できます");

function inTarget(...segs) {
  return join(TARGET, ...segs);
}
function inKit(...segs) {
  return join(KIT, ...segs);
}
function copyMdFiles(relDir) {
  const srcDir = inKit(relDir);
  const destDir = inTarget(relDir);
  mkdirSync(destDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (f.endsWith(".md") && !KIT_ONLY.has(join(relDir, f))) cpSync(join(srcDir, f), join(destDir, f));
  }
}

console.log("▶ .claude/ (skills / agents / commands)");
mkdirSync(inTarget(".claude", "skills"), { recursive: true });
cpSync(inKit(".claude", "skills"), inTarget(".claude", "skills"), { recursive: true });
copyMdFiles(join(".claude", "agents"));
copyMdFiles(join(".claude", "commands"));

console.log("▶ scripts/");
cpSync(inKit("scripts"), inTarget("scripts"), {
  recursive: true,
  filter: (src) => !KIT_ONLY.has(join("scripts", src.slice(inKit("scripts").length + 1))),
});

const wantBaseRef = `origin/${branch.name}`;
if (existsSync(inTarget("conformance.config.json"))) {
  console.log("  skip conformance.config.json (既存)");
  // 既存ファイルは書き換えず、ブランチの食い違いだけ知らせる
  try {
    const existing = JSON.parse(readFileSync(inTarget("conformance.config.json"), "utf8"));
    if (existing.baseRef !== undefined && existing.baseRef !== wantBaseRef) {
      console.log(`  ! 既存の conformance.config.json の baseRef (${existing.baseRef}) は既定ブランチ ${branch.name} と異なります`);
    }
  } catch {
    // 壊れたJSONの扱いは trace-matrix 側に任せる
  }
} else {
  const cfg = JSON.parse(readFileSync(CONFIG_TEMPLATE, "utf8"));
  cfg.baseRef = wantBaseRef;
  writeFileSync(inTarget("conformance.config.json"), JSON.stringify(cfg, null, 2) + "\n");
  console.log("▶ conformance.config.json");
}

mkdirSync(inTarget(".github", "workflows"), { recursive: true });
if (existsSync(inTarget(".github", "workflows", "conformance.yml"))) {
  console.log("  skip .github/workflows/conformance.yml (既存)");
} else {
  const workflow = readFileSync(WORKFLOW_TEMPLATE, "utf8").replaceAll("__DEFAULT_BRANCH__", branch.name);
  writeFileSync(inTarget(".github", "workflows", "conformance.yml"), workflow);
  console.log("▶ .github/workflows/conformance.yml");
}

console.log("▶ CLAUDE.md");
{
  const MARK = "<!-- conformance-kit -->";
  const kitClaudeMd = readFileSync(inKit("CLAUDE.md"), "utf8");
  const targetPath = inTarget("CLAUDE.md");
  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, `${MARK}\n${kitClaudeMd}`);
  } else {
    const existing = readFileSync(targetPath, "utf8");
    if (existing.includes(MARK)) {
      console.log("  skip (導入済み)");
    } else {
      writeFileSync(targetPath, `${existing}\n${MARK}\n${kitClaudeMd}`);
      console.log("  既存 CLAUDE.md の末尾に追記");
    }
  }
}

console.log("▶ package.json scripts");
{
  const pkgPath = inTarget("package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.scripts ??= {};
    const add = {
      spec: "tsx scripts/spec-init.ts",
      "lint:spec": "tsx scripts/spec-lint.ts",
      trace: "tsx scripts/trace-matrix.ts",
      verdict: "tsx scripts/record-verdict.ts",
      gate: "tsx scripts/gate.ts",
    };
    for (const [k, v] of Object.entries(add)) if (!pkg.scripts[k]) pkg.scripts[k] = v;
    if (!pkg.scripts.test) console.log("  ! scripts.test が未定義。gate.ts は node --test を呼ぶので定義が必要");
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  } else {
    console.log("  ! package.json が無い。npm init 後に再実行");
  }
}

if (WITH_SAMPLES) {
  console.log("▶ サンプル (specs/example-login, src/auth.ts, src/rogue.ts, tests/auth.test.ts)");
  const SAMPLES = inKit("examples", "with-samples");
  mkdirSync(inTarget("specs"), { recursive: true });
  mkdirSync(inTarget("src"), { recursive: true });
  mkdirSync(inTarget("tests"), { recursive: true });

  const loginDir = join(SAMPLES, "specs", "example-login");
  if (existsSync(loginDir)) {
    if (!existsSync(inTarget("specs", "example-login"))) {
      cpSync(loginDir, inTarget("specs", "example-login"), { recursive: true });
    }
  } else {
    console.log("  ! サンプルが見つかりません: specs/example-login");
  }

  for (const f of ["auth.ts", "rogue.ts"]) {
    const src = join(SAMPLES, "src", f);
    if (existsSync(src)) {
      if (!existsSync(inTarget("src", f))) cpSync(src, inTarget("src", f));
    } else {
      console.log(`  ! サンプルが見つかりません: src/${f}`);
    }
  }

  const testSrc = join(SAMPLES, "tests", "auth.test.ts");
  if (existsSync(testSrc)) {
    if (!existsSync(inTarget("tests", "auth.test.ts"))) cpSync(testSrc, inTarget("tests", "auth.test.ts"));
  } else {
    console.log("  ! サンプルが見つかりません: tests/auth.test.ts");
  }
}

if (!existsSync(inTarget("tsconfig.json"))) {
  console.log("  ! tsconfig.json が無い。gate.ts の型チェック段を外すか tsconfig を用意する");
}

console.log(`
✔ 導入完了。次に:
  npm i yaml && npm i -D tsx typescript @types/node
  conformance.config.json の srcDirs / testFilePattern を確認
  npx tsx scripts/spec-lint.ts      # 要件が無ければ exit 2（正常）
  claude                             # /spec <slug> "機能の説明" から開始
`);
