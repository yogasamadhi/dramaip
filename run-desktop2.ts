#!/usr/bin/env bun

/** DramaIP Studio Next（desktop2）根启动器。 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_BUN = "1.3.14";
const MINIMUM_NODE = [22, 12, 0] as const;

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = join(repositoryRoot, "desktop2");
const studioDirectory = join(desktopDirectory, "apps", "studio");
const installMarker = join(desktopDirectory, "node_modules", ".bun");
const electronDirectory = join(studioDirectory, "node_modules", "electron");

interface Options {
  readonly check: boolean;
  readonly forceInstall: boolean;
  readonly rebuildEngines: boolean;
  readonly devArguments: readonly string[];
}

interface RuntimeSpec {
  readonly label: string;
  readonly entry: string;
  readonly buildScript: string;
  readonly verifyScript?: string;
}

function color(code: string, value: string): string {
  return process.stdout.isTTY ? `\u001B[${code}m${value}\u001B[0m` : value;
}

function info(message: string): void {
  process.stdout.write(`${color("36", "→")} ${message}\n`);
}

function ok(message: string): void {
  process.stdout.write(`${color("32", "✓")} ${message}\n`);
}

function warn(message: string): void {
  process.stderr.write(`${color("33", "!")} ${message}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

function help(): void {
  process.stdout.write(`
DramaIP Studio Next 开发启动器

用法:
  bun run run-desktop2.ts [选项] [-- Electron/Vite 参数]

选项:
  --install           强制执行 bun install
  --rebuild-engines   强制重建 OpenCode、Codex、DSH 和 Pi Runtime
  --check             只读检查启动环境，不安装、不构建、不启动
  -h, --help          显示帮助

示例:
  bun run run-desktop2.ts
  bun run run-desktop2.ts --rebuild-engines
  bun run run-desktop2.ts -- --host 127.0.0.1
`);
}

function parseOptions(arguments_: readonly string[]): Options | undefined {
  let forceInstall = false;
  let rebuildEngines = false;
  let check = false;
  const devArguments: string[] = [];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") {
      devArguments.push(...arguments_.slice(index + 1));
      break;
    }
    if (argument === "--install") forceInstall = true;
    else if (argument === "--rebuild-engines") rebuildEngines = true;
    else if (argument === "--check") check = true;
    else if (argument === "-h" || argument === "--help") {
      help();
      return undefined;
    } else {
      fail(`未知参数：${argument}（Electron/Vite 参数请放在 -- 之后）`);
    }
  }

  if (check && (forceInstall || rebuildEngines || devArguments.length > 0)) {
    fail(
      "--check 是只读操作，不能与 --install、--rebuild-engines 或启动参数同时使用",
    );
  }

  return { check, forceInstall, rebuildEngines, devArguments };
}

function parseVersion(value: string): readonly [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(value.trim());
  if (!match) fail(`无法解析版本号：${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(
  actual: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

async function runCommand(
  command: string,
  arguments_: readonly string[],
  cwd: string,
): Promise<void> {
  const child = spawn(command, [...arguments_], {
    cwd,
    env: cleanEnvironment(),
    stdio: "inherit",
  });
  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0) {
    const reason = result.signal
      ? `信号 ${result.signal}`
      : `退出码 ${result.code ?? 1}`;
    fail(`命令执行失败（${reason}）：${command} ${arguments_.join(" ")}`);
  }
}

function targetTriple(): string {
  const arm = process.arch === "arm64";
  if (process.platform === "darwin") {
    return arm ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "win32") {
    return arm ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "linux") {
    return arm ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  }
  fail(`不支持的平台：${process.platform}/${process.arch}`);
}

function runtimeSpecs(): readonly RuntimeSpec[] {
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  return [
    {
      label: "OpenCode 1.18.15",
      entry: join(studioDirectory, "build", "opencode", "node.js"),
      buildScript: "build:opencode",
    },
    {
      label: "Codex 0.147.0",
      entry: join(
        studioDirectory,
        "build",
        "codex",
        targetTriple(),
        executable,
      ),
      buildScript: "build:codex",
    },
    {
      label: "DeepSeek Harness 0.1.0-rc.5",
      entry: join(
        studioDirectory,
        "build",
        "dsh",
        "node_modules",
        "@deepseek-ai",
        "dsh-sdk-jsonrpc-demo",
        "lib",
        "packaged-bin.js",
      ),
      buildScript: "build:dsh",
      verifyScript: "verify:dsh",
    },
    {
      label: "Pi 0.84.2",
      entry: join(studioDirectory, "build", "pi", "runtime-manifest.json"),
      buildScript: "build:pi",
      verifyScript: "verify:pi",
    },
  ];
}

function checkToolchain(): string {
  const bunVersion = process.versions.bun;
  if (bunVersion !== REQUIRED_BUN) {
    fail(
      `Bun 版本必须为 ${REQUIRED_BUN}，当前为 ${bunVersion ?? "非 Bun 运行时"}`,
    );
  }
  ok(`Bun ${bunVersion}`);

  const node = Bun.which("node");
  if (!node) fail("未找到 Node.js");
  const result = spawnSync(node, ["--version"], { encoding: "utf8" });
  if (result.status !== 0)
    fail(`Node.js 版本检查失败：${result.stderr || result.error?.message}`);
  const versionText = result.stdout.trim();
  if (!versionAtLeast(parseVersion(versionText), MINIMUM_NODE)) {
    fail(
      `Node.js 版本必须 >= ${MINIMUM_NODE.join(".")}，当前为 ${versionText}`,
    );
  }
  ok(`Node.js ${versionText.replace(/^v/u, "")}`);
  return process.execPath;
}

async function ensureDependencies(
  bun: string,
  options: Options,
): Promise<void> {
  if (options.check) {
    if (!existsSync(installMarker))
      fail("desktop2 依赖未安装：请运行 bun run run-desktop2.ts --install");
    ok("desktop2 依赖已安装");
    return;
  }
  if (!options.forceInstall && existsSync(installMarker)) {
    ok("依赖已安装，跳过 bun install");
    return;
  }
  info("安装 desktop2 依赖（bun install）……");
  await runCommand(bun, ["install"], desktopDirectory);
  if (!existsSync(installMarker))
    fail("bun install 完成后仍未找到 node_modules/.bun");
  ok("desktop2 依赖就绪");
}

function electronBinaryReady(): boolean {
  const pathFile = join(electronDirectory, "path.txt");
  if (!existsSync(pathFile)) return false;
  const relativeBinary = readFileSync(pathFile, "utf8").trim();
  return (
    relativeBinary.length > 0 &&
    existsSync(join(electronDirectory, "dist", relativeBinary))
  );
}

async function ensureElectron(bun: string, check: boolean): Promise<void> {
  if (electronBinaryReady()) {
    ok("Electron 43.2.0 二进制就绪");
    return;
  }
  if (check) fail("Electron 二进制未就绪：请运行 bun run run-desktop2.ts");

  const installScript = join(electronDirectory, "install.js");
  if (!existsSync(installScript)) {
    fail(`找不到 Electron 安装脚本：${installScript}，请尝试 --install`);
  }
  info("Electron 二进制缺失，正在运行 install.js……");
  await runCommand(bun, ["run", installScript], electronDirectory);
  if (!electronBinaryReady())
    fail("Electron install.js 执行完成，但二进制仍未就绪");
  ok("Electron 43.2.0 二进制就绪");
}

async function ensureAgentRuntimes(
  bun: string,
  options: Options,
): Promise<void> {
  for (const runtime of runtimeSpecs()) {
    if (options.check) {
      if (!existsSync(runtime.entry))
        fail(`${runtime.label} Runtime 未就绪：${runtime.entry}`);
      ok(`${runtime.label} Runtime 就绪`);
      continue;
    }
    if (existsSync(runtime.entry) && !options.rebuildEngines) {
      ok(`${runtime.label} Runtime 已存在，跳过构建`);
      continue;
    }
    info(`准备 ${runtime.label} Runtime……`);
    await runCommand(bun, ["run", runtime.buildScript], studioDirectory);
    if (runtime.verifyScript) {
      await runCommand(bun, ["run", runtime.verifyScript], studioDirectory);
    }
    if (!existsSync(runtime.entry))
      fail(`${runtime.label} 构建完成，但运行入口不存在：${runtime.entry}`);
    ok(`${runtime.label} Runtime 就绪`);
  }
  ok("LangGraph 0.2.43 由 desktop2 依赖图提供");
}

async function runDevelopmentServer(
  bun: string,
  devArguments: readonly string[],
): Promise<number> {
  if ("ELECTRON_RUN_AS_NODE" in process.env) {
    warn(
      "已从子进程环境中移除 ELECTRON_RUN_AS_NODE，避免 Electron 以 Node 模式启动",
    );
  }
  info("启动 desktop2 开发模式（Ctrl-C 关闭）……");

  const detached = process.platform !== "win32";
  const child = spawn(
    bun,
    ["run", "dev", ...(devArguments.length > 0 ? ["--", ...devArguments] : [])],
    {
      cwd: desktopDirectory,
      detached,
      env: cleanEnvironment(),
      stdio: "inherit",
    },
  );

  let stopping = false;
  let forceTimer: NodeJS.Timeout | undefined;

  const signalChild = (signal: NodeJS.Signals): void => {
    if (!child.pid) return;
    try {
      if (detached) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH")
        warn(`关闭 desktop2 进程时发生错误：${(error as Error).message}`);
    }
  };

  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    warn("正在关闭 Electron 与开发服务器……");
    signalChild("SIGTERM");
    forceTimer = setTimeout(() => {
      warn("开发进程未及时退出，正在强制关闭……");
      signalChild("SIGKILL");
    }, 8_000);
  };

  const onInterrupt = (): void => stop();
  const onTerminate = (): void => stop();
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);

  const result = await waitForChild(child);
  if (forceTimer) clearTimeout(forceTimer);
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);

  if (stopping) {
    ok("已关闭 desktop2");
    return 0;
  }
  if (result.code === 0) return 0;
  const reason = result.signal
    ? `信号 ${result.signal}`
    : `退出码 ${result.code ?? 1}`;
  warn(`desktop2 dev 异常退出（${reason}）`);
  return result.code ?? 1;
}

function waitForChild(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) return;
  if (!existsSync(studioDirectory))
    fail(`找不到 desktop2 Studio 目录：${studioDirectory}`);

  process.stdout.write(`${color("1;36", "▶ desktop2 一键启动")}\n`);
  const bun = checkToolchain();
  await ensureDependencies(bun, options);
  await ensureElectron(bun, options.check);
  await ensureAgentRuntimes(bun, options);

  if (options.check) {
    ok("desktop2 启动环境检查通过");
    return;
  }
  process.exitCode = await runDevelopmentServer(bun, options.devArguments);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${color("31", "✗")} ${message}\n`);
  process.exitCode = 1;
}
