# conformance kit — 要件抽出と適合性検証のパイプライン

AIコーディングにおいて、(1) 要件を人間から過不足なく引き出し、(2) 実装がそれに適合していることを機械的に担保する。

```
/spec ──▶ spec-lint ──▶ spec-challenger ──▶ /freeze ──▶ 実装 ──▶ /verify ──▶ /reconcile ──▶ gate
  骨組み    機械検査       敵対的レビュー      凍結ゲート          独立検証     要件へ還元    合否
   ▲                                                                  │
   └──────────────────── 要件の欠落は要件へ戻す ◀────────────────────┘
```

完了の定義を「テストが通った」から「**全受入基準が証拠付きで pass、または人間へ返却済み**」に移す。

この`/spec → /verify → /reconcile → gate`ループは、いわゆる[loop engineering](https://www.langchain.com/blog/the-art-of-loop-engineering)（タスク＋検証グレーダー＋停止条件で構成する反復ループの設計）の一実装でもある。`verifier`/`scope-auditor`がagenticなグレーダー、`record-verdict.ts`の2回fail自動`blocked`が停止条件（termination logic）に相当する。

## 設計上の主張

0. **人間に白紙を書かせない。** 「要件を漏れなく書いてください」は必ず失敗する。AIが先に全項目を推測で埋め、人間には差分を否定してもらう。書くコストより否定するコストの方が桁違いに低い。
1. **判定者と実装者を分離する。** 自分の成果物を採点する主体は必ず甘くなる。`verifier` は別サブエージェント（＝別コンテキスト）で、実装の意図説明を受け取らない。
2. **逆方向を必ず見る。** 未実装よりも「頼んでいない実装」の方が検出されにくく、保守債務として残る。
3. **停止条件をコードで担保する。** 「2回失敗したら人間に返す」をプロンプトの努力目標にせず、`record-verdict.ts` の分岐にする。
4. **仮決めに機械的な痕跡を残す。** `assumptions` と `@assumption AS-001` の対応が切れていれば検出される。暗黙の仮定が確定事項に化けるのを防ぐ。

## 構成

```
specs/<feature>/requirements.yaml   要件の単一の正（AC / assumptions / out_of_scope / open_questions）
scripts/spec-init.ts                要件の骨組み生成（白紙を作らない）
scripts/spec-lint.ts                要件の機械検査と freeze 遷移ゲート
scripts/trace-matrix.ts             順方向・逆方向・仮定のトレース検査
scripts/record-verdict.ts           検証結果の書き戻しと自動エスカレーション
scripts/gate.ts                     トレース + テスト + 型（bash不使用、Windows対応）
.claude/skills/spec-intake/         要件抽出の手順（Claude が自動で参照）
.claude/skills/conformance-verify/  検証ループの手順（同上）
.claude/agents/spec-challenger.md   要件を敵対的にレビューするサブエージェント
.claude/agents/verifier.md          独立検証サブエージェント
.claude/agents/scope-auditor.md     逆方向監査サブエージェント
.claude/commands/spec.md            /spec — 要件確定
.claude/commands/freeze.md          /freeze — draft -> frozen
.claude/commands/verify.md          /verify
.claude/commands/reconcile.md       /reconcile
CLAUDE.md                           実装者向け規約（対象リポジトリの CLAUDE.md にマージ）
.github/workflows/conformance.yml   CIゲート
```

## 導入

```bash
node install.mjs <対象リポジトリのパス> [--with-samples]
cd <対象リポジトリ>
npm i yaml && npm i -D tsx typescript @types/node
```

`install.mjs` はプレーンな Node ESM（追加依存なし）で書かれており、Windows のネイティブ
PowerShell/cmd.exe でも Git Bash や WSL を別途用意せずにそのまま動く（`gate.ts`/`install.mjs`
はどちらも bash に依存しない）。

`install.mjs` は `.claude/` `scripts/` `conformance.config.json` `.github/workflows/` を配置し、
既存の `CLAUDE.md` があれば末尾に追記、`package.json` の `scripts` に不足分だけ追加する。
既存ファイルは上書きせず、二重実行しても安全。

規約は2つだけ（詳細は CLAUDE.md）。

- `it()`/`test()` のタイトルに AC-ID を含める … `it("AC-001: 未登録アドレスでも200を返す", ...)`
- 実装に `@covers AC-001` を書く … 逆方向トレースの根拠になる

## 使い方

```bash
/spec <slug> "機能の説明"  # 要件を確定させる（推測で埋める→最大3問→三値に振り分け）
/freeze <slug>          # 曖昧語・異常系不在などを error 扱いにして凍結
/verify                 # 検証ループを回す（trace → verifier → scope-auditor）
/reconcile              # 差分を要件へ還元する
npm run gate            # マージ前の合否
npx tsx scripts/trace-matrix.ts --base origin/main --strict
npx tsx scripts/record-verdict.ts --ac AC-002 --verdict fail --note "期限切れで500"
```

## 検査項目

| コード | 方向 | 意味 | 重み |
|---|---|---|---|
| `UNCOVERED_AC` | 順 | 受入基準が有効な it()/test() のタイトルに現れない | error（`could` は warn） |
| `SKIPPED_TEST` | 順 | ACのテストが skip/todo/xit | error |
| `NO_EVIDENCE` | 順 | `verify: manual/inspection` なのに証跡が空 | error |
| `PASS_WITHOUT_EVIDENCE` | 順 | pass なのに evidence が無い（手編集の疑い） | error |
| `AC_FAILING` / `AC_BLOCKED` | 順 | fail のまま / 人間の判断待ち | error |
| `UNTRACED_CHANGE` | 逆 | 変更されたがどのACにも紐づかない | warn（`--strict` で error） |
| `UNSCANNED_CHANGE` | 逆 | srcDirs 外のコードが変更された | warn |
| `DANGLING_AC` | 逆 | 存在しないACを参照 | error |
| `DUPLICATE_ID` | 要件 | AC/AS の ID がリポジトリ内で重複 | error |
| `UNRECORDED_ASSUMPTION` | 仮定 | 要件に無い仮定がコードに埋まっている | error |
| `ASSUMPTION_UNANCHORED` | 仮定 | 仮決めがコード側に紐づかず回収漏れを検出できない | warn |
| `ASSUMPTION_EXPIRED` | 仮定 | `resolve_by` を過ぎても未確定 | error |
| `STALE_ASSUMPTION_TAG` | 仮定 | confirmed 済みなのに `@assumption` が残っている | warn |
| `FROZEN_WITH_OPEN` | 要件 | 未決事項を残したまま frozen | error |
| `NO_SCOPE_FENCE` | 要件 | `out_of_scope` が空 | error |
| `DRAFT_SPEC` | 要件 | draft のため検査対象外 | warn |

カバーの定義は「有効な `it()`/`test()` の**タイトル**に AC-ID が含まれること」。コメント・`describe`・skip は数えない。

`record-verdict.ts` は `pass` に `--evidence` を、`fail`/`blocked` に `--note` を要求する。省略すると記録されない。

## 要件側の検査項目（spec-lint.ts）

| コード | 意味 |
|---|---|
| `AMBIGUOUS_TERM` | 「適切に」「高速」「必要に応じて」等、検証手順に落ちない語 |
| `UNOBSERVABLE_THEN` | then に観測可能な結果が無い（「〜に対応する」「〜できる」） |
| `UNMEASURABLE_NFR` | `kind: nfr` なのに数値としきい値が無い |
| `COMPOUND_THEN` | 「かつ」で複合。片側だけ失敗した時に原因が特定できない |
| `NO_FAILURE_PATH` | 異常系のACが1件も無い |
| `NO_SCOPE_FENCE` | `out_of_scope` が空 |
| `MISSING_GWT` | given / when が欠落 |
| `ASSUMPTION_NO_OWNER` | 仮決めに owner / resolve_by が無い |
| `STALE_QUESTION` | 未決事項が14日以上未回答 |
| `PLACEHOLDER_LEFT` | TBD / 未定 が残っている |
| `CANNOT_FREEZE` | 未決事項を残したまま freeze しようとしている |

`draft` の間は多くが warn。`--gate freeze` を付けると曖昧語・観測不能な then・異常系の不在・スコープ未定義・owner なし仮決めが **error に昇格**する。これが draft → frozen の遷移ゲート。

`frozen` / `reconciling` の要件は、`--gate freeze` の有無にかかわらず常に厳格判定になる。凍結済みの要件が曖昧なまま warn で通過することはない。

曖昧語は正規表現で判定しており、「等しい」「未定義」「高速道路」のような正当な語は拾わない。

## 既知の限界・未着手

- 逆方向トレースはファイル単位。`@covers AC-001` を持つファイルに無関係な関数を足しても検出しない。関数単位の検出は `scope-auditor`（LLM）の担当
- カバー判定は `it()`/`test()` タイトルの文字列一致。Vitest/Jest/node:test に加え、Playwright（`@playwright/test`をimportしているファイル限定）の `test.describe` タイトルも動作確認済み（詳細は `specs/playwright-support/`）。ただし2階層より深いdescribeの入れ子、動的タイトル（テンプレートリテラル）は対象外
- pytest（Python）は `codeExtensions` に `py` を含めれば検出対象になる（docstring方式、詳細は `specs/pytest-support/`）。それ以外の非JS/Pythonの言語・pytest以外のPythonテストフレームワーク（unittest単体、nose等）は未対応
- `verifier` の「コードを編集しない」は Bash ツールを持つ以上プロンプト頼み。厳密にしたいなら `verifier` の `tools` から Bash を外し、テスト実行を呼び出し元で行って結果を渡す構成にする
- `UNOBSERVABLE_THEN` は観測動詞の辞書一致。英語で書かれた要件はほぼ拾えない（辞書に英語が少ない）
- 「最大3問」（`/spec` の質問数上限）はプロンプト制約であり機械的な強制ではない。守られているかは人間が見るしかない
- `spec-challenger` の指摘品質は測っていない。誤検知が多ければ観点を絞る
- 複数機能をまたぐ要件（機能Aの変更が機能BのACを壊す）の検出は未対応

## AI駆動開発トレンドの追従判断

conformance-kitは現在 Claude Code 以外の外部サービスに依存しない構成を意図的に保っている。AI駆動開発エコシステムの動向調査と、その追従可否判断（採用/見送り/却下と再検討条件）は `/trend-watch` で行い、`TREND_BACKLOG.md` に記録する（`specs/trend-watch/`、FEAT-007）。過去の判断はそちらを参照。
