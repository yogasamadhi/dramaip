import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UV_VERSION = "0.9.28";
const PYTHON_VERSION = "3.11.15";
const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const repository = resolve(desktop, "../..");
const source = join(repository, "vendor/hermes-agent");
const adapter = join(desktop, "hermes-adapter/dramaip_hermes_acp.py");
const engineLockPath = join(repository, "vendor/hermes-agent.lock.json");
const output = join(desktop, "build/hermes");
const pythonStaging = join(desktop, "build/hermes-python-staging");
const uv = process.env.DRAMAIP_UV_BINARY || "uv";

function runCommand(command, label, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? source,
      env: { ...process.env, UV_NO_PROGRESS: "1" },
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

function runUv(label, args, options = {}) {
  return runCommand(uv, label, args, options);
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

if (
  !existsSync(join(source, "uv.lock")) ||
  !existsSync(adapter) ||
  !existsSync(engineLockPath)
)
  throw new Error("Hermes 冻结锁或 DramaIP ACP 适配器缺失");
if (relative(desktop, output).startsWith("..") || output === desktop)
  throw new Error(`拒绝清理不安全的 Hermes 输出目录：${output}`);

const versionOutput = await runUv("读取 uv 版本", ["--version"], {
  capture: true,
});
const actualUvVersion = versionOutput.replace(/^uv\s+/, "").split(/\s+/)[0];
if (actualUvVersion !== UV_VERSION)
  throw new Error(
    `Hermes 构建必须使用 uv ${UV_VERSION}，实际为 ${actualUvVersion}；可通过 DRAMAIP_UV_BINARY 指向锁定二进制`,
  );

await rm(output, { recursive: true, force: true });
await rm(pythonStaging, { recursive: true, force: true });
await mkdir(output, { recursive: true, mode: 0o755 });
await mkdir(pythonStaging, { recursive: true, mode: 0o755 });
const engineLock = JSON.parse(await readFile(engineLockPath, "utf8"));
const platformKey = `${process.platform}-${process.arch}`;
const pythonArtifact = engineLock.pythonArtifacts?.[platformKey];
if (!pythonArtifact)
  throw new Error(`Hermes 锁定文件不支持当前平台：${platformKey}`);
const pythonArchive = join(pythonStaging, "python.tar.gz");
const cachedArchive = process.env.DRAMAIP_HERMES_PYTHON_ARCHIVE;
if (cachedArchive) {
  if (!existsSync(cachedArchive))
    throw new Error("DRAMAIP_HERMES_PYTHON_ARCHIVE 指向的文件不存在");
  await cp(cachedArchive, pythonArchive);
} else {
  await runCommand("curl", "下载锁定 CPython", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--output",
    pythonArchive,
    pythonArtifact.url,
  ]);
}
const archive = await readFile(pythonArchive);
const archiveHash = createHash("sha256").update(archive).digest("hex");
if (archiveHash !== pythonArtifact.sha256)
  throw new Error("Hermes CPython 3.11.15 归档校验失败");
await runCommand("tar", "解压锁定 CPython", [
  "-xzf",
  pythonArchive,
  "-C",
  output,
]);
await rm(pythonStaging, { recursive: true, force: true });

const requirements = join(output, "requirements.lock.txt");
await runUv(
  "导出 Hermes 冻结依赖",
  [
    "export",
    "--frozen",
    "--no-dev",
    "--extra",
    "acp",
    "--extra",
    "mcp",
    "--extra",
    "anthropic",
    "--no-emit-project",
    "--output-file",
    requirements,
  ],
  { capture: true },
);
const pythonPath =
  process.platform === "win32"
    ? join(output, "python/python.exe")
    : join(output, "python/bin/python3");
await runUv(
  "安装 Hermes 生产依赖闭包",
  [
    "pip",
    "install",
    "--python",
    pythonPath,
    "--target",
    join(output, "site-packages"),
    "--requirements",
    requirements,
    "--require-hashes",
    "--link-mode",
    "copy",
    "--compile-bytecode",
  ],
  { cwd: output },
);

const project = join(output, "project");
await mkdir(project, { recursive: true });
const projectDirectories = [
  "acp_adapter",
  "agent",
  "assets",
  "cron",
  "gateway",
  "hermes_cli",
  "locales",
  "plugins",
  "providers",
  "tools",
  "tui_gateway",
];
for (const name of projectDirectories)
  await cp(join(source, name), join(project, name), {
    recursive: true,
    filter: (path) =>
      !path.includes("__pycache__") &&
      !path.endsWith(".pyc") &&
      !path.includes("/tests/"),
  });
for (const entry of await readdir(source, { withFileTypes: true }))
  if (entry.isFile() && entry.name.endsWith(".py"))
    await cp(join(source, entry.name), join(project, entry.name));

await mkdir(join(output, "adapter"), { recursive: true });
await cp(adapter, join(output, "adapter/dramaip_hermes_acp.py"));
const tree = await runtimeTree(output);
await writeFile(
  join(output, "runtime-manifest.json"),
  `${JSON.stringify(
    {
      engine: "hermes",
      version: "0.20.1",
      uvVersion: UV_VERSION,
      pythonVersion: PYTHON_VERSION,
      pythonStandaloneRelease: engineLock.pythonStandaloneRelease,
      pythonArchiveSha256: pythonArtifact.sha256,
      platform: process.platform,
      arch: process.arch,
      entries: {
        python: relative(output, pythonPath).replaceAll("\\", "/"),
        adapter: "adapter/dramaip_hermes_acp.py",
        project: "project",
        sitePackages: "site-packages",
      },
      ...tree,
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `已准备 Hermes 0.20.1 Runtime（uv ${UV_VERSION}，CPython ${PYTHON_VERSION}，${output}）\n`,
);
