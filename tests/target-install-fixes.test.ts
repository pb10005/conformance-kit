// @covers AC-081, AC-082, AC-083, AC-084, AC-085, AC-086, AC-087, AC-088, AC-089, AC-090, AC-091, AC-092, AC-093, AC-094, AC-095, AC-096, AC-097, AC-098
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { resolveTsxCli } from "../scripts/lib/tsx-cli.ts";

const repoRoot = process.cwd();
const installer = join(repoRoot, "install.mjs");

interface Result { code: number; stdout: string; stderr: string }
function exec(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Result {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: opts.cwd ?? repoRoot,
      env: opts.env ?? process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}
const install = (target: string, ...extra: string[]) => exec([installer, target, ...extra]);

function withTmp(fn: (...dirs: string[]) => void, count = 1): void {
  const dirs = Array.from({ length: count }, () => mkdtempSync(join(tmpdir(), "conformance-kit-target-")));
  try {
    fn(...dirs);
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
}

/** origin/HEAD を持つ（あるいは持たない）gitリポジトリを作る。ネットワークは使わない */
function gitRepo(dir: string, opts: { originHead?: string; branch?: string } = {}): void {
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  git("init", "-q");
  if (opts.branch) git("checkout", "-q", "-b", opts.branch);
  if (opts.originHead) git("symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${opts.originHead}`);
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as { baseRef?: string };
const readWorkflow = (target: string) =>
  parse(readFileSync(join(target, ".github", "workflows", "conformance.yml"), "utf8")) as {
    on: { push: { branches: string[] } };
    jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
  };
const traceStep = (target: string) => readWorkflow(target).jobs.gate.steps.find((s) => s.name === "traceability")!.run!;

function specLint(then: string): Result {
  const dir = mkdtempSync(join(tmpdir(), "conformance-kit-lint-"));
  try {
    mkdirSync(join(dir, "specs", "x"), { recursive: true });
    writeFileSync(
      join(dir, "specs", "x", "requirements.yaml"),
      [
        "id: FX-010",
        'title: "fixture"',
        "status: draft",
        "out_of_scope:",
        '  - "n/a"',
        "acceptance:",
        "  - id: AC-001",
        "    kind: functional",
        '    given: "不正な入力で"',
        '    when: "送信する"',
        `    then: ${JSON.stringify(then)}`,
        "    priority: must",
        "    verify: test",
        "",
      ].join("\n"),
    );
    return exec([resolveTsxCli(), join(repoRoot, "scripts", "spec-lint.ts"), "specs/x", "--gate", "freeze", "--json"], { cwd: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const ambiguousTou = (r: Result) =>
  (JSON.parse(r.stdout) as { findings: { code: string; level: string; message: string }[] }).findings.filter(
    (f) => f.code === "AMBIGUOUS_TERM" && f.message.includes("「等」"),
  );

describe("導入先への配布物 (FEAT-010)", () => {
  it("AC-081: キット専用のtrend-watch.mdとrecord-trend.tsは導入先に作成されない", () => {
    withTmp((t) => {
      assert.equal(install(t).code, 0);
      assert.ok(!existsSync(join(t, ".claude", "commands", "trend-watch.md")));
      assert.ok(!existsSync(join(t, "scripts", "record-trend.ts")));
    });
  });

  it("AC-082: 利用者向けのコマンドとscriptsは導入先に作成される", () => {
    withTmp((t) => {
      assert.equal(install(t).code, 0);
      for (const f of ["spec.md", "freeze.md", "verify.md", "reconcile.md"]) assert.ok(existsSync(join(t, ".claude", "commands", f)), f);
      for (const f of ["spec-init.ts", "spec-lint.ts", "trace-matrix.ts", "record-verdict.ts", "record-decision.ts", "gate.ts"]) {
        assert.ok(existsSync(join(t, "scripts", f)), f);
      }
      for (const f of readdirSync(join(repoRoot, "scripts", "lib"))) assert.ok(existsSync(join(t, "scripts", "lib", f)), f);
    });
  });

  it("AC-083: 配置されるCI定義のjobsはgateだけ", () => {
    withTmp((t) => {
      assert.equal(install(t).code, 0);
      assert.deepEqual(Object.keys(readWorkflow(t).jobs), ["gate"]);
    });
  });

  it("AC-084: origin/HEADがmainならCI定義とbaseRefがmainになる", () => {
    withTmp((t) => {
      gitRepo(t, { originHead: "main" });
      const r = install(t);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(readWorkflow(t).on.push.branches, ["main"]);
      assert.ok(traceStep(t).includes("github.base_ref || 'main'"), traceStep(t));
      assert.equal(readJson(join(t, "conformance.config.json")).baseRef, "origin/main");
      assert.ok(r.stdout.split("\n").includes("default branch: main (origin/HEAD)"), r.stdout);
    });
  });

  it("AC-085: gitリポジトリでなければmainにフォールバックしgitのエラーを出さない", () => {
    withTmp((t) => {
      const r = install(t);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(readJson(join(t, "conformance.config.json")).baseRef, "origin/main");
      assert.ok(r.stdout.split("\n").includes("default branch: main (fallback)"), r.stdout);
      assert.ok(!r.stderr.includes("fatal:"), r.stderr);
    });
  });

  it("AC-086: --default-branchはorigin/HEADより優先される", () => {
    withTmp((t) => {
      gitRepo(t, { originHead: "main" });
      const r = install(t, "--default-branch", "trunk");
      assert.equal(r.code, 0, r.stderr);
      assert.equal(readJson(join(t, "conformance.config.json")).baseRef, "origin/trunk");
      assert.deepEqual(readWorkflow(t).on.push.branches, ["trunk"]);
      assert.ok(r.stdout.split("\n").includes("default branch: trunk (--default-branch)"), r.stdout);
    });
  });

  it("AC-087: --with-samplesでもサンプルは作成されtrend-watch.mdは作成されない", () => {
    withTmp((t) => {
      assert.equal(install(t, "--with-samples").code, 0);
      for (const f of ["specs/example-login/requirements.yaml", "src/auth.ts", "src/rogue.ts", "tests/auth.test.ts"]) {
        assert.ok(existsSync(join(t, f)), f);
      }
      assert.ok(!existsSync(join(t, ".claude", "commands", "trend-watch.md")));
    });
  });

  it("AC-088: 熟語の一部の「等」はAMBIGUOUS_TERMにならない", () => {
    const words = ["冪等", "べき等", "同等", "対等", "平等", "均等", "劣等", "優等", "何等", "等しい", "等価", "等号", "等分", "等級", "等式", "等辺"];
    const r = specLint(`${words.join("・")}の結果を返す`);
    assert.deepEqual(ambiguousTou(r), [], r.stdout);
  });

  it("AC-089: 名詞の後ろの「等」は引き続きerrorで検出されexit 1を返す", () => {
    const r = specLint("画面等に表示する");
    const hit = ambiguousTou(r);
    assert.equal(hit.length, 1, r.stdout);
    assert.equal(hit[0].level, "error");
    assert.equal(r.code, 1);
  });

  it("AC-090: 除外される「等」と除外されない「等」が同じ文にあれば後者を検出する", () => {
    const r = specLint("冪等に処理し、画面等に表示する");
    const hit = ambiguousTou(r);
    assert.equal(hit.length, 1, r.stdout);
    assert.equal(hit[0].level, "error");
    assert.equal(r.code, 1);
  });

  it("AC-091: origin/HEADが無ければ作業ブランチではなくmainを使う", () => {
    withTmp((t) => {
      gitRepo(t, { branch: "feature/x" });
      const r = install(t);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(readJson(join(t, "conformance.config.json")).baseRef, "origin/main");
      const lines = r.stdout.split("\n").map((l) => l.trim());
      assert.ok(lines.includes("default branch: main (fallback)"), r.stdout);
      assert.ok(lines.includes("--default-branch で指定できます"), r.stdout);
    });
  });

  it("AC-092: --with-samplesと--default-branchは順不同で効く", () => {
    withTmp((t1, t2) => {
      assert.equal(install(t1, "--with-samples", "--default-branch", "trunk").code, 0);
      assert.equal(install(t2, "--default-branch", "trunk", "--with-samples").code, 0);
      for (const t of [t1, t2]) {
        assert.ok(existsSync(join(t, "specs", "example-login", "requirements.yaml")), t);
        assert.equal(readJson(join(t, "conformance.config.json")).baseRef, "origin/trunk");
      }
    }, 2);
  });

  it("AC-093: --default-branchの値が無い・不正ならexit 2で何も作成しない", () => {
    for (const extra of [["--default-branch"], ["--default-branch", "a'b"]]) {
      withTmp((t) => {
        const r = install(t, ...extra);
        assert.equal(r.code, 2, JSON.stringify(extra));
        assert.ok(r.stderr.includes("ブランチ名が不正"), r.stderr);
        assert.deepEqual(readdirSync(t), []);
      });
    }
  });

  it("AC-094: templates/conformance.ymlが欠けたキットからはexit 2で何も作成しない", () => {
    withTmp((kit, t) => {
      mkdirSync(join(kit, "templates"));
      copyFileSync(installer, join(kit, "install.mjs"));
      copyFileSync(join(repoRoot, "templates", "conformance.config.json"), join(kit, "templates", "conformance.config.json"));
      const r = exec([join(kit, "install.mjs"), t], { cwd: kit });
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.ok(r.stderr.includes("templates/conformance.yml が見つかりません"), r.stderr);
      assert.deepEqual(readdirSync(t), []);
    }, 2);
  });

  it("AC-095: PATHにgitが無くてもmainで導入を完了する", () => {
    withTmp((t) => {
      const r = exec([installer, t], { env: { ...process.env, PATH: "" } });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(readJson(join(t, "conformance.config.json")).baseRef, "origin/main");
    });
  });

  it("AC-096: 既存設定のbaseRefが既定ブランチと違えば書き換えずに警告する", () => {
    withTmp((t) => {
      gitRepo(t, { originHead: "main" });
      const p = join(t, "conformance.config.json");
      const original = JSON.stringify({ baseRef: "origin/master" });
      writeFileSync(p, original);
      const r = install(t);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(readFileSync(p, "utf8"), original);
      assert.ok(r.stdout.includes("既存の conformance.config.json の baseRef (origin/master) は既定ブランチ main と異なります"), r.stdout);
    });
  });

  it("AC-097: 配置したファイルにプレースホルダが残らない", () => {
    withTmp((t) => {
      assert.equal(install(t).code, 0);
      for (const f of [join(".github", "workflows", "conformance.yml"), "conformance.config.json"]) {
        assert.ok(!readFileSync(join(t, f), "utf8").includes("__DEFAULT_BRANCH__"), f);
      }
    });
  });

  it("AC-098: 配布用CI定義のgateジョブはキット自身のgateジョブと一致する", () => {
    const tpl = parse(readFileSync(join(repoRoot, "templates", "conformance.yml"), "utf8").replaceAll("__DEFAULT_BRANCH__", "master")) as {
      jobs: Record<string, unknown>;
    };
    const own = parse(readFileSync(join(repoRoot, ".github", "workflows", "conformance.yml"), "utf8")) as { jobs: Record<string, unknown> };
    assert.deepEqual(tpl.jobs.gate, own.jobs.gate);
  });
});
