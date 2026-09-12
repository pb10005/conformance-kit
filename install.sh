#!/usr/bin/env bash
# conformance-kit を対象リポジトリへ導入する。
#   bash install.sh <対象リポジトリのパス> [--with-samples]
# 既存ファイルは上書きしない（.claude/ 配下の同名ファイルのみ更新）。
set -euo pipefail
KIT="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-}"
WITH_SAMPLES="${2:-}"
[ -z "$TARGET" ] && { echo "usage: bash install.sh <target-repo> [--with-samples]"; exit 2; }
[ -d "$TARGET" ] || { echo "not a directory: $TARGET"; exit 2; }
cd "$TARGET"

echo "▶ .claude/ (skills / agents / commands)"
mkdir -p .claude/skills .claude/agents .claude/commands
cp -r "$KIT/.claude/skills/." .claude/skills/
cp "$KIT/.claude/agents/"*.md .claude/agents/
cp "$KIT/.claude/commands/"*.md .claude/commands/

echo "▶ scripts/"
mkdir -p scripts
cp "$KIT/scripts/"*.ts "$KIT/scripts/gate.sh" scripts/
chmod +x scripts/gate.sh

for f in conformance.config.json; do
  if [ -e "$f" ]; then echo "  skip $f (既存)"; else cp "$KIT/$f" "$f"; echo "▶ $f"; fi
done

mkdir -p .github/workflows
if [ -e .github/workflows/conformance.yml ]; then echo "  skip .github/workflows/conformance.yml (既存)"
else cp "$KIT/.github/workflows/conformance.yml" .github/workflows/; echo "▶ .github/workflows/conformance.yml"; fi

echo "▶ CLAUDE.md"
MARK="<!-- conformance-kit -->"
if [ ! -e CLAUDE.md ]; then
  { echo "$MARK"; cat "$KIT/CLAUDE.md"; } > CLAUDE.md
elif grep -q "$MARK" CLAUDE.md; then
  echo "  skip (導入済み)"
else
  { echo; echo "$MARK"; cat "$KIT/CLAUDE.md"; } >> CLAUDE.md
  echo "  既存 CLAUDE.md の末尾に追記"
fi

echo "▶ package.json scripts"
if [ -e package.json ]; then
  node - <<'JS'
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.scripts ??= {};
const add = {
  "spec": "tsx scripts/spec-init.ts",
  "lint:spec": "tsx scripts/spec-lint.ts",
  "trace": "tsx scripts/trace-matrix.ts",
  "verdict": "tsx scripts/record-verdict.ts",
  "gate": "bash scripts/gate.sh",
};
for (const [k, v] of Object.entries(add)) if (!p.scripts[k]) p.scripts[k] = v;
if (!p.scripts.test) console.log("  ! scripts.test が未定義。gate.sh は npm test を呼ぶので定義が必要");
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
JS
else
  echo "  ! package.json が無い。npm init 後に再実行"
fi

if [ "$WITH_SAMPLES" = "--with-samples" ]; then
  echo "▶ サンプル (specs/example-login, src/auth.ts, src/rogue.ts, tests/auth.test.ts)"
  mkdir -p specs src tests
  cp -rn "$KIT/specs/example-login" specs/ 2>/dev/null || true
  cp -n "$KIT/src/"*.ts src/ 2>/dev/null || true
  cp -n "$KIT/tests/"*.ts tests/ 2>/dev/null || true
fi

[ -e tsconfig.json ] || echo "  ! tsconfig.json が無い。gate.sh の型チェック段が失敗するので用意するか gate.sh から外す"

cat <<MSG

✔ 導入完了。次に:
  npm i yaml && npm i -D tsx typescript @types/node
  conformance.config.json の srcDirs / testFilePattern を確認
  npx tsx scripts/spec-lint.ts      # 要件が無ければ exit 2（正常）
  claude                             # /spec <slug> "機能の説明" から開始
MSG
