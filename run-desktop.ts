#!/usr/bin/env bun

/** DramaIP Studio（desktop）独立开发启动器。 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Dirent,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const REQUIRED_BUN_VERSION = "1.4.0" as const;

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = join(repositoryRoot, "desktop");
const studioDirectory = join(desktopDirectory, "apps", "desktop");
const installMarker = join(desktopDirectory, "node_modules", ".bun");
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

interface VendorSubmoduleSpec {
  readonly label: string;
  readonly path: string;
  readonly marker: string;
}

interface Toolchain {
  readonly bun: string;
}

function color(code: string, value: string): string {
  return process.stdout.isTTY ? `\u001B[${code}m${value}\u001B[0m` : value;
}

function info(message: string): void {
  process.stdout.write(`${color("36", "• ")}${message}\n`);
}

function ok(message: string): void {
  process.stdout.write(`${color("32", "✓ ")}${message}\n`);
}

function warn(message: string): void {
  process.stderr.write(`${color("33", "! ")}${message}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

function help(): void {
  process.stdout.write(`
DramaIP Studio 开发启动器

用法:
  bun run-desktop.ts [选项] [-- Electron/Vite 参数]

选项:
  --install           强制执行 bun install
  --rebuild-engines   强制重建所有当前平台支持的智能引擎 Runtime
  --check             只读检查启动环境，不修复、不构建、不启动
  -h, --help          显示帮助

示例:
  bun run-desktop.ts
  bun run-desktop.ts --rebuild-engines
  bun run-desktop.ts -- --host 127.0.0.1
`);
}

function parseOptions(arguments_: readonly string[]): Options | undefined {
  let check = false;
  let forceInstall = false;
  let rebuildEngines = false;
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
    fail("--check 是只读操作，不能与安装、重建、跳过检查或启动参数同时使用");
  }

  return {
    check,
    forceInstall,
    rebuildEngines,
    devArguments,
  };
}

export function assertBunVersion(version: string | undefined): string {
  if (version !== REQUIRED_BUN_VERSION) {
    fail(
      `Bun 版本必须恰好为 ${REQUIRED_BUN_VERSION}，当前为 ${version ?? "非 Bun 运行时"}`,
    );
  }
  return version;
}

function cleanEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

async function runCommand(
  command: string,
  arguments_: readonly string[],
  cwd = desktopDirectory,
  environment: NodeJS.ProcessEnv = cleanEnvironment(),
): Promise<void> {
  const child = spawn(command, [...arguments_], {
    cwd,
    env: environment,
    stdio: "inherit",
  });
  const result = await waitForChild(child);
  if (result.code !== 0) {
    const reason = result.signal
      ? `信号 ${result.signal}`
      : `退出码 ${result.code ?? 1}`;
    fail(`命令执行失败（${reason}）：${command} ${arguments_.join(" ")}`);
  }
}

function checkToolchain(): Toolchain {
  const bunVersion = assertBunVersion(process.versions.bun);
  ok(`bun ${bunVersion}`);
  return { bun: process.execPath };
}

export function vendorSubmoduleSpecs(): readonly VendorSubmoduleSpec[] {
  return [
    {
      label: "DSH Cordis",
      path: "vendor/deepseek-harness",
      marker: "vendor/cordis/src/index.ts",
    },
    {
      label: "Codex",
      path: "vendor/codex-rust",
      marker: "codex-rs/Cargo.toml",
    },
    {
      label: "Pi",
      path: "vendor/pi",
      marker: "package-lock.json",
    },
  ];
}

async function ensureVendorSubmodules(check: boolean): Promise<void> {
  const missing = vendorSubmoduleSpecs().filter(
    (submodule) =>
      !existsSync(join(repositoryRoot, submodule.path, submodule.marker)),
  );
  if (missing.length === 0) {
    ok("必要的 vendor 子模块已就绪");
    return;
  }

  const paths = missing.map((submodule) => submodule.path);
  if (check) {
    fail(
      `vendor 子模块未初始化：${paths.join(", ")}；请运行 bun run-desktop.ts 完成初始化`,
    );
  }

  const git = Bun.which("git");
  if (!git) {
    fail(`未找到 Git，无法初始化 vendor 子模块：${paths.join(", ")}`);
  }
  info(
    `初始化 vendor 子模块：${missing.map((submodule) => submodule.label).join("、")}……`,
  );
  await runCommand(
    git,
    ["submodule", "update", "--init", "--", ...paths],
    repositoryRoot,
  );

  const incomplete = missing.filter(
    (submodule) =>
      !existsSync(join(repositoryRoot, submodule.path, submodule.marker)),
  );
  if (incomplete.length > 0) {
    fail(
      `vendor 子模块初始化完成，但必要文件仍缺失：${incomplete.map((submodule) => join(submodule.path, submodule.marker)).join(", ")}`,
    );
  }
  ok("必要的 vendor 子模块已就绪");
}

async function ensureDependencies(
  bun: string,
  options: Options,
): Promise<void> {
  if (options.check) {
    if (!existsSync(installMarker)) {
      fail("desktop 依赖未安装：请运行 bun run-desktop.ts --install");
    }
    ok("desktop 依赖已安装");
    return;
  }
  info("安装 desktop 依赖（bun install）……首次可能较慢。");
  await runCommand(bun, ["install"]);
  if (!existsSync(installMarker)) {
    fail("bun install 完成后仍未找到 node_modules/.bun");
  }
  ok("desktop 依赖就绪");
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

export function runtimeSpecs(): readonly RuntimeSpec[] {
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  const runtimes: RuntimeSpec[] = [
    {
      label: "Codex 0.164.0",
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
      label: "Pi 1.4.0",
      entry: join(studioDirectory, "build", "pi", "runtime-manifest.json"),
      buildScript: "build:pi",
      verifyScript: "verify:pi",
    },
  ];
  return runtimes;
}

async function ensureAgentRuntimes(
  bun: string,
  options: Options,
): Promise<void> {
  for (const runtime of runtimeSpecs()) {
    if (options.check) {
      if (!existsSync(runtime.entry)) {
        fail(`${runtime.label} Runtime 未就绪：${runtime.entry}`);
      }
      ok(`${runtime.label} Runtime 就绪`);
      continue;
    }
    if (existsSync(runtime.entry) && !options.rebuildEngines) {
      ok(`${runtime.label} Runtime 已就绪`);
      continue;
    }
    info(`准备 ${runtime.label} Runtime……首次可能较慢。`);
    await runCommand(bun, [
      "run",
      "--filter",
      "@dramaip/desktop",
      runtime.buildScript,
    ]);
    if (runtime.verifyScript) {
      await runCommand(bun, [
        "run",
        "--filter",
        "@dramaip/desktop",
        runtime.verifyScript,
      ]);
    }
    if (!existsSync(runtime.entry)) {
      fail(`${runtime.label} Runtime 构建完成，但入口不存在：${runtime.entry}`);
    }
    ok(`${runtime.label} Runtime 就绪`);
  }
}

function readPackageVersion(packageFile: string): string | undefined {
  if (!existsSync(packageFile)) return undefined;
  try {
    const value = JSON.parse(readFileSync(packageFile, "utf8")) as {
      version?: unknown;
    };
    return typeof value.version === "string" ? value.version : undefined;
  } catch {
    return undefined;
  }
}

function electronPackageDirectory(): string | undefined {
  const workspacePackage = join(studioDirectory, "node_modules", "electron");
  if (existsSync(workspacePackage)) return workspacePackage;
  const store = join(desktopDirectory, "node_modules", ".bun");
  if (!existsSync(store)) return undefined;
  for (const entry of readdirSync(store).sort()) {
    if (!entry.startsWith("electron@")) continue;
    const candidate = join(store, entry, "node_modules", "electron");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function electronPlatform(): { platform: string; arch: string } {
  const platform =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "win32"
        : "linux";
  const arch = process.arch === "x64" ? "x64" : process.arch;
  return { platform, arch };
}

function electronExecutablePath(platform: string): string {
  if (platform === "darwin" || platform === "mas") {
    return "Electron.app/Contents/MacOS/Electron";
  }
  return platform === "win32" ? "electron.exe" : "electron";
}

function electronCacheDirectories(): string[] {
  const home = homedir();
  if (process.platform === "darwin") {
    return [join(home, "Library", "Caches", "electron")];
  }
  if (process.platform === "win32") {
    return [
      join(
        process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
        "electron",
        "Cache",
      ),
    ];
  }
  return [join(process.env.XDG_CACHE_HOME ?? join(home, ".cache"), "electron")];
}

function readElectronMirror(): string | undefined {
  const npmrc = join(desktopDirectory, ".npmrc");
  if (!existsSync(npmrc)) return undefined;
  for (const rawLine of readFileSync(npmrc, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith("electron_mirror=")) {
      return line.slice("electron_mirror=".length).trim();
    }
  }
  return undefined;
}

function electronBinaryReady(electronDirectory: string): boolean {
  const pathFile = join(electronDirectory, "path.txt");
  if (!existsSync(pathFile)) return false;
  const relativeBinary = readFileSync(pathFile, "utf8").trim();
  return (
    relativeBinary.length > 0 &&
    existsSync(join(electronDirectory, "dist", relativeBinary))
  );
}

function findCachedElectronZip(
  version: string,
  platform: string,
  arch: string,
): string | undefined {
  const filename = `electron-v${version}-${platform}-${arch}.zip`;
  for (const cacheDirectory of electronCacheDirectories()) {
    if (!existsSync(cacheDirectory)) continue;
    const flat = join(cacheDirectory, filename);
    if (existsSync(flat)) return flat;
    const directories = [cacheDirectory];
    while (directories.length > 0) {
      const directory = directories.pop();
      if (!directory) break;
      let entries: Dirent[];
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const candidate = join(directory, entry.name);
        if (entry.isFile() && entry.name === filename) return candidate;
        if (entry.isDirectory()) directories.push(candidate);
      }
    }
  }
  return undefined;
}

async function extractElectronZip(
  archive: string,
  destination: string,
  electronDirectory: string,
): Promise<void> {
  const packageFile = realpathSync(join(electronDirectory, "package.json"));
  const localRequire = createRequire(packageFile);
  const loaded = localRequire("@electron-internal/extract-zip") as {
    default?: unknown;
    extract?: unknown;
  };
  const extract = (loaded.default ?? loaded.extract) as
    ((zipPath: string, options: { dir: string }) => Promise<void>) | undefined;
  if (typeof extract !== "function") {
    fail("Electron 内置的 ZIP 解压器不可用");
  }
  await extract(archive, { dir: destination });
}

async function ensureElectron(bun: string, check: boolean): Promise<string> {
  const electronDirectory = electronPackageDirectory();
  if (!electronDirectory) {
    fail("Electron 包未安装：请运行 bun run-desktop.ts --install");
  }
  const version = readPackageVersion(join(electronDirectory, "package.json"));
  if (!version) fail("Electron 包版本无法识别");
  if (electronBinaryReady(electronDirectory)) {
    ok(`electron 二进制就绪（v${version}）`);
    return electronDirectory;
  }
  if (check) {
    fail("Electron 二进制未就绪：请运行 bun run-desktop.ts");
  }

  const { platform, arch } = electronPlatform();
  const cached = findCachedElectronZip(version, platform, arch);
  if (cached) {
    info(`Electron 二进制缺失，从缓存解压 ${cached}……`);
    const distribution = join(electronDirectory, "dist");
    mkdirSync(distribution, { recursive: true });
    try {
      await extractElectronZip(cached, distribution, electronDirectory);
      writeFileSync(
        join(electronDirectory, "path.txt"),
        electronExecutablePath(platform),
        "utf8",
      );
    } catch (error) {
      warn(
        `Electron 缓存解压失败：${(error as Error).message}；改用 install.js`,
      );
    }
    if (electronBinaryReady(electronDirectory)) {
      ok(`electron 二进制就绪（v${version}，来自缓存）`);
      return electronDirectory;
    }
    warn("Electron 缓存解压后校验未通过，改用 install.js");
  }

  const installScript = join(electronDirectory, "install.js");
  if (!existsSync(installScript)) {
    fail(`找不到 Electron 安装脚本：${installScript}`);
  }
  const mirror = readElectronMirror();
  const environment = cleanEnvironment(
    mirror
      ? {
          ELECTRON_MIRROR: mirror,
          npm_config_electron_mirror: mirror,
        }
      : {},
  );
  info("Electron 二进制缺失，正在运行 install.js……");
  await runCommand(bun, ["run", installScript], electronDirectory, environment);
  if (!electronBinaryReady(electronDirectory)) {
    fail("Electron install.js 执行完成，但二进制仍未就绪");
  }
  ok(`electron 二进制就绪（v${version}）`);
  return electronDirectory;
}

function processGroupExists(processId: number): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function stopDevelopmentProcess(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  warn("正在关闭 Electron 与开发服务器……");
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (!(await waitForExitWithTimeout(child, 8_000))) {
      warn("开发进程未及时退出，正在强制关闭……");
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
      });
    }
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH")
      child.kill("SIGTERM");
  }
  const deadline = Date.now() + 8_000;
  while (processGroupExists(child.pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (processGroupExists(child.pid)) {
    warn("开发进程未及时退出，正在强制关闭……");
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        child.kill("SIGKILL");
    }
  }
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
  info("启动 desktop 开发模式（Ctrl-C 关闭）……");
  const child = spawn(
    bun,
    [
      "run",
      "--filter",
      "@dramaip/desktop",
      "dev:raw",
      ...(devArguments.length > 0 ? ["--", ...devArguments] : []),
    ],
    {
      cwd: desktopDirectory,
      detached: true,
      env: cleanEnvironment(),
      stdio: "inherit",
    },
  );

  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const requestStop = (): void => {
    if (stopping) return;
    stopping = true;
    stopPromise = stopDevelopmentProcess(child);
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  const result = await waitForChild(child);
  process.off("SIGINT", requestStop);
  process.off("SIGTERM", requestStop);
  if (stopPromise) await stopPromise;

  if (stopping) {
    ok("已关闭 desktop");
    return 0;
  }
  if (result.code === 0) return 0;
  await stopDevelopmentProcess(child);
  const reason = result.signal
    ? `信号 ${result.signal}`
    : `退出码 ${result.code ?? 1}`;
  warn(`desktop dev 异常退出（${reason}）`);
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

async function waitForExitWithTimeout(
  child: ChildProcess,
  timeout: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    waitForChild(child).then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), timeout),
    ),
  ]);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) return;
  if (!existsSync(studioDirectory)) {
    fail(`找不到 desktop Studio 目录：${studioDirectory}`);
  }

  process.stdout.write(`${color("1;36", "▶ desktop 一键启动")}\n`);
  const toolchain = checkToolchain();
  await ensureVendorSubmodules(options.check);
  await runCommand(toolchain.bun, [
    "scripts/prepare-dsh-framework.mjs",
    ...(options.check ? ["--check"] : []),
  ]);
  await ensureDependencies(toolchain.bun, options);
  if (!options.check)
    await runCommand(toolchain.bun, ["run", "build:framework"]);
  await runCommand(toolchain.bun, ["scripts/check-dsh-framework.mjs"]);
  await ensureAgentRuntimes(toolchain.bun, options);
  await ensureElectron(toolchain.bun, options.check);
  if (!options.check) {
    await runCommand(toolchain.bun, ["run", "plugins:generate"]);
    await runCommand(toolchain.bun, ["run", "build:runtime"]);
  }

  if (options.check) {
    ok("desktop 启动环境检查通过");
    return;
  }
  process.exitCode = await runDevelopmentServer(
    toolchain.bun,
    options.devArguments,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${color("31", "✗ ")}${message}\n`);
    process.exitCode = 1;
  }
}
