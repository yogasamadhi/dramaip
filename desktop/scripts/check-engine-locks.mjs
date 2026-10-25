import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(root, "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const codex = await readJson(join(repositoryRoot, "vendor/codex.lock.json"));
const protocol = await readJson(
  join(repositoryRoot, "vendor/codex.protocol.lock.json"),
);
const dsh = await readJson(
  join(repositoryRoot, "vendor/deepseek-harness.lock.json"),
);
const pi = await readJson(join(repositoryRoot, "vendor/pi.lock.json"));
const langgraph = await readJson(
  join(repositoryRoot, "vendor/langgraph.lock.json"),
);

const langgraphPackages = {
  "@langchain/langgraph": "1.4.9",
  "@langchain/core": "1.2.4",
  ai: "6.0.168",
  "@ai-sdk/anthropic": "3.0.82",
  "@ai-sdk/google": "3.0.73",
  "@ai-sdk/openai": "3.0.84",
  "@ai-sdk/openai-compatible": "2.0.56",
};
if (
  langgraph.package !== "@langchain/langgraph" ||
  langgraph.version !== langgraphPackages["@langchain/langgraph"] ||
  langgraph.license !== "MIT" ||
  langgraph.core?.package !== "@langchain/core" ||
  langgraph.core?.version !== langgraphPackages["@langchain/core"] ||
  langgraph.core?.license !== "MIT"
)
  throw new Error("LangGraph.js 固定版本必须为 1.4.9（MIT，Core 1.2.4）");
const expectedModelRuntime = Object.fromEntries(
  Object.entries(langgraphPackages).filter(
    ([name]) => name !== "@langchain/langgraph" && name !== "@langchain/core",
  ),
);
if (
  JSON.stringify(langgraph.modelRuntime) !==
  JSON.stringify(expectedModelRuntime)
)
  throw new Error("LangGraph 模型依赖锁定清单不完整");
for (const [name, version] of Object.entries(langgraph.modelRuntime ?? {}))
  if (langgraphPackages[name] !== version)
    throw new Error(`LangGraph 模型依赖锁定不一致：${name}`);
const agentAdapterManifest = await readJson(
  join(root, "packages/ai/package.json"),
);
const bunLock = await readFile(join(root, "bun.lock"), "utf8");
for (const [name, version] of Object.entries(langgraphPackages)) {
  if (agentAdapterManifest.dependencies?.[name] !== version)
    throw new Error(`LangGraph 依赖未精确固定：${name}@${version}`);
  const resolution = bunLock
    .split("\n")
    .find(
      (line) =>
        line.includes(`"${name}": [`) && line.includes(`${name}@${version}`),
    );
  if (!resolution)
    throw new Error(`bun.lock 缺少 LangGraph 依赖：${name}@${version}`);
  if (!resolution.includes("sha512-"))
    throw new Error(`bun.lock 缺少 LangGraph 依赖完整性摘要：${name}`);
}
if (/better-sqlite3/iu.test(bunLock))
  throw new Error("LangGraph 引擎不得引入 better-sqlite3 checkpointer");
const langgraphNotices = await readFile(
  join(
    root,
    "apps/desktop/build/third-party-notices/LangGraph-and-AI-SDK-NOTICES.md",
  ),
  "utf8",
);
for (const name of Object.keys(langgraphPackages))
  if (!langgraphNotices.includes(name))
    throw new Error(`LangGraph 第三方许可证清单缺少：${name}`);

if (codex.package !== "@openai/codex" || codex.version !== "0.164.0")
  throw new Error("Codex 固定版本必须为 @openai/codex 0.164.0");
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

if (
  dsh.version !== "0.2.1-rc.3" ||
  dsh.license !== "MIT" ||
  dsh.packageManager !== "pnpm@11.28.5" ||
  dsh.lockfile !== "pnpm-lock.yaml"
)
  throw new Error("DSH 固定版本必须为 0.2.1-rc.3（MIT，pnpm 11.28.5）");
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
  pi.version !== "1.4.0" ||
  pi.license !== "MIT" ||
  pi.node !== ">=22.19.0" ||
  pi.lockfile !== "package-lock.json"
)
  throw new Error("Pi 固定版本必须为 1.4.0（MIT，Node >=22.19.0）");
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
);
if (
  piTree.count !== pi.sourceTreeFileCount ||
  piTree.sha256 !== pi.sourceTreeSha256
)
  throw new Error("Pi 完整源码树校验失败，vendor 冻结快照可能已变化");

process.stdout.write(
  `活动引擎锁定文件有效：Pi ${pi.version}；Codex ${codex.version}（${requiredTriples.length} 个平台）；LangGraph.js ${langgraph.version}。框架源码快照完整：DSH ${dsh.version}\n`,
);
