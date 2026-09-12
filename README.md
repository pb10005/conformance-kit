# conformance kit — 要件抽出と適合性検証のパイプライン

AIコーディングにおいて、(1) 要件を人間から過不足なく引き出し、(2) 実装がそれに適合していることを機械的に担保する。

```
/spec ──▶ spec-lint ──▶ spec-challenger ──▶ /freeze ──▶ 実装 ──▶ /verify ──▶ /reconcile ──▶ gate
  骨組み    機械検査       敵対的レビュー      凍結ゲート          独立検証     要件へ還元    合否
   ▲                                                                  │
   └──────────────────── 要件の欠落は要件へ戻す ◀────────────────────┘
```

完了の定義を「テストが通った」から「**全受入基準が証拠付きで pass、または人間へ返却済み**」に移す。

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
scripts/gate.sh                     トレース + テスト + 型
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
HANDOFF.md                          Claude Code への引き継ぎ手順と既知の限界
.github/workflows/conformance.yml   CIゲート
```

## 導入

```bash
bash install.sh <対象リポジトリのパス> [--with-samples]
cd <対象リポジトリ>
npm i yaml && npm i -D tsx typescript @types/node
```

`install.sh` は `.claude/` `scripts/` `conformance.config.json` `.github/workflows/` を配置し、
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
