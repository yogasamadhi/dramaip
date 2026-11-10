// Prepares the Desktop development environment before the Electron shell
// starts: pinned toolchain, vendor submodules, DSH framework workspaces,
// workspace dependencies, agent runtimes and the Electron binary.
//
// The launcher is a pnpm script (`pnpm run dev`), not a separate executable,
// so every step below is reachable from `package.json` and testable in
// process. `--check` keeps the whole pass read-only.
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const studioRoot = join(desktopRoot, "apps", "desktop");
const installMarker = join(desktopRoot, "node_modules", ".modules.yaml");

export const REQUIRED_NODE_VERSION = "24.18.0";
export const REQUIRED_PNPM_VERSION = "11.28.5";

/** Vendor submodules the development environment needs. */
export function vendorSubmoduleSpecs() {
  return [
    {
      label: "DSH Cordis",
      path: "vendor/deepseek-harness",
      marker: "vendor/cordis/src/index.ts",
    },
    { label: "Pi", path: "vendor/pi", marker: "package-lock.json" },
  ];
}

/** Agent runtimes the Desktop shell starts on demand. */
export function runtimeSpecs() {
  return [
    {
      label: "Pi 1.5.0",
      entry: join(studioRoot, "build", "pi", "runtime-manifest.json"),
      buildScript: "build:pi",
      verifyScript: "verify:pi",
    },
  ];
}

/** Finds an executable on PATH the way the other launchers do. */
export function resolveExecutable(name) {
  const entries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((extension) => extension.toLowerCase())
      : [""];
  const suffixes =
    process.platform === "win32" &&
    !extensions.some((extension) => name.toLowerCase().endsWith(extension))
      ? ["", ...extensions]
      : [""];
  for (const entry of entries) {
    const directory = entry.replace(/^"|"$/gu, "");
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (process.platform !== "win32") accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return undefined;
}

export function assertNodeVersion(version) {
  if (version !== REQUIRED_NODE_VERSION)
    throw new Error(
      `Node 版本必须恰好为 ${REQUIRED_NODE_VERSION}，当前为 ${version || "非 Node 运行时"}`,
    );
  return version;
}

export function assertPnpmVersion(version) {
  if (version !== REQUIRED_PNPM_VERSION)
    throw new Error(
      `pnpm 版本必须恰好为 ${REQUIRED_PNPM_VERSION}，当前为 ${version || "未安装 pnpm"}`,
    );
  return version;
}

/** Parses the launcher options. */
export function parseOptions(arguments_) {
  const options = {
    check: false,
    rebuildRuntimes: false,
  };
  let index = 0;
  while (index < arguments_.length) {
    const argument = arguments_[index];
    // pnpm forwards its own argument separator; the launcher parses the
    // options itself.
    if (argument === "--") {
      index += 1;
      continue;
    }
    if (argument === "-h" || argument === "--help") return undefined;
    if (argument === "--check") options.check = true;
    else if (argument === "--rebuild-runtimes") options.rebuildRuntimes = true;
    else throw new Error(`未知参数：${argument}`);
    index += 1;
  }
  if (options.check && options.rebuildRuntimes)
    throw new Error("--check 是只读操作，不能与重建 Runtime 同时使用");
  return options;
}

export function helpText() {
  return `
DramaIP Studio 开发启动器

用法:
  pnpm run dev

选项:
  --rebuild-runtimes   强制重建所有当前平台支持的智能引擎 Runtime
  --check              只读检查启动环境，不修复、不构建、不启动
  -h, --help           显示帮助
`;
}

const info = (message) => console.log(`• ${message}`);
const ok = (message) => console.log(`✓ ${message}`);
const warn = (message) => console.error(`! ${message}`);

/** Runs a command in the foreground and fails the launcher when it fails. */
export function runCommand(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd ?? desktopRoot,
    env: options.environment ?? cleanEnvironment(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0)
    throw new Error(
      `命令执行失败（退出码 ${result.status}）：${command} ${arguments_.join(" ")}`,
    );
  return result.status ?? 0;
}

/** The launcher never lets Electron start in Node mode. */
export function cleanEnvironment(overrides) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return { ...environment, ...(overrides ?? {}) };
}

/** Verifies the pinned Node and pnpm versions. */
export function checkToolchain() {
  const node = resolveExecutable("node");
  if (!node) throw new Error("未找到 Node，请先安装 Node 24.18.0");
  const nodeProbe = spawnSync(node, ["--version"], { encoding: "utf8" });
  const nodeVersion = assertNodeVersion(
    nodeProbe.stdout?.trim().replace(/^v/u, "") || undefined,
  );
  ok(`node ${nodeVersion}`);
  const pnpm = resolveExecutable("pnpm");
  if (!pnpm)
    throw new Error(`未找到 pnpm，请先安装 pnpm ${REQUIRED_PNPM_VERSION}`);
  const probe = spawnSync(pnpm, ["--version"], {
    cwd: desktopRoot,
    encoding: "utf8",
  });
  const pnpmVersion = assertPnpmVersion(probe.stdout?.trim() || undefined);
  ok(`pnpm ${pnpmVersion}`);
  return { node, pnpm };
}

/** Initializes the vendor submodules the development environment needs. */
export function ensureVendorSubmodules(check) {
  const specs = vendorSubmoduleSpecs();
  const missing = specs.filter(
    (submodule) =>
      !existsSync(join(desktopRoot, submodule.path, submodule.marker)),
  );
  if (!missing.length) {
    ok("必要的 vendor 子模块已就绪");
    return;
  }
  const paths = missing.map((submodule) => submodule.path);
  if (check)
    throw new Error(
      `vendor 子模块未初始化：${paths.join(", ")}；请运行 pnpm run prepare:submodules`,
    );
  const git = resolveExecutable("git");
  if (!git)
    throw new Error(
      `未找到 Git，无法初始化 vendor 子模块：${paths.join(", ")}`,
    );
  info(
    `初始化 vendor 子模块：${missing.map((entry) => entry.label).join("、")}……`,
  );
  runCommand(git, ["submodule", "update", "--init", "--", ...paths], {
    cwd: desktopRoot,
  });
  const incomplete = missing.filter(
    (submodule) =>
      !existsSync(join(desktopRoot, submodule.path, submodule.marker)),
  );
  if (incomplete.length)
    throw new Error(
      `vendor 子模块初始化完成，但必要文件仍缺失：${incomplete
        .map((entry) => `${entry.path}/${entry.marker}`)
        .join(", ")}`,
    );
  ok("必要的 vendor 子模块已就绪");
}

/** Installs the workspace dependencies. */
export function ensureDependencies(pnpm, check) {
  if (check) {
    if (!existsSync(installMarker))
      throw new Error("dramaip 依赖未安装：请运行 pnpm install");
    ok("dramaip 依赖已安装");
    return;
  }
  info("安装 dramaip 依赖（pnpm install）……首次可能较慢。");
  runCommand(pnpm, ["install"]);
  if (!existsSync(installMarker))
    throw new Error("pnpm install 完成后仍未找到 node_modules/.modules.yaml");
  ok("dramaip 依赖就绪");
}

/** Builds the agent runtimes the Desktop shell starts on demand. */
export function ensureAgentRuntimes(pnpm, check, rebuildRuntimes) {
  for (const runtime of runtimeSpecs()) {
    if (check) {
      if (!existsSync(runtime.entry))
        throw new Error(`${runtime.label} Runtime 未就绪：${runtime.entry}`);
      ok(`${runtime.label} Runtime 就绪`);
      continue;
    }
    if (existsSync(runtime.entry) && !rebuildRuntimes) {
      ok(`${runtime.label} Runtime 已就绪`);
      continue;
    }
    info(`准备 ${runtime.label} Runtime……首次可能较慢。`);
    runCommand(pnpm, [
      "--filter",
      "@dramaip/desktop",
      "run",
      runtime.buildScript,
    ]);
    if (runtime.verifyScript)
      runCommand(pnpm, [
        "--filter",
        "@dramaip/desktop",
        "run",
        runtime.verifyScript,
      ]);
    if (!existsSync(runtime.entry))
      throw new Error(
        `${runtime.label} Runtime 构建完成，但入口不存在：${runtime.entry}`,
      );
    ok(`${runtime.label} Runtime 就绪`);
  }
}

/** Directory the installed Electron package lives in. */
export function electronPackageDirectory() {
  for (const candidate of [
    join(studioRoot, "node_modules", "electron"),
    join(desktopRoot, "node_modules", "electron"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  const store = join(desktopRoot, "node_modules", ".pnpm");
  if (!existsSync(store)) return undefined;
  for (const entry of readdirSync(store).sort()) {
    if (!entry.startsWith("electron@")) continue;
    const candidate = join(store, entry, "node_modules", "electron");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function electronExecutablePath() {
  if (process.platform === "darwin")
    return "Electron.app/Contents/MacOS/Electron";
  return process.platform === "win32" ? "electron.exe" : "electron";
}

function electronBinaryReady(directory) {
  const pathFile = join(directory, "path.txt");
  if (!existsSync(pathFile)) return false;
  const relative = readFileSync(pathFile, "utf8").trim();
  return Boolean(relative) && existsSync(join(directory, "dist", relative));
}

function electronMirror() {
  const npmrc = join(desktopRoot, ".npmrc");
  if (!existsSync(npmrc)) return undefined;
  for (const rawLine of readFileSync(npmrc, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("electron_mirror="))
      return line.slice("electron_mirror=".length).trim();
  }
  return undefined;
}

/** Makes sure the Electron binary is downloaded and ready. */
export function ensureElectron(node, check) {
  const directory = electronPackageDirectory();
  if (!directory) throw new Error("Electron 包未安装：请先运行 pnpm install");
  const manifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  const version = manifest.version;
  if (!version) throw new Error("Electron 包版本无法识别");
  if (electronBinaryReady(directory)) {
    ok(`electron 二进制就绪（v${version}）`);
    return directory;
  }
  if (check) throw new Error("Electron 二进制未就绪：请先运行 pnpm install");
  const installScript = join(directory, "install.js");
  if (!existsSync(installScript))
    throw new Error(`找不到 Electron 安装脚本：${installScript}`);
  const mirror = electronMirror();
  info("Electron 二进制缺失，正在运行 install.js……");
  runCommand(node, [installScript], {
    cwd: directory,
    environment: cleanEnvironment(
      mirror
        ? {
            ELECTRON_MIRROR: mirror,
            npm_config_electron_mirror: mirror,
          }
        : {},
    ),
  });
  if (!electronBinaryReady(directory))
    throw new Error("Electron install.js 执行完成，但二进制仍未就绪");
  ok(`electron 二进制就绪（v${version}）`);
  return directory;
}

/**
 * Prepares the development environment.
 * @param options - `{ check, rebuildRuntimes }` launcher options.
 */
export function prepareDevEnvironment(options = {}) {
  const check = options.check === true;
  if (!existsSync(studioRoot))
    throw new Error(`找不到 dramaip Studio 目录：${studioRoot}`);
  console.log("▶ dramaip 一键启动");
  const { node, pnpm } = checkToolchain();
  ensureVendorSubmodules(check);
  runCommand(node, [
    "scripts/prepare-dsh-framework.mjs",
    ...(check ? ["--check"] : []),
  ]);
  ensureDependencies(pnpm, check);
  if (!check) runCommand(pnpm, ["run", "build:framework"]);
  runCommand(node, ["scripts/check-dsh-framework.mjs"]);
  ensureAgentRuntimes(pnpm, check, options.rebuildRuntimes === true);
  ensureElectron(node, check);
  if (!check) runCommand(pnpm, ["run", "plugins:generate"]);
  if (check) ok("dramaip 启动环境检查通过");
  return { node, pnpm };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (!options) console.log(helpText());
    else prepareDevEnvironment(options);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
