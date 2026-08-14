import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  lstat,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PNPM_VERSION = "11.2.2";
const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const repository = resolve(desktop, "../..");
const source = join(repository, "vendor/openclaw");
const output = join(desktop, "build/openclaw");

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

async function runtimeTree(directory) {
  const files = [];
  async function collect(relativePath = "") {
    for (const entry of await readdir(join(directory, relativePath), {
      withFileTypes: true,
    })) {
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (path === "runtime-manifest.json") continue;
      if (entry.isDirectory()) await collect(path);
      else files.push(path);
    }
  }
  await collect();
  files.sort();
  const hash = createHash("sha256");
  for (const path of files) {
    const content = await readFile(join(directory, path));
    hash.update(
      `${path}\0${createHash("sha256").update(content).digest("hex")}\n`,
    );
  }
  return { fileCount: files.length, treeSha256: hash.digest("hex") };
}

if (!existsSync(join(source, "pnpm-lock.yaml")))
  throw new Error("缺少 OpenClaw pnpm-lock.yaml");
if (relative(desktop, output).startsWith("..") || output === desktop)
  throw new Error(`拒绝清理不安全的 OpenClaw 输出目录：${output}`);
const actualPnpmVersion = await run("读取 pnpm 版本", ["--version"], {
  capture: true,
});
if (actualPnpmVersion !== PNPM_VERSION)
  throw new Error(
    `OpenClaw 构建必须使用 pnpm ${PNPM_VERSION}，实际为 ${actualPnpmVersion}`,
  );

await run("安装 OpenClaw 依赖", ["install", "--frozen-lockfile"]);
await run("构建 OpenClaw Gateway", ["run", "build"]);
await rm(output, { recursive: true, force: true });
await run("部署 OpenClaw 生产闭包", [
  "--filter",
  "openclaw",
  "deploy",
  "--legacy",
  "--prod",
  "--config.node-linker=hoisted",
  "--config.auto-install-peers=false",
  "--config.link-workspace-packages=true",
  "--config.allow-unused-patches=true",
  output,
]);
await materializeLinks();
for (const name of ["README.md", "CHANGELOG.md"])
  await rm(join(output, name), { force: true });
if (
  !existsSync(join(output, "openclaw.mjs")) ||
  !existsSync(join(output, "dist")) ||
  !existsSync(join(output, "node_modules"))
)
  throw new Error("OpenClaw Gateway 生产运行闭包不完整");

const tree = await runtimeTree(output);
await writeFile(
  join(output, "runtime-manifest.json"),
  `${JSON.stringify(
    {
      engine: "openclaw",
      version: "2026.7.1",
      pnpmVersion: PNPM_VERSION,
      nodeVersion: "24.18.0",
      platform: process.platform,
      arch: process.arch,
      entry: "openclaw.mjs",
      ...tree,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(
  `已准备 OpenClaw 2026.7.1 Gateway（pnpm ${PNPM_VERSION}，${output}）\n`,
);
