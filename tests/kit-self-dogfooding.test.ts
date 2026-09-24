// @covers AC-044, AC-045, AC-046, AC-047, AC-048, AC-049, AC-050, AC-051, AC-052, AC-053, AC-054, AC-055, AC-056, AC-058, AC-059, AC-060, AC-061
// 実在しない AC-ID / AS-ID のフィクスチャは "AC-" + "900" のように組み立てる。そのまま書くと
// tests/ を走査するリポジトリ自身のトレースで DANGLING_AC / UNRECORDED_ASSUMPTION になる。
// @assumption AS-034
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { resolveTsxCli } from "../scripts/lib/tsx-cli.ts";

const repoRoot = process.cwd();
const script = (name: string) => join(repoRoot, "scripts", name);

interface Result { code: number; stdout: string; stderr: string }
function exec(cmd: string, args: string[], cwd: string): Result {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}
const tsx = (name: string, args: string[], cwd: string) => exec(process.execPath, [resolveTsxCli(), script(name), ...args], cwd);

interface Finding { level: string; code: string; ref: string }
const findingsOf = (r: Result): Finding[] => (JSON.parse(r.stdout) as { findings: Finding[] }).findings;

const FIXTURE_AC = "AC-" + "900";
const FIXTURE_AS = "AS-" + "777";
const FIXTURE_DANGLING = "AC-" + "999";

// frozen・ACなし・out_of_scope ありの最小要件（それ自体は finding を出さない）
const EMPTY_FROZEN_SPEC = ["id: FX-008", 'title: "fixture"', "status: frozen", "out_of_scope:", '  - "n/a"', "acceptance: []", ""].join("\n");

/** <parent>/proj にフィクスチャを作り、cwd=<parent>・`--root proj` で実行できるようにする */
function withProject(fn: (parent: string, proj: string) => void, srcDirs: string[]): void {
  const parent = mkdtempSync(join(tmpdir(), "conformance-kit-dogfood-"));
  const proj = join(parent, "proj");
  try {
    mkdirSync(join(proj, "specs", "x"), { recursive: true });
    writeFileSync(join(proj, "conformance.config.json"), JSON.stringify({ specDir: "specs", srcDirs }));
    writeFileSync(join(proj, "specs", "x", "requirements.yaml"), EMPTY_FROZEN_SPEC);
    fn(parent, proj);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

function acSpec(extra: string[] = []): string {
  return [
    "id: FX-009",
    'title: "fixture"',
    "status: frozen",
    "out_of_scope:",
    '  - "n/a"',
    "open_questions: []",
    "acceptance:",
    `  - id: ${FIXTURE_AC}`,
    "    kind: functional",
    '    given: "g"',
    '    when: "w"',
    '    then: "200を返す"',
    "    priority: must",
    "    verify: test",
    "    status: pending",
    "    attempts: 0",
    ...extra,
    "",
  ].join("\n");
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "conformance-kit-dogfood-"));
}

describe("kit self-dogfooding (FEAT-008)", () => {
  it("AC-044: srcDirsのファイルパスエントリが走査され、未記録の@assumptionがUNRECORDED_ASSUMPTIONとして報告される", () => {
    withProject((parent, proj) => {
      writeFileSync(join(proj, "install.mjs"), `// @assumption ${FIXTURE_AS}\nexport {};\n`);
      const r = tsx("trace-matrix.ts", ["--root", "proj", "--json"], parent);
      const hit = findingsOf(r).filter((f) => f.code === "UNRECORDED_ASSUMPTION" && f.ref === FIXTURE_AS);
      assert.equal(hit.length, 1, r.stdout);
    }, ["install.mjs"]);
  });

  it("AC-045: srcDirsに存在しないパスがあっても実行エラーにならずexit 0を返す", () => {
    withProject((parent, proj) => {
      mkdirSync(join(proj, "src"));
      writeFileSync(join(proj, "src", "ok.ts"), "export const ok = 1;\n");
      const r = tsx("trace-matrix.ts", ["--root", "proj"], parent);
      assert.notEqual(r.code, 2, r.stdout + r.stderr);
      assert.equal(r.code, 0, r.stdout + r.stderr);
    }, ["no-such-dir", "src"]);
  });

  it("AC-046: リポジトリのconformance.config.jsonのsrcDirsにscriptsとinstall.mjsを含む", () => {
    const cfg = JSON.parse(readFileSync(join(repoRoot, "conformance.config.json"), "utf8")) as { srcDirs: string[] };
    assert.ok(cfg.srcDirs.includes("scripts"), JSON.stringify(cfg.srcDirs));
    assert.ok(cfg.srcDirs.includes("install.mjs"), JSON.stringify(cfg.srcDirs));
  });

  it("AC-047: リポジトリ自身のトレースでSTALE_ASSUMPTION_TAG・DANGLING_AC・UNRECORDED_ASSUMPTIONを出さない", () => {
    const r = tsx("trace-matrix.ts", ["--json"], repoRoot);
    const bad = findingsOf(r).filter((f) => ["STALE_ASSUMPTION_TAG", "DANGLING_AC", "UNRECORDED_ASSUMPTION"].includes(f.code));
    assert.deepEqual(bad, []);
  });

  it("AC-048: scripts/配下とinstall.mjsの全ファイルが実在するACへの@coversを持つ", () => {
    const COVERS_RE = /@covers\s+((?:AC-\d{3,}[,\s]*)+)/g;
    const cfg = JSON.parse(readFileSync(join(repoRoot, "conformance.config.json"), "utf8")) as { codeExtensions: string[] };
    const exts = new Set(cfg.codeExtensions.map((e) => "." + e));

    const known = new Set<string>();
    for (const d of readdirSync(join(repoRoot, "specs"))) {
      const p = join(repoRoot, "specs", d, "requirements.yaml");
      if (!existsSync(p)) continue;
      const spec = parse(readFileSync(p, "utf8")) as { status?: string; acceptance?: { id: string }[] };
      if (spec.status === "draft") continue;
      for (const ac of spec.acceptance ?? []) known.add(ac.id);
    }

    const targets = [join(repoRoot, "install.mjs")];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (exts.has(extname(p))) targets.push(p);
      }
    };
    walk(join(repoRoot, "scripts"));
    assert.ok(targets.length > 5, "走査対象が少なすぎる");

    for (const t of targets) {
      const ids = [...readFileSync(t, "utf8").matchAll(COVERS_RE)].flatMap((m) => m[1].match(/AC-\d{3,}/g) ?? []);
      assert.ok(ids.length > 0, `${t}: @covers が無い`);
      for (const id of ids) assert.ok(known.has(id), `${t}: @covers ${id} が draft 以外の要件に存在しない`);
    }
  });

  it("AC-049: install.mjsは導入先へsrcDirsが[src, tests]の配布用設定を書き出す", () => {
    const target = tmpDir();
    try {
      const r = exec(process.execPath, [join(repoRoot, "install.mjs"), target], repoRoot);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      const cfg = JSON.parse(readFileSync(join(target, "conformance.config.json"), "utf8")) as { srcDirs: string[] };
      assert.deepEqual(cfg.srcDirs, ["src", "tests"]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("AC-050: freezeゲートでは曖昧語がAMBIGUOUS_TERMのerrorとして出力されexit 1を返す", () => {
    const dir = tmpDir();
    try {
      mkdirSync(join(dir, "specs", "x"), { recursive: true });
      writeFileSync(
        join(dir, "specs", "x", "requirements.yaml"),
        acSpec().replace("status: frozen", "status: draft").replace('then: "200を返す"', 'then: "適切にエラーを返す"'),
      );
      const r = tsx("spec-lint.ts", ["specs/x", "--gate", "freeze"], dir);
      assert.ok(r.stdout.includes("✗ [AMBIGUOUS_TERM]"), r.stdout);
      assert.equal(r.code, 1, r.stdout + r.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-051: spec-initは既存の最大FEAT番号+1のdraft要件を作成する", () => {
    const dir = tmpDir();
    try {
      mkdirSync(join(dir, "specs", "old"), { recursive: true });
      writeFileSync(join(dir, "specs", "old", "requirements.yaml"), "id: FEAT-003\n");
      const r = tsx("spec-init.ts", ["new-feature", "--title", "x"], dir);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      const created = join(dir, "specs", "new-feature", "requirements.yaml");
      assert.ok(existsSync(created), "requirements.yaml が作成されていない");
      const spec = parse(readFileSync(created, "utf8")) as { id: string; status: string };
      assert.equal(spec.id, "FEAT-004");
      assert.equal(spec.status, "draft");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-052: spec-initは既存の要件を上書きせずexit 2を返す", () => {
    const dir = tmpDir();
    try {
      mkdirSync(join(dir, "specs", "existing"), { recursive: true });
      const p = join(dir, "specs", "existing", "requirements.yaml");
      writeFileSync(p, "id: FEAT-001\n# 既存\n");
      const r = tsx("spec-init.ts", ["existing"], dir);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.equal(readFileSync(p, "utf8"), "id: FEAT-001\n# 既存\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-053: record-verdictは--evidenceなしのpassを拒否しexit 2で要件を変更しない", () => {
    const dir = tmpDir();
    try {
      mkdirSync(join(dir, "specs", "x"), { recursive: true });
      const p = join(dir, "specs", "x", "requirements.yaml");
      writeFileSync(p, acSpec());
      const before = readFileSync(p, "utf8");
      const r = tsx("record-verdict.ts", ["--ac", FIXTURE_AC, "--verdict", "pass"], dir);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.equal(readFileSync(p, "utf8"), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-054: record-verdictは2回目のfailでblockedに降格しopen_questionsへ起票する", () => {
    const dir = tmpDir();
    try {
      mkdirSync(join(dir, "specs", "x"), { recursive: true });
      const p = join(dir, "specs", "x", "requirements.yaml");
      writeFileSync(p, acSpec());
      const first = tsx("record-verdict.ts", ["--ac", FIXTURE_AC, "--verdict", "fail", "--note", "1回目"], dir);
      assert.equal(first.code, 0, first.stdout + first.stderr);
      const second = tsx("record-verdict.ts", ["--ac", FIXTURE_AC, "--verdict", "fail", "--note", "2回目"], dir);
      assert.equal(second.code, 1, second.stdout + second.stderr);

      const spec = parse(readFileSync(p, "utf8")) as {
        acceptance: { id: string; status: string }[];
        open_questions: { from: string; status: string }[];
      };
      assert.equal(spec.acceptance.find((a) => a.id === FIXTURE_AC)?.status, "blocked");
      const oq = spec.open_questions.filter((q) => q.from === FIXTURE_AC && q.status === "open");
      assert.equal(oq.length, 1, JSON.stringify(spec.open_questions));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-055: srcDirsのファイルエントリは逆方向トレースでもUNTRACED_CHANGEとして検出される", () => {
    withProject((parent, proj) => {
      const git = (...args: string[]) =>
        execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: parent, stdio: "pipe" }).toString().trim();
      git("init", "-q");
      writeFileSync(join(proj, "install.mjs"), "export {};\n");
      git("add", "-A");
      git("commit", "-q", "-m", "base");
      const base = git("rev-parse", "HEAD");
      writeFileSync(join(proj, "install.mjs"), "export const changed = 1;\n");
      git("commit", "-q", "-am", "change");

      const r = tsx("trace-matrix.ts", ["--root", "proj", "--base", base, "--strict", "--json"], parent);
      const findings = findingsOf(r);
      assert.ok(
        findings.some((f) => f.code === "UNTRACED_CHANGE" && f.ref === "install.mjs" && f.level === "error"),
        r.stdout,
      );
      assert.ok(!findings.some((f) => f.code === "UNSCANNED_CHANGE" && f.ref === "install.mjs"), r.stdout);
      assert.equal(r.code, 1, r.stdout + r.stderr);
    }, ["install.mjs"]);
  });

  it("AC-056: scripts/配下の@assumptionタグが読まれ、AS-019〜AS-026・AS-033がASSUMPTION_UNANCHOREDにならない", () => {
    const r = tsx("trace-matrix.ts", ["--json"], repoRoot);
    const watched = new Set(["019", "020", "021", "022", "023", "024", "025", "026", "033"].map((n) => "AS-" + n));
    const bad = findingsOf(r).filter((f) => f.code === "ASSUMPTION_UNANCHORED" && watched.has(f.ref));
    assert.deepEqual(bad, []);
  });

  it("AC-058: 配布用設定はsrcDirs以外のキーでキット自身の設定と一致し、srcDirsは[src, tests]と一致する", () => {
    const own = JSON.parse(readFileSync(join(repoRoot, "conformance.config.json"), "utf8")) as Record<string, unknown>;
    const dist = JSON.parse(readFileSync(join(repoRoot, "templates", "conformance.config.json"), "utf8")) as Record<string, unknown>;
    const { srcDirs: _own, ...ownRest } = own;
    const { srcDirs: distSrc, ...distRest } = dist;
    assert.deepEqual(distRest, ownRest);
    assert.deepEqual(distSrc, ["src", "tests"]);
  });

  it("AC-059: 配布用設定が欠けたキットからのinstall.mjsはexit 2で何も作成しない", () => {
    const kit = tmpDir();
    const target = tmpDir();
    try {
      copyFileSync(join(repoRoot, "install.mjs"), join(kit, "install.mjs"));
      const r = exec(process.execPath, [join(kit, "install.mjs"), target], kit);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.ok(r.stderr.includes("templates/conformance.config.json が見つかりません"), r.stderr);
      assert.deepEqual(readdirSync(target), []);
    } finally {
      rmSync(kit, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("AC-060: install.mjsは導入先の既存conformance.config.jsonを上書きしない", () => {
    const target = tmpDir();
    try {
      const p = join(target, "conformance.config.json");
      const original = JSON.stringify({ srcDirs: ["app"] });
      writeFileSync(p, original);
      const r = exec(process.execPath, [join(repoRoot, "install.mjs"), target], repoRoot);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(readFileSync(p, "utf8"), original);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("AC-061: 重なるsrcDirsエントリでも同じファイルは1回だけ走査されDANGLING_ACが重複しない", () => {
    withProject((parent, proj) => {
      mkdirSync(join(proj, "scripts", "lib"), { recursive: true });
      writeFileSync(join(proj, "scripts", "lib", "x.ts"), `// refers to ${FIXTURE_DANGLING}\nexport {};\n`);
      const r = tsx("trace-matrix.ts", ["--root", "proj", "--json"], parent);
      const dangling = findingsOf(r).filter((f) => f.code === "DANGLING_AC");
      assert.equal(dangling.length, 1, r.stdout);
    }, ["scripts", "scripts/lib"]);
  });
});
