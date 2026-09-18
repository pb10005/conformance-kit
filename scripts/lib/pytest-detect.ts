// @covers AC-018, AC-019, AC-020, AC-022
// @assumption AS-010, AS-012
//
// pytest（Python）のトップレベルテスト関数からAC-IDカバレッジを抽出する。
// JS/TSの TEST_CALL_RE（it()/test()呼び出しの文字列タイトル）に相当するPython版。
// AC-IDは `def test_foo():`（`async def` も含む）の直後に続くdocstringに書く
// （AS-010）。docstring以外（コメント・別関数のdocstring等）での言及はカバーとして扱わない。
// `^` はトップレベル（行頭、インデント無し）にのみマッチするため、class内のメソッドは
// 対象外になる（AS-011）。
//
// スキップ判定は無条件の `@pytest.mark.skip`（単一行）のみを対象とする（AS-012）。
// `\b` の単語境界により `@pytest.mark.skipif` は「skip」に一致しない
// （"skipif" は "skip" と "if" の間に境界が無いため）。
const AC_RE = /\bAC-\d{3,}\b/g;
const PYTEST_FUNC_RE =
  /^((?:@[^\n]*\n)*)(?:async\s+)?def\s+test_\w+\s*\([^)]*\)\s*:[ \t]*\n\s*("""|''')([\s\S]*?)\2/gm;
const SKIP_RE = /@pytest\.mark\.skip\b/;

export interface PytestCoverage {
  active: Set<string>;
  skipped: Set<string>;
}

export function extractPytestCoverage(text: string): PytestCoverage {
  const active = new Set<string>();
  const skipped = new Set<string>();
  for (const m of text.matchAll(PYTEST_FUNC_RE)) {
    const decorators = m[1];
    const docstring = m[3];
    const target = SKIP_RE.test(decorators) ? skipped : active;
    for (const id of docstring.match(AC_RE) ?? []) target.add(id);
  }
  return { active, skipped };
}
