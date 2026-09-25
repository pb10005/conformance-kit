# target-install-fixes — 要件変更ログ

- 2026-09-25 [AS-044] scope-auditorの指摘により、origin/HEADのブランチ名がAS-046の受理条件に合わない場合もmainへフォールバックする既存実装の分岐を明文化した（CI定義への不正な値の埋め込みを防ぐ防御）
- 2026-09-25 [AS-047] scope-auditorの指摘により、既存configにbaseRefが無い場合・JSONとして読めない場合は警告しない既存実装の分岐を明文化した
