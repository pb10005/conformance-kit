# TREND_BACKLOG — AI駆動開発トレンド判断ログ

- 2026-09-18 [Jev (TypeSafe AI)] defer — spec-lint.tsの正規表現ベースの意味チェック(AMBIGUOUS_TERM/UNOBSERVABLE_THEN/NO_FAILURE_PATH)をJevで補強できないか検討したが、(1)APIキー管理・CIシークレット・gateの決定論性の毀損・要件テキストが新興ベンダーへ渡る信頼境界の拡張というコストが発生し、(2)同種の意味的チェックは既にspec-challenger/verifier/scope-auditor(いずれも既存依存のClaude Code経由)が多段でカバーしており便益が限定的、(3)spec-lintは元々ミリ秒で完結する処理であり外部API往復は高速化ではなく純増コストになるため見送り / 再検討条件: (a)spec数・CI実行頻度が増えLLMサブエージェントの往復コストが実際にボトルネック化したとき / (b)正規表現ヒューリスティックの見逃しが実測で繰り返し問題化したとき / (c)TypeSafe AI側でSLA・Node公式SDK・価格の実績が積まれたとき
