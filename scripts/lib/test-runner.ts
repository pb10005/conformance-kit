// @covers AC-099, AC-100, AC-101, AC-102, AC-103, AC-104
// gate.ts のテスト段の起動内容を決める。シェルも .cmd シムも経由せず、常に
// spawnSync(process.execPath, args) で起動できる引数列を返す（FEAT-003 の方針）。
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type TestRunnerConfig = { testRunner?: unknown; testScript?: unknown };

export class TestRunnerConfigError extends Error {}

// @assumption AS-048
export function resolveTestInvocation(
  root: string,
  cfg: TestRunnerConfig,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string[] {
  const runner = cfg.testRunner ?? "node-test";
  if (runner === "node-test") {
    const testFiles = readdirSync(join(root, "tests"))
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => join("tests", f));
    return ["--test", "--test-concurrency=1", "--experimental-strip-types", ...testFiles];
  }
  if (runner === "npm-script") {
    const script = cfg.testScript ?? "test";
    if (typeof script !== "string" || script.trim() === "") {
      throw new TestRunnerConfigError(`testScript が不正です: ${JSON.stringify(cfg.testScript)}`);
    }
    return [resolveNpmCli(env, execPath), "run", script];
  }
  throw new TestRunnerConfigError(
    `testRunner が不正です: ${JSON.stringify(runner)}（"node-test" または "npm-script" を指定）`,
  );
}

// @assumption AS-049
export function resolveNpmCli(env: NodeJS.ProcessEnv = process.env, execPath: string = process.execPath): string {
  const fromEnv = env.npm_execpath;
  // npm_execpath は npm 以外（pnpm/yarn）を指すこともある。npm-cli.js のときだけ使う
  if (fromEnv && /npm-cli\.[cm]?js$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const nodeDir = dirname(execPath);
  const candidates = [
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), // POSIX
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), // Windows
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new TestRunnerConfigError(`npm-cli.js が見つかりません（探した場所: ${candidates.join(", ")}）`);
}
