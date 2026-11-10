import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = root;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const dsh = await readJson(
  join(repositoryRoot, "vendor/deepseek-harness.lock.json"),
);
const pi = await readJson(join(repositoryRoot, "vendor/pi.lock.json"));

const agentAdapterManifest = await readJson(
  join(root, "packages/ai/package.json"),
);
const pnpmLock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
if (
  Object.keys(agentAdapterManifest.dependencies ?? {}).some(
    (name) => name === "ai" || name.startsWith("@ai-sdk/"),
  ) ||
  /(?:^  '?@ai-sdk\/|^  ai@\d)/mu.test(pnpmLock)
)
  throw new Error("模型调用只使用 Pi，不得引入 Vercel AI SDK");
if (
  Object.keys(agentAdapterManifest.dependencies ?? {}).some((name) =>
    name.startsWith("@langchain/"),
  ) ||
  /@langchain\//u.test(pnpmLock)
)
  throw new Error("Pi 单引擎不应包含额外的图编排 SDK 依赖");
if (
  dsh.version !== "0.2.2-alpha.3" ||
  dsh.license !== "MIT" ||
  dsh.packageManager !== "pnpm@11.28.5" ||
  dsh.lockfile !== "pnpm-lock.yaml"
)
  throw new Error("DSH 固定版本必须为 0.2.2-alpha.3（MIT，pnpm 11.28.5）");
const dshRoot = join(repositoryRoot, "vendor/deepseek-harness");
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
    if (entry.name === ".git") continue;
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
      if (entry.name === ".git" || excludedPaths.has(path)) continue;
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

const piRoot = join(repositoryRoot, "vendor/pi");
const piManifest = await readJson(join(piRoot, "packages/agent/package.json"));
if (
  pi.package !== "@earendil-works/pi-agent-core" ||
  pi.version !== "1.5.0" ||
  pi.license !== "MIT" ||
  pi.node !== ">=22.19.0" ||
  pi.lockfile !== "package-lock.json"
)
  throw new Error("Pi 固定版本必须为 1.5.0（MIT，Node >=22.19.0）");
if (
  piManifest.name !== pi.package ||
  piManifest.version !== pi.version ||
  piManifest.license !== pi.license ||
  piManifest.engines?.node !== pi.node
)
  throw new Error("Pi Agent package.json 与锁定文件不一致");
const piPackageLock = await readFile(join(piRoot, pi.lockfile));
if (
  createHash("sha256").update(piPackageLock).digest("hex") !==
  pi.packageLockSha256
)
  throw new Error("Pi package-lock.json 校验失败");
const piTree = await frozenTree(
  piRoot,
  new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".cache",
    "out",
  ]),
  new Set(["packages/ai/src/providers/data"]),
);
if (
  JSON.stringify(pi.excludedPaths) !==
    JSON.stringify(["packages/ai/src/providers/data"]) ||
  pi.modelData?.sourceRevision !== pi.revision ||
  pi.modelData?.archive !== "pi-model-data.tgz" ||
  createHash("sha256")
    .update(await readFile(join(repositoryRoot, "vendor/pi-model-data.tgz")))
    .digest("hex") !== pi.modelData.sha256
)
  throw new Error("Pi 生成模型目录归档校验失败");
if (
  piTree.count !== pi.sourceTreeFileCount ||
  piTree.sha256 !== pi.sourceTreeSha256
)
  throw new Error("Pi 完整源码树校验失败，vendor 冻结快照可能已变化");

process.stdout.write(
  `活动引擎锁定文件有效：Pi ${pi.version}。框架源码快照完整：DSH ${dsh.version}\n`,
);
