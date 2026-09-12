#!/usr/bin/env bash
# 適合性ゲート。ここを通らないものはマージしない。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── 1/4 要件の健全性"
npx tsx scripts/spec-lint.ts

echo "── 2/4 トレーサビリティ"
npx tsx scripts/trace-matrix.ts "$@"

echo "── 3/4 テスト"
npm test --silent

echo "── 4/4 型"
npx tsc --noEmit

echo "✔ 適合性ゲート通過"
