#!/usr/bin/env node
// @covers AC-012, AC-013, AC-017
// @assumption AS-006
//
// conformance-kit を対象リポジトリへ導入する。プレーンなNode ESM（追加依存なし）で書かれており、
// 対象リポジトリで `npm i` する前でも実行できる。POSIXシェルに一切依存しないため、
// Windowsのネイティブ PowerShell/cmd.exe からもそのまま動く。
//
//   node install.mjs <対象リポジトリのパス> [--with-samples]
//
// 既存ファイルは上書きしない（.claude/ scripts/ 配下の同名ファイルのみ常に更新）。
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KIT = dirname(fileURLToPath(import.meta.url));
const TARGET = process.argv[2];
const WITH_SAMPLES = process.argv[3];

if (!TARGET) {
  console.error("usage: node install.mjs <target-repo> [--with-samples]");
  process.exit(2);
}
if (!existsSync(TARGET)) {
  console.error(`not a directory: ${TARGET}`);
  process.exit(2);
}

function inTarget(...segs) {
  return join(TARGET, ...segs);
}
function inKit(...segs) {
  return join(KIT, ...segs);
}
function copyMdFiles(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (f.endsWith(".md")) cpSync(join(srcDir, f), join(destDir, f));
  }
}

console.log("▶ .claude/ (skills / agents / commands)");
mkdirSync(inTarget(".claude", "skills"), { recursive: true });
cpSync(inKit(".claude", "skills"), inTarget(".claude", "skills"), { recursive: true });
copyMdFiles(inKit(".claude", "agents"), inTarget(".claude", "agents"));
copyMdFiles(inKit(".claude", "commands"), inTarget(".claude", "commands"));

console.log("▶ scripts/");
cpSync(inKit("scripts"), inTarget("scripts"), { recursive: true });

for (const f of ["conformance.config.json"]) {
  if (existsSync(inTarget(f))) {
    console.log(`  skip ${f} (既存)`);
  } else {
    cpSync(inKit(f), inTarget(f));
    console.log(`▶ ${f}`);
  }
}

mkdirSync(inTarget(".github", "workflows"), { recursive: true });
if (existsSync(inTarget(".github", "workflows", "conformance.yml"))) {
  console.log("  skip .github/workflows/conformance.yml (既存)");
} else {
  cpSync(inKit(".github", "workflows", "conformance.yml"), inTarget(".github", "workflows", "conformance.yml"));
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

if (WITH_SAMPLES === "--with-samples") {
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
