# Claude Code への引き継ぎ

## このキットが何であるか

要件抽出（/spec → /freeze）と適合性検証（/verify → /reconcile）の2フェーズからなるパイプライン。
完了判断を「テストが通った」から「全受入基準が証拠付き pass、または人間へ返却済み」へ移す。
動作確認済み（Node 22.22 / tsx / yaml）。設計判断は README.md、日々の規約は CLAUDE.md を参照。

## 導入手順（最初のタスク）

1. `bash install.sh <対象リポジトリのパス>` を実行する
   （動作確認用サンプルも入れる場合は末尾に `--with-samples`）
   既存ファイルは上書きしない。`CLAUDE.md` は末尾に追記、`package.json` の `scripts` は不足分のみ追加される
2. 対象リポジトリで `npm i yaml && npm i -D tsx typescript @types/node`
3. `conformance.config.json` の `srcDirs` / `testFilePattern` / `codeExtensions` を対象リポジトリに合わせる
   （Next.js なら `srcDirs: ["app", "src", "lib", "tests"]`、Vitest なら `testFilePattern` はそのままでよい）
4. `package.json` に `scripts.test` があることを確認する。`gate.sh` が `npm test` を呼ぶ
5. `tsconfig.json` が無い場合、`gate.sh` の型チェック段を外すか tsconfig を用意する
6. `npx tsx scripts/spec-lint.ts` と `npx tsx scripts/trace-matrix.ts` が動くことを確認する（要件が無ければ exit 2 が正常）
7. `--with-samples` を使った場合、`specs/example-login/` `src/auth.ts` `src/rogue.ts` `tests/auth.test.ts` は動作確認後に削除する

## 最初の実運用（2つ目のタスク）

小さめの1機能で `/spec` → `/freeze` → 実装 → `/verify` を1周回し、以下を観測して報告する:

- `UNTRACED_CHANGE` の誤検知率（型定義・DI配線など「付随実装」がどれだけ引っかかるか）
  → 高ければ `@covers` の付与規約を緩めるか、scope-auditor の分類Aを自動化する
- verifier が `pass` の根拠として出した `--evidence` が、人間が見て納得できる粒度か
- 2回 fail → blocked の閾値が早すぎないか（`--max-attempts` で調整可）
- `AMBIGUOUS_TERM` の誤検知率。特に「など」「等」「一部の」は通常の日本語でも出るため、
  ノイズが多ければ `scripts/spec-lint.ts` の `AMBIGUOUS` 配列から外す
- 「最大3問」で足りているか。4問目以降を assumptions に落とした結果、後で手戻りが出た回数を数える

## 既知の限界（設計上、今は対処しない）

- 逆方向トレースはファイル単位。`@covers AC-001` を持つファイルに無関係な関数を足しても検出しない。関数単位は scope-auditor（LLM）の担当
- カバー判定は it()/test() タイトルの文字列一致。Vitest/Jest/node:test は動くが、Playwright の `test.describe` 内のタイトルも同じ正規表現で拾えるはずだが未検証
- Python 等の非JS実装は `codeExtensions` を変えれば走査はするが、テストタイトル検出の正規表現は JS/TS 前提
- verifier の「コードを編集しない」は Bash ツールを持つ以上プロンプト頼み。厳密にしたいなら verifier の `tools` から Bash を外し、テスト実行を親側で行って結果を渡す構成にする

## 要件側の既知の限界

- 曖昧語検出は正規表現の辞書一致。「等しい」「未定義」等の正当な語は除外済みだが、文脈は見ていない。誤検知が多い語は `scripts/spec-lint.ts` の `AMBIGUOUS` 配列から外す
- `UNOBSERVABLE_THEN` は観測動詞の辞書一致。英語で書かれた要件はほぼ拾えない（辞書に英語が少ない）
- 「最大3問」はプロンプト制約であり機械的な強制ではない。守られているかは人間が見るしかない
- `spec-challenger` の指摘品質は測っていない。誤検知が多ければ観点を絞る

## 未着手（次フェーズ）

- 要件の変更履歴。現状 `requirements.yaml` は git 履歴以外に変更理由を持たない。`/reconcile` で要件を変えた理由を `decisions.md` に追記する仕組みは未実装
- 複数機能をまたぐ要件（機能Aの変更が機能BのACを壊す）の検出は未対応
