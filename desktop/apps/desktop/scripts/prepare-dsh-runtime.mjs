import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PNPM_VERSION = "11.7.0";
const DEPLOY_ROOT_PACKAGE = "dsh-jsonrpc-agent-pkg";
const ENTRY_BIN =
  "node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js";
const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const repository = resolve(desktop, "../..");
const source = join(repository, "vendor/deepseek-harness");
const output = join(desktop, "build/dsh");
const mcpOutput = join(desktop, "build/dsh-mcp-staging");
const sourceNodeModules = join(source, "python/sdk-runtime/node_modules");

function run(label, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("corepack", ["pnpm", ...args], {
      cwd: source,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (value) => (stdout += value));
      child.stderr.on("data", (value) => (stderr += value));
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolvePromise(stdout.trim());
      reject(
        new Error(
          `${label}失败（退出码 ${code ?? "unknown"}）${stderr ? `：${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

async function findSymlink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return path;
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function restoreLegacyHoists() {
  const manifest = JSON.parse(
    await readFile(join(output, "package.json"), "utf8"),
  );
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(output, "node_modules", dependency);
    if (existsSync(destination)) continue;
    const dependencySource = join(sourceNodeModules, dependency);
    if (!existsSync(dependencySource))
      throw new Error(`DSH 部署闭包缺少依赖：${dependency}`);
    await mkdir(dirname(destination), { recursive: true });
    const nestedNodeModules = join(dependencySource, "node_modules");
    await cp(dependencySource, destination, {
      recursive: true,
      dereference: true,
      filter: (path) =>
        path !== nestedNodeModules &&
        !path.startsWith(`${nestedNodeModules}${sep}`),
    });
  }
}

async function materializeLinks() {
  const nodeModules = join(output, "node_modules");
  let link = await findSymlink(nodeModules);
  while (link) {
    const segments = link.slice(nodeModules.length + 1).split(sep);
    const binIndex = segments.lastIndexOf(".bin");
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), {
        recursive: true,
        force: true,
      });
    } else {
      const dependencySource = await realpath(link);
      const nestedNodeModules = join(dependencySource, "node_modules");
      await rm(link, { recursive: true, force: true });
      await cp(dependencySource, link, {
        recursive: true,
        dereference: true,
        filter: (path) =>
          path !== nestedNodeModules &&
          !path.startsWith(`${nestedNodeModules}${sep}`),
      });
    }
    link = await findSymlink(nodeModules);
  }
}

async function addDramaIpMcpClient() {
  await rm(mcpOutput, { recursive: true, force: true });
  await run("部署 DSH MCP Client", [
    "--filter",
    "@deepseek-ai/dsh-mcp-client",
    "deploy",
    "--legacy",
    "--prod",
    "--config.node-linker=hoisted",
    "--config.auto-install-peers=false",
    "--config.link-workspace-packages=true",
    "--config.allow-unused-patches=true",
    mcpOutput,
  ]);
  const destination = join(output, "node_modules/@deepseek-ai/dsh-mcp-client");
  const stagedNodeModules = join(mcpOutput, "node_modules");
  await mkdir(dirname(destination), { recursive: true });
  await cp(mcpOutput, destination, {
    recursive: true,
    dereference: true,
    filter: (path) =>
      path !== stagedNodeModules &&
      !path.startsWith(`${stagedNodeModules}${sep}`),
  });
  await mergeStagedDependencies(stagedNodeModules);
  await rm(mcpOutput, { recursive: true, force: true });
}

async function mergeStagedDependencies(stagedNodeModules) {
  const outputNodeModules = join(output, "node_modules");
  for (const entry of await readdir(stagedNodeModules, {
    withFileTypes: true,
  })) {
    if (entry.name === ".bin" || entry.name === ".pnpm") continue;
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scopedEntry of await readdir(
        join(stagedNodeModules, entry.name),
        { withFileTypes: true },
      )) {
        const dependency = `${entry.name}/${scopedEntry.name}`;
        const destination = join(outputNodeModules, dependency);
        if (existsSync(destination)) continue;
        await mkdir(dirname(destination), { recursive: true });
        await cp(join(stagedNodeModules, dependency), destination, {
          recursive: true,
          dereference: true,
        });
      }
      continue;
    }
    const destination = join(outputNodeModules, entry.name);
    if (existsSync(destination)) continue;
    await cp(join(stagedNodeModules, entry.name), destination, {
      recursive: true,
      dereference: true,
    });
  }
}

if (!existsSync(join(source, "pnpm-lock.yaml")))
  throw new Error("缺少 DSH pnpm-lock.yaml");
if (relative(desktop, output).startsWith("..") || output === desktop)
  throw new Error(`拒绝清理不安全的 DSH 输出目录：${output}`);

const actualPnpmVersion = await run("读取 pnpm 版本", ["--version"], {
  capture: true,
});
if (actualPnpmVersion !== PNPM_VERSION)
  throw new Error(
    `DSH 构建必须使用 pnpm ${PNPM_VERSION}，实际为 ${actualPnpmVersion}`,
  );

await run("安装 DSH 依赖", ["install", "--frozen-lockfile"]);
await run("构建 DSH Host Libraries", ["run", "build:lib:host"]);
await rm(output, { recursive: true, force: true });
await run("部署 DSH JSON-RPC Runtime", [
  "--filter",
  DEPLOY_ROOT_PACKAGE,
  "deploy",
  "--legacy",
  "--prod",
  "--config.node-linker=hoisted",
  "--config.auto-install-peers=false",
  "--config.link-workspace-packages=true",
  output,
]);
await restoreLegacyHoists();
await addDramaIpMcpClient();
await materializeLinks();
await Promise.all(
  ["README.md", "README.zh.md", "README.i18n.yaml"].map((name) =>
    rm(join(output, name), { force: true }),
  ),
);
if (!existsSync(join(output, ENTRY_BIN)))
  throw new Error("DSH JSON-RPC Runtime 入口未生成");

process.stdout.write(
  `已准备 DSH 0.1.0-rc.5 Runtime（pnpm ${PNPM_VERSION}，${output}）\n`,
);
