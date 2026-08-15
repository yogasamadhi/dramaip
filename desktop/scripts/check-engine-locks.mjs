import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const codex = await readJson(join(root, "vendor/codex.lock.json"));
const protocol = await readJson(join(root, "vendor/codex.protocol.lock.json"));
const opencode = await readJson(join(root, "vendor/opencode.lock.json"));
const dsh = await readJson(join(root, "vendor/deepseek-harness.lock.json"));
const hermes = await readJson(join(root, "vendor/hermes-agent.lock.json"));

if (codex.package !== "@openai/codex" || codex.version !== "0.147.0")
  throw new Error("Codex 固定版本必须为 @openai/codex 0.147.0");
if (protocol.package !== codex.package || protocol.version !== codex.version)
  throw new Error("Codex 协议快照与二进制固定版本不一致");
const requiredTriples = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "aarch64-unknown-linux-musl",
  "x86_64-unknown-linux-musl",
  "aarch64-pc-windows-msvc",
  "x86_64-pc-windows-msvc",
];
for (const triple of requiredTriples) {
  const target = codex.platforms?.[triple];
  if (!target) throw new Error(`Codex 锁定文件缺少平台：${triple}`);
  if (!/^sha512-/.test(target.integrity ?? ""))
    throw new Error(`Codex ${triple} 缺少 npm 完整性校验`);
  if (!/^[a-f0-9]{64}$/.test(target.binarySha256 ?? ""))
    throw new Error(`Codex ${triple} 缺少二进制 SHA-256`);
}

if (opencode.version !== "1.18.15" || opencode.license !== "MIT")
  throw new Error("OpenCode 固定版本必须为 1.18.15（MIT）");
const opencodeManifest = await readFile(
  join(root, "vendor/opencode/packages/opencode/package.json"),
);
const manifestSha = createHash("sha256").update(opencodeManifest).digest("hex");
if (manifestSha !== opencode.packageManifestSha256)
  throw new Error("OpenCode 源码清单校验失败，vendor 内容可能已变化");

if (
  dsh.version !== "0.1.0-rc.5" ||
  dsh.license !== "MIT" ||
  dsh.packageManager !== "pnpm@11.7.0" ||
  dsh.lockfile !== "pnpm-lock.yaml"
)
  throw new Error("DSH 固定版本必须为 0.1.0-rc.5（MIT，pnpm 11.7.0）");
const dshRoot = join(root, "vendor/deepseek-harness");
const dshManifest = await readJson(join(dshRoot, "package.json"));
if (
  dshManifest.version !== dsh.version ||
  dshManifest.license !== dsh.license ||
  dshManifest.packageManager !== dsh.packageManager
)
  throw new Error("DSH package.json 与锁定文件不一致");
const dshPnpmLock = await readFile(join(dshRoot, dsh.lockfile));
const dshPnpmLockSha = createHash("sha256").update(dshPnpmLock).digest("hex");
if (dshPnpmLockSha !== dsh.pnpmLockSha256)
  throw new Error("DSH pnpm-lock.yaml 校验失败");

const dshExcludedDirectories = new Set([
  ".git",
  "node_modules",
  "lib",
  "dist",
  "dist-exe",
  "coverage",
  ".turbo",
  ".cache",
]);
const dshRuntimeOutput =
  "python/sdk-runtime/src/deepseek_harness_runtime/runtime/node";
async function collectDshSourceFiles(relative = "") {
  const files = [];
  for (const entry of await readdir(join(dshRoot, relative), {
    withFileTypes: true,
  })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (
        dshExcludedDirectories.has(entry.name) ||
        path === dshRuntimeOutput ||
        path.startsWith(`${dshRuntimeOutput}/`)
      )
        continue;
      files.push(...(await collectDshSourceFiles(path)));
    } else if (
      entry.name !== ".DS_Store" &&
      !entry.name.endsWith(".tsbuildinfo")
    ) {
      files.push({ path, link: entry.isSymbolicLink() });
    }
  }
  return files;
}
const dshSourceFiles = (await collectDshSourceFiles()).sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
);
const dshTreeHash = createHash("sha256");
for (const file of dshSourceFiles) {
  const content = file.link
    ? Buffer.from(`link:${await readlink(join(dshRoot, file.path))}`)
    : await readFile(join(dshRoot, file.path));
  const contentHash = createHash("sha256").update(content).digest("hex");
  dshTreeHash.update(`${file.path}\0${contentHash}\n`);
}
if (
  dshSourceFiles.length !== dsh.sourceTreeFileCount ||
  dshTreeHash.digest("hex") !== dsh.sourceTreeSha256
)
  throw new Error("DSH 完整源码树校验失败，vendor 冻结快照可能已变化");

async function frozenTree(
  rootDirectory,
  excludedDirectories,
  excludedPaths = new Set(),
) {
  async function collect(relative = "") {
    const files = [];
    for (const entry of await readdir(join(rootDirectory, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (excludedPaths.has(path)) continue;
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name))
          files.push(...(await collect(path)));
      } else if (
        entry.name !== ".DS_Store" &&
        !entry.name.endsWith(".pyc") &&
        !entry.name.endsWith(".tsbuildinfo")
      ) {
        files.push({ path, link: entry.isSymbolicLink() });
      }
    }
    return files;
  }
  const files = (await collect()).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const file of files) {
    const content = file.link
      ? Buffer.from(`link:${await readlink(join(rootDirectory, file.path))}`)
      : await readFile(join(rootDirectory, file.path));
    hash.update(
      `${file.path}\0${createHash("sha256").update(content).digest("hex")}\n`,
    );
  }
  return { count: files.length, sha256: hash.digest("hex") };
}

const hermesRoot = join(root, "vendor/hermes-agent");
const hermesManifest = await readFile(
  join(hermesRoot, "pyproject.toml"),
  "utf8",
);
if (
  hermes.version !== "0.20.1" ||
  hermes.license !== "MIT" ||
  hermes.requiresPython !== ">=3.11,<3.14" ||
  hermes.uvVersion !== "0.9.28" ||
  hermes.pythonVersion !== "3.11.15" ||
  hermes.pythonStandaloneRelease !== "20260807" ||
  hermes.lockfile !== "uv.lock"
)
  throw new Error(
    "Hermes 固定版本必须为 0.20.1（MIT，uv 0.9.28，CPython 3.11.15）",
  );
if (
  !hermesManifest.includes('version = "0.20.1"') ||
  !hermesManifest.includes('license = "MIT"') ||
  !hermesManifest.includes('requires-python = ">=3.11,<3.14"')
)
  throw new Error("Hermes pyproject.toml 与锁定文件不一致");
const hermesUvLock = await readFile(join(hermesRoot, hermes.lockfile));
if (
  createHash("sha256").update(hermesUvLock).digest("hex") !==
  hermes.uvLockSha256
)
  throw new Error("Hermes uv.lock 校验失败");
const hermesTree = await frozenTree(
  hermesRoot,
  new Set([
    ".git",
    ".venv",
    "node_modules",
    "dist",
    "dist-runtime",
    "build",
    "coverage",
    ".pytest_cache",
    ".ruff_cache",
    "__pycache__",
    ".cache",
    "target",
    "out",
  ]),
);
if (
  hermesTree.count !== hermes.sourceTreeFileCount ||
  hermesTree.sha256 !== hermes.sourceTreeSha256
)
  throw new Error("Hermes 完整源码树校验失败，vendor 冻结快照可能已变化");

if (
  !Array.isArray(hermes.runtimePlatforms) ||
  hermes.runtimePlatforms.length !== 6
)
  throw new Error("Hermes 运行时清单必须覆盖 macOS、Windows、Linux 双架构");
for (const platform of hermes.runtimePlatforms) {
  const artifact = hermes.pythonArtifacts?.[platform];
  if (
    !artifact ||
    !artifact.url?.includes(`/20260807/cpython-3.11.15%2B20260807-`) ||
    !artifact.url.endsWith("-install_only_stripped.tar.gz") ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")
  )
    throw new Error(`Hermes ${platform} 缺少锁定的 CPython 3.11.15 运行时`);
}
if (
  Object.keys(hermes.pythonArtifacts ?? {}).some(
    (platform) => !hermes.runtimePlatforms.includes(platform),
  )
)
  throw new Error("Hermes CPython 运行时清单包含未声明平台");

process.stdout.write(
  `活动引擎锁定文件有效：OpenCode ${opencode.version}；Codex ${codex.version}（${requiredTriples.length} 个平台）；DSH ${dsh.version}；Hermes ${hermes.version}\n`,
);
